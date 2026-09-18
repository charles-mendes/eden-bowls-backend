const fs = require('fs');
const path = require('path');
const { listEmailPreviews } = require('../core/email/preview-fixtures');

const outDir = path.resolve(__dirname, '../../docs-new/Email/previews');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderIndex(previews) {
  const cards = previews.map((item) => `
    <article class="card">
      <p class="kicker">${escapeHtml(item.group)} · ${item.wired ? 'dispara hoje' : 'template pronto'}</p>
      <h2>${escapeHtml(item.label)}</h2>
      <p class="subject">${escapeHtml(item.content.subject)}</p>
      <a class="open" href="${escapeHtml(item.id)}.html">Abrir carta</a>
      <iframe title="${escapeHtml(item.label)}" src="${escapeHtml(item.id)}.html" loading="lazy"></iframe>
    </article>`).join('');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Correspondência Eden Bowls</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Quicksand:wght@400;500;600&family=Tenor+Sans&display=swap" rel="stylesheet">
  <style>
    :root {
      --ink: #212E25;
      --parchment: #F5EFE2;
      --moss: #7B876F;
      --clay: #B08F66;
      --paper: #FFFBF4;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--ink);
      color: var(--parchment);
      font-family: Quicksand, Helvetica, sans-serif;
    }
    body::before {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      opacity: 0.08;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='4'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
    }
    header {
      max-width: 1120px;
      margin: 0 auto;
      padding: 64px 24px 24px;
    }
    .eyebrow {
      letter-spacing: 0.42em;
      text-transform: uppercase;
      font-size: 11px;
      color: var(--clay);
      margin: 0 0 16px;
    }
    h1 {
      font-family: "Tenor Sans", Georgia, serif;
      font-weight: 400;
      font-size: clamp(40px, 6vw, 72px);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      margin: 0 0 16px;
    }
    header p {
      max-width: 42rem;
      line-height: 1.7;
      color: #d8d1c0;
    }
    .grid {
      max-width: 1120px;
      margin: 0 auto;
      padding: 12px 24px 80px;
      display: grid;
      gap: 28px;
    }
    @media (min-width: 900px) {
      .grid { grid-template-columns: 1fr 1fr; }
    }
    .card {
      background: var(--paper);
      color: var(--ink);
      padding: 22px;
      border-radius: 4px 4px 28px 4px;
    }
    .kicker {
      margin: 0 0 8px;
      letter-spacing: 0.22em;
      text-transform: uppercase;
      font-size: 10px;
      color: var(--clay);
    }
    h2 {
      font-family: "Tenor Sans", Georgia, serif;
      font-weight: 400;
      margin: 0 0 8px;
    }
    .subject {
      margin: 0 0 16px;
      color: #5C6758;
      font-size: 14px;
    }
    .open {
      display: inline-block;
      margin-bottom: 16px;
      color: var(--moss);
      letter-spacing: 0.14em;
      text-transform: uppercase;
      font-size: 12px;
      text-decoration: none;
    }
    iframe {
      display: block;
      width: 100%;
      height: 640px;
      border: 1px solid #D0C7AC;
      background: #F5EFE2;
    }
  </style>
</head>
<body>
  <header>
    <p class="eyebrow">Da cozinha</p>
    <h1>Correspondência</h1>
    <p>Cartas da Eden — não o pacote WooCommerce. Masthead verde-musgo, papel pergaminho, Tenor Sans. Os três primeiros já disparam no Node; o restante está pronto para o evento Stripe ou o fluxo de senha.</p>
  </header>
  <main class="grid">${cards}</main>
</body>
</html>`;
}

function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const previews = listEmailPreviews();

  for (const item of previews) {
    fs.writeFileSync(path.join(outDir, `${item.id}.html`), item.content.html);
  }

  fs.writeFileSync(path.join(outDir, 'index.html'), renderIndex(previews));
  process.stdout.write(`Wrote ${previews.length} email previews to ${outDir}\n`);
}

main();
