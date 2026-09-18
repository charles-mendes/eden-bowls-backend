const BRAND = {
  parchment: '#F5EFE2',
  paper: '#FFFBF4',
  ink: '#212E25',
  moss: '#7B876F',
  mossHover: '#6a7660',
  clay: '#B08F66',
  border: '#D0C7AC',
  muted: '#5C6758',
  support: 'hello@edenbowls.com',
  name: 'Eden Bowls',
  storeUrl: 'https://edenbowls.com'
};

const FONT_DISPLAY = "'Tenor Sans', Georgia, 'Times New Roman', serif";
const FONT_BODY = "'Quicksand', 'Segoe UI', Helvetica, Arial, sans-serif";

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isPortuguese(locale) {
  return String(locale || '').toLowerCase().startsWith('pt');
}

function buttonHtml({ href, label }) {
  const safeHref = escapeHtml(href);
  const safeLabel = escapeHtml(label);

  return `
<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:28px 0 8px;">
  <tr>
    <td style="background:${BRAND.moss};border-radius:8px;">
      <a href="${safeHref}" style="display:inline-block;padding:14px 28px;font-family:${FONT_BODY};font-size:13px;letter-spacing:0.16em;text-transform:uppercase;color:${BRAND.parchment};text-decoration:none;font-weight:600;">
        ${safeLabel}
      </a>
    </td>
  </tr>
</table>`.trim();
}

function kickerHtml(text) {
  return `<p style="margin:0 0 10px;font-family:${FONT_BODY};font-size:11px;letter-spacing:0.28em;text-transform:uppercase;color:${BRAND.clay};">${escapeHtml(text)}</p>`;
}

function headingHtml(text) {
  return `<h1 style="margin:0 0 18px;font-family:${FONT_DISPLAY};font-size:28px;line-height:1.2;font-weight:400;color:${BRAND.ink};">${escapeHtml(text)}</h1>`;
}

function paragraphHtml(text) {
  return `<p style="margin:0 0 14px;font-family:${FONT_BODY};font-size:16px;line-height:1.65;color:${BRAND.ink};">${escapeHtml(text)}</p>`;
}

function mutedHtml(text) {
  return `<p style="margin:0 0 14px;font-family:${FONT_BODY};font-size:14px;line-height:1.6;color:${BRAND.muted};">${escapeHtml(text)}</p>`;
}

function codeWellHtml(code) {
  return `
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:8px 0 24px;">
  <tr>
    <td style="background:${BRAND.parchment};border:1px solid ${BRAND.border};border-radius:16px;padding:22px 16px;text-align:center;">
      <p style="margin:0;font-family:${FONT_DISPLAY};font-size:36px;letter-spacing:0.28em;color:${BRAND.ink};">${escapeHtml(code)}</p>
    </td>
  </tr>
</table>`.trim();
}

function pillsHtml(items) {
  const chips = (items || []).filter(Boolean).map((item) => (
    `<span style="display:inline-block;margin:0 8px 8px 0;padding:6px 12px;border:1px solid ${BRAND.clay};border-radius:999px;font-family:${FONT_BODY};font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:${BRAND.ink};">${escapeHtml(item)}</span>`
  )).join('');

  return `<p style="margin:4px 0 16px;">${chips}</p>`;
}

function detailsTableHtml(rows) {
  const body = (rows || [])
    .filter((row) => row && row.label)
    .map((row) => `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid ${BRAND.border};font-family:${FONT_BODY};font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:${BRAND.muted};width:42%;">${escapeHtml(row.label)}</td>
        <td style="padding:10px 0;border-bottom:1px solid ${BRAND.border};font-family:${FONT_BODY};font-size:15px;color:${BRAND.ink};">${escapeHtml(row.value || '—')}</td>
      </tr>`)
    .join('');

  return `
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:8px 0 12px;">
  ${body}
</table>`.trim();
}

function wrapEmailHtml({
  locale,
  preheader,
  kicker,
  title,
  innerHtml
}) {
  const pt = isPortuguese(locale);
  const preview = escapeHtml(preheader || '');
  const footerNote = pt
    ? 'Carta automática da cozinha Eden. Dúvidas: '
    : 'An automatic letter from the Eden kitchen. Questions: ';
  const legal = pt
    ? 'Não encaminhe códigos nem senhas. Se você não reconhece este e-mail, ignore.'
    : 'Do not forward codes or passwords. If you did not expect this email, ignore it.';

  return `<!DOCTYPE html>
<html lang="${pt ? 'pt-BR' : 'en'}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="x-ua-compatible" content="ie=edge">
  <title>${escapeHtml(title || BRAND.name)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Quicksand:wght@400;500;600&family=Tenor+Sans&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:${BRAND.parchment};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${preview}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${BRAND.parchment};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;">
          <tr>
            <td style="background:${BRAND.ink};padding:28px 36px 24px;text-align:center;">
              <p style="margin:0 0 8px;font-family:${FONT_BODY};font-size:10px;letter-spacing:0.42em;text-transform:uppercase;color:${BRAND.clay};">${pt ? 'Da cozinha' : 'From the kitchen'}</p>
              <p style="margin:0;font-family:${FONT_DISPLAY};font-size:22px;letter-spacing:0.34em;text-transform:uppercase;color:${BRAND.parchment};">Eden Bowls</p>
              <p style="margin:14px auto 0;width:72px;border-bottom:2px solid ${BRAND.clay};line-height:0;font-size:0;">&nbsp;</p>
            </td>
          </tr>
          <tr>
            <td style="background:${BRAND.paper};padding:36px 36px 28px;border-left:1px solid ${BRAND.border};border-right:1px solid ${BRAND.border};">
              ${kickerHtml(kicker)}
              ${headingHtml(title)}
              ${innerHtml}
            </td>
          </tr>
          <tr>
            <td style="background:${BRAND.parchment};border:1px solid ${BRAND.border};border-top:0;padding:22px 36px 28px;">
              <p style="margin:0 0 8px;font-family:${FONT_DISPLAY};font-size:13px;letter-spacing:0.2em;text-transform:uppercase;color:${BRAND.ink};">${escapeHtml(BRAND.name)}</p>
              <p style="margin:0 0 8px;font-family:${FONT_BODY};font-size:13px;line-height:1.6;color:${BRAND.muted};">${footerNote}<a href="mailto:${BRAND.support}" style="color:${BRAND.moss};text-decoration:none;">${BRAND.support}</a></p>
              <p style="margin:0;font-family:${FONT_BODY};font-size:12px;line-height:1.55;color:${BRAND.muted};">${escapeHtml(legal)}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

module.exports = {
  BRAND,
  FONT_BODY,
  FONT_DISPLAY,
  buttonHtml,
  codeWellHtml,
  detailsTableHtml,
  escapeHtml,
  headingHtml,
  isPortuguese,
  kickerHtml,
  mutedHtml,
  paragraphHtml,
  pillsHtml,
  wrapEmailHtml
};
