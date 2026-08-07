const PRODUCTS_ERROR = {
  INVALID_CATEGORY_SLUG: {
    status: 422,
    code: 'invalid_category_slug',
    message: 'Invalid category slug.'
  },
  INVALID_COUNTRY: {
    status: 422,
    code: 'invalid_country',
    message: 'Country is not supported.'
  },
  COUNTRY_CURRENCY_MISMATCH: {
    status: 422,
    code: 'country_currency_mismatch',
    message: 'Currency is not allowed for selected country.'
  },
  CATEGORY_NOT_FOUND: {
    status: 404,
    code: 'category_not_found',
    message: 'Category not found.'
  },
  CATALOG_NOT_INITIALIZED: {
    status: 503,
    code: 'catalog_not_initialized',
    message: 'Products catalog is not initialized. Run migrations and seed data.'
  },
  TOO_MANY_REQUESTS: {
    status: 429,
    code: 'too_many_requests',
    message: 'Too many requests. Please try again later.'
  }
};

module.exports = {
  PRODUCTS_ERROR
};
