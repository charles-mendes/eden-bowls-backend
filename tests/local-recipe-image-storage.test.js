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

  test('writes a new file per upload under the market and flavor and returns its public URL', async () => {
    const storage = new LocalRecipeImageStorage({ directory, publicBaseUrl: 'https://qa-api.edenbowls.com/recipe-images/' });

    const first = await storage.write({ market: 'BR', flavorSlug: 'senior-beef', buffer: Buffer.from('one') });
    const second = await storage.write({ market: 'BR', flavorSlug: 'senior-beef', buffer: Buffer.from('two') });

    expect(first).toMatch(/^https:\/\/qa-api\.edenbowls\.com\/recipe-images\/recipe-br-senior-beef-[a-f0-9]{32}\.webp$/);
    expect(second).not.toBe(first);
    expect(await fs.readFile(path.join(directory, path.basename(first)), 'utf8')).toBe('one');
  });

  test('deletes only its own recipe image names', async () => {
    const storage = new LocalRecipeImageStorage({ directory, publicBaseUrl: '/recipe-images' });
    const url = await storage.write({ market: 'US', flavorSlug: 'beef', buffer: Buffer.from('x') });
    await fs.writeFile(path.join(directory, 'other.png'), 'keep');

    await storage.delete(url);
    await storage.delete('/recipe-images/other.png');
    await storage.delete('/recipe-images/../../etc/passwd');
    await storage.delete(url);

    expect(await fs.readdir(directory)).toEqual(['other.png']);
  });

  test('writes a library image without the recipe slug, under a new name per write', async () => {
    const storage = new LocalRecipeImageStorage({ directory, publicBaseUrl: '/recipe-images' });

    const first = await storage.writeAsset({ market: 'BR', kind: 'plan', buffer: Buffer.from('one') });
    const second = await storage.writeAsset({ market: 'BR', kind: 'plan', buffer: Buffer.from('one') });

    expect(first).toMatch(/^\/recipe-images\/plan-br-[a-f0-9]{32}\.webp$/);
    expect(second).not.toBe(first);
    expect(await fs.readFile(path.join(directory, path.basename(first)), 'utf8')).toBe('one');
  });

  test('refuses an unknown library kind or market', async () => {
    const storage = new LocalRecipeImageStorage({ directory, publicBaseUrl: '/recipe-images' });
    await expect(storage.writeAsset({ market: 'XX', kind: 'plan', buffer: Buffer.from('x') })).rejects.toThrow();
    await expect(storage.writeAsset({ market: 'BR', kind: '../x', buffer: Buffer.from('x') })).rejects.toThrow();
    expect(await fs.readdir(directory)).toEqual([]);
  });

  test('never deletes a library image file', async () => {
    const storage = new LocalRecipeImageStorage({ directory, publicBaseUrl: '/recipe-images' });
    const url = await storage.writeAsset({ market: 'US', kind: 'plan', buffer: Buffer.from('x') });

    await storage.delete(url);

    expect(await fs.readdir(directory)).toEqual([path.basename(url)]);
  });

  test('the stored URL is served as a public static file', async () => {
    const storage = new LocalRecipeImageStorage({ directory, publicBaseUrl: '/recipe-images' });
    const url = await storage.write({ market: 'US', flavorSlug: 'beef', buffer: Buffer.from('webp-bytes') });
    const app = createApp({ corsOrigins: ['http://localhost:5173'], recipeImagePublicDir: directory });

    const response = await request(app).get(url);

    expect(response.status).toBe(200);
    expect(Buffer.from(response.body).toString()).toBe('webp-bytes');
  });
});
