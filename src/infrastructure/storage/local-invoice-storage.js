const fs = require('fs/promises');
const path = require('path');

// Invoice PDFs on the API disk (INVOICE_PDF_DIR; a Docker volume in QA and production). One file per invoice
// number; writing it again replaces the file through a temporary name, so a reader never sees half a PDF.
class LocalInvoiceStorage {
  constructor(options = {}) {
    this.directory = options.directory || path.join(process.cwd(), 'data', 'invoices');
  }

  filenameFor(invoiceNumber) {
    const safe = String(invoiceNumber || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
    if (!safe) {
      throw new Error('An invoice number is required to name the PDF.');
    }
    return `${safe}.pdf`;
  }

  async write({ invoiceNumber, buffer }) {
    await fs.mkdir(this.directory, { recursive: true });
    const filename = this.filenameFor(invoiceNumber);
    const target = path.join(this.directory, filename);
    const temporary = `${target}.${process.pid}.tmp`;
    await fs.writeFile(temporary, buffer);
    await fs.rename(temporary, target);
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
  LocalInvoiceStorage
};
