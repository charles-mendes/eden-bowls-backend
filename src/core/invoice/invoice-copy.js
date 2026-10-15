// Every fixed text of the invoice, as approved in
// docs-new/FEATURE_CUSTOMIZED_INVOICE/Eden Bowls - Invoice personalizado EN e PT (aprovacao).pdf.
// Change a text here, never inside the renderer, and keep both languages in step.

const SUPPORT_EMAIL = 'hello@edenbowls.com';

const INVOICE_ISSUERS = {
  'en-US': {
    name: 'Eden Bowls',
    line: 'Eden Bowls · Boca Raton, FL, USA',
    email: SUPPORT_EMAIL
  },
  'pt-BR': {
    name: 'Eden Bowls',
    line: 'Eden Bowls · CNPJ 65.291.985/0001-05 · Curitiba, PR',
    email: SUPPORT_EMAIL
  }
};

const INVOICE_COPY = {
  'en-US': {
    title: 'INVOICE',
    numberLabel: 'Invoice number',
    statusDue: 'PAYMENT DUE',
    statusPaid: 'PAID',
    issued: 'DATE OF ISSUE',
    due: 'DATE DUE',
    paidOn: 'DATE PAID',
    billTo: 'BILL TO',
    shipTo: 'SHIP TO',
    headlineDue: (amount, date) => `${amount} due ${date}`,
    headlinePaid: (amount, date) => `${amount} paid ${date}`,
    from: 'From',
    payOnline: 'PAY ONLINE',
    columns: { description: 'DESCRIPTION', quantity: 'QTY', unitPrice: 'UNIT PRICE', amount: 'AMOUNT' },
    productLine: 'Fresh Bowl',
    servicePeriod: 'Service period',
    fallbackLine: 'Eden Bowls subscription',
    subtotal: 'Subtotal',
    discount: 'Discount',
    shipping: 'Shipping',
    tax: 'Tax',
    total: 'Total',
    credit: 'Credit applied',
    amountPaid: 'Amount paid',
    amountDue: 'Amount due',
    notes: 'NOTES',
    thanksPet: (pets) => `Thank you for feeding ${pets} with Eden Bowls.`,
    thanks: 'Thank you for choosing Eden Bowls.',
    coversCycle: 'This invoice covers the subscription cycle shown above.',
    coversChange: 'This invoice covers the plan change shown above.',
    chargedDue: 'Payment is charged automatically to the card on file.',
    chargedPaid: 'Payment was charged automatically to the card on file.',
    questions: 'Questions about this invoice? Write to',
    page: (page, total) => `Page ${page} of ${total}`
  },
  'pt-BR': {
    title: 'FATURA',
    numberLabel: 'Número da fatura',
    statusDue: 'PAGAMENTO PENDENTE',
    statusPaid: 'PAGO',
    issued: 'DATA DE EMISSÃO',
    due: 'VENCIMENTO',
    paidOn: 'DATA DO PAGAMENTO',
    billTo: 'COBRANÇA',
    shipTo: 'ENTREGA',
    headlineDue: (amount, date) => `${amount} · vence em ${date}`,
    headlinePaid: (amount, date) => `${amount} · pago em ${date}`,
    from: 'Emitente',
    payOnline: 'PAGAR ONLINE',
    columns: { description: 'DESCRIÇÃO', quantity: 'QTD.', unitPrice: 'PREÇO UNITÁRIO', amount: 'VALOR' },
    productLine: 'Fresh Bowl',
    servicePeriod: 'Período',
    fallbackLine: 'Assinatura Eden Bowls',
    subtotal: 'Subtotal',
    discount: 'Desconto',
    shipping: 'Frete',
    tax: 'Impostos',
    total: 'Total',
    credit: 'Crédito aplicado',
    amountPaid: 'Valor pago',
    amountDue: 'Valor a pagar',
    notes: 'OBSERVAÇÕES',
    thanksPet: (pets) => `Obrigado por alimentar ${pets} com a Eden Bowls.`,
    thanks: 'Obrigado por escolher a Eden Bowls.',
    coversCycle: 'Esta fatura se refere ao ciclo de assinatura indicado acima.',
    coversChange: 'Esta fatura se refere à alteração de plano indicada acima.',
    chargedDue: 'O pagamento é cobrado automaticamente no cartão cadastrado.',
    chargedPaid: 'O pagamento foi cobrado automaticamente no cartão cadastrado.',
    questions: 'Dúvidas sobre esta fatura? Escreva para',
    page: (page, total) => `Página ${page} de ${total}`
  }
};

// Recipe names follow the flavor names the store shows (src/core/market.js flavorLabels): the `turkey` key is sold
// as Chicken / Frango, so the invoice prints what the customer bought, not the sample text of the approved PDF.
const FLAVOR_RECIPE_LABELS = {
  'en-US': {
    beef: 'Beef Recipe',
    fish: 'Fish Recipe',
    pork: 'Pork Recipe',
    turkey: 'Chicken Recipe'
  },
  'pt-BR': {
    beef: 'Receita de Carne Bovina',
    fish: 'Receita de Peixe',
    pork: 'Receita de Porco',
    turkey: 'Receita de Frango'
  }
};

module.exports = {
  FLAVOR_RECIPE_LABELS,
  INVOICE_COPY,
  INVOICE_ISSUERS
};
