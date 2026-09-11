const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

class LocalUpsLabelStorage {
  constructor(options = {}) {
    this.directory = options.directory || path.join(process.cwd(), 'data', 'ups-labels');
  }

  async write({ invoiceId, format = 'gif', buffer }) {
    await fs.mkdir(this.directory, { recursive: true });
    const safeInvoice = String(invoiceId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'unknown';
    const ext = String(format || 'gif').toLowerCase() === 'pdf' ? 'pdf' : 'gif';
    const filename = `label-${safeInvoice}-${crypto.randomUUID().replace(/-/g, '')}.${ext}`;
    const target = path.join(this.directory, filename);
    await fs.writeFile(target, buffer);
    return filename;
  }

  resolvePath(filename) {
    const name = path.basename(String(filename || '').trim());
    if (!name || name.includes('..')) {
      return null;
    }
    return path.join(this.directory, name);
  }

  async read(filename) {
    const target = this.resolvePath(filename);
    if (!target) {
      return null;
    }
    try {
      return await fs.readFile(target);
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }
}

module.exports = {
  LocalUpsLabelStorage
};
