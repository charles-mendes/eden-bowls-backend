const { MARKETS } = require('./market');

const FLAVOR_KEYS = ['beef', 'fish', 'pork', 'turkey'];
const FLAVOR_SLUG_META = '_flavor_slug';
const FLAVOR_ALIASES_META = '_flavor_aliases';

const SEED_FLAVOR_ALIASES = {
  beef: ['bovino', 'carne'],
  fish: ['peixe'],
  pork: ['porco'],
  turkey: ['chicken', 'frango', 'peru']
};

const FLAVOR_KEY_ALIASES = {};
for (const [key, aliases] of Object.entries(SEED_FLAVOR_ALIASES)) {
  FLAVOR_KEY_ALIASES[key] = key;
  for (const alias of aliases) {
    FLAVOR_KEY_ALIASES[alias] = key;
  }
}

const FLAVOR_CATALOG = {
  BR: {
    country: 'BR',
    currency: 'BRL',
    zoneId: 'br',
    product: {
      id: 100,
      title: 'Flavors BR',
      slug: 'flavors-br',
      days: 30,
      menuOrder: 1
    },
    packs: [
      {
        weight: '300g',
        prices: {
          beef: 25,
          fish: 35,
          pork: 25,
          turkey: 22.5
        }
      },
      {
        weight: '500g',
        prices: {
          beef: 45,
          fish: 65,
          pork: 45,
          turkey: 42.5
        }
      }
    ]
  },
  US: {
    country: 'US',
    currency: 'USD',
    zoneId: 'us',
    product: {
      id: 200,
      title: 'Flavors US',
      slug: 'flavors-us',
      days: 30,
      menuOrder: 2
    },
    packs: [
      {
        weight: '10.6oz',
        prices: {
          beef: 25,
          fish: 35,
          pork: 25,
          turkey: 22.5
        }
      },
      {
        weight: '17.6oz',
        prices: {
          beef: 45,
          fish: 65,
          pork: 45,
          turkey: 42.5
        }
      }
    ]
  }
};

function flavorKeyFromLabel(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function parseFlavorAliases(value) {
  const parts = Array.isArray(value) ? value : String(value || '').split(/[,;]/);
  const aliases = [];
  const seen = new Set();

  for (const part of parts) {
    const slug = flavorKeyFromLabel(part);
    if (!slug || seen.has(slug)) {
      continue;
    }
    seen.add(slug);
    aliases.push(slug);
  }

  return aliases;
}

function defaultAliasesForSlug(slug) {
  const key = flavorKeyFromLabel(slug);
  if (!key) {
    return [];
  }
  if (SEED_FLAVOR_ALIASES[key]) {
    return [key, ...SEED_FLAVOR_ALIASES[key]];
  }
  if (FLAVOR_KEY_ALIASES[key]) {
    const canonical = FLAVOR_KEY_ALIASES[key];
    return [canonical, ...(SEED_FLAVOR_ALIASES[canonical] || [])];
  }
  return [key];
}

function listFlavorLabelMaps(market) {
  if (market && market.flavorLabels) {
    return [market.flavorLabels];
  }

  return Object.values(MARKETS)
    .map((item) => item && item.flavorLabels)
    .filter(Boolean);
}

function canonicalFlavorKey(value, market) {
  const slug = flavorKeyFromLabel(value);
  if (!slug) {
    return '';
  }

  if (FLAVOR_KEYS.includes(slug)) {
    return slug;
  }

  if (FLAVOR_KEY_ALIASES[slug]) {
    return FLAVOR_KEY_ALIASES[slug];
  }

  for (const labels of listFlavorLabelMaps(market)) {
    for (const [key, label] of Object.entries(labels)) {
      if (flavorKeyFromLabel(key) === slug || flavorKeyFromLabel(label) === slug) {
        return key;
      }
    }
  }

  return slug;
}

function flavorAliasKeys(value, market, extraAliases) {
  const slug = flavorKeyFromLabel(value);
  if (!slug) {
    return [];
  }

  const aliases = new Set([slug]);
  const canonical = canonicalFlavorKey(slug, market);
  if (canonical) {
    aliases.add(canonical);
  }

  for (const alias of defaultAliasesForSlug(canonical || slug)) {
    aliases.add(alias);
  }

  for (const alias of parseFlavorAliases(extraAliases)) {
    aliases.add(alias);
    const mapped = canonicalFlavorKey(alias, market);
    if (mapped) {
      aliases.add(mapped);
    }
  }

  for (const labels of listFlavorLabelMaps(market)) {
    for (const [key, label] of Object.entries(labels)) {
      if (flavorKeyFromLabel(key) === slug || flavorKeyFromLabel(label) === slug || key === canonical) {
        aliases.add(flavorKeyFromLabel(key));
        aliases.add(flavorKeyFromLabel(label));
      }
    }
  }

  return [...aliases].filter(Boolean);
}

function listFlavorOptions(market) {
  const labels = market && market.flavorLabels ? market.flavorLabels : {};

  return FLAVOR_KEYS.map((key) => ({
    key,
    label: labels[key] || key
  }));
}

function catalogRowFromValue(raw) {
  if (typeof raw === 'string') {
    return {
      label: raw.trim(),
      key: '',
      aliases: []
    };
  }

  if (!raw || typeof raw !== 'object') {
    return { label: '', key: '', aliases: [] };
  }

  return {
    label: String(raw.label || raw.flavor || '').trim(),
    key: flavorKeyFromLabel(raw.key || raw.slug || raw.flavor_key || ''),
    aliases: parseFlavorAliases(raw.aliases)
  };
}

function flavorOptionsFromCatalog(rows, market) {
  const options = [];
  const seen = new Set();

  for (const raw of Array.isArray(rows) ? rows : []) {
    const row = catalogRowFromValue(raw);
    const key = row.key || canonicalFlavorKey(row.label, market);
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    const option = {
      key,
      label: row.label || key
    };
    if (row.aliases.length > 0) {
      option.aliases = row.aliases;
    }
    options.push(option);
  }

  return options;
}

function flavorOptionsFromLabels(labels, market) {
  return flavorOptionsFromCatalog(labels, market);
}

function listFlavorVariations(country) {
  const catalog = FLAVOR_CATALOG[country];

  if (!catalog) {
    return [];
  }

  return catalog.packs.flatMap((pack) => (
    FLAVOR_KEYS.map((flavor) => ({
      flavor,
      weight: pack.weight,
      price: pack.prices[flavor],
      currency: catalog.currency,
      zoneId: catalog.zoneId
    }))
  ));
}

function allowFlavorCatalogFallback() {
  return process.env.NODE_ENV !== 'production';
}

function findCatalogFlavorOption(value, catalogOptions, market) {
  const slug = flavorKeyFromLabel(value);
  if (!slug) {
    return null;
  }

  const options = Array.isArray(catalogOptions) ? catalogOptions : [];
  for (const option of options) {
    if (!option || typeof option !== 'object') {
      continue;
    }
    const aliases = new Set([
      flavorKeyFromLabel(option.key),
      flavorKeyFromLabel(option.label),
      ...parseFlavorAliases(option.aliases),
      ...flavorAliasKeys(option.key || option.label, market, option.aliases)
    ]);
    if (aliases.has(slug)) {
      return option;
    }
  }

  const canonical = canonicalFlavorKey(value, market);
  return options.find((option) => flavorKeyFromLabel(option && option.key) === canonical) || null;
}

module.exports = {
  FLAVOR_KEYS,
  FLAVOR_KEY_ALIASES,
  FLAVOR_CATALOG,
  FLAVOR_SLUG_META,
  FLAVOR_ALIASES_META,
  SEED_FLAVOR_ALIASES,
  allowFlavorCatalogFallback,
  canonicalFlavorKey,
  defaultAliasesForSlug,
  findCatalogFlavorOption,
  flavorAliasKeys,
  flavorKeyFromLabel,
  flavorOptionsFromCatalog,
  flavorOptionsFromLabels,
  listFlavorOptions,
  listFlavorVariations,
  parseFlavorAliases
};
