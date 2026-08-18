function defaultOpenDatabase(filePath) {
  try {
    const maxmind = require('maxmind');
    return maxmind.open(filePath);
  } catch (error) {
    if (error && error.code === 'ERR_REQUIRE_ESM') {
      return import('maxmind').then((mod) => mod.open(filePath));
    }

    throw error;
  }
}

class MaxMindCountryReader {
  constructor({ dbPath, openDatabase } = {}) {
    this.dbPath = dbPath || '';
    this.openDatabase = typeof openDatabase === 'function' ? openDatabase : defaultOpenDatabase;
    this.lookup = null;
  }

  isOpen() {
    return Boolean(this.lookup);
  }

  async open() {
    this.lookup = null;

    if (!this.dbPath) {
      return this;
    }

    try {
      this.lookup = await this.openDatabase(this.dbPath);
    } catch {
      this.lookup = null;
    }

    return this;
  }

  async lookupIsoCode(ip) {
    if (!this.lookup || !ip) {
      return '';
    }

    try {
      const record = typeof this.lookup.get === 'function' ? this.lookup.get(ip) : null;
      const country = record && record.country ? record.country : null;
      const iso = country && (country.iso_code || country.isoCode);
      return iso ? String(iso).trim().toUpperCase() : '';
    } catch {
      return '';
    }
  }
}

module.exports = {
  MaxMindCountryReader
};
