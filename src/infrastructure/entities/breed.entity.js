const { EntitySchema } = require('typeorm');

function buildBreedEntitySchema(tableName = 'wp_hsr_breeds') {
  return new EntitySchema({
    name: 'Breed',
    tableName,
    columns: {
      id: {
        type: Number,
        primary: true,
        generated: true
      },
      namePt: {
        name: 'name_pt',
        type: String,
        length: 191
      },
      nameEn: {
        name: 'name_en',
        type: String,
        length: 191
      },
      size: {
        name: 'size',
        type: String,
        length: 50,
        nullable: true
      }
    }
  });
}

module.exports = {
  buildBreedEntitySchema
};