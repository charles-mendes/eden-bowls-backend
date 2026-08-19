const US_STATES = {
  AL: 'ALABAMA',
  AK: 'ALASKA',
  AZ: 'ARIZONA',
  AR: 'ARKANSAS',
  CA: 'CALIFORNIA',
  CO: 'COLORADO',
  CT: 'CONNECTICUT',
  DE: 'DELAWARE',
  FL: 'FLORIDA',
  GA: 'GEORGIA',
  HI: 'HAWAII',
  ID: 'IDAHO',
  IL: 'ILLINOIS',
  IN: 'INDIANA',
  IA: 'IOWA',
  KS: 'KANSAS',
  KY: 'KENTUCKY',
  LA: 'LOUISIANA',
  ME: 'MAINE',
  MD: 'MARYLAND',
  MA: 'MASSACHUSETTS',
  MI: 'MICHIGAN',
  MN: 'MINNESOTA',
  MS: 'MISSISSIPPI',
  MO: 'MISSOURI',
  MT: 'MONTANA',
  NE: 'NEBRASKA',
  NV: 'NEVADA',
  NH: 'NEW HAMPSHIRE',
  NJ: 'NEW JERSEY',
  NM: 'NEW MEXICO',
  NY: 'NEW YORK',
  NC: 'NORTH CAROLINA',
  ND: 'NORTH DAKOTA',
  OH: 'OHIO',
  OK: 'OKLAHOMA',
  OR: 'OREGON',
  PA: 'PENNSYLVANIA',
  RI: 'RHODE ISLAND',
  SC: 'SOUTH CAROLINA',
  SD: 'SOUTH DAKOTA',
  TN: 'TENNESSEE',
  TX: 'TEXAS',
  UT: 'UTAH',
  VT: 'VERMONT',
  VA: 'VIRGINIA',
  WA: 'WASHINGTON',
  WV: 'WEST VIRGINIA',
  WI: 'WISCONSIN',
  WY: 'WYOMING'
};

const US_STATE_ALIASES = {
  'NOVA IORQUE': 'NY'
};

const US_STATE_BY_NAME = Object.fromEntries(
  Object.entries(US_STATES).map(([code, name]) => [name, code])
);

function normalizeUsStateInput(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }

  const upper = raw.toUpperCase();
  if (US_STATES[upper]) {
    return upper;
  }

  if (US_STATE_ALIASES[upper]) {
    return US_STATE_ALIASES[upper];
  }

  if (US_STATE_BY_NAME[upper]) {
    return US_STATE_BY_NAME[upper];
  }

  return upper;
}

function formatStateForStorage(value, country) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }

  if (country === 'US') {
    return normalizeUsStateInput(raw);
  }

  return raw.toUpperCase();
}

function formatStateForDisplay(value, country) {
  const stored = formatStateForStorage(value, country);
  if (!stored) {
    return '';
  }

  if (country === 'US' && US_STATES[stored]) {
    return US_STATES[stored];
  }

  return stored;
}

module.exports = {
  US_STATES,
  formatStateForStorage,
  formatStateForDisplay
};
