const { Table, TableIndex } = require('typeorm');
const { seedFlavorCatalog } = require('./helpers/seed-flavor-catalog');

class CreateProductsCatalogTables1700000000002 {
  name = 'CreateProductsCatalogTables1700000000002';

  async up(queryRunner) {
    await this.createPostsTable(queryRunner);
    await this.createPostmetaTable(queryRunner);
    await this.createTermsTable(queryRunner);
    await this.createTermTaxonomyTable(queryRunner);
    await this.createTermRelationshipsTable(queryRunner);
    await this.seedCatalog(queryRunner);
  }

  async down(queryRunner) {
    if (await queryRunner.hasTable('wp_term_relationships')) {
      await queryRunner.dropTable('wp_term_relationships');
    }

    if (await queryRunner.hasTable('wp_term_taxonomy')) {
      await queryRunner.dropTable('wp_term_taxonomy');
    }

    if (await queryRunner.hasTable('wp_terms')) {
      await queryRunner.dropTable('wp_terms');
    }

    if (await queryRunner.hasTable('wp_postmeta')) {
      await queryRunner.dropTable('wp_postmeta');
    }

    if (await queryRunner.hasTable('wp_posts')) {
      await queryRunner.dropTable('wp_posts');
    }
  }

  async createPostsTable(queryRunner) {
    if (await queryRunner.hasTable('wp_posts')) {
      return;
    }

    await queryRunner.createTable(new Table({
      name: 'wp_posts',
      columns: [
        {
          name: 'ID',
          type: 'bigint',
          unsigned: true,
          isPrimary: true
        },
        {
          name: 'post_parent',
          type: 'bigint',
          unsigned: true,
          isNullable: false,
          default: 0
        },
        {
          name: 'post_type',
          type: 'varchar',
          length: '32',
          isNullable: false
        },
        {
          name: 'post_status',
          type: 'varchar',
          length: '20',
          isNullable: false
        },
        {
          name: 'post_title',
          type: 'varchar',
          length: '255',
          isNullable: false,
          default: "''"
        },
        {
          name: 'post_name',
          type: 'varchar',
          length: '255',
          isNullable: false,
          default: "''"
        },
        {
          name: 'menu_order',
          type: 'int',
          isNullable: false,
          default: 0
        },
        {
          name: 'created_at',
          type: 'datetime',
          isNullable: false,
          default: 'CURRENT_TIMESTAMP'
        },
        {
          name: 'updated_at',
          type: 'datetime',
          isNullable: false,
          default: 'CURRENT_TIMESTAMP',
          onUpdate: 'CURRENT_TIMESTAMP'
        }
      ]
    }), true);

    await queryRunner.createIndex('wp_posts', new TableIndex({
      name: 'idx_wp_posts_type_status',
      columnNames: ['post_type', 'post_status']
    }));

    await queryRunner.createIndex('wp_posts', new TableIndex({
      name: 'idx_wp_posts_parent',
      columnNames: ['post_parent']
    }));
  }

  async createPostmetaTable(queryRunner) {
    if (await queryRunner.hasTable('wp_postmeta')) {
      return;
    }

    await queryRunner.createTable(new Table({
      name: 'wp_postmeta',
      columns: [
        {
          name: 'meta_id',
          type: 'bigint',
          unsigned: true,
          isPrimary: true,
          isGenerated: true,
          generationStrategy: 'increment'
        },
        {
          name: 'post_id',
          type: 'bigint',
          unsigned: true,
          isNullable: false
        },
        {
          name: 'meta_key',
          type: 'varchar',
          length: '255',
          isNullable: false
        },
        {
          name: 'meta_value',
          type: 'longtext',
          isNullable: true
        }
      ]
    }), true);

    await queryRunner.createIndex('wp_postmeta', new TableIndex({
      name: 'idx_wp_postmeta_post_id',
      columnNames: ['post_id']
    }));

    await queryRunner.createIndex('wp_postmeta', new TableIndex({
      name: 'idx_wp_postmeta_meta_key',
      columnNames: ['meta_key']
    }));
  }

  async createTermsTable(queryRunner) {
    if (await queryRunner.hasTable('wp_terms')) {
      return;
    }

    await queryRunner.createTable(new Table({
      name: 'wp_terms',
      columns: [
        {
          name: 'term_id',
          type: 'bigint',
          unsigned: true,
          isPrimary: true
        },
        {
          name: 'name',
          type: 'varchar',
          length: '200',
          isNullable: false
        },
        {
          name: 'slug',
          type: 'varchar',
          length: '200',
          isNullable: false
        }
      ]
    }), true);

    await queryRunner.createIndex('wp_terms', new TableIndex({
      name: 'uk_wp_terms_slug',
      columnNames: ['slug'],
      isUnique: true
    }));
  }

  async createTermTaxonomyTable(queryRunner) {
    if (await queryRunner.hasTable('wp_term_taxonomy')) {
      return;
    }

    await queryRunner.createTable(new Table({
      name: 'wp_term_taxonomy',
      columns: [
        {
          name: 'term_taxonomy_id',
          type: 'bigint',
          unsigned: true,
          isPrimary: true
        },
        {
          name: 'term_id',
          type: 'bigint',
          unsigned: true,
          isNullable: false
        },
        {
          name: 'taxonomy',
          type: 'varchar',
          length: '32',
          isNullable: false
        }
      ]
    }), true);

    await queryRunner.createIndex('wp_term_taxonomy', new TableIndex({
      name: 'idx_wp_term_taxonomy_term_id',
      columnNames: ['term_id']
    }));

    await queryRunner.createIndex('wp_term_taxonomy', new TableIndex({
      name: 'idx_wp_term_taxonomy_taxonomy',
      columnNames: ['taxonomy']
    }));
  }

  async createTermRelationshipsTable(queryRunner) {
    if (await queryRunner.hasTable('wp_term_relationships')) {
      return;
    }

    await queryRunner.createTable(new Table({
      name: 'wp_term_relationships',
      columns: [
        {
          name: 'object_id',
          type: 'bigint',
          unsigned: true,
          isNullable: false
        },
        {
          name: 'term_taxonomy_id',
          type: 'bigint',
          unsigned: true,
          isNullable: false
        }
      ]
    }), true);

    await queryRunner.createIndex('wp_term_relationships', new TableIndex({
      name: 'idx_wp_term_relationships_object_id',
      columnNames: ['object_id']
    }));

    await queryRunner.createIndex('wp_term_relationships', new TableIndex({
      name: 'idx_wp_term_relationships_term_taxonomy_id',
      columnNames: ['term_taxonomy_id']
    }));
  }

  async seedCatalog(queryRunner) {
    await seedFlavorCatalog(queryRunner);
  }
}

module.exports = {
  CreateProductsCatalogTables1700000000002
};
