const crypto = require('crypto');
const { toMysqlDateTime } = require('../../core/stripe-subscription-map');

const TABLE = 'bling_connection';
const ROW_ID = 1;

function dateOrNull(value) {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(`${String(value).replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

// The tokens are stored AES-256-GCM encrypted, with a key derived from BLING_CLIENT_SECRET. Rotating the secret
// means authorizing again, which a new secret demands anyway.
class BlingConnectionRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.key = options.clientSecret
      ? crypto.createHash('sha256').update(`bling-connection:${options.clientSecret}`).digest()
      : null;
  }

  encrypt(value) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64')).join('.');
  }

  decrypt(value) {
    if (!value || !this.key) return '';
    try {
      const [iv, tag, encrypted] = String(value).split('.').map((part) => Buffer.from(part, 'base64'));
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    } catch (_error) {
      return '';
    }
  }

  async read() {
    const rows = await this.dataSource.query(`SELECT * FROM \`${TABLE}\` WHERE \`id\` = ? LIMIT 1`, [ROW_ID]);
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return null;
    return {
      accessToken: this.decrypt(row.access_token_enc),
      refreshToken: this.decrypt(row.refresh_token_enc),
      accessExpiresAt: dateOrNull(row.access_expires_at),
      refreshedAt: dateOrNull(row.refreshed_at),
      needsAuthorization: Boolean(Number(row.needs_authorization))
    };
  }

  async saveTokens({ accessToken, refreshToken, accessExpiresAt, now = new Date() }) {
    const values = [
      this.encrypt(accessToken),
      this.encrypt(refreshToken),
      toMysqlDateTime(accessExpiresAt),
      toMysqlDateTime(now)
    ];
    await this.dataSource.query(
      `INSERT INTO \`${TABLE}\` (\`id\`, \`access_token_enc\`, \`refresh_token_enc\`, \`access_expires_at\`, \`refreshed_at\`, \`needs_authorization\`)
       VALUES (?, ?, ?, ?, ?, 0)
       ON DUPLICATE KEY UPDATE \`access_token_enc\` = VALUES(\`access_token_enc\`),
         \`refresh_token_enc\` = VALUES(\`refresh_token_enc\`),
         \`access_expires_at\` = VALUES(\`access_expires_at\`),
         \`refreshed_at\` = VALUES(\`refreshed_at\`),
         \`needs_authorization\` = 0`,
      [ROW_ID, ...values]
    );
  }

  async markNeedsAuthorization() {
    await this.dataSource.query(
      `UPDATE \`${TABLE}\` SET \`needs_authorization\` = 1, \`access_token_enc\` = NULL, \`refresh_token_enc\` = NULL WHERE \`id\` = ?`,
      [ROW_ID]
    );
  }

  async saveState({ stateHash, expiresAt }) {
    await this.dataSource.query(
      `INSERT INTO \`${TABLE}\` (\`id\`, \`state_hash\`, \`state_expires_at\`) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE \`state_hash\` = VALUES(\`state_hash\`), \`state_expires_at\` = VALUES(\`state_expires_at\`)`,
      [ROW_ID, stateHash, toMysqlDateTime(expiresAt)]
    );
  }

  // One use: the update that wins clears the state, so a replayed callback finds nothing.
  async consumeState({ stateHash, now = new Date() }) {
    const result = await this.dataSource.query(
      `UPDATE \`${TABLE}\` SET \`state_hash\` = NULL, \`state_expires_at\` = NULL
       WHERE \`id\` = ? AND \`state_hash\` = ? AND \`state_expires_at\` > ?`,
      [ROW_ID, stateHash, toMysqlDateTime(now)]
    );
    return Number(result && result.affectedRows) === 1;
  }
}

module.exports = {
  BlingConnectionRepository
};
