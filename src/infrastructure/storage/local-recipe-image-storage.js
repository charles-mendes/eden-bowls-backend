const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const RECIPE_IMAGE_FILENAME_PATTERN = /^recipe-(br|us)-[a-z0-9-]+-[a-f0-9]{32}\.webp$/;

// Recipe banner images on local disk (RECIPE_IMAGE_DIR), served at /recipe-images. A new name per upload
// keeps browsers and CDNs from serving the replaced image.
class LocalRecipeImageStorage {
  constructor(options = {}) {
    this.directory = options.directory || path.join(process.cwd(), 'public', 'recipe-images');
    this.publicBaseUrl = String(options.publicBaseUrl || '').replace(/\/+$/, '');
  }

  async write({ market, flavorSlug, buffer }) {
    const slug = String(flavorSlug || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'recipe';
    await fs.mkdir(this.directory, { recursive: true });
    const filename = `recipe-${String(market).toLowerCase()}-${slug}-${crypto.randomUUID().replace(/-/g, '')}.webp`;
    await fs.writeFile(path.join(this.directory, filename), buffer);
    return `${this.publicBaseUrl}/${filename}`;
  }

  async delete(publicUrl) {
    const filename = this.filenameFromUrl(publicUrl);
    if (!filename || !RECIPE_IMAGE_FILENAME_PATTERN.test(filename)) {
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
  LocalRecipeImageStorage
};
