class BackgroundJobCursorRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.tableName = options.tableName || 'background_job_cursors';
  }

  async get(jobName) {
    const rows = await this.dataSource.query(
      `SELECT \`cursor\` FROM \`${this.tableName}\` WHERE \`job_name\` = ?`,
      [jobName]
    );
    return rows && rows[0] ? String(rows[0].cursor) : '0';
  }

  async set(jobName, cursor) {
    await this.dataSource.query(
      `INSERT INTO \`${this.tableName}\` (\`job_name\`, \`cursor\`, \`updated_at\`) VALUES (?, ?, CURRENT_TIMESTAMP) ON DUPLICATE KEY UPDATE \`cursor\` = VALUES(\`cursor\`), \`updated_at\` = CURRENT_TIMESTAMP`,
      [jobName, String(cursor)]
    );
  }
}

module.exports = {
  BackgroundJobCursorRepository
};
