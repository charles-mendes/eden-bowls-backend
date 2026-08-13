const { HttpError } = require('../../core/http-error');

class AuthRefreshTokenRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.tableName = options.tableName || 'auth_refresh_tokens';
  }

  ensureDataSource() {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new HttpError(503, 'Database connection is not initialized.');
    }
  }

  async create(record) {
    this.ensureDataSource();

    const sql = [
      `INSERT INTO \`${this.tableName}\``,
      '(`id`, `user_id`, `family_id`, `token_hash`, `expires_at`)',
      'VALUES (?, ?, ?, ?, ?)'
    ].join(' ');

    await this.dataSource.query(sql, [
      record.id,
      record.userId,
      record.familyId,
      record.tokenHash,
      record.expiresAt
    ]);
  }

  async findByHash(tokenHash) {
    this.ensureDataSource();

    const sql = [
      'SELECT `id`, `user_id`, `family_id`, `token_hash`, `replaced_by_id`,',
      '`replay_grace_until`, `replay_consumed_at`, `expires_at`, `last_used_at`,',
      '`revoked_at`, `revoked_reason`',
      `FROM \`${this.tableName}\``,
      'WHERE `token_hash` = ?',
      'LIMIT 1'
    ].join(' ');
    const rows = await this.dataSource.query(sql, [tokenHash]);
    const row = Array.isArray(rows) ? rows[0] : null;

    return row ? this.mapRecord(row) : null;
  }

  async rotateAtomically({ tokenHash, successor, now, replayGraceUntil }) {
    this.ensureDataSource();

    return this.dataSource.transaction(async (manager) => {
      const source = await this.findByHashWithManager(manager, tokenHash, true);
      if (!source) {
        return { status: 'missing' };
      }

      if (source.revokedAt || this.isExpired(source.expiresAt, now)) {
        return { status: 'invalid', source };
      }

      if (!source.replacedById) {
        const successorRecord = {
          ...successor,
          userId: source.userId,
          familyId: source.familyId
        };
        await this.createWithManager(manager, successorRecord);
        const marked = await this.markRotatedWithManager(manager, {
          id: source.id,
          replacementId: successorRecord.id,
          now,
          replayGraceUntil
        });

        if (!marked) {
          throw new HttpError(409, 'Unable to rotate refresh token.');
        }

        return { status: 'rotated', source, successor: successorRecord };
      }

      const replayed = await this.consumeReplayGraceWithManager(manager, { id: source.id, now });
      if (!replayed) {
        return { status: 'reuse', source };
      }

      const replacement = await this.findByIdWithManager(manager, source.replacedById, true);
      if (!replacement || replacement.revokedAt || this.isExpired(replacement.expiresAt, now)) {
        return { status: 'invalid', source };
      }

      return { status: 'grace_replay', source, successor: replacement };
    });
  }

  async markRotated({ id, replacementId, now, replayGraceUntil }) {
    this.ensureDataSource();

    const sql = [
      `UPDATE \`${this.tableName}\``,
      'SET `replaced_by_id` = ?, `replay_grace_until` = ?, `last_used_at` = ?',
      'WHERE `id` = ? AND `replaced_by_id` IS NULL AND `revoked_at` IS NULL AND `expires_at` > ?'
    ].join(' ');
    const result = await this.dataSource.query(sql, [replacementId, replayGraceUntil, now, id, now]);

    return this.getAffectedRows(result) === 1;
  }

  async consumeReplayGrace({ id, now }) {
    this.ensureDataSource();

    const sql = [
      `UPDATE \`${this.tableName}\``,
      'SET `replay_consumed_at` = ?, `last_used_at` = ?',
      'WHERE `id` = ? AND `replaced_by_id` IS NOT NULL AND `replay_consumed_at` IS NULL',
      'AND `revoked_at` IS NULL AND `replay_grace_until` >= ?'
    ].join(' ');
    const result = await this.dataSource.query(sql, [now, now, id, now]);

    return this.getAffectedRows(result) === 1;
  }

  async findById(id) {
    this.ensureDataSource();

    const sql = [
      'SELECT `id`, `user_id`, `family_id`, `token_hash`, `replaced_by_id`,',
      '`replay_grace_until`, `replay_consumed_at`, `expires_at`, `last_used_at`,',
      '`revoked_at`, `revoked_reason`',
      `FROM \`${this.tableName}\``,
      'WHERE `id` = ?',
      'LIMIT 1'
    ].join(' ');
    const rows = await this.dataSource.query(sql, [id]);
    const row = Array.isArray(rows) ? rows[0] : null;

    return row ? this.mapRecord(row) : null;
  }

  async revokeFamily(familyId, reason, now) {
    return this.revokeWhere('`family_id` = ?', [familyId], reason, now);
  }

  async revokeAllForUser(userId, reason, now) {
    return this.revokeWhere('`user_id` = ?', [userId], reason, now);
  }

  async deleteExpired(now) {
    this.ensureDataSource();
    const result = await this.dataSource.query(
      `DELETE FROM \`${this.tableName}\` WHERE \`expires_at\` < ?`,
      [now]
    );

    return this.getAffectedRows(result);
  }

  async revokeWhere(whereClause, parameters, reason, now) {
    this.ensureDataSource();

    const sql = [
      `UPDATE \`${this.tableName}\``,
      'SET `revoked_at` = ?, `revoked_reason` = ?',
      `WHERE ${whereClause} AND \`revoked_at\` IS NULL`
    ].join(' ');
    const result = await this.dataSource.query(sql, [now, reason, ...parameters]);

    return this.getAffectedRows(result);
  }

  async findByHashWithManager(manager, tokenHash, lock) {
    const rows = await manager.query(this.selectByClause('`token_hash` = ?', lock), [tokenHash]);
    const row = Array.isArray(rows) ? rows[0] : null;
    return row ? this.mapRecord(row) : null;
  }

  async findByIdWithManager(manager, id, lock) {
    const rows = await manager.query(this.selectByClause('`id` = ?', lock), [id]);
    const row = Array.isArray(rows) ? rows[0] : null;
    return row ? this.mapRecord(row) : null;
  }

  selectByClause(whereClause, lock) {
    return [
      'SELECT `id`, `user_id`, `family_id`, `token_hash`, `replaced_by_id`,',
      '`replay_grace_until`, `replay_consumed_at`, `expires_at`, `last_used_at`,',
      '`revoked_at`, `revoked_reason`',
      `FROM \`${this.tableName}\``,
      `WHERE ${whereClause}`,
      'LIMIT 1',
      lock ? 'FOR UPDATE' : ''
    ].filter(Boolean).join(' ');
  }

  async createWithManager(manager, record) {
    await manager.query(
      `INSERT INTO \`${this.tableName}\` (\`id\`, \`user_id\`, \`family_id\`, \`token_hash\`, \`expires_at\`) VALUES (?, ?, ?, ?, ?)`,
      [record.id, record.userId, record.familyId, record.tokenHash, record.expiresAt]
    );
  }

  async markRotatedWithManager(manager, { id, replacementId, now, replayGraceUntil }) {
    const result = await manager.query(
      `UPDATE \`${this.tableName}\` SET \`replaced_by_id\` = ?, \`replay_grace_until\` = ?, \`last_used_at\` = ? WHERE \`id\` = ? AND \`replaced_by_id\` IS NULL AND \`revoked_at\` IS NULL AND \`expires_at\` > ?`,
      [replacementId, replayGraceUntil, now, id, now]
    );
    return this.getAffectedRows(result) === 1;
  }

  async consumeReplayGraceWithManager(manager, { id, now }) {
    const result = await manager.query(
      `UPDATE \`${this.tableName}\` SET \`replay_consumed_at\` = ?, \`last_used_at\` = ? WHERE \`id\` = ? AND \`replaced_by_id\` IS NOT NULL AND \`replay_consumed_at\` IS NULL AND \`revoked_at\` IS NULL AND \`replay_grace_until\` >= ?`,
      [now, now, id, now]
    );
    return this.getAffectedRows(result) === 1;
  }

  isExpired(expiresAt, now) {
    return new Date(expiresAt).getTime() <= new Date(now).getTime();
  }

  getAffectedRows(result) {
    if (result && typeof result.affectedRows === 'number') {
      return result.affectedRows;
    }

    if (Array.isArray(result) && result[0] && typeof result[0].affectedRows === 'number') {
      return result[0].affectedRows;
    }

    return 0;
  }

  mapRecord(row) {
    return {
      id: String(row.id),
      userId: Number(row.user_id),
      familyId: String(row.family_id),
      tokenHash: String(row.token_hash),
      replacedById: row.replaced_by_id ? String(row.replaced_by_id) : null,
      replayGraceUntil: row.replay_grace_until || null,
      replayConsumedAt: row.replay_consumed_at || null,
      expiresAt: row.expires_at,
      lastUsedAt: row.last_used_at || null,
      revokedAt: row.revoked_at || null,
      revokedReason: row.revoked_reason || null
    };
  }
}

module.exports = {
  AuthRefreshTokenRepository
};