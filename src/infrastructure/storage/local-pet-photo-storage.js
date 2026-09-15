const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const PHOTO_FILENAME_PATTERN = /^pet-[a-zA-Z0-9-]{1,36}-[a-f0-9]{32}\.(png|jpg|webp)$/i;

class LocalPetPhotoStorage {
  constructor(options = {}) {
    this.directory = options.directory || path.join(process.cwd(), 'public', 'pet-photos');
    this.publicBaseUrl = String(options.publicBaseUrl || '').replace(/\/+$/, '');
  }

  async write({ petId, ext, buffer }) {
    await fs.mkdir(this.directory, { recursive: true });
    const safeId = String(petId || '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 36) || 'pet';
    const filename = `pet-${safeId}-${crypto.randomUUID().replace(/-/g, '')}.${ext}`;
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
  LocalPetPhotoStorage
};
