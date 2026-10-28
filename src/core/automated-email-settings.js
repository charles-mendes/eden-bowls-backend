const { HttpError } = require('./http-error');

const AUTOMATED_EMAIL_SETTINGS_INVALID = 'automated_email_settings_invalid';
const BATCH_RANGE = { min: 1, max: 500 };
const DAILY_CAP_RANGE = { min: 1, max: 5000 };
// What the jobs used when no variable was set, and what a market without a row uses.
const DEFAULT_AUTOMATED_EMAIL_SETTINGS = Object.freeze({
  lifeStageChangeEnabled: true,
  announcementBatchSize: 50,
  announcementDailyCap: 300
});

function integerIn(value, range) {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return Number.isInteger(number) && number >= range.min && number <= range.max ? number : null;
}

/**
 * Settings of the automated life-stage emails of a market (automated-email-settings), or 422
 * `automated_email_settings_invalid` listing the fields: batch 1 to 500, daily cap 1 to 5,000 and not lower
 * than the batch.
 */
function parseAutomatedEmailSettings(input) {
  const source = input && typeof input === 'object' ? input : {};
  const invalid = [];
  const enabled = source.life_stage_change_enabled;
  const batch = integerIn(source.announcement_batch_size, BATCH_RANGE);
  const cap = integerIn(source.announcement_daily_cap, DAILY_CAP_RANGE);
  if (typeof enabled !== 'boolean') invalid.push('life_stage_change_enabled');
  if (batch === null) invalid.push('announcement_batch_size');
  if (cap === null || (batch !== null && cap < batch)) invalid.push('announcement_daily_cap');
  if (invalid.length) {
    throw new HttpError(422, `Invalid automated email settings: ${invalid.join(', ')}.`, { code: AUTOMATED_EMAIL_SETTINGS_INVALID, fields: invalid });
  }
  return { lifeStageChangeEnabled: enabled, announcementBatchSize: batch, announcementDailyCap: cap };
}

function automatedEmailSettingsPayload(market, settings) {
  return {
    market,
    life_stage_change_enabled: settings.lifeStageChangeEnabled,
    announcement_batch_size: settings.announcementBatchSize,
    announcement_daily_cap: settings.announcementDailyCap,
    updated_at: settings.updatedAt || null
  };
}

module.exports = {
  AUTOMATED_EMAIL_SETTINGS_INVALID,
  BATCH_RANGE,
  DAILY_CAP_RANGE,
  DEFAULT_AUTOMATED_EMAIL_SETTINGS,
  automatedEmailSettingsPayload,
  parseAutomatedEmailSettings
};
