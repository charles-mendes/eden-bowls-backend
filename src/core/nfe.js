const NFE_STATUS = {
  PENDING: 'pending',
  BLOCKED_MISSING_DOCUMENT: 'blocked_missing_document',
  SUBMITTED: 'submitted',
  AUTHORIZED: 'authorized',
  REJECTED: 'rejected',
  ERROR: 'error'
};

const NFE_STATUSES = Object.values(NFE_STATUS);
const NFE_RETRYABLE_STATUSES = [NFE_STATUS.ERROR, NFE_STATUS.REJECTED, NFE_STATUS.BLOCKED_MISSING_DOCUMENT];

// GET /nfe `situacao`. Contas a receber numbers the same words differently; that table does not apply here.
const BLING_SITUACAO = {
  PENDENTE: 1,
  CANCELADA: 2,
  AGUARDANDO_RECIBO: 3,
  REJEITADA: 4,
  AUTORIZADA: 5,
  EMITIDA_DANFE: 6,
  REGISTRADA: 7,
  AGUARDANDO_PROTOCOLO: 8,
  DENEGADA: 9,
  CONSULTA_SITUACAO: 10,
  BLOQUEADA: 11
};

const SITUACAO_LABELS = {
  1: 'Pendente',
  2: 'Cancelada',
  3: 'Aguardando recibo',
  4: 'Rejeitada',
  5: 'Autorizada',
  6: 'Emitida DANFE',
  7: 'Registrada',
  8: 'Aguardando protocolo',
  9: 'Denegada',
  10: 'Consulta situação',
  11: 'Bloqueada'
};

function nfeStatusFromSituacao(situacao) {
  const value = Number(situacao);
  if (value === BLING_SITUACAO.AUTORIZADA || value === BLING_SITUACAO.EMITIDA_DANFE) {
    return NFE_STATUS.AUTHORIZED;
  }
  if (value === BLING_SITUACAO.REJEITADA || value === BLING_SITUACAO.DENEGADA
    || value === BLING_SITUACAO.CANCELADA || value === BLING_SITUACAO.BLOQUEADA) {
    return NFE_STATUS.REJECTED;
  }
  return NFE_STATUS.SUBMITTED;
}

function situacaoLabel(situacao) {
  return SITUACAO_LABELS[Number(situacao)] || null;
}

// The API has no protocol field. The authorized XML carries it, when Bling returns the XML itself and not a link.
function protocolFromXml(xml) {
  const match = /<nProt>\s*(\d+)\s*<\/nProt>/.exec(String(xml || ''));
  return match ? match[1] : null;
}

function isInvoiceLinesPricedExactly(amountMinor, quantity) {
  return Number.isInteger(amountMinor / quantity);
}

/**
 * The order of a Stripe invoice, in minor units: product lines, freight and one difference that closes on
 * invoice.total, so the note never disagrees with the charge. Discounts and credit lines become the discount;
 * anything Stripe added on top of the lines becomes other expenses.
 */
function buildNfeOrderLines({ lines, totalMinor, isShipping }) {
  const items = [];
  let freightMinor = 0;
  for (const line of lines) {
    const amountMinor = Number(line.amountMinor) || 0;
    if (isShipping(line)) {
      freightMinor += Math.max(0, amountMinor);
      continue;
    }
    if (amountMinor <= 0) continue;
    const quantity = Math.max(1, Number(line.quantity) || 1);
    const exact = isInvoiceLinesPricedExactly(amountMinor, quantity);
    items.push({
      code: line.code,
      description: line.description,
      quantity: exact ? quantity : 1,
      unitMinor: exact ? amountMinor / quantity : amountMinor
    });
  }
  const itemsMinor = items.reduce((sum, item) => sum + item.quantity * item.unitMinor, 0);
  const differenceMinor = itemsMinor + freightMinor - totalMinor;
  return {
    items,
    freightMinor,
    discountMinor: Math.max(0, differenceMinor),
    otherExpensesMinor: Math.max(0, -differenceMinor)
  };
}

module.exports = {
  BLING_SITUACAO,
  NFE_RETRYABLE_STATUSES,
  NFE_STATUS,
  NFE_STATUSES,
  buildNfeOrderLines,
  nfeStatusFromSituacao,
  protocolFromXml,
  situacaoLabel
};
