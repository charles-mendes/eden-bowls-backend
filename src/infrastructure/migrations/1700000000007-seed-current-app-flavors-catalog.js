const { seedFlavorCatalog } = require('./helpers/seed-flavor-catalog');

class SeedCurrentAppFlavorsCatalog1700000000007 {
  name = 'SeedCurrentAppFlavorsCatalog1700000000007';

  async up(queryRunner) {
    if (!(await queryRunner.hasTable('wp_posts')) || !(await queryRunner.hasTable('wp_postmeta'))) {
      return;
    }

    await seedFlavorCatalog(queryRunner);
  }

  async down() {
    // Catalog rows are replaced in place. Previous placeholder seed is not restored.
  }
}

module.exports = {
  SeedCurrentAppFlavorsCatalog1700000000007
};
