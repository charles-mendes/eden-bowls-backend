const { HttpError } = require('../../core/http-error');
const { PUBLIC_FEEDBACK_LIMIT } = require('../../core/feedbacks');

function readInsertId(result) {
  if (result && typeof result.insertId !== 'undefined') {
    return Number(result.insertId);
  }

  if (Array.isArray(result) && result[0] && typeof result[0].insertId !== 'undefined') {
    return Number(result[0].insertId);
  }

  return 0;
}

function toIso(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

class FeedbacksRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.tableName = options.tableName || 'feedbacks';
  }

  ensureDataSource() {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new HttpError(503, 'Database connection is not initialized.');
    }
  }

  mapRow(row) {
    if (!row) {
      return null;
    }

    return {
      id: Number(row.id),
      name: String(row.name || ''),
      category: String(row.category || ''),
      country: String(row.country || ''),
      place: String(row.place || ''),
      photo: String(row.photo || ''),
      comment: String(row.comment || ''),
      active: Boolean(Number(row.active)),
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at)
    };
  }

  escapeLike(value) {
    return String(value).replace(/[\\%_]/g, '\\$&');
  }

  buildFilters({ country, active, search } = {}) {
    const filters = [];
    const params = [];

    if (country) {
      filters.push('`country` = ?');
      params.push(country);
    }

    if (typeof active === 'boolean') {
      filters.push('`active` = ?');
      params.push(active ? 1 : 0);
    }

    const term = String(search || '').trim();
    if (term) {
      filters.push("`name` LIKE ? ESCAPE '\\\\'");
      params.push(`%${this.escapeLike(term)}%`);
    }

    return {
      whereClause: filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '',
      params
    };
  }

  async list(query = {}) {
    this.ensureDataSource();

    const { whereClause, params } = this.buildFilters(query);
    const perPage = Number(query.perPage || 20);
    const offset = Number(query.offset || 0);

    const [countRows, itemRows] = await Promise.all([
      this.dataSource.query(
        `SELECT COUNT(*) AS total FROM \`${this.tableName}\` ${whereClause}`.trim(),
        params
      ),
      this.dataSource.query(
        [
          `SELECT * FROM \`${this.tableName}\``,
          whereClause,
          'ORDER BY `created_at` DESC, `id` DESC',
          'LIMIT ? OFFSET ?'
        ].filter(Boolean).join(' '),
        [...params, perPage, offset]
      )
    ]);

    const totalRow = Array.isArray(countRows) ? countRows[0] : null;
    const items = Array.isArray(itemRows) ? itemRows : [];

    return {
      total: Number(totalRow && totalRow.total ? totalRow.total : 0),
      items: items.map((row) => this.mapRow(row))
    };
  }

  async listPublic({ country, limit = PUBLIC_FEEDBACK_LIMIT } = {}) {
    this.ensureDataSource();

    const safeLimit = Math.max(1, Math.min(PUBLIC_FEEDBACK_LIMIT, Number(limit) || PUBLIC_FEEDBACK_LIMIT));
    const rows = await this.dataSource.query(
      [
        `SELECT * FROM \`${this.tableName}\``,
        'WHERE `country` = ? AND `active` = 1',
        'ORDER BY `created_at` ASC, `id` ASC',
        'LIMIT ?'
      ].join(' '),
      [country, safeLimit]
    );

    return (Array.isArray(rows) ? rows : []).map((row) => this.mapRow(row));
  }

  async findById(id) {
    this.ensureDataSource();

    const rows = await this.dataSource.query(
      `SELECT * FROM \`${this.tableName}\` WHERE \`id\` = ? LIMIT 1`,
      [Number(id)]
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    return this.mapRow(row);
  }

  async create({ name, category, country, place, comment, active, photo = '' }) {
    this.ensureDataSource();

    const result = await this.dataSource.query(
      [
        `INSERT INTO \`${this.tableName}\``,
        '(`name`, `category`, `country`, `place`, `photo`, `comment`, `active`)',
        'VALUES (?, ?, ?, ?, ?, ?, ?)'
      ].join(' '),
      [name, category, country, place || '', photo || '', comment, active ? 1 : 0]
    );

    const insertedId = readInsertId(result);
    if (!insertedId) {
      throw new HttpError(500, 'Failed to create feedback.');
    }

    return this.findById(insertedId);
  }

  async update(id, fields = {}) {
    this.ensureDataSource();

    const columns = [];
    const params = [];

    if (Object.prototype.hasOwnProperty.call(fields, 'name')) {
      columns.push('`name` = ?');
      params.push(fields.name);
    }
    if (Object.prototype.hasOwnProperty.call(fields, 'category')) {
      columns.push('`category` = ?');
      params.push(fields.category);
    }
    if (Object.prototype.hasOwnProperty.call(fields, 'country')) {
      columns.push('`country` = ?');
      params.push(fields.country);
    }
    if (Object.prototype.hasOwnProperty.call(fields, 'place')) {
      columns.push('`place` = ?');
      params.push(fields.place || '');
    }
    if (Object.prototype.hasOwnProperty.call(fields, 'photo')) {
      columns.push('`photo` = ?');
      params.push(fields.photo || '');
    }
    if (Object.prototype.hasOwnProperty.call(fields, 'comment')) {
      columns.push('`comment` = ?');
      params.push(fields.comment);
    }
    if (Object.prototype.hasOwnProperty.call(fields, 'active')) {
      columns.push('`active` = ?');
      params.push(fields.active ? 1 : 0);
    }

    if (columns.length === 0) {
      return this.findById(id);
    }

    params.push(Number(id));
    await this.dataSource.query(
      `UPDATE \`${this.tableName}\` SET ${columns.join(', ')} WHERE \`id\` = ? LIMIT 1`,
      params
    );

    return this.findById(id);
  }

  async delete(id) {
    this.ensureDataSource();
    await this.dataSource.query(
      `DELETE FROM \`${this.tableName}\` WHERE \`id\` = ? LIMIT 1`,
      [Number(id)]
    );
    return true;
  }
}

module.exports = {
  FeedbacksRepository
};
