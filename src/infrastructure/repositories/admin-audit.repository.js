const { HttpError } = require('../../core/http-error');

class AdminAuditRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.tableName = options.tableName || 'admin_audit_events';
  }

  ensureDataSource() {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new HttpError(503, 'Database connection is not initialized.');
    }
  }

  async create(event = {}) {
    this.ensureDataSource();
    const metadata = event.metadata == null ? null : JSON.stringify(event.metadata);
    await this.dataSource.query(
      [
        `INSERT INTO \`${this.tableName}\``,
        '(`actor_user_id`, `actor_email`, `action`, `target_user_id`, `target_email`, `metadata`)',
        'VALUES (?, ?, ?, ?, ?, ?)'
      ].join(' '),
      [
        event.actorUserId || null,
        event.actorEmail || null,
        String(event.action || '').trim(),
        event.targetUserId || null,
        event.targetEmail || null,
        metadata
      ]
    );
  }

  // Inside a caller's transaction, and errors propagate: a change that cannot be audited is not saved.
  async createIn(executor, event = {}) {
    const result = await executor.query(
      [
        `INSERT INTO \`${this.tableName}\``,
        '(`actor_user_id`, `actor_email`, `action`, `target_user_id`, `target_email`, `metadata`)',
        'VALUES (?, ?, ?, ?, ?, ?)'
      ].join(' '),
      [
        event.actorUserId || null,
        event.actorEmail || null,
        String(event.action || '').trim(),
        null,
        null,
        event.metadata == null ? null : JSON.stringify(event.metadata)
      ]
    );
    return Number(result.insertId);
  }

  async findById(id) {
    this.ensureDataSource();
    const rows = await this.dataSource.query(`SELECT id, action, metadata FROM \`${this.tableName}\` WHERE id = ?`, [id]);
    if (!rows.length) return null;
    const metadata = typeof rows[0].metadata === 'string' ? JSON.parse(rows[0].metadata) : (rows[0].metadata || {});
    return { id: Number(rows[0].id), action: rows[0].action, metadata };
  }

  // Calendar events of one market whose date falls in one year, newest first.
  async listDeliveryCalendar({ market, year, limit = 200 }) {
    this.ensureDataSource();
    const rows = await this.dataSource.query(
      `SELECT id, actor_user_id, actor_email, action, metadata, created_at
         FROM \`${this.tableName}\`
        WHERE action LIKE 'delivery\\_calendar.%'
          AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.market')) = ?
          AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.closedOn')) LIKE ?
        ORDER BY created_at DESC, id DESC
        LIMIT ?`,
      [market, `${year}-%`, limit]
    );
    return rows.map((row) => ({
      id: Number(row.id),
      actorUserId: row.actor_user_id == null ? null : Number(row.actor_user_id),
      actorEmail: row.actor_email || null,
      action: row.action,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || {}),
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
    }));
  }
}

module.exports = {
  AdminAuditRepository
};
