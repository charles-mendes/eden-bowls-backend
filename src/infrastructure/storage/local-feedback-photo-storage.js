const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const PHOTO_FILENAME_PATTERN = /^photo-\d+-[a-f0-9]{32}\.(png|jpg|webp)$/i;

class LocalFeedbackPhotoStorage {
  constructor(options = {}) {
    this.directory = options.directory || path.join(process.cwd(), 'public', 'feedback-photos');
    this.publicBaseUrl = String(options.publicBaseUrl || '').replace(/\/+$/, '');
  }

  async write({ feedbackId, ext, buffer }) {
    await fs.mkdir(this.directory, { recursive: true });
    const filename = `photo-${Number(feedbackId)}-${crypto.randomUUID().replace(/-/g, '')}.${ext}`;
    const target = path.join(this.directory, filename);
    await fs.writeFile(target, buffer);
    return `${this.publicBaseUrl}/${filename}`;
  }

  async delete(publicUrl) {
    const filename = this.filenameFromUrl(publicUrl);
    if (!filename || !PHOTO_FILENAME_PATTERN.test(filename)) {
      return;
    }

    try {
      await fs.unlink(path.join(this.directory, filename));
    } catch (error) {
      if (error && error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  filenameFromUrl(publicUrl) {
    const value = String(publicUrl || '').trim();
    if (!value) {
      return '';
    }

    try {
      const parsed = new URL(value, 'http://localhost');
      return path.basename(parsed.pathname || '');
    } catch {
      return path.basename(value);
    }
  }
}

module.exports = {
  LocalFeedbackPhotoStorage
};
