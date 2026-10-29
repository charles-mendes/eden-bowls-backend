const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const RECIPE_IMAGE_FILENAME_PATTERN = /^recipe-(br|us)-[a-z0-9-]+-[a-f0-9]{32}\.webp$/;
const MEDIA_ASSET_FILENAME_PATTERN = /^(plan|banner)-(br|us)-[a-f0-9]{32}\.webp$/;

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

  // Library image (plan-image-library): no recipe slug in the name, since a recipe only points at it.
  async writeAsset({ market, kind, buffer }) {
    await fs.mkdir(this.directory, { recursive: true });
    const filename = `${String(kind).toLowerCase()}-${String(market).toLowerCase()}-${crypto.randomUUID().replace(/-/g, '')}.webp`;
    if (!MEDIA_ASSET_FILENAME_PATTERN.test(filename)) {
      throw new Error('Invalid library image kind or market.');
    }
    await fs.writeFile(path.join(this.directory, filename), buffer);
    return `${this.publicBaseUrl}/${filename}`;
  }

  // Banner files only: the API never deletes a library image's file.
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
