const path = require('path');

// The approved Eden Bowls PDF look (customer invoice), shared by every PDF the API renders.
const ASSETS_DIR = path.join(__dirname, '..', 'invoices', 'assets');
const LOGO_PATH = path.join(ASSETS_DIR, 'logo-horizontal.png');
const LOGO_RATIO = 900 / 317;

// Brand tokens of the approved layout (same palette as the emails in src/core/email/html.js).
const COLORS = {
  paper: '#FFFBF4',
  ink: '#212E25',
  muted: '#5C6758',
  clay: '#B08F66',
  moss: '#7B876F',
  parchment: '#F5EFE2',
  rule: '#E3DBC6',
  tableRule: '#6F766A',
  panel: '#F4EFE3',
  panelBorder: '#D9D1B9',
  badge: '#FBE9C9',
  badgeText: '#7E5E36',
  paidBadge: '#E5E9DD',
  paidBadgeText: '#55614A'
};

const FONT_BODY = 'EdenBody';
const FONT_STRONG = 'EdenStrong';
const FONT_DISPLAY = 'EdenDisplay';

// TTF only: pdfkit breaks on the composite glyphs (ã, ç, é) of WOFF2 files.
function registerBrandFonts(doc) {
  doc.registerFont(FONT_BODY, path.join(ASSETS_DIR, 'Quicksand-Regular.ttf'));
  doc.registerFont(FONT_STRONG, path.join(ASSETS_DIR, 'Quicksand-SemiBold.ttf'));
  doc.registerFont(FONT_DISPLAY, path.join(ASSETS_DIR, 'TenorSans-Latin.ttf'));
}

module.exports = {
  ASSETS_DIR,
  LOGO_PATH,
  LOGO_RATIO,
  COLORS,
  FONT_BODY,
  FONT_STRONG,
  FONT_DISPLAY,
  registerBrandFonts
};
