const request = require('supertest');
const { createApp } = require('../src/app');
const { HttpError } = require('../src/core/http-error');

describe('products routes', () => {
  const corsOrigins = ['http://localhost:5173'];

  test('returns products contract for the /api/v1 path', async () => {
    const productsService = {
      listProducts: jest.fn().mockResolvedValue({
        success: true,
        data: {
          country: 'BR',
          currency: 'BRL',
          category: {
            id: 123,
            slug: 'flavors',
            name: 'Flavors'
          },
          products: [
            {
              product_id: 1001,
              name: 'Plano Premium',
              slug: 'plano-premium',
              country: 'BR',
              currency: 'BRL',
              days: 30,
              tags: [{ id: 7, name: 'frango', slug: 'frango' }],
              starting_price: 29.9,
              variations: [
                {
                  variation_id: 2001,
                  flavor: 'Frango',
                  weight: '300g',
                  price: 29.9,
                  currency: 'BRL'
                }
              ]
            }
          ],
          empty: false
        }
      })
    };

    const app = createApp({ productsService, corsOrigins });
    const response = await request(app)
      .get('/api/v1/products')
      .query({ category_slug: 'flavors', country: 'BR', currency: 'BRL' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.country).toBe('BR');
    expect(productsService.listProducts).toHaveBeenCalledWith({
      categorySlug: 'flavors',
      country: 'BR',
      currency: 'BRL'
    });
  });

  test('applies currency fallback by country when currency is omitted', async () => {
    const productsService = {
      listProducts: jest.fn().mockResolvedValue({
        success: true,
        data: {
          country: 'BR',
          currency: 'BRL',
          category: {
            id: 123,
            slug: 'flavors',
            name: 'Flavors'
          },
          products: [],
          empty: true
        }
      })
    };

    const app = createApp({ productsService, corsOrigins });
    const response = await request(app)
      .get('/api/v1/products')
      .query({ category_slug: 'flavors', country: 'BR' });

    expect(response.status).toBe(200);
    expect(productsService.listProducts).toHaveBeenCalledWith({
      categorySlug: 'flavors',
      country: 'BR',
      currency: 'BRL'
    });
  });

  test('returns 422 wp-style error for invalid country', async () => {
    const productsService = {
      listProducts: jest.fn()
    };

    const app = createApp({ productsService, corsOrigins });
    const response = await request(app)
      .get('/api/v1/products')
      .query({ category_slug: 'flavors', country: 'AR', currency: 'ARS' });

    expect(response.status).toBe(422);
    expect(response.body).toEqual({
      code: 'invalid_country',
      message: 'Country is not supported.',
      data: { status: 422 }
    });
    expect(productsService.listProducts).not.toHaveBeenCalled();
  });

  test('returns 422 wp-style error for invalid category slug', async () => {
    const productsService = {
      listProducts: jest.fn()
    };

    const app = createApp({ productsService, corsOrigins });
    const response = await request(app)
      .get('/api/v1/products')
      .query({ category_slug: '   ', country: 'BR', currency: 'BRL' });

    expect(response.status).toBe(422);
    expect(response.body).toEqual({
      code: 'invalid_category_slug',
      message: 'Invalid category slug.',
      data: { status: 422 }
    });
    expect(productsService.listProducts).not.toHaveBeenCalled();
  });

  test('returns 422 wp-style error for currency mismatch', async () => {
    const productsService = {
      listProducts: jest.fn()
    };

    const app = createApp({ productsService, corsOrigins });
    const response = await request(app)
      .get('/api/v1/products')
      .query({ category_slug: 'flavors', country: 'BR', currency: 'USD' });

    expect(response.status).toBe(422);
    expect(response.body).toEqual({
      code: 'country_currency_mismatch',
      message: 'Currency is not allowed for selected country.',
      data: { status: 422 }
    });
    expect(productsService.listProducts).not.toHaveBeenCalled();
  });

  test('returns 404 wp-style error for missing category', async () => {
    const productsService = {
      listProducts: jest.fn().mockRejectedValue(
        new HttpError(404, 'Category not found.', {
          code: 'category_not_found'
        })
      )
    };

    const app = createApp({ productsService, corsOrigins });
    const response = await request(app)
      .get('/api/v1/products')
      .query({ category_slug: 'flavors', country: 'BR', currency: 'BRL' });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      code: 'category_not_found',
      message: 'Category not found.',
      data: { status: 404 }
    });
  });

  test('returns 503 clear error when catalog is not initialized', async () => {
    const productsService = {
      listProducts: jest.fn().mockRejectedValue(
        new HttpError(503, 'Products catalog is not initialized. Run migrations and seed data.', {
          code: 'catalog_not_initialized'
        })
      )
    };

    const app = createApp({ productsService, corsOrigins });
    const response = await request(app)
      .get('/api/v1/products')
      .query({ category_slug: 'flavors', country: 'BR', currency: 'BRL' });

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      code: 'catalog_not_initialized',
      message: 'Products catalog is not initialized. Run migrations and seed data.',
      data: { status: 503 }
    });
  });
});
