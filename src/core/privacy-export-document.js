// Turns an export package (PrivacyService.buildExportPackage) into the strings the privacy PDF prints
// (privacy-data-export). Pure, no I/O: the renderer only draws what this returns.
const { exportCopy, translateValue } = require('./privacy-export-copy');

const TIME_ZONE = { 'pt-BR': 'America/Sao_Paulo', en: 'America/New_York' };
const INTL_LOCALE = { 'pt-BR': 'pt-BR', en: 'en-US' };

function formatDate(locale, value, withTime = false) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    dateStyle: 'long',
    ...(withTime ? { timeStyle: 'short' } : {}),
    timeZone: TIME_ZONE[locale]
  }).format(date);
}

function text(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

function yesNo(copy, value) {
  if (value === null || value === undefined) return null;
  return value ? copy.yes : copy.no;
}

// Rows with an empty value print a dash, so the reader sees the field exists and is blank.
function rows(copy, labels, values) {
  return Object.keys(values).map((key) => ({ label: labels[key], value: values[key] == null ? copy.empty : String(values[key]) }));
}

function hasAny(values) {
  return Object.values(values).some((value) => value !== null && value !== undefined);
}

function section(copy, key, records) {
  const base = copy.sections[key];
  return {
    key,
    title: base.title,
    sourceLabel: copy.sourceLabel,
    source: base.source,
    purposeLabel: copy.purposeLabel,
    purpose: base.purpose,
    records,
    noRecord: records.length === 0 ? copy.noRecord : null
  };
}

function profileSection(locale, copy, profile = {}) {
  const labels = copy.sections.profile.fields;
  const cookies = profile.cookiePreferences || {};
  const values = {
    fullName: text(profile.fullName),
    email: text(profile.email),
    phone: text(profile.phone),
    countryCode: text(profile.countryCode),
    marketingOptIn: yesNo(copy, profile.marketingOptIn),
    cookieAnalytics: translateValue(locale, 'cookie', cookies.analytics),
    cookieAds: translateValue(locale, 'cookie', cookies.ads)
  };
  return section(copy, 'profile', hasAny(values) ? [{ title: null, rows: rows(copy, labels, values) }] : []);
}

// Number and neighborhood exist only in Brazilian addresses; a US address does not show them.
const BRAZIL_ONLY_DELIVERY_FIELDS = ['number', 'neighborhood'];

function deliverySection(copy, delivery = {}) {
  const us = String((delivery && delivery.country) || '').toUpperCase() === 'US';
  const labels = { ...copy.sections.delivery.fields };
  if (us) for (const key of BRAZIL_ONLY_DELIVERY_FIELDS) delete labels[key];
  const values = {};
  for (const key of Object.keys(labels)) values[key] = text(delivery && delivery[key]);
  return section(copy, 'delivery', hasAny(values) ? [{ title: null, rows: rows(copy, labels, values) }] : []);
}

function petsSection(locale, copy, pets = []) {
  const labels = copy.sections.pets.fields;
  const records = pets.map((pet) => ({
    title: text(pet.name),
    rows: rows(copy, labels, {
      name: text(pet.name),
      breed: text(pet.breed),
      age: text(copy.age(Number(pet.ageYears) || 0, Number(pet.ageMonths) || 0)),
      weight: text(pet.weightInput) ? `${text(pet.weightInput)}${pet.weightUnit ? ` ${pet.weightUnit}` : ''}` : null,
      size: translateValue(locale, 'size', pet.size),
      activityLevel: translateValue(locale, 'activityLevel', pet.activityLevel),
      petCondition: translateValue(locale, 'petCondition', pet.petCondition),
      neutered: yesNo(copy, pet.neutered)
    })
  }));
  return section(copy, 'pets', records);
}

function consentsSection(locale, copy, consents = []) {
  const labels = copy.sections.consents.fields;
  const records = consents.map((consent) => ({
    title: translateValue(locale, 'consentType', consent.consentType),
    rows: rows(copy, labels, {
      consentType: translateValue(locale, 'consentType', consent.consentType),
      status: translateValue(locale, 'consentStatus', consent.status),
      documentVersion: text(consent.documentVersion),
      source: translateValue(locale, 'consentSource', consent.source),
      createdAt: formatDate(locale, consent.createdAt, true)
    })
  }));
  return section(copy, 'consents', records);
}

function subscriptionsSection(locale, copy, subscriptions = []) {
  const labels = copy.sections.subscriptions.fields;
  const records = subscriptions.map((subscription, index) => ({
    title: copy.itemLabel(index + 1),
    rows: rows(copy, labels, {
      status: translateValue(locale, 'subscriptionStatus', subscription.status),
      stripeSubscriptionId: text(subscription.stripeSubscriptionId),
      stripeCustomerId: text(subscription.stripeCustomerId),
      currentPeriodEnd: formatDate(locale, subscription.currentPeriodEnd),
      cancelAtPeriodEnd: yesNo(copy, subscription.cancelAtPeriodEnd),
      deliveryInstructions: text(subscription.deliveryInstructions)
    })
  }));
  return section(copy, 'subscriptions', records);
}

function contactsSection(locale, copy, contacts = []) {
  const labels = copy.sections.contacts.fields;
  const records = contacts.map((contact, index) => ({
    title: copy.itemLabel(index + 1),
    rows: rows(copy, labels, {
      createdAt: formatDate(locale, contact.createdAt, true),
      channel: translateValue(locale, 'contactChannel', contact.channel),
      reason: translateValue(locale, 'contactReason', contact.reason),
      outcome: translateValue(locale, 'contactOutcome', contact.outcome),
      note: text(contact.note)
    })
  }));
  return section(copy, 'contacts', records);
}

function addressIssuesSection(locale, copy, issues = []) {
  const labels = copy.sections.addressIssues.fields;
  const records = issues.map((issue, index) => ({
    title: copy.itemLabel(index + 1),
    rows: rows(copy, labels, {
      codes: (Array.isArray(issue.codes) ? issue.codes : []).map((code) => translateValue(locale, 'addressIssueCode', code)).join(', ') || null,
      source: translateValue(locale, 'addressIssueSource', issue.source),
      openedAt: formatDate(locale, issue.openedAt, true),
      emailSentAt: formatDate(locale, issue.emailSentAt, true),
      resolvedAt: formatDate(locale, issue.resolvedAt, true)
    })
  }));
  return section(copy, 'addressIssues', records);
}

/**
 * The privacy export PDF as strings. `type` is the request type (access or portability).
 */
function buildPrivacyExportDocument({ pack = {}, requestId, type = 'access', locale = 'pt-BR' }) {
  const copy = exportCopy(locale);
  const profile = pack.profile || {};
  return {
    locale,
    documentTitle: copy.documentTitle,
    heading: copy.heading,
    meta: [
      { label: copy.requestLabel, value: `#${requestId} · ${copy.typeLabel[type] || copy.typeLabel.access}` },
      { label: copy.exportedAtLabel, value: formatDate(locale, pack.exportedAt, true) || copy.empty }
    ],
    intro: copy.intro,
    sections: [
      profileSection(locale, copy, profile),
      deliverySection(copy, profile.delivery),
      petsSection(locale, copy, pack.pets || []),
      consentsSection(locale, copy, pack.consents || []),
      subscriptionsSection(locale, copy, pack.subscriptions || []),
      contactsSection(locale, copy, pack.customerContacts || []),
      addressIssuesSection(locale, copy, pack.addressIssues || [])
    ],
    criteria: copy.criteria,
    sharing: copy.sharing,
    notIncluded: copy.notIncluded,
    footer: copy.footer,
    filename: copy.filename(requestId)
  };
}

module.exports = {
  buildPrivacyExportDocument
};
