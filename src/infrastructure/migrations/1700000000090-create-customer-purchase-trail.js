// customer-purchase-trail: what a customer did on the way to a purchase, or to a change of a bought subscription,
// and what failed there, kept per customer and per market (br|us). Only ids, codes and the message already shown
// to the customer are stored: never a request body, header, token, card, address or a raw Stripe payload.
// Rows are deleted after 180 days by the purchase_trail_retention job.
const ATTEMPTS = 'customer_purchase_attempts';
const EVENTS = 'customer_purchase_events';
const CONFIG_EVENTS = 'customer_purchase_config_events';

const ERROR_COLUMNS = `
  \`http_status\` SMALLINT UNSIGNED NULL,
  \`error_code\` VARCHAR(64) NULL,
  \`error_message\` VARCHAR(500) NULL,
  \`stripe_code\` VARCHAR(64) NULL,
  \`stripe_type\` VARCHAR(64) NULL,
  \`stripe_param\` VARCHAR(128) NULL`;

class CreateCustomerPurchaseTrail1700000000090 {
  name = 'CreateCustomerPurchaseTrail1700000000090';

  async up(queryRunner) {
    if (!(await queryRunner.hasTable(ATTEMPTS))) {
      await queryRunner.query(`CREATE TABLE \`${ATTEMPTS}\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`user_id\` BIGINT UNSIGNED NOT NULL,
        \`market\` ENUM('br','us') NOT NULL,
        \`email\` VARCHAR(191) NULL,
        \`stripe_account\` VARCHAR(8) NULL,
        \`correlation_id\` CHAR(36) NOT NULL,
        \`attempt_id\` VARCHAR(128) NULL,
        \`area\` ENUM('onboarding','plan','checkout','subscription') NOT NULL,
        \`term_months\` TINYINT UNSIGNED NULL,
        \`currency\` CHAR(3) NULL,
        \`promotion_code_id\` VARCHAR(64) NULL,
        \`subscription_id\` VARCHAR(64) NULL,
        \`status\` ENUM('in_progress','paid','completed','failed') NOT NULL DEFAULT 'in_progress',
        \`final_step\` VARCHAR(48) NULL,
        ${ERROR_COLUMNS},
        \`ip_hash\` CHAR(64) NULL,
        \`started_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`finished_at\` DATETIME NULL,
        \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uniq_cpa_user_market_correlation\` (\`user_id\`, \`market\`, \`correlation_id\`),
        KEY \`idx_cpa_user_market_started\` (\`user_id\`, \`market\`, \`started_at\`),
        KEY \`idx_cpa_market_status_started\` (\`market\`, \`status\`, \`started_at\`),
        KEY \`idx_cpa_attempt\` (\`attempt_id\`),
        KEY \`idx_cpa_subscription\` (\`subscription_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    }

    if (!(await queryRunner.hasTable(EVENTS))) {
      // stripe_event_id + step is unique so a redelivered webhook writes its row once; MySQL lets NULLs repeat.
      await queryRunner.query(`CREATE TABLE \`${EVENTS}\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`attempt_row_id\` BIGINT UNSIGNED NULL,
        \`user_id\` BIGINT UNSIGNED NULL,
        \`market\` ENUM('br','us') NOT NULL,
        \`area\` ENUM('onboarding','plan','checkout','subscription','webhook') NOT NULL,
        \`step\` VARCHAR(48) NOT NULL,
        \`action\` VARCHAR(48) NULL,
        \`outcome\` ENUM('ok','failed') NOT NULL,
        \`pet_id\` BIGINT UNSIGNED NULL,
        \`subscription_id\` VARCHAR(64) NULL,
        \`stripe_account\` VARCHAR(8) NULL,
        \`stripe_event_id\` VARCHAR(64) NULL,
        \`stripe_event_type\` VARCHAR(64) NULL,
        ${ERROR_COLUMNS},
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uniq_cpe_stripe_event_step\` (\`stripe_event_id\`, \`step\`),
        KEY \`idx_cpe_attempt\` (\`attempt_row_id\`, \`id\`),
        KEY \`idx_cpe_user_market_created\` (\`user_id\`, \`market\`, \`created_at\`),
        KEY \`idx_cpe_market_area_created\` (\`market\`, \`area\`, \`created_at\`),
        CONSTRAINT \`fk_cpe_attempt\` FOREIGN KEY (\`attempt_row_id\`) REFERENCES \`${ATTEMPTS}\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    }

    if (!(await queryRunner.hasTable(CONFIG_EVENTS))) {
      await queryRunner.query(`CREATE TABLE \`${CONFIG_EVENTS}\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`market\` ENUM('br','us') NOT NULL,
        \`stripe_account\` VARCHAR(8) NULL,
        \`actor_admin_id\` BIGINT UNSIGNED NULL,
        \`action\` VARCHAR(64) NOT NULL,
        \`target_ref\` VARCHAR(128) NULL,
        \`outcome\` ENUM('ok','failed') NOT NULL,
        \`error_code\` VARCHAR(64) NULL,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        KEY \`idx_cpce_market_created\` (\`market\`, \`created_at\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    }
  }

  async down(queryRunner) {
    for (const table of [EVENTS, CONFIG_EVENTS, ATTEMPTS]) {
      if (await queryRunner.hasTable(table)) {
        await queryRunner.query(`DROP TABLE \`${table}\``);
      }
    }
  }
}

module.exports = {
  CreateCustomerPurchaseTrail1700000000090
};
