const { GIANT_BREED_GROUPS, NOT_GIANT_BREEDS } = require('../../core/giant-breeds');

const TABLE = 'nutrition_parameter_sets';
const AUDIT = 'admin_audit_events';
const REASON = 'racas_gigantes';

function parse(value) {
  if (value && typeof value === 'object') return value;
  return JSON.parse(String(value || 'null'));
}

/**
 * The giant breed lists with every breed whose adult weighs over 40 kg (src/core/giant-breeds.js). A breed someone
 * added stays where it is; Greyhound, Borzoi and "anatolian" leave the lists; a breed already in a list is not added
 * to another, since a breed may sit in one group only. Null when nothing changes.
 */
function withGiantBreeds(parameters) {
  const current = (parameters && parameters.breed_groups) || {};
  const next = {};
  for (const group of Object.keys(GIANT_BREED_GROUPS)) {
    next[group] = (Array.isArray(current[group]) ? current[group] : []).filter((breed) => !NOT_GIANT_BREEDS.includes(breed));
  }
  const listed = new Set(Object.values(next).flat());
  for (const [group, breeds] of Object.entries(GIANT_BREED_GROUPS)) {
    for (const breed of breeds) {
      if (!listed.has(breed)) {
        next[group].push(breed);
        listed.add(breed);
      }
    }
  }
  const changes = Object.keys(next)
    .map((group) => ({ field: `breed_groups.${group}`, from: (current[group] || []).join(', '), to: next[group].join(', ') }))
    .filter((change) => change.from !== change.to);
  return changes.length ? { parameters: { ...parameters, breed_groups: next }, changes } : null;
}

class NutritionGiantBreeds1700000000079 {
  name = 'NutritionGiantBreeds1700000000079';

  async up(queryRunner) {
    if (!(await queryRunner.hasTable(TABLE))) return;

    const published = await queryRunner.query(`SELECT id, parameters FROM \`${TABLE}\` WHERE status = 'published' ORDER BY id DESC LIMIT 1`);
    if (Array.isArray(published) && published.length) {
      const upgraded = withGiantBreeds(parse(published[0].parameters));
      if (upgraded) {
        await queryRunner.query(`UPDATE \`${TABLE}\` SET status = 'retired' WHERE id = ?`, [published[0].id]);
        const result = await queryRunner.query(
          `INSERT INTO \`${TABLE}\` (status, parameters, published_at) VALUES ('published', ?, CURRENT_TIMESTAMP)`,
          [JSON.stringify(upgraded.parameters)]
        );
        if (await queryRunner.hasTable(AUDIT)) {
          await queryRunner.query(
            `INSERT INTO \`${AUDIT}\` (actor_user_id, actor_email, action, metadata) VALUES (NULL, NULL, 'nutrition.parameters.publish', ?)`,
            [JSON.stringify({ from_set_id: Number(published[0].id), to_set_id: Number(result.insertId), reason: REASON, changes: upgraded.changes })]
          );
        }
      }
    }

    const drafts = await queryRunner.query(`SELECT id, parameters FROM \`${TABLE}\` WHERE status = 'draft'`);
    for (const draft of Array.isArray(drafts) ? drafts : []) {
      const upgraded = withGiantBreeds(parse(draft.parameters));
      if (upgraded) {
        await queryRunner.query(`UPDATE \`${TABLE}\` SET parameters = ? WHERE id = ?`, [JSON.stringify(upgraded.parameters), draft.id]);
      }
    }
  }

  // Publishes again the set this migration retired.
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
  NutritionGiantBreeds1700000000079,
  withGiantBreeds
};
