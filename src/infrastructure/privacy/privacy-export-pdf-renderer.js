const PDFDocument = require('pdfkit');
const {
  LOGO_PATH,
  LOGO_RATIO,
  COLORS,
  FONT_BODY,
  FONT_STRONG,
  FONT_DISPLAY,
  registerBrandFonts
} = require('../pdf/brand');
const { buildPrivacyExportDocument } = require('../../core/privacy-export-document');

const MARGIN = 50;
const LOGO_HEIGHT = 34;
const LABEL = { size: 6.8, spacing: 1.5 };
const FOOTER_HEIGHT = 60;
const ROW_GAP = 4;
const LABEL_COLUMN = 150;

function label(doc, value, x, y, options = {}) {
  doc.font(FONT_BODY).fontSize(LABEL.size).fillColor(COLORS.clay)
    .text(value, x, y, { characterSpacing: LABEL.spacing, lineBreak: false, ...options });
}

function rule(doc, y, x1, x2, color, width = 0.75) {
  doc.save().moveTo(x1, y).lineTo(x2, y).lineWidth(width).strokeColor(color).stroke().restore();
}

function paintPaper(doc) {
  doc.save().rect(0, 0, doc.page.width, doc.page.height).fill(COLORS.paper).restore();
}

// Logo left, document title right, clay rule: the same top as the invoice.
function drawTop(doc, model, right, width) {
  doc.image(LOGO_PATH, MARGIN, 40, { height: LOGO_HEIGHT, width: LOGO_HEIGHT * LOGO_RATIO });
  doc.font(FONT_DISPLAY).fontSize(18).fillColor(COLORS.ink)
    .text(model.heading.toUpperCase(), MARGIN, 48, { width, align: 'right', characterSpacing: 2.5, lineBreak: false });
  rule(doc, 96, MARGIN, right, COLORS.clay, 1);
  return 96;
}

function drawFooter(doc, model, page, pages, right, width) {
  const ruleY = doc.page.height - FOOTER_HEIGHT;
  rule(doc, ruleY, MARGIN, right, COLORS.rule);
  doc.font(FONT_BODY).fontSize(7).fillColor(COLORS.muted);
  const prefix = `${model.footer.questionsPrefix} `;
  const emailX = MARGIN + doc.widthOfString(prefix);
  doc.text(prefix, MARGIN, ruleY + 14, { lineBreak: false });
  doc.fillColor(COLORS.clay).text(model.footer.email, emailX, ruleY + 14, { lineBreak: false });
  doc.link(emailX, ruleY + 14, doc.widthOfString(model.footer.email), 9, `mailto:${model.footer.email}`);
  doc.fillColor(COLORS.muted)
    .text(model.footer.pageLabel(page, pages), MARGIN, ruleY + 14, { width, align: 'right', lineBreak: false });
}

/**
 * Draws a privacy export document (buildPrivacyExportDocument) into a PDF buffer.
 * Portuguese prints on A4 and English on Letter, as the invoice does.
 */
function renderPrivacyExportDocument(model) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: model.locale === 'en' ? 'LETTER' : 'A4',
      margin: 0,
      bufferPages: true,
      info: { Title: `${model.documentTitle} ${model.meta[0].value}`, Author: 'Eden Bowls' }
    });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      registerBrandFonts(doc);
      // No ligatures: with them "fi" copies out as "f" ("perfl"), which breaks copy and screen readers.
      const drawText = doc.text.bind(doc);
      doc.text = (value, x, y, options = {}) => drawText(value, x, y, { features: { liga: false, clig: false }, ...options });
      const right = doc.page.width - MARGIN;
      const width = right - MARGIN;
      const bottom = doc.page.height - FOOTER_HEIGHT - 14;
      let y;

      const newPage = () => {
        doc.addPage();
        paintPaper(doc);
        y = drawTop(doc, model, right, width) + 22;
      };
      // Starts a new page when the next block does not fit.
      const ensure = (height) => {
        if (y + height > bottom) newPage();
      };
      const heightOf = (value, font, size, blockWidth, lineGap = 2) => {
        doc.font(font).fontSize(size);
        return doc.heightOfString(value, { width: blockWidth, lineGap });
      };
      const paragraph = (value, { font = FONT_BODY, size = 9, color = COLORS.ink, x = MARGIN, blockWidth = width, gap = 2 } = {}) => {
        const height = heightOf(value, font, size, blockWidth, gap);
        ensure(height);
        doc.font(font).fontSize(size).fillColor(color).text(value, x, y, { width: blockWidth, lineGap: gap });
        y += height;
      };
      const pageRoom = bottom - (96 + 22);
      const rowHeight = (row) => Math.max(heightOf(row.value, FONT_BODY, 9, width - LABEL_COLUMN), 11) + ROW_GAP;
      // A record stays on one page when it fits on one.
      const recordHeight = (record) => (record.title ? 19 : 0) + record.rows.reduce((sum, row) => sum + rowHeight(row), 0) + 8;
      const SECTION_HEAD = 48;
      const sectionTitle = (value, keepWith = 12) => {
        ensure(SECTION_HEAD + Math.min(keepWith, pageRoom - SECTION_HEAD));
        y += 18;
        doc.font(FONT_DISPLAY).fontSize(13).fillColor(COLORS.ink).text(value, MARGIN, y, { lineBreak: false });
        y += 20;
        rule(doc, y, MARGIN, right, COLORS.rule);
        y += 10;
      };

      paintPaper(doc);
      y = drawTop(doc, model, right, width) + 18;

      // Request and date, then the introduction.
      model.meta.forEach((item, index) => {
        const x = MARGIN + index * (width / 2);
        label(doc, item.label, x, y);
        doc.font(FONT_BODY).fontSize(10).fillColor(COLORS.ink).text(item.value, x, y + 13, { width: width / 2 - 12, lineBreak: false });
      });
      y += 40;
      paragraph(model.intro, { size: 9, color: COLORS.muted, gap: 3 });

      for (const current of model.sections) {
        // Source and purpose in a panel with the clay bar, like the invoice notes.
        const textWidth = width - LABEL_COLUMN - 32;
        const sourceHeight = heightOf(current.source, FONT_BODY, 8.5, textWidth);
        const purposeHeight = heightOf(current.purpose, FONT_BODY, 8.5, textWidth);
        const panelHeight = 12 + sourceHeight + 8 + purposeHeight + 12;
        // The title, the panel and the first record (or "no record") start on the same page.
        const firstBlock = current.noRecord ? 16 : recordHeight(current.records[0]);
        sectionTitle(current.title, panelHeight + 10 + firstBlock);
        ensure(panelHeight);
        doc.save().rect(MARGIN, y, width, panelHeight).fill(COLORS.panel).restore();
        doc.save().rect(MARGIN, y, 2.5, panelHeight).fill(COLORS.clay).restore();
        label(doc, current.sourceLabel, MARGIN + 16, y + 13);
        doc.font(FONT_BODY).fontSize(8.5).fillColor(COLORS.ink)
          .text(current.source, MARGIN + 16 + LABEL_COLUMN, y + 11, { width: textWidth, lineGap: 2 });
        const purposeY = y + 12 + sourceHeight + 8;
        label(doc, current.purposeLabel, MARGIN + 16, purposeY + 2);
        doc.font(FONT_BODY).fontSize(8.5).fillColor(COLORS.ink)
          .text(current.purpose, MARGIN + 16 + LABEL_COLUMN, purposeY, { width: textWidth, lineGap: 2 });
        y += panelHeight + 10;

        if (current.noRecord) {
          paragraph(current.noRecord, { size: 9, color: COLORS.muted });
          continue;
        }

        for (const record of current.records) {
          ensure(Math.min(recordHeight(record), pageRoom));
          if (record.title) {
            ensure(36);
            y += 4;
            doc.font(FONT_STRONG).fontSize(9.5).fillColor(COLORS.ink).text(record.title, MARGIN, y, { width, lineBreak: false });
            y += 15;
          }
          for (const row of record.rows) {
            const valueWidth = width - LABEL_COLUMN;
            const height = Math.max(heightOf(row.value, FONT_BODY, 9, valueWidth), 11);
            ensure(height + ROW_GAP);
            doc.font(FONT_BODY).fontSize(8.5).fillColor(COLORS.muted).text(row.label, MARGIN, y + 0.5, { width: LABEL_COLUMN - 12 });
            doc.font(FONT_BODY).fontSize(9).fillColor(COLORS.ink).text(row.value, MARGIN + LABEL_COLUMN, y, { width: valueWidth, lineGap: 2 });
            y += height + ROW_GAP;
          }
          rule(doc, y + 2, MARGIN, right, COLORS.rule, 0.5);
          y += 8;
        }
      }

      sectionTitle(model.criteria.title, heightOf(model.criteria.text, FONT_BODY, 9, width));
      paragraph(model.criteria.text);

      // Sharing table: the policy's recipients, the same for every customer.
      // The title, the intro, the header and the first two rows start together.
      sectionTitle(model.sharing.title, heightOf(model.sharing.intro, FONT_BODY, 9, width) + 8 + 24 + 2 * 30);
      paragraph(model.sharing.intro, { color: COLORS.muted });
      y += 8;
      const columns = [
        { key: 'recipient', x: MARGIN, w: width * 0.3 },
        { key: 'purpose', x: MARGIN + width * 0.31, w: width * 0.34 },
        { key: 'place', x: MARGIN + width * 0.66, w: width * 0.34 }
      ];
      ensure(24);
      for (const column of columns) label(doc, model.sharing.columns[column.key], column.x, y);
      y += 12;
      rule(doc, y, MARGIN, right, COLORS.tableRule, 0.9);
      y += 6;
      for (const row of model.sharing.rows) {
        const height = Math.max(...columns.map((column) => heightOf(row[column.key], FONT_BODY, 8.5, column.w - 8)));
        ensure(height + 10);
        for (const column of columns) {
          doc.font(column.key === 'recipient' ? FONT_STRONG : FONT_BODY).fontSize(8.5).fillColor(COLORS.ink)
            .text(row[column.key], column.x, y, { width: column.w - 8, lineGap: 2 });
        }
        y += height + 5;
        rule(doc, y, MARGIN, right, COLORS.rule, 0.5);
        y += 5;
      }
      y += 4;
      paragraph(model.sharing.staff, { size: 8.5, color: COLORS.muted });

      const notIncludedHeight = heightOf(model.notIncluded.intro, FONT_BODY, 9, width) + 4
        + model.notIncluded.items.reduce((sum, item) => sum + heightOf(item, FONT_BODY, 9, width - 14) + 6, 0);
      sectionTitle(model.notIncluded.title, notIncludedHeight);
      paragraph(model.notIncluded.intro, { color: COLORS.muted });
      y += 4;
      for (const item of model.notIncluded.items) {
        const height = heightOf(item, FONT_BODY, 9, width - 14);
        ensure(height + 6);
        doc.save().circle(MARGIN + 3, y + 5, 1.6).fill(COLORS.clay).restore();
        doc.font(FONT_BODY).fontSize(9).fillColor(COLORS.ink).text(item, MARGIN + 14, y, { width: width - 14, lineGap: 2 });
        y += height + 6;
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

/**
 * The privacy export package as a PDF buffer, in the request's language.
 */
async function renderPrivacyExportPdf({ pack, requestId, type = 'access', locale = 'pt-BR' }) {
  const model = buildPrivacyExportDocument({ pack, requestId, type, locale });
  return { buffer: await renderPrivacyExportDocument(model), filename: model.filename };
}

module.exports = {
  renderPrivacyExportDocument,
  renderPrivacyExportPdf
};
