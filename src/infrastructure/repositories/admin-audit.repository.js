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
}

module.exports = {
  AdminAuditRepository
};
