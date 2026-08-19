const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const AVATAR_FILENAME_PATTERN = /^avatar-\d+-[a-f0-9]{32}\.(png|jpg|webp)$/i;

class LocalAvatarStorage {
  constructor(options = {}) {
    this.directory = options.directory || path.join(process.cwd(), 'public', 'avatars');
    this.publicBaseUrl = String(options.publicBaseUrl || '').replace(/\/+$/, '');
  }

  async write({ userId, ext, buffer }) {
    await fs.mkdir(this.directory, { recursive: true });
    const filename = `avatar-${Number(userId)}-${crypto.randomUUID().replace(/-/g, '')}.${ext}`;
    const target = path.join(this.directory, filename);
    await fs.writeFile(target, buffer);
    return `${this.publicBaseUrl}/${filename}`;
  }

  async delete(publicUrl) {
    const filename = this.filenameFromUrl(publicUrl);
    if (!filename || !AVATAR_FILENAME_PATTERN.test(filename)) {
      return;
    }

    try {
      await fs.unlink(path.join(this.directory, filename));
    } catch (error) {
      if (error && error.code !== 'ENOENT') {
        return;
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
  LocalAvatarStorage
};
