const USERMETA_TABLE = 'wp_usermeta';
const ADMIN_ROLES_META_KEY = '_eden_admin_roles';

async function renameRole(queryRunner, from, to) {
  if (!(await queryRunner.hasTable(USERMETA_TABLE))) {
    return;
  }
  // Stored roles are a JSON array (["nutritionist"]) or an older comma list; only role keys live here.
  await queryRunner.query(
    `UPDATE \`${USERMETA_TABLE}\` SET \`meta_value\` = REPLACE(\`meta_value\`, ?, ?) WHERE \`meta_key\` = ? AND \`meta_value\` LIKE ?`,
    [from, to, ADMIN_ROLES_META_KEY, `%${from}%`]
  );
}

class RenameNutritionistRoleToVeterinarian1700000000033 {
  name = 'RenameNutritionistRoleToVeterinarian1700000000033';

  async up(queryRunner) {
    await renameRole(queryRunner, 'nutritionist', 'veterinarian');
  }

  async down(queryRunner) {
    await renameRole(queryRunner, 'veterinarian', 'nutritionist');
  }
}

module.exports = {
  RenameNutritionistRoleToVeterinarian1700000000033
};
