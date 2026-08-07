const { HttpError } = require('../../core/http-error');

class BreedsRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.tableName = options.tableName || 'wp_hsr_breeds';
    this.hasSizeColumnCache = null;
  }

  async search(search = '', lang = 'pt', limit = 10) {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new HttpError(503, 'Database connection is not initialized.');
    }

    const normalizedLang = this.normalizeLang(lang);
    const normalizedLimit = this.normalizeLimit(limit);
    const hasSizeColumn = await this.hasSizeColumn();
    const nameColumn = normalizedLang === 'en' ? 'name_en' : 'name_pt';
    const selectSize = hasSizeColumn ? '`size`' : "'' AS `size`";
    const filters = [];
    const params = [];

    if (String(search || '').trim() !== '') {
      const like = `%${this.escapeLike(String(search).trim())}%`;
      filters.push("(`name_pt` LIKE ? ESCAPE '\\\\' OR `name_en` LIKE ? ESCAPE '\\\\')");
      params.push(like, like);
    }

    const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
    const sql = [
      `SELECT id, \`name_pt\`, \`name_en\`, ${selectSize}`,
      `FROM \`${this.tableName}\``,
      whereClause,
      `ORDER BY \`${nameColumn}\` ASC`,
      'LIMIT ?'
    ]
      .filter(Boolean)
      .join(' ');

    params.push(normalizedLimit);

    let rows;

    try {
      rows = await this.dataSource.query(sql, params);
    } catch (error) {
      if (this.isMissingTableError(error)) {
        return [];
      }

      throw error;
    }

    const items = Array.isArray(rows) ? rows : [];

    return items.map((item) => ({
      id: Number(item.id),
      name: normalizedLang === 'en' ? String(item.name_en || '') : String(item.name_pt || ''),
      name_pt: String(item.name_pt || ''),
      name_en: String(item.name_en || ''),
      size: this.normalizeSize(item.size)
    }));
  }

  async hasSizeColumn() {
    if (this.hasSizeColumnCache !== null) {
      return this.hasSizeColumnCache;
    }

    try {
      const rows = await this.dataSource.query(`SHOW COLUMNS FROM \`${this.tableName}\` LIKE 'size'`);
      this.hasSizeColumnCache = Array.isArray(rows) && rows.length > 0;
    } catch (error) {
      if (this.isMissingTableError(error)) {
        this.hasSizeColumnCache = false;
      } else {
        throw error;
      }
    }

    return this.hasSizeColumnCache;
  }

  normalizeLang(lang) {
    return String(lang || '').trim().toLowerCase() === 'en' ? 'en' : 'pt';
  }

  normalizeLimit(limit) {
    const parsedLimit = Number(limit);

    if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
      return 10;
    }

    return Math.max(1, Math.min(500, Math.trunc(parsedLimit)));
  }

  normalizeSize(value) {
    const normalized = String(value || '').trim().toLowerCase();

    if (['small', 'medium', 'large'].includes(normalized)) {
      return normalized;
    }

    return '';
  }

  escapeLike(value) {
    return String(value).replace(/[\\%_]/g, '\\$&');
  }

  isMissingTableError(error) {
    return Boolean(
      error && (
        error.code === 'ER_NO_SUCH_TABLE' ||
        error.errno === 1146 ||
        /doesn't exist/i.test(String(error.message || ''))
      )
    );
  }
}

module.exports = {
  BreedsRepository
};