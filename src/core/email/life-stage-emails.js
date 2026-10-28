const { DateTime } = require('luxon');
const { TIMEZONE_BR, TIMEZONE_US } = require('../delivery-closed-days');
const {
  BRAND,
  FONT_BODY,
  buttonHtml,
  detailsTableHtml,
  escapeHtml,
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

function announcementAudience(pt, stages) {
  const puppy = stages.includes('puppy');
  const senior = stages.includes('senior');
  if (puppy && senior) return pt ? 'filhotes e cães sênior' : 'puppies and senior dogs';
  if (puppy) return pt ? 'filhotes' : 'puppies';
  return pt ? 'cães sênior' : 'senior dogs';
}

// Launch announcement (marketing): one letter per customer naming each puppy or senior with its plan's Ajustar packs.
function buildLifeStageAnnouncementEmail({
  firstName,
  dogs,
  profileUrl,
  companyLine,
  locale,
  assetBaseUrl,
  allowRelativeAssets
} = {}) {
  const pt = isPortuguese(locale || 'pt-BR');
  const hello = greet(pt, firstName);
  const named = (Array.isArray(dogs) ? dogs : []).filter((dog) => dog && dog.stage);
  const audience = announcementAudience(pt, named.map((dog) => dog.stage));
  const subject = pt
    ? `Novidade na Eden Bowls: receitas para ${audience}`
    : `New at Eden Bowls: recipes for ${audience}`;
  const intro = pt
    ? `Temos novidade: a Eden Bowls agora tem receitas feitas para cada fase da vida, e chegaram as receitas para ${audience}.`
    : `We have news: Eden Bowls now has recipes made for each life stage, and the recipes for ${audience} are here.`;
  const keep = pt
    ? 'Os planos não mudam sozinhos: as receitas, os packs e o preço continuam os mesmos até você ajustar. Você pode trocar para as receitas novas ou manter as atuais.'
    : 'Plans do not change on their own: recipes, packs and price stay the same until you adjust them. You can switch to the new recipes or keep the current ones.';
  const optOut = pt
    ? 'Você recebe este e-mail porque aceitou receber novidades da Eden Bowls. Para não receber mais, desmarque essa opção no seu perfil.'
    : 'You are getting this email because you chose to hear Eden Bowls news. To stop, turn that option off in your profile.';
  const profile = String(profileUrl || '').trim();

  const dogLine = (dog) => {
    const pet = petLabel(pt, dog.petName);
    const stageName = stageLabel(pt, dog.stage);
    return pt ? `${pet} · fase ${stageName}` : `${pet} · ${stageName} stage`;
  };
  const adjustLabel = (dog) => (pt ? `Ajustar packs de ${petLabel(pt, dog.petName)}` : `Adjust ${petLabel(pt, dog.petName)}'s packs`);

  const text = [
    hello,
    intro,
    ...named.map((dog) => [
      dogLine(dog),
      (dog.recipes || []).length ? `${pt ? 'Receitas' : 'Recipes'}: ${dog.recipes.join(', ')}` : '',
      dog.adjustUrl ? `${adjustLabel(dog)}: ${dog.adjustUrl}` : ''
    ].filter(Boolean).join('\n')),
    keep,
    profile ? `${optOut} ${profile}` : optOut,
    companyLine
  ].filter(Boolean).join('\n\n');

  const innerHtml = [
    paragraphHtml(hello),
    paragraphHtml(intro),
    ...named.map((dog) => [
      detailsTableHtml([{ label: 'Pet', value: dogLine(dog) }]),
      (dog.recipes || []).length ? pillsHtml(dog.recipes) : '',
      dog.adjustUrl ? buttonHtml({ href: dog.adjustUrl, label: adjustLabel(dog) }) : ''
    ].join('')),
    paragraphHtml(keep),
    profile
      ? `<p style="margin:0 0 14px;font-family:${FONT_BODY};font-size:14px;line-height:1.6;color:${BRAND.muted};">${escapeHtml(optOut)} <a href="${escapeHtml(profile)}" style="color:${BRAND.muted};text-decoration:underline;">${pt ? 'Abrir meu perfil' : 'Open my profile'}</a></p>`
      : mutedHtml(optOut)
  ].join('');

  return {
    id: 'life-stage-announcement',
    subject,
    text,
    html: wrapEmailHtml({
      locale: locale || 'pt-BR',
      preheader: intro,
      kicker: pt ? 'Novidade' : 'New',
      title: pt ? `Receitas para ${audience}` : `Recipes for ${audience}`,
      innerHtml,
      assetBaseUrl,
      allowRelativeAssets,
      securityNote: false,
      footerLines: [companyLine]
    })
  };
}

module.exports = {
  STAGE_LABELS,
  buildLifeStageAnnouncementEmail,
  buildLifeStageChangeEmail,
  firstEditableDeadline,
  formatDeadline,
  packsUrl,
  stageLabel
};
