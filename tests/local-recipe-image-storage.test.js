const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { createApp } = require('../src/app');
const { LocalRecipeImageStorage } = require('../src/infrastructure/storage/local-recipe-image-storage');

describe('LocalRecipeImageStorage', () => {
  let directory;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'recipe-images-'));
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  test('writes a library image without the recipe slug, under a new name per write', async () => {
    const storage = new LocalRecipeImageStorage({ directory, publicBaseUrl: '/recipe-images' });

    const first = await storage.writeAsset({ market: 'BR', kind: 'plan', buffer: Buffer.from('one') });
    const second = await storage.writeAsset({ market: 'BR', kind: 'plan', buffer: Buffer.from('one') });
    const banner = await storage.writeAsset({ market: 'US', kind: 'banner', buffer: Buffer.from('two') });

    expect(first).toMatch(/^\/recipe-images\/plan-br-[a-f0-9]{32}\.webp$/);
    expect(second).not.toBe(first);
    expect(banner).toMatch(/^\/recipe-images\/banner-us-[a-f0-9]{32}\.webp$/);
    expect(await fs.readFile(path.join(directory, path.basename(first)), 'utf8')).toBe('one');
  });

  test('refuses an unknown library kind or market', async () => {
    const storage = new LocalRecipeImageStorage({ directory, publicBaseUrl: '/recipe-images' });
    await expect(storage.writeAsset({ market: 'XX', kind: 'plan', buffer: Buffer.from('x') })).rejects.toThrow();
    await expect(storage.writeAsset({ market: 'BR', kind: '../x', buffer: Buffer.from('x') })).rejects.toThrow();
    expect(await fs.readdir(directory)).toEqual([]);
  });

  test('has no way to delete or overwrite a file', () => {
    const methods = Object.getOwnPropertyNames(LocalRecipeImageStorage.prototype);
    expect(methods.filter((name) => /delete|remove|unlink|destroy/i.test(name))).toEqual([]);
    expect(methods).not.toContain('write');
  });

  test('the stored URL is served as a public static file', async () => {
    const storage = new LocalRecipeImageStorage({ directory, publicBaseUrl: '/recipe-images' });
    const url = await storage.writeAsset({ market: 'US', kind: 'banner', buffer: Buffer.from('webp-bytes') });
    const app = createApp({ corsOrigins: ['http://localhost:5173'], recipeImagePublicDir: directory });

    const response = await request(app).get(url);

    expect(response.status).toBe(200);
    expect(Buffer.from(response.body).toString()).toBe('webp-bytes');
  });
});
