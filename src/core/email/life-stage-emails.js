const { DateTime } = require('luxon');
const { TIMEZONE_BR, TIMEZONE_US } = require('../delivery-closed-days');
const {
  buttonHtml,
  detailsTableHtml,
  isPortuguese,
  mutedHtml,
  paragraphHtml,
  pillsHtml,
  wrapEmailHtml
} = require('./html');

const STAGE_LABELS = {
  pt: { puppy: 'Filhote', adult: 'Adulto', senior: 'Sênior' },
  en: { puppy: 'Puppy', adult: 'Adult', senior: 'Senior' }
};

function stageLabel(pt, stage) {
  const labels = pt ? STAGE_LABELS.pt : STAGE_LABELS.en;
  return labels[stage] || String(stage || '');
}

function greet(pt, firstName) {
  const name = String(firstName || '').trim();
  if (pt) {
    return name ? `Oi, ${name}.` : 'Oi.';
  }
  return name ? `Hi ${name},` : 'Hi,';
}

function petLabel(pt, petName) {
  return String(petName || '').trim() || (pt ? 'seu cão' : 'your dog');
}

// Ajustar packs of one plan, opened on the pet when it is known (same path as the store's packsPath).
function packsUrl(storeAppUrl, subscriptionId, petId) {
  const base = String(storeAppUrl || 'http://localhost:5173').replace(/\/+$/, '');
  const path = `${base}/dashboard/plans/${encodeURIComponent(String(subscriptionId || ''))}/packs`;
  return petId ? `${path}?pet=${encodeURIComponent(String(petId))}` : path;
}

function toDate(value) {
  if (value instanceof Date) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// The delivery the adjustment still applies to at send time: the first one whose cutoff has not passed.
function firstEditableDeadline(deliveries, now = new Date()) {
  const deadlines = (Array.isArray(deliveries) ? deliveries : [])
    .map((delivery) => toDate(delivery && (delivery.editableUntil || delivery.editable_until)))
    .filter((date) => date && date.getTime() > now.getTime())
    .sort((left, right) => left.getTime() - right.getTime());
  return deadlines[0] || null;
}

// "terça-feira, 20 de outubro, às 23h59 (horário de Brasília)" / "Tuesday, October 20, at 11:59 PM ET".
function formatDeadline(value, market) {
  const date = toDate(value);
  if (!date) return '';
  const us = String(market || '').toUpperCase() === 'US';
  const local = DateTime.fromJSDate(date, { zone: us ? TIMEZONE_US : TIMEZONE_BR });
  if (us) {
    return `${local.setLocale('en-US').toFormat("cccc, MMMM d, 'at' h:mm a")} ET`;
  }
  return `${local.setLocale('pt-BR').toFormat("cccc, d 'de' MMMM, 'às' HH'h'mm")} (horário de Brasília)`;
}

function stageChangeSentence(pt, petName, stage) {
  return pt
    ? `Pela idade informada, ${petName} está entrando na fase ${stageLabel(pt, stage)}.`
    : `Based on the age you gave, ${petName} is entering the ${stageLabel(pt, stage)} stage.`;
}

function buildLifeStageChangeEmail({
  firstName,
  petName,
  stage,
  suggestedRecipes,
  adjustUrl,
  deadlineLabel,
  locale,
  assetBaseUrl,
  allowRelativeAssets
} = {}) {
  const pt = isPortuguese(locale || 'pt-BR');
  const hello = greet(pt, firstName);
  const pet = petLabel(pt, petName);
  const stageName = stageLabel(pt, stage);
  const sentence = stageChangeSentence(pt, pet, stage);
  const recipes = (Array.isArray(suggestedRecipes) ? suggestedRecipes : []).filter(Boolean);
  const url = String(adjustUrl || '').trim();
  const subject = pt
    ? `${pet} está entrando na fase ${stageName}`
    : `${pet} is entering the ${stageName} stage`;
  const keep = pt
    ? `O plano de ${pet} não muda sozinho: as receitas, os packs e o preço continuam os mesmos. Se quiser, troque para as receitas da fase ${stageName} ou mantenha as atuais ajustando só as quantidades.`
    : `${pet}'s plan does not change on its own: recipes, packs and price stay the same. If you like, switch to the ${stageName} recipes or keep the current ones and adjust only the quantities.`;
  const deadlineNote = pt
    ? 'Depois desse prazo, o ajuste vale a partir da entrega seguinte.'
    : 'After this deadline, the adjustment applies from the following delivery.';

  const text = [
    hello,
    sentence,
    keep,
    recipes.length ? `${pt ? `Receitas da fase ${stageName}` : `${stageName} recipes`}: ${recipes.join(', ')}` : '',
    deadlineLabel ? `${pt ? 'Ajuste até' : 'Adjust by'}: ${deadlineLabel}` : '',
    url ? `${pt ? 'Ajustar packs' : 'Adjust packs'}: ${url}` : '',
    deadlineLabel ? deadlineNote : ''
  ].filter(Boolean).join('\n');

  const innerHtml = [
    paragraphHtml(hello),
    paragraphHtml(sentence),
    paragraphHtml(keep),
    recipes.length ? pillsHtml(recipes) : '',
    detailsTableHtml([
      { label: 'Pet', value: pet },
      { label: pt ? 'Nova fase' : 'New stage', value: stageName },
      { label: pt ? 'Ajuste até' : 'Adjust by', value: deadlineLabel }
    ]),
    url ? buttonHtml({ href: url, label: pt ? 'Ajustar packs' : 'Adjust packs' }) : '',
    deadlineLabel ? mutedHtml(deadlineNote) : ''
  ].join('');

  return {
    id: 'life-stage-change',
    subject,
    text,
    html: wrapEmailHtml({
      locale: locale || 'pt-BR',
      preheader: sentence,
      kicker: pt ? 'Fase da vida' : 'Life stage',
      title: subject,
      innerHtml,
      assetBaseUrl,
      allowRelativeAssets
    })
  };
}

module.exports = {
  STAGE_LABELS,
  buildLifeStageChangeEmail,
  firstEditableDeadline,
  formatDeadline,
  packsUrl,
  stageLabel
};
