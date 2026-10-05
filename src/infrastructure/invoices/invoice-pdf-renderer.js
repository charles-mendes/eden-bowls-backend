const path = require('path');
const PDFDocument = require('pdfkit');

const ASSETS_DIR = path.join(__dirname, 'assets');

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
const MARGIN = 50;
const LOGO_HEIGHT = 40;
const LOGO_RATIO = 900 / 317;
const LABEL = { size: 6.8, spacing: 1.5 };
const ROW_PAD_TOP = 12;
const ROW_PAD_BOTTOM = 13;
const TOTAL_ROW = 25;
const FOOTER_HEIGHT = 69;

function columnsFor(width) {
  return {
    billX: MARGIN + Math.round(width * 0.346),
    shipX: MARGIN + Math.round(width * 0.69),
    qtyRight: MARGIN + Math.round(width * 0.62),
    unitRight: MARGIN + Math.round(width * 0.86),
    totalsX: MARGIN + Math.round(width * 0.48)
  };
}

function label(doc, text, x, y, options = {}) {
  doc.font(FONT_BODY).fontSize(LABEL.size).fillColor(COLORS.clay)
    .text(text, x, y, { characterSpacing: LABEL.spacing, lineBreak: false, ...options });
}

function rule(doc, y, x1, x2, color, width = 0.75) {
  doc.save().moveTo(x1, y).lineTo(x2, y).lineWidth(width).strokeColor(color).stroke().restore();
}


function paintPaper(doc) {
  doc.save().rect(0, 0, doc.page.width, doc.page.height).fill(COLORS.paper).restore();
}

function drawTop(doc, model, right, width) {
  doc.image(path.join(ASSETS_DIR, 'logo-horizontal.png'), MARGIN, 43, {
    height: LOGO_HEIGHT,
    width: LOGO_HEIGHT * LOGO_RATIO
  });
  doc.font(FONT_DISPLAY).fontSize(23).fillColor(COLORS.ink)
    .text(model.title, MARGIN, 46, { width, align: 'right', characterSpacing: 4, lineBreak: false });
  doc.font(FONT_BODY).fontSize(8.5).fillColor(COLORS.muted)
    .text(model.numberLine, MARGIN, 73, { width, align: 'right', characterSpacing: 0.6, lineBreak: false });

  doc.font(FONT_BODY).fontSize(7);
  const badgeText = model.statusLabel;
  const badgeWidth = doc.widthOfString(badgeText, { characterSpacing: 1.4 }) + 22;
  const badgeX = right - badgeWidth;
  const paid = model.status === 'paid';
  doc.save().roundedRect(badgeX, 93, badgeWidth, 17, 8.5).fill(paid ? COLORS.paidBadge : COLORS.badge).restore();
  doc.fillColor(paid ? COLORS.paidBadgeText : COLORS.badgeText)
    .text(badgeText, badgeX, 98.5, { width: badgeWidth, align: 'center', characterSpacing: 1.4, lineBreak: false });
  rule(doc, 124, MARGIN, right, COLORS.clay, 1);
  return 124;
}

function drawParties(doc, model, columns, right) {
  const top = 143;
  const lineGap = 14.2;
  let leftBottom = top;
  model.meta.forEach((item, index) => {
    const y = top + index * 41;
    label(doc, item.label, MARGIN, y);
    doc.font(FONT_BODY).fontSize(10).fillColor(COLORS.ink).text(item.value, MARGIN, y + 16, { lineBreak: false });
    leftBottom = y + 30;
  });

  const block = (party, x) => {
    const width = (x === columns.billX ? columns.shipX : right) - x - 12;
    label(doc, party.label, x, top);
    let y = top + 16;
    doc.font(FONT_BODY).fontSize(9).fillColor(COLORS.ink);
    for (const line of party.lines) {
      doc.text(line, x, y, { width, lineGap: 2 });
      y = Math.max(y + lineGap, doc.y);
    }
    return y;
  };
  const bottom = Math.max(leftBottom, block(model.billTo, columns.billX), block(model.shipTo, columns.shipX));
  const ruleY = bottom + 12;
  rule(doc, ruleY, MARGIN, right, COLORS.rule);
  return ruleY;
}

function drawSummary(doc, model, top, right, width) {
  const y = top + 18;
  const buttonWidth = 92;
  const textWidth = width - 40 - (model.payOnline ? buttonWidth + 24 : 0);
  doc.font(FONT_DISPLAY).fontSize(16);
  const headlineHeight = doc.heightOfString(model.summary.headline, { width: textWidth, lineGap: 4 });
  const height = Math.max(67, headlineHeight + 46);
  doc.save().roundedRect(MARGIN, y, width, height, 8).fillAndStroke(COLORS.panel, COLORS.panelBorder).restore();
  doc.fillColor(COLORS.ink).text(model.summary.headline, MARGIN + 20, y + 19, { width: textWidth, lineGap: 4 });
  doc.font(FONT_BODY).fontSize(7.5).fillColor(COLORS.muted)
    .text(model.summary.from, MARGIN + 20, y + 23 + headlineHeight, { characterSpacing: 0.4, lineBreak: false });

  if (model.payOnline) {
    const bx = right - 20 - buttonWidth;
    const by = y + (height - 28) / 2;
    doc.save().roundedRect(bx, by, buttonWidth, 28, 4).fill(COLORS.moss).restore();
    doc.font(FONT_BODY).fontSize(7).fillColor(COLORS.parchment)
      .text(model.payOnline.label, bx, by + 10.5, { width: buttonWidth, align: 'center', characterSpacing: 1.5, lineBreak: false });
    doc.link(bx, by, buttonWidth, 28, model.payOnline.url);
  }
  return y + height;
}

function drawTableHeader(doc, model, top, columns, right) {
  const y = top + 19;
  label(doc, model.columns.description, MARGIN, y);
  label(doc, model.columns.quantity, MARGIN, y, { width: columns.qtyRight - MARGIN, align: 'right' });
  label(doc, model.columns.unitPrice, MARGIN, y, { width: columns.unitRight - MARGIN, align: 'right' });
  label(doc, model.columns.amount, MARGIN, y, { width: right - MARGIN, align: 'right' });
  rule(doc, y + 15, MARGIN, right, COLORS.tableRule, 0.9);
  return y + 15;
}

function rowHeight(doc, item, descWidth) {
  doc.font(FONT_BODY).fontSize(9);
  let height = doc.heightOfString(item.description, { width: descWidth });
  if (item.period) {
    doc.fontSize(7.5);
    height += 5 + doc.heightOfString(item.period, { width: descWidth });
  }
  return ROW_PAD_TOP + height + ROW_PAD_BOTTOM;
}

function drawRow(doc, item, top, columns, right, descWidth) {
  const y = top + ROW_PAD_TOP;
  doc.font(FONT_BODY).fontSize(9).fillColor(COLORS.ink).text(item.description, MARGIN, y, { width: descWidth });
  if (item.period) {
    doc.fontSize(7.5).fillColor(COLORS.muted).text(item.period, MARGIN, doc.y + 5, { width: descWidth });
  }
  doc.font(FONT_BODY).fontSize(9).fillColor(COLORS.ink);
  doc.text(item.quantity, MARGIN, y, { width: columns.qtyRight - MARGIN, align: 'right', lineBreak: false });
  doc.text(item.unitPrice, MARGIN, y, { width: columns.unitRight - MARGIN, align: 'right', lineBreak: false });
  doc.text(item.amount, MARGIN, y, { width: right - MARGIN, align: 'right', lineBreak: false });
}

function totalsHeight(model) {
  return model.totals.reduce((sum, row) => sum + (row.kind === 'total' ? TOTAL_ROW + 8 : TOTAL_ROW), 0);
}

function drawTotals(doc, model, top, columns, right) {
  let y = top;
  const width = right - columns.totalsX;
  for (const row of model.totals) {
    const height = row.kind === 'total' ? TOTAL_ROW + 8 : TOTAL_ROW;
    if (row.kind === 'total') {
      doc.font(FONT_DISPLAY).fontSize(10).fillColor(COLORS.ink)
        .text(row.label, columns.totalsX, y + 10, { lineBreak: false });
      doc.fontSize(14).text(row.value, columns.totalsX, y + 7, { width, align: 'right', lineBreak: false });
    } else if (row.kind === 'due') {
      doc.font(FONT_STRONG).fontSize(9).fillColor(COLORS.ink)
        .text(row.label, columns.totalsX, y + 8, { lineBreak: false });
      doc.text(row.value, columns.totalsX, y + 8, { width, align: 'right', lineBreak: false });
    } else {
      doc.font(FONT_BODY).fontSize(9).fillColor(COLORS.ink)
        .text(row.label, columns.totalsX, y + 8, { lineBreak: false });
      doc.text(row.value, columns.totalsX, y + 8, { width, align: 'right', lineBreak: false });
    }
    y += height;
    rule(doc, y, columns.totalsX, right, row.kind === 'due' ? COLORS.panelBorder : COLORS.rule);
  }
  return y;
}

function notesHeight(doc, model, width) {
  doc.font(FONT_BODY).fontSize(8.5);
  return 25 + doc.heightOfString(model.notes.text, { width: width - 38, lineGap: 3 }) + 12;
}

function drawNotes(doc, model, top, width) {
  const height = notesHeight(doc, model, width);
  doc.save().rect(MARGIN, top, width, height).fill(COLORS.panel).restore();
  doc.save().rect(MARGIN, top, 2.5, height).fill(COLORS.clay).restore();
  doc.font(FONT_BODY).fontSize(LABEL.size).fillColor(COLORS.ink)
    .text(model.notes.label, MARGIN + 16, top + 13, { characterSpacing: LABEL.spacing, lineBreak: false });
  doc.font(FONT_BODY).fontSize(8.5).fillColor(COLORS.muted)
    .text(model.notes.text, MARGIN + 16, top + 25, { width: width - 38, lineGap: 3 });
  return top + height;
}

function drawFooter(doc, model, page, pages, right, width) {
  const ruleY = doc.page.height - FOOTER_HEIGHT;
  rule(doc, ruleY, MARGIN, right, COLORS.rule);
  doc.font(FONT_BODY).fontSize(7).fillColor(COLORS.muted)
    .text(model.footer.issuerLine, MARGIN, ruleY + 12, { lineBreak: false });
  const prefix = `${model.footer.questionsPrefix} `;
  const emailX = MARGIN + doc.widthOfString(prefix);
  doc.text(prefix, MARGIN, ruleY + 24, { lineBreak: false });
  doc.fillColor(COLORS.clay).text(model.footer.email, emailX, ruleY + 24, { lineBreak: false });
  doc.link(emailX, ruleY + 24, doc.widthOfString(model.footer.email), 9, `mailto:${model.footer.email}`);
  doc.fillColor(COLORS.muted)
    .text(model.footer.pageLabel(page, pages), MARGIN, ruleY + 24, { width, align: 'right', lineBreak: false });
}

/**
 * Renders the document built by `buildInvoiceDocument` into a PDF buffer.
 * US invoices use Letter and Brazilian ones A4, as in the approved layout.
 */
function renderInvoicePdf(model) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: model.pageSize || 'LETTER',
      margin: 0,
      bufferPages: true,
      info: {
        Title: `${model.title} ${model.invoiceNumber}`,
        Author: 'Eden Bowls',
        Subject: model.invoiceNumber
      }
    });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      doc.registerFont(FONT_BODY, path.join(ASSETS_DIR, 'Quicksand-Regular.ttf'));
      doc.registerFont(FONT_STRONG, path.join(ASSETS_DIR, 'Quicksand-SemiBold.ttf'));
      doc.registerFont(FONT_DISPLAY, path.join(ASSETS_DIR, 'TenorSans-Latin.ttf'));

      const right = doc.page.width - MARGIN;
      const width = right - MARGIN;
      const columns = columnsFor(width);
      const descWidth = columns.qtyRight - MARGIN - 60;
      const bottomLimit = doc.page.height - FOOTER_HEIGHT - 10;

      // A continuation page repeats the top; the table header only when more rows follow.
      const newPage = ({ tableHeader = true } = {}) => {
        doc.addPage();
        paintPaper(doc);
        const top = drawTop(doc, model, right, width);
        return tableHeader ? drawTableHeader(doc, model, top, columns, right) : top + 22;
      };

      paintPaper(doc);
      drawTop(doc, model, right, width);
      const partiesBottom = drawParties(doc, model, columns, right);
      const summaryBottom = drawSummary(doc, model, partiesBottom, right, width);
      let y = drawTableHeader(doc, model, summaryBottom, columns, right);

      for (const item of model.items) {
        const height = rowHeight(doc, item, descWidth);
        if (y + height > bottomLimit) y = newPage();
        drawRow(doc, item, y, columns, right, descWidth);
        y += height;
        rule(doc, y, MARGIN, right, COLORS.rule);
      }

      if (y + totalsHeight(model) > bottomLimit) y = newPage({ tableHeader: false });
      y = drawTotals(doc, model, y, columns, right);

      const notesTop = y + 22;
      if (notesTop + notesHeight(doc, model, width) > bottomLimit) {
        drawNotes(doc, model, newPage({ tableHeader: false }), width);
      } else {
        drawNotes(doc, model, notesTop, width);
      }

      const range = doc.bufferedPageRange();
      for (let index = 0; index < range.count; index += 1) {
        doc.switchToPage(range.start + index);
        drawFooter(doc, model, index + 1, range.count, right, width);
      }
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

module.exports = {
  renderInvoicePdf
};
