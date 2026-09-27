const { EntitySchema } = require('typeorm');

function buildBackgroundJobCursorEntitySchema(tableName = 'background_job_cursors') {
  return new EntitySchema({
    name: 'BackgroundJobCursor',
    tableName,
    columns: {
      jobName: {
        name: 'job_name',
        type: String,
        length: 64,
        primary: true
      },
      cursor: {
        type: String,
        length: 191,
        default: '0'
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
  buildBackgroundJobCursorEntitySchema
};
