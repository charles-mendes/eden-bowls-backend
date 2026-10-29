const crypto = require('crypto');
const { HttpError } = require('../core/http-error');
const { assertRecordMarket } = require('../core/admin-market-scope');
const {
  MEDIA_ASSET_IN_USE,
  MEDIA_ASSET_INVALID,
  MEDIA_ASSET_KINDS,
  RECIPE_IMAGE_INVALID,
  normalizeRecipeMarket
} = require('../core/recipe-content');
const { processRecipeImage } = require('../infrastructure/imaging/recipe-image');

const MAX_ORIGINAL_FILENAME_LENGTH = 255;

function marketOf(market) {
  const normalized = normalizeRecipeMarket(market);
  if (!normalized) {
    throw new HttpError(400, 'Market must be BR or US.', { code: 'invalid_market' });
  }
  return normalized;
}

function kindOf(kind) {
  const normalized = String(kind || '').trim().toLowerCase();
  if (!MEDIA_ASSET_KINDS.includes(normalized)) {
    throw new HttpError(422, `Library image kind must be one of ${MEDIA_ASSET_KINDS.join(', ')}.`, { code: MEDIA_ASSET_INVALID, reason: 'kind' });
  }
  return normalized;
}

function originalFilenameOf(value) {
  const name = String(value == null ? '' : value).replace(/[\\/]/g, '_').trim();
  if (!name || name.length > MAX_ORIGINAL_FILENAME_LENGTH) {
    throw new HttpError(422, `Original file name must have 1 to ${MAX_ORIGINAL_FILENAME_LENGTH} characters.`, {
      code: MEDIA_ASSET_INVALID,
      reason: 'originalFilename'
    });
  }
  return name;
}

function decodeImageBase64(imageBase64) {
  const raw = String(imageBase64 || '');
  const buffer = raw && !/data:|,/.test(raw) ? Buffer.from(raw, 'base64') : Buffer.alloc(0);
  if (!buffer.length) {
    throw new HttpError(422, 'Invalid image data.', { code: RECIPE_IMAGE_INVALID, reason: 'data' });
  }
  return buffer;
}

function actorId(actor) {
  const id = actor && (actor.userId || actor.id);
  return id ? Number(id) : null;
}

// Admin image library (plan-image-library). Nothing here deletes an image or its file: archiving only hides it.
class MediaLibraryService {
  constructor(options = {}) {
    this.repository = options.repository;
    this.imageStorage = options.imageStorage || null;
    this.processImage = options.processImage || processRecipeImage;
    this.auditService = options.auditService || null;
  }

  async list({ market, kind, archived } = {}, actor = {}) {
    const normalizedMarket = marketOf(market);
    assertRecordMarket(actor, normalizedMarket);
    const items = await this.repository.list({
      market: normalizedMarket,
      kind: kindOf(kind),
      archived: archived === true || archived === 'true'
    });
    return { market: normalizedMarket, items };
  }

  // Same bytes in the same market and kind return the stored image (restored if archived) with duplicate: true.
  async upload(payload = {}, actor = {}) {
    const market = marketOf(payload.market);
    assertRecordMarket(actor, market);
    const kind = kindOf(payload.kind);
    const originalFilename = originalFilenameOf(payload.originalFilename);
    if (!this.imageStorage || typeof this.imageStorage.writeAsset !== 'function') {
      throw new HttpError(503, 'Recipe image storage is not available.');
    }
    const original = decodeImageBase64(payload.imageBase64);
    const processed = await this.processImage({ mimeType: payload.mimeType, buffer: original, kind });
    const sha256 = crypto.createHash('sha256').update(original).digest('hex');

    const existing = await this.repository.findByHash({ market, kind, sha256 });
    if (existing) {
      return { asset: await this.restoreDuplicate(existing, actor), duplicate: true };
    }

    const url = await this.imageStorage.writeAsset({ market, kind, buffer: processed.buffer });
    const asset = await this.repository.insert({
      kind,
      market,
      url,
      originalFilename,
      mimeType: processed.mimeType,
      width: processed.width,
      height: processed.height,
      bytes: processed.buffer.length,
      sha256,
      uploadedBy: actorId(actor)
    });
    if (!asset) {
      // A concurrent upload stored the same bytes first. The file just written stays unused on disk, like
      // every library file, rather than adding a delete path.
      const winner = await this.repository.findByHash({ market, kind, sha256 });
      return { asset: await this.restoreDuplicate(winner, actor), duplicate: true };
    }

    await this.recordAudit(actor, 'media.upload', asset);
    return { asset, duplicate: false };
  }

  async restoreDuplicate(asset, actor) {
    if (!asset.archived) {
      return asset;
    }
    const restored = await this.repository.restore(asset.id);
    await this.recordAudit(actor, 'media.restore', restored);
    return restored;
  }

  // The image of a library id within the actor's markets; an image outside them reads as not found.
  async get(id, actor = {}) {
    const assetId = Number(id);
    const asset = Number.isInteger(assetId) && assetId > 0 ? await this.repository.findById(assetId) : null;
    if (!asset) {
      throw new HttpError(404, 'Library image not found.');
    }
    assertRecordMarket(actor, asset.market);
    return asset;
  }

  async archive(id, actor = {}) {
    const asset = await this.get(id, actor);
    if (asset.archived) {
      return asset;
    }
    const result = await this.repository.archive(asset.id);
    if (!result.archived) {
      throw new HttpError(409, 'A library image in use cannot be archived.', {
        code: MEDIA_ASSET_IN_USE,
        usedBy: result.usedBy
      });
    }
    await this.recordAudit(actor, 'media.archive', result);
    return result;
  }

  async restore(id, actor = {}) {
    const asset = await this.get(id, actor);
    if (!asset.archived) {
      return asset;
    }
    const restored = await this.repository.restore(asset.id);
    await this.recordAudit(actor, 'media.restore', restored);
    return restored;
  }

  async recordAudit(actor, action, asset) {
    if (!this.auditService || typeof this.auditService.record !== 'function') {
      return;
    }
    await this.auditService.record({
      actor,
      action,
      metadata: { market: asset.market, assetId: asset.id, originalFilename: asset.originalFilename }
    });
  }
}

module.exports = {
  MediaLibraryService
};
