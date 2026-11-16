const TABLE = 'nutrition_parameter_sets';
const AUDIT = 'admin_audit_events';
const REASON = 'em_alimento_fresco';
const OLD = { dog: 3600, cat: 3800 };
const NEW = { dog: 1200, cat: 1200 };

function parse(value) {
  if (value && typeof value === 'object') return value;
  return JSON.parse(String(value || 'null'));
}

// The default EM of the food (`nem`, kcal/kg) was the dry kibble value 3600/3800; Eden Bowls sells fresh food at
// 1150 to 1500 kcal/kg. Each species still on the old default gets 1200; a value someone edited is kept. The
// published set is published again (the old one stays in the history), the draft is changed in place.
function withFreshDefault(parameters) {
  const nem = parameters && parameters.nem ? parameters.nem : {};
  const next = { ...nem };
  let changed = false;
  for (const species of Object.keys(OLD)) {
    if (Number(nem[species]) === OLD[species]) {
      next[species] = NEW[species];
      changed = true;
    }
  }
  return changed ? { ...parameters, nem: next } : null;
}

class NutritionDefaultFoodEnergy1700000000078 {
  name = 'NutritionDefaultFoodEnergy1700000000078';

  async up(queryRunner) {
    if (!(await queryRunner.hasTable(TABLE))) return;

    const published = await queryRunner.query(`SELECT id, parameters FROM \`${TABLE}\` WHERE status = 'published' ORDER BY id DESC LIMIT 1`);
    if (Array.isArray(published) && published.length) {
      const upgraded = withFreshDefault(parse(published[0].parameters));
      if (upgraded) {
        await queryRunner.query(`UPDATE \`${TABLE}\` SET status = 'retired' WHERE id = ?`, [published[0].id]);
        const result = await queryRunner.query(
          `INSERT INTO \`${TABLE}\` (status, parameters, published_at) VALUES ('published', ?, CURRENT_TIMESTAMP)`,
          [JSON.stringify(upgraded)]
        );
        if (await queryRunner.hasTable(AUDIT)) {
          await queryRunner.query(
            `INSERT INTO \`${AUDIT}\` (actor_user_id, actor_email, action, metadata) VALUES (NULL, NULL, 'nutrition.parameters.publish', ?)`,
            [JSON.stringify({
              from_set_id: Number(published[0].id),
              to_set_id: Number(result.insertId),
              reason: REASON,
              changes: Object.keys(OLD)
                .filter((species) => upgraded.nem[species] !== parse(published[0].parameters).nem[species])
                .map((species) => ({ field: `nem.${species}`, from: OLD[species], to: NEW[species] }))
            })]
          );
        }
      }
    }

    const drafts = await queryRunner.query(`SELECT id, parameters FROM \`${TABLE}\` WHERE status = 'draft'`);
    for (const draft of Array.isArray(drafts) ? drafts : []) {
      const upgraded = withFreshDefault(parse(draft.parameters));
      if (upgraded) {
        await queryRunner.query(`UPDATE \`${TABLE}\` SET parameters = ? WHERE id = ?`, [JSON.stringify(upgraded), draft.id]);
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
  NutritionDefaultFoodEnergy1700000000078
};
