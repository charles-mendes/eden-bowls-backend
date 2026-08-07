const { HttpError } = require('../core/http-error');

class ProductsService {
  constructor(repository) {
    this.repository = repository;
  }

  async listProducts(query) {
    if (!this.repository) {
      throw new HttpError(503, 'Products repository is not available.');
    }

    const payload = await this.repository.listByCategory(query);

    return {
      success: true,
      data: payload
    };
  }
}

module.exports = {
  ProductsService
};
