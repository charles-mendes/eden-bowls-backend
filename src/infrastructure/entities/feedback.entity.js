const { EntitySchema } = require('typeorm');

function buildFeedbackEntitySchema(tableName = 'feedbacks') {
  return new EntitySchema({
    name: 'Feedback',
    tableName,
    columns: {
      id: {
        type: Number,
        primary: true,
        generated: true
      },
      name: {
        type: String,
        length: 191
      },
      category: {
        type: String,
        length: 32
      },
      country: {
        type: String,
        length: 2
      },
      place: {
        type: String,
        length: 191,
        default: ''
      },
      photo: {
        type: String,
        length: 512,
        default: ''
      },
      comment: {
        type: 'text'
      },
      active: {
        type: Boolean,
        default: true
      },
      createdAt: {
        name: 'created_at',
        type: 'datetime',
        createDate: true
      },
      updatedAt: {
        name: 'updated_at',
        type: 'datetime',
        updateDate: true
      }
    }
  });
}

module.exports = {
  buildFeedbackEntitySchema
};
