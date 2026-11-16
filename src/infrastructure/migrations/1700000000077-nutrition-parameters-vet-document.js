const { upgradeNutritionParameters } = require('../../core/nutrition-parameters');

const TABLE = 'nutrition_parameter_sets';
const AUDIT = 'admin_audit_events';
const REASON = 'requerimento_energetico';

function parse(value) {
  if (value && typeof value === 'object') return value;
  return JSON.parse(String(value || 'null'));
}

// The calculation follows the veterinarian's document (requerimento_energetico.md): a giant-dog matrix and cat
// factors 60 and 100. The published set gets them as a new published set, so the old one stays in the history and
// can be copied back; the draft, if any, is upgraded in place. The publication is audited with no actor.
class NutritionParametersVetDocument1700000000077 {
  name = 'NutritionParametersVetDocument1700000000077';

  async up(queryRunner) {
    if (!(await queryRunner.hasTable(TABLE))) return;

    const published = await queryRunner.query(`SELECT id, parameters FROM \`${TABLE}\` WHERE status = 'published' ORDER BY id DESC LIMIT 1`);
    if (Array.isArray(published) && published.length) {
      const current = parse(published[0].parameters);
      const upgraded = upgradeNutritionParameters(current);
      if (upgraded !== current) {
        await queryRunner.query(`UPDATE \`${TABLE}\` SET status = 'retired' WHERE id = ?`, [published[0].id]);
        const result = await queryRunner.query(
          `INSERT INTO \`${TABLE}\` (status, parameters, published_at) VALUES ('published', ?, CURRENT_TIMESTAMP)`,
          [JSON.stringify(upgraded)]
        );
        if (await queryRunner.hasTable(AUDIT)) {
          await queryRunner.query(
            `INSERT INTO \`${AUDIT}\` (actor_user_id, actor_email, action, metadata) VALUES (NULL, NULL, 'nutrition.parameters.publish', ?)`,
            [JSON.stringify({ from_set_id: Number(published[0].id), to_set_id: Number(result.insertId), reason: REASON })]
          );
        }
      }
    }

    const drafts = await queryRunner.query(`SELECT id, parameters FROM \`${TABLE}\` WHERE status = 'draft'`);
    for (const draft of Array.isArray(drafts) ? drafts : []) {
      const current = parse(draft.parameters);
      const upgraded = upgradeNutritionParameters(current);
      if (upgraded !== current) {
        await queryRunner.query(`UPDATE \`${TABLE}\` SET parameters = ? WHERE id = ?`, [JSON.stringify(upgraded), draft.id]);
      }
    }
  }

  // Publishes again the set this migration retired. The upgraded drafts keep the new values.
  async down(queryRunner) {
    if (!(await queryRunner.hasTable(TABLE)) || !(await queryRunner.hasTable(AUDIT))) return;
    const events = await queryRunner.query(
      `SELECT metadata FROM \`${AUDIT}\` WHERE action = 'nutrition.parameters.publish' AND actor_user_id IS NULL
        AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.reason')) = ? ORDER BY id DESC LIMIT 1`,
      [REASON]
    );
    if (!Array.isArray(events) || !events.length) return;
    const metadata = parse(events[0].metadata);
    await queryRunner.query(`UPDATE \`${TABLE}\` SET status = 'retired' WHERE id = ? AND status = 'published'`, [metadata.to_set_id]);
    await queryRunner.query(`UPDATE \`${TABLE}\` SET status = 'published', published_at = CURRENT_TIMESTAMP WHERE id = ?`, [metadata.from_set_id]);
  }
}

module.exports = {
  NutritionParametersVetDocument1700000000077
};
