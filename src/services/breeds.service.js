class BreedsService {
  constructor(repository) {
    this.repository = repository;
  }

  async listBreeds(query) {
    const items = await this.repository.search(query.search, query.lang, query.limit);

    return {
      success: true,
      data: {
        items
      }
    };
  }
}

module.exports = {
  BreedsService
};