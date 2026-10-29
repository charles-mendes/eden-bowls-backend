const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const MEDIA_ASSET_FILENAME_PATTERN = /^(plan|banner)-(br|us)-[a-f0-9]{32}\.webp$/;

// Recipe library images on local disk (RECIPE_IMAGE_DIR), served at /recipe-images. A new name per upload
// keeps browsers and CDNs from serving a replaced image. There is no delete: a file written here stays, so a
// replaced or unlinked banner or thumbnail keeps its URL (plan-image-library).
class LocalRecipeImageStorage {
  constructor(options = {}) {
    this.directory = options.directory || path.join(process.cwd(), 'public', 'recipe-images');
    this.publicBaseUrl = String(options.publicBaseUrl || '').replace(/\/+$/, '');
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
}

module.exports = {
  LocalRecipeImageStorage
};
