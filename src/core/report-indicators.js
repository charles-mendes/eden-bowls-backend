const { HttpError } = require('./http-error');

// One entry per figure of the Relatórios screen. The key is the `Chave` of the aggregate CSV, so a CSV row,
// a card and its details all name the same number. Labels are the screen's; hints are the cards' help texts.
//
// An entry says where its records come from (`source`), how each record adds to the figure (`measures`:
// `contribution`, or `numerator` and `denominator` for averages and rates), and how to read the figure from
// the consolidated report (`value`), which the details compare with the sum of the records.

const STATUS_LABELS = {
  active: 'Ativa',
  trialing: 'Em teste',
  past_due: 'Pagamento atrasado',
  canceled: 'Cancelada',
  paused: 'Pausada',
  incomplete: 'Incompleta',
  incomplete_expired: 'Expirada',
  unpaid: 'Não paga'
};

const GROUP_LABELS = {
  invoices: {
    subscription_create: 'Primeira compra',
    subscription_cycle: 'Renovação do ciclo',
    subscription_update: 'Mudança na assinatura',
    subscription_threshold: 'Cobrança por limite',
    manual: 'Manual',
    '': 'Sem motivo de cobrança'
  },
  subscriptions: STATUS_LABELS,
  awaiting: STATUS_LABELS,
  lineItems: STATUS_LABELS,
  mrr: STATUS_LABELS,
  checkouts: { started: 'Só iniciado', linked: 'Vinculado ao Stripe', activated: 'Chegou a ativar' },
  cycles: { to_prepare: 'A preparar', in_production: 'Em produção', ready: 'Pronto', blocked: 'Bloqueado' },
  shipments: {
    label_created: 'Etiqueta criada',
    shipped: 'Enviado',
    in_transit: 'Em trânsito',
    delivered: 'Entregue',
    exception: 'Com exceção',
    voided: 'Cancelado',
    '': 'Sem status'
  },
  movements: { production: 'Produção', separation: 'Separação', separation_reversal: 'Estorno de separação', adjustment: 'Ajuste' }
};

const CYCLE_LABELS = { to_prepare: 'A preparar', in_production: 'Em produção', ready: 'Prontos', blocked: 'Bloqueados' };
const SHIPMENT_LABELS = {
  label_created: 'Etiqueta criada',
  shipped: 'Enviados',
  in_transit: 'Em trânsito',
  delivered: 'Entregues',
  exception: 'Com exceção',
  voided: 'Cancelados'
};

const get = (object, path) => path.split('.').reduce((value, part) => (value == null ? undefined : value[part]), object);

// A card with value and previous.
const kpiValue = (path) => (report, options = {}) => {
  const entry = get(report, path);
  if (!entry || typeof entry !== 'object') return undefined;
  return options.previous ? entry.previous : entry.value;
};
// A bare number of the report (point-in-time controls).
const plainValue = (path) => (report) => {
  const value = get(report, path);
  return typeof value === 'number' ? value : undefined;
};
// A series measure: one bucket, or the whole period.
const seriesValue = (measure) => (report, options = {}) => {
  if (!Array.isArray(report.series)) return undefined;
  if (options.bucket) return Number(options.bucket[measure] || 0);
  return report.series.reduce((sum, bucket) => sum + Number(bucket[measure] || 0), 0);
};
const ratio = (numerator, denominator) => (denominator ? Math.round((numerator / denominator) * 10000) / 10000 : null);

const INVOICE_CRITERIA = [
  'Faturas de cliente com status pago (paid), da conta Stripe do mercado.',
  'Emitidas dentro da janela, pelo horário local do mercado.',
  'Só a moeda do mercado entra nos valores; faturas em outra moeda ficam fora e aparecem em Excluídos.',
  'Valor pago como cobrado: inclui impostos e frete, não desconta reembolsos.'
];
const SUBSCRIPTION_NOW = ['Assinaturas do ledger na conta Stripe do mercado, no status de agora.'];
const LIFECYCLE = [
  'Só assinaturas que chegaram a ativar (activated_at preenchido) contam como novas ou canceladas.',
  'Datas preenchidas pelo backfill são aproximadas e vêm marcadas.'
];
const CHECKOUT_CRITERIA = [
  'Checkouts do mercado (onboarding_user_state.market), criados na janela pelo horário local.',
  'Vinculado: o cliente tem assinatura Stripe na conta do mercado. Ativado: essa assinatura chegou a ativar.'
];
const MIX_CRITERIA = [
  'Retrato de agora: assinaturas do mercado em status ativa, em teste ou pagamento atrasado.',
  'Itens do plano com quantidade maior que zero; pacotes contam uma entrega de cada assinatura.',
  'O período escolhido não se aplica a Pacotes por entrega.'
];
const CYCLE_CRITERIA = [
  'Ciclos de produção pagos (paid_at preenchido) das assinaturas da conta Stripe do mercado.',
  'Pela data de entrega dentro da janela.',
  'Status desconhecido conta como A preparar.'
];
const SHIPMENT_CRITERIA = ['Envios UPS das assinaturas da conta Stripe US, criados na janela.'];
const MOVEMENT_CRITERIA = ['Movimentos de estoque dos itens do mercado, criados na janela.'];

function invoiceEntry(label, kind, variant, extra = {}) {
  return {
    label,
    kind,
    source: { name: 'invoices', args: { variant } },
    measures: { contribution: kind === 'money' ? 'amount' : 'one' },
    excluded: variant === 'otherCurrency' ? [] : [{ source: { name: 'invoices', args: { variant: 'otherCurrency' } }, reason: 'Moeda diferente da moeda do mercado' }],
    criteria: INVOICE_CRITERIA,
    ...extra
  };
}

function subscriptionNow(label, variant, path, extra = {}) {
  return {
    label,
    kind: 'count',
    pointInTime: true,
    value: kpiValue(path),
    source: { name: 'subscriptions', args: { variant } },
    measures: { contribution: 'one' },
    criteria: SUBSCRIPTION_NOW,
    ...extra
  };
}

function checkoutStage(label, variant) {
  return {
    label,
    kind: 'count',
    value: kpiValue(`stages.${variant}`),
    source: { name: 'checkouts', args: { variant } },
    measures: { contribution: 'one' },
    criteria: CHECKOUT_CRITERIA
  };
}

function conversion(label, sourceVariant, numerator, numeratorLabel, denominatorLabel, key, hint) {
  return {
    label,
    kind: 'rate',
    value: kpiValue(`conversions.${key}`),
    source: { name: 'checkouts', args: { variant: sourceVariant } },
    measures: { numerator, denominator: 'one' },
    combine: 'ratio',
    formula: { numerator: numeratorLabel, denominator: denominatorLabel },
    hint,
    criteria: CHECKOUT_CRITERIA
  };
}

const REPORTS = {
  revenue: {
    grossRevenue: invoiceEntry('Faturamento bruto', 'money', 'paid', {
      value: kpiValue('kpis.grossRevenue'),
      description: 'Soma do valor pago das faturas do período.',
      hint: 'Inclui impostos e frete cobrados; não desconta reembolsos.'
    }),
    paidInvoices: invoiceEntry('Faturas pagas', 'count', 'paid', {
      value: kpiValue('kpis.paidInvoices'),
      description: 'Quantidade de faturas pagas no período.'
    }),
    averageTicket: {
      ...invoiceEntry('Ticket médio', 'money', 'paid'),
      value: kpiValue('kpis.averageTicket'),
      description: 'Valor médio de cada fatura paga.',
      hint: 'Faturamento bruto ÷ faturas pagas.',
      measures: { numerator: 'amount', denominator: 'one' },
      combine: 'average',
      formula: { numerator: 'Faturamento bruto', denominator: 'Faturas pagas' }
    },
    firstPurchaseRevenue: invoiceEntry('Primeira compra', 'money', 'firstPurchase', {
      value: kpiValue('kpis.firstPurchaseRevenue'),
      description: 'Faturamento das faturas da primeira compra (motivo subscription_create).'
    }),
    renewalRevenue: invoiceEntry('Renovações', 'money', 'renewal', {
      value: kpiValue('kpis.renewalRevenue'),
      description: 'Faturamento das demais faturas pagas: renovações e mudanças de assinatura.'
    }),
    excludedInvoices: {
      ...invoiceEntry('Faturas em outra moeda fora do relatório', 'count', 'otherCurrency'),
      value: plainValue('excludedInvoices'),
      noPrevious: true,
      description: 'Faturas pagas da conta do mercado numa moeda diferente; não entram em nenhum valor.',
      hint: 'Faturas pagas do mercado em outra moeda não entram nos valores.'
    },
    estimatedMrr: {
      label: 'MRR estimado',
      kind: 'money',
      pointInTime: true,
      value: kpiValue('estimatedMrr'),
      mrr: 'priced',
      description: 'Receita recorrente mensal estimada das assinaturas que pagam hoje.',
      hint: 'Estimado: soma do preço mensal das assinaturas ativas e com pagamento atrasado, sem cupons recorrentes.',
      criteria: [
        'Assinaturas da conta Stripe do mercado em status ativa ou pagamento atrasado.',
        'Preço mensal guardado no plano (catalog_pricing.subtotal); todo preço cobra por mês.',
        'Cupons recorrentes não são descontados.',
        'Assinaturas em teste ou sem preço ficam fora e aparecem em Excluídos.'
      ]
    },
    'estimatedMrr.trialingSubscriptions': {
      label: 'Assinaturas em teste fora do MRR',
      kind: 'count',
      pointInTime: true,
      value: plainValue('estimatedMrr.trialingSubscriptions'),
      mrr: 'trialing',
      description: 'Assinaturas em teste: ainda não cobram e ficam fora do MRR.',
      criteria: ['Assinaturas da conta Stripe do mercado em status em teste (trialing).']
    },
    'estimatedMrr.unpricedSubscriptions': {
      label: 'Assinaturas sem preço fora do MRR',
      kind: 'count',
      pointInTime: true,
      value: plainValue('estimatedMrr.unpricedSubscriptions'),
      mrr: 'unpriced',
      description: 'Assinaturas que cobram, mas sem preço mensal guardado no plano.',
      criteria: ['Assinaturas ativas ou com pagamento atrasado sem catalog_pricing.subtotal válido.']
    },
    'series.revenue': invoiceEntry('Faturamento', 'money', 'paid', {
      value: seriesValue('revenue'),
      series: true,
      description: 'Faturamento bruto de um ponto do gráfico.'
    }),
    'series.invoices': invoiceEntry('Faturas pagas', 'count', 'paid', {
      value: seriesValue('invoices'),
      series: true,
      description: 'Faturas pagas de um ponto do gráfico.'
    })
  },
  subscriptions: {
    'current.active': subscriptionNow('Ativas', 'active', 'current.active', { description: 'Assinaturas em status ativa agora.' }),
    'current.trialing': subscriptionNow('Em teste', 'trialing', 'current.trialing', { description: 'Assinaturas em teste agora.' }),
    'current.canceling': subscriptionNow('Cancelando', 'canceling', 'current.canceling', {
      description: 'Assinaturas que pediram cancelamento no fim do período e ainda estão na fila.'
    }),
    'current.pastDue': subscriptionNow('Pagamento atrasado', 'pastDue', 'current.pastDue', { description: 'Assinaturas com pagamento atrasado agora.' }),
    'current.renewing7d': subscriptionNow('Renovam em 7 dias', 'renewing7d', 'current.renewing7d', {
      description: 'Assinaturas da fila cuja próxima cobrança cai nos próximos 7 dias.',
      criteria: [...SUBSCRIPTION_NOW, 'Fim do período atual entre agora e daqui a 7 dias.']
    }),
    activeSubscriptions: {
      ...subscriptionNow('Assinaturas ativas', 'activeOrTrialing', 'current.active'),
      value: (report) => {
        const active = get(report, 'current.active.value');
        const trialing = get(report, 'current.trialing.value');
        return typeof active === 'number' && typeof trialing === 'number' ? active + trialing : undefined;
      },
      description: 'Assinaturas ativas e em teste agora.',
      hint: 'Ativas e em teste'
    },
    new: {
      label: 'Novas',
      kind: 'count',
      value: kpiValue('kpis.new'),
      source: { name: 'subscriptions', args: { variant: 'new' } },
      measures: { contribution: 'one' },
      description: 'Assinaturas que ativaram pela primeira vez no período.',
      criteria: [...LIFECYCLE, 'Data de ativação (activated_at) dentro da janela.']
    },
    canceled: {
      label: 'Canceladas',
      kind: 'count',
      value: kpiValue('kpis.canceled'),
      source: { name: 'subscriptions', args: { variant: 'canceled' } },
      measures: { contribution: 'one' },
      description: 'Assinaturas que terminaram no período, inclusive as que começaram nele.',
      criteria: [...LIFECYCLE, 'Data de término (canceled_at) dentro da janela; pedido de cancelamento sem término não conta.']
    },
    activeAtStart: {
      label: 'Ativas no início',
      kind: 'count',
      value: kpiValue('kpis.activeAtStart'),
      source: { name: 'subscriptions', args: { variant: 'activeAtStart' } },
      measures: { contribution: 'one' },
      description: 'Base do churn: assinaturas já ativas no início do período.',
      criteria: [...LIFECYCLE, 'Ativou antes do início da janela e não tinha terminado até o início.']
    },
    churn: {
      label: 'Churn',
      kind: 'rate',
      value: kpiValue('kpis.churn'),
      source: { name: 'subscriptions', args: { variant: 'activeAtStart' } },
      measures: { numerator: 'churned', denominator: 'one' },
      combine: 'ratio',
      formula: { numerator: 'Canceladas entre as ativas no início', denominator: 'Ativas no início' },
      description: 'Parte das assinaturas ativas no início que terminou no período.',
      hint: 'Canceladas entre as ativas no início ÷ ativas no início.',
      criteria: [...LIFECYCLE, 'Assinaturas que começaram e terminaram dentro do período contam em Canceladas, não no churn.']
    },
    approximateNewCount: {
      label: 'Novas assinaturas com data aproximada',
      kind: 'count',
      noPrevious: true,
      value: plainValue('approximateNewCount'),
      source: { name: 'subscriptions', args: { variant: 'approximateNew' } },
      measures: { contribution: 'one' },
      description: 'Novas do período cuja data de ativação veio do backfill.',
      hint: 'Registradas antes do relatório.',
      criteria: LIFECYCLE
    },
    approximateCanceledCount: {
      label: 'Cancelamentos com data aproximada',
      kind: 'count',
      noPrevious: true,
      value: plainValue('approximateCanceledCount'),
      source: { name: 'subscriptions', args: { variant: 'approximateCanceled' } },
      measures: { contribution: 'one' },
      description: 'Canceladas do período cuja data de término veio do backfill.',
      hint: 'Registrados antes do relatório.',
      criteria: LIFECYCLE
    },
    'series.newCount': {
      label: 'Novas',
      kind: 'count',
      series: true,
      value: seriesValue('newCount'),
      source: { name: 'subscriptions', args: { variant: 'new' } },
      measures: { contribution: 'one' },
      description: 'Novas assinaturas de um ponto do gráfico.',
      criteria: LIFECYCLE
    },
    'series.canceled': {
      label: 'Cancelamentos',
      kind: 'count',
      series: true,
      value: seriesValue('canceled'),
      source: { name: 'subscriptions', args: { variant: 'canceled' } },
      measures: { contribution: 'one' },
      description: 'Cancelamentos de um ponto do gráfico.',
      criteria: LIFECYCLE
    }
  },
  acquisition: {
    'stages.started': { ...checkoutStage('Checkouts iniciados', 'started'), description: 'Checkouts do mercado criados no período.' },
    'stages.linked': { ...checkoutStage('Vinculados ao Stripe', 'linked'), description: 'Checkouts do período cujo cliente tem assinatura Stripe no mercado.' },
    'stages.activated': { ...checkoutStage('Chegaram a ativar', 'activated'), description: 'Checkouts do período cuja assinatura chegou a ativar, mesmo se cancelada depois.' },
    'conversions.startedToLinked': {
      ...conversion('Iniciados → vinculados ao Stripe', 'started', 'linked', 'Vinculados ao Stripe', 'Checkouts iniciados', 'startedToLinked', 'Vinculados ao Stripe ÷ checkouts iniciados.'),
      description: 'Parte dos checkouts iniciados que chegou a vincular uma assinatura Stripe.'
    },
    'conversions.linkedToActivated': {
      ...conversion('Vinculados → chegaram a ativar', 'linked', 'activated', 'Chegaram a ativar', 'Vinculados ao Stripe', 'linkedToActivated', 'Chegaram a ativar ÷ vinculados ao Stripe.'),
      description: 'Parte dos checkouts vinculados que chegou a ativar.'
    },
    'conversions.startedToActivated': {
      ...conversion('Conversão total', 'started', 'activated', 'Chegaram a ativar', 'Checkouts iniciados', 'startedToActivated', 'Chegaram a ativar ÷ checkouts iniciados.'),
      description: 'Parte dos checkouts iniciados que chegou a ativar.'
    },
    unassignedCheckouts: {
      label: 'Checkouts sem mercado fora do funil',
      kind: 'count',
      noPrevious: true,
      adminOnly: true,
      value: plainValue('unassignedCheckouts'),
      source: { name: 'checkouts', args: { variant: 'unassigned' } },
      measures: { contribution: 'one' },
      description: 'Checkouts do período sem mercado definido; não entram em nenhum funil.',
      hint: 'Checkouts do período sem mercado definido.',
      criteria: ['Checkouts com mercado vazio, criados na janela.']
    },
    'series.started': {
      ...checkoutStage('Checkouts', 'started'),
      series: true,
      value: seriesValue('started'),
      description: 'Checkouts iniciados de um ponto do gráfico.'
    }
  },
  operations: {
    ...Object.fromEntries(Object.entries(CYCLE_LABELS).map(([status, label]) => [`cycles.${status}`, {
      label,
      kind: 'count',
      value: kpiValue(`cycles.${status}`),
      source: { name: 'cycles', args: { status } },
      measures: { contribution: 'one' },
      description: `Ciclos pagos com entrega no período em status ${label.toLowerCase()}.`,
      hint: 'Pela data de entrega no período',
      criteria: CYCLE_CRITERIA
    }])),
    late: {
      label: 'Atrasados',
      kind: 'count',
      value: kpiValue('late'),
      source: { name: 'cycles', args: { late: true } },
      measures: { contribution: 'one' },
      description: 'Ciclos pagos cujo dia de preparo já passou e que não estão prontos.',
      hint: 'Dia de preparo já passou e o ciclo não está pronto.',
      criteria: [...CYCLE_CRITERIA, 'Dia de preparo antes de hoje, no horário local do mercado, e status diferente de Pronto.']
    },
    awaitingPayment: {
      label: 'Aguardando pagamento',
      kind: 'count',
      pointInTime: true,
      value: kpiValue('awaitingPayment'),
      source: { name: 'awaiting', args: {} },
      measures: { contribution: 'one' },
      description: 'Renovações da fila de produção ainda não pagas.',
      hint: 'Renovações ainda não pagas; não contam como atrasadas.',
      criteria: [
        'Assinaturas da conta Stripe do mercado em status ativa, em teste ou pagamento atrasado.',
        'A renovação seguinte (ou a atual, se atrasada) ainda não tem ciclo pago.',
        'Cancelamento agendado fica fora, exceto com pagamento atrasado.'
      ]
    },
    'shipments.total': {
      label: 'Envios (sem cancelados)',
      kind: 'count',
      value: kpiValue('shipments.total'),
      source: { name: 'shipments', args: { variant: 'total' } },
      measures: { contribution: 'one' },
      excluded: [{ source: { name: 'shipments', args: { variant: 'voided' } }, reason: 'Envio cancelado (voided)' }],
      description: 'Envios UPS criados no período, sem os cancelados.',
      criteria: [...SHIPMENT_CRITERIA, 'Envios cancelados (voided) ficam fora e aparecem em Excluídos.']
    }
  },
  stock: {
    ...Object.fromEntries([['produced', 'Produzido'], ['separated', 'Separado'], ['adjusted', 'Ajustado']].map(([kind, label]) => [`totals.${kind}`, {
      label,
      kind: 'count',
      value: kpiValue(`totals.${kind}`),
      source: { name: 'movements', args: { kind } },
      measures: { contribution: 'effect' },
      description: `${label} no período, somando todos os itens de estoque do mercado.`,
      criteria: [...MOVEMENT_CRITERIA, ...(kind === 'separated' ? ['Estorno de separação subtrai.'] : [])]
    }])),
    'totals.onHand': {
      label: 'Saldo',
      kind: 'count',
      pointInTime: true,
      value: kpiValue('totals.onHand'),
      source: { name: 'movements', args: { kind: 'balance', allTime: true } },
      measures: { contribution: 'effect' },
      description: 'Saldo de agora de todos os itens de estoque do mercado.',
      criteria: [
        'Saldo guardado em cada item de estoque do mercado.',
        'A conferência soma todos os movimentos já registrados; diferença indica saldo alterado fora dos movimentos.'
      ]
    }
  }
};

// Mix, stock rows and UPS statuses are keyed by recipe, pack size or status.
const DYNAMIC = [
  {
    report: 'mix',
    pattern: /^recipes\.(.+)\.(packs|subscriptions|share)$/,
    build: ([, flavor, measure]) => ({
      label: { packs: 'Pacotes por entrega', subscriptions: 'Assinaturas', share: 'Participação nos pacotes' }[measure],
      kind: measure === 'share' ? 'rate' : 'count',
      pointInTime: true,
      item: (report) => {
        const row = (report.recipes || []).find((recipe) => recipe.key === flavor);
        return row ? row.name : undefined;
      },
      value: (report) => {
        const rows = report.recipes || [];
        const row = rows.find((recipe) => recipe.key === flavor);
        if (!row) return undefined;
        if (measure === 'share') return ratio(row.packs, rows.reduce((sum, recipe) => sum + recipe.packs, 0));
        return row[measure];
      },
      source: { name: 'lineItems', args: measure === 'share' ? { match: { flavor } } : { flavor } },
      measures: measure === 'share' ? { numerator: 'matchPacks', denominator: 'packs' } : { contribution: measure === 'packs' ? 'packs' : 'one' },
      ...(measure === 'share' ? { combine: 'ratio', formula: { numerator: 'Pacotes da receita', denominator: 'Pacotes de todas as receitas' } } : {}),
      description: {
        packs: 'Pacotes desta receita por entrega, somando as assinaturas.',
        subscriptions: 'Assinaturas que têm esta receita no plano.',
        share: 'Parte dos pacotes por entrega do mercado que é desta receita.'
      }[measure],
      hint: measure === 'packs' ? 'Pacotes por entrega nas assinaturas ativas' : '',
      criteria: MIX_CRITERIA
    })
  },
  {
    report: 'mix',
    pattern: /^packSizes\.(\d+)\.(packs|subscriptions|share)$/,
    build: ([, gramsText, measure]) => {
      const grams = Number(gramsText);
      return {
        label: { packs: 'Pacotes', subscriptions: 'Assinaturas', share: 'Participação' }[measure],
        kind: measure === 'share' ? 'rate' : 'count',
        pointInTime: true,
        item: (report) => {
          const row = (report.packSizes || []).find((size) => size.grams === grams);
          return row ? row.label : undefined;
        },
        value: (report) => {
          const row = (report.packSizes || []).find((size) => size.grams === grams);
          return row ? row[measure] : undefined;
        },
        source: { name: 'lineItems', args: measure === 'share' ? { match: { grams } } : { grams } },
        measures: measure === 'share' ? { numerator: 'matchPacks', denominator: 'packs' } : { contribution: measure === 'packs' ? 'packs' : 'one' },
        ...(measure === 'share' ? { combine: 'ratio', formula: { numerator: 'Pacotes deste tamanho', denominator: 'Pacotes de todos os tamanhos' } } : {}),
        description: {
          packs: 'Pacotes deste tamanho por entrega, somando as assinaturas.',
          subscriptions: 'Assinaturas que têm este tamanho de pacote no plano.',
          share: 'Parte dos pacotes por entrega do mercado que é deste tamanho.'
        }[measure],
        criteria: MIX_CRITERIA
      };
    }
  },
  {
    report: 'mix',
    pattern: /^recipes\.packs\.total$/,
    build: () => ({
      label: 'Pacotes por entrega',
      kind: 'count',
      pointInTime: true,
      item: () => 'Total',
      value: (report) => (Array.isArray(report.recipes) && report.recipes.length ? report.recipes.reduce((sum, recipe) => sum + recipe.packs, 0) : undefined),
      source: { name: 'lineItems', args: {} },
      measures: { contribution: 'packs' },
      description: 'Pacotes por entrega de todas as receitas do mercado.',
      criteria: MIX_CRITERIA
    })
  },
  {
    report: 'operations',
    pattern: /^shipments\.byStatus\.([a-z_]+)$/,
    build: ([, status]) => ({
      label: 'Envios',
      kind: 'count',
      item: () => SHIPMENT_LABELS[status] || status,
      value: kpiValue(`shipments.byStatus.${status}`),
      source: { name: 'shipments', args: { variant: 'status', status } },
      measures: { contribution: 'one' },
      description: `Envios UPS criados no período em status ${(SHIPMENT_LABELS[status] || status).toLowerCase()}.`,
      criteria: SHIPMENT_CRITERIA
    })
  },
  {
    report: 'stock',
    pattern: /^rows\.(.+)\.(\d+)\.(produced|separated|adjusted|onHand|minLevel)$/,
    build: ([, flavor, gramsText, measure]) => {
      const grams = Number(gramsText);
      const find = (report) => (report.rows || []).find((row) => row.key === flavor && row.grams === grams);
      const label = { produced: 'Produzido', separated: 'Separado', adjusted: 'Ajustado', onHand: 'Saldo', minLevel: 'Mínimo' }[measure];
      const pointInTime = measure === 'onHand' || measure === 'minLevel';
      return {
        label,
        kind: 'count',
        pointInTime,
        noPrevious: true,
        item: (report) => {
          const row = find(report);
          return row ? `${row.name} · ${row.label}` : undefined;
        },
        value: (report) => {
          const row = find(report);
          return row ? row[measure] : undefined;
        },
        ...(measure === 'minLevel'
          ? { config: true }
          : {
            source: { name: 'movements', args: { kind: pointInTime ? 'balance' : measure, flavor, grams, allTime: pointInTime } },
            measures: { contribution: 'effect' }
          }),
        description: {
          produced: 'Packs produzidos no período para este item.',
          separated: 'Packs separados no período para este item, descontando estornos.',
          adjusted: 'Ajustes de contagem no período para este item.',
          onHand: 'Saldo de agora deste item.',
          minLevel: 'Nível mínimo configurado para este item.'
        }[measure],
        criteria: measure === 'minLevel'
          ? ['Configuração do item de estoque; não vem de registros.']
          : pointInTime
            ? ['Saldo guardado no item de estoque.', 'A conferência soma todos os movimentos já registrados do item; diferença indica saldo alterado fora dos movimentos.']
            : [...MOVEMENT_CRITERIA, ...(measure === 'separated' ? ['Estorno de separação subtrai.'] : [])]
      };
    }
  }
];

// The summary cards are the same figures of each market's own report.
const SUMMARY = {
  grossRevenue: { report: 'revenue', key: 'grossRevenue' },
  paidInvoices: { report: 'revenue', key: 'paidInvoices' },
  averageTicket: { report: 'revenue', key: 'averageTicket' },
  activeSubscriptions: { report: 'subscriptions', key: 'activeSubscriptions' },
  new: { report: 'subscriptions', key: 'new', label: 'Novas assinaturas' },
  canceled: { report: 'subscriptions', key: 'canceled' },
  churn: { report: 'subscriptions', key: 'churn' },
  checkoutsStarted: { report: 'acquisition', key: 'stages.started' },
  checkoutToActivation: { report: 'acquisition', key: 'conversions.startedToActivated', label: 'Checkout → ativação' }
};

const REPORT_NAMES = ['summary', 'revenue', 'subscriptions', 'acquisition', 'mix', 'operations', 'stock'];

function unknownIndicator() {
  return new HttpError(400, 'Unknown indicator for this report.', { code: 'report_indicator_unknown' });
}

function lookup(report, key) {
  const fixed = REPORTS[report] && Object.prototype.hasOwnProperty.call(REPORTS[report], key) ? REPORTS[report][key] : null;
  if (fixed) return fixed;
  for (const entry of DYNAMIC) {
    if (entry.report !== report) continue;
    const match = entry.pattern.exec(key);
    if (match) return entry.build(match);
  }
  return null;
}

// Resolves a report and a key to the entry the details use. `series.x.total` is the CSV total row of a series.
function resolveIndicator(report, rawKey) {
  const name = String(report || '');
  if (!REPORT_NAMES.includes(name)) {
    throw new HttpError(400, 'Unknown report.', { code: 'report_unknown' });
  }
  const key = String(rawKey || '').replace(/^(series\.[A-Za-z]+)\.total$/, '$1');
  if (name === 'summary') {
    const target = SUMMARY[key];
    if (!target) throw unknownIndicator();
    const entry = lookup(target.report, target.key);
    return { ...entry, label: target.label || entry.label, key: target.key, report: target.report, requestedReport: 'summary', requestedKey: key };
  }
  const entry = lookup(name, key);
  if (!entry) throw unknownIndicator();
  return { ...entry, key, report: name, requestedReport: name, requestedKey: key };
}

function hasPrevious(entry) {
  return !entry.pointInTime && !entry.noPrevious && !entry.series;
}

// Label and hint of a figure for the aggregate CSV; null when the key is not a figure.
function indicatorText(report, key) {
  try {
    const entry = resolveIndicator(report, key);
    return { label: entry.label, hint: entry.hint || '' };
  } catch (_error) {
    return null;
  }
}

function groupLabel(sourceName, key) {
  const labels = GROUP_LABELS[sourceName] || {};
  return labels[key] || key || '—';
}

module.exports = {
  GROUP_LABELS,
  SHIPMENT_LABELS,
  REPORT_NAMES,
  SUMMARY,
  groupLabel,
  hasPrevious,
  indicatorText,
  resolveIndicator
};
