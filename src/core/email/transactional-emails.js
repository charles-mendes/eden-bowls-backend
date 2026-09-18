const {
  buttonHtml,
  codeWellHtml,
  detailsTableHtml,
  isPortuguese,
  mutedHtml,
  paragraphHtml,
  pillsHtml,
  wrapEmailHtml
} = require('./html');

function joinList(items) {
  return (items || []).filter(Boolean).join(', ');
}

function buildPasswordResetEmail({
  firstName,
  resetUrl,
  locale
} = {}) {
  const pt = isPortuguese(locale || 'pt-BR');
  const name = String(firstName || '').trim() || (pt ? 'oi' : 'there');
  const url = String(resetUrl || '').trim();
  const subject = pt ? 'Redefinir senha da Eden Bowls' : 'Reset your Eden Bowls password';
  const text = pt
    ? `Oi ${name}, recebemos um pedido para redefinir sua senha. Abra este link: ${url}`
    : `Hi ${name}, we received a request to reset your password. Open this link: ${url}`;

  const innerHtml = [
    paragraphHtml(pt
      ? `Oi ${name}, alguém pediu uma senha nova nesta conta. Se foi você, o caminho está abaixo. Se não foi, deixe esta carta na mesa.`
      : `Hi ${name}, someone asked for a new password on this account. If it was you, the path is below. If not, leave this letter on the table.`),
    url ? buttonHtml({ href: url, label: pt ? 'Escolher nova senha' : 'Choose a new password' }) : '',
    mutedHtml(pt
      ? 'O link expira em pouco tempo e só funciona uma vez.'
      : 'The link expires soon and works only once.')
  ].join('');

  return {
    id: 'password-reset',
    subject,
    text,
    html: wrapEmailHtml({
      locale: locale || 'pt-BR',
      preheader: pt ? 'Um caminho curto para uma senha nova.' : 'A short path to a new password.',
      kicker: pt ? 'Conta' : 'Account',
      title: pt ? 'A chave da cozinha' : 'The kitchen key',
      innerHtml
    })
  };
}

function buildOrderConfirmedEmail({
  firstName,
  petName,
  flavors,
  planName,
  cycleLabel,
  totalLabel,
  dashboardUrl,
  locale
} = {}) {
  const pt = isPortuguese(locale || 'pt-BR');
  const name = String(firstName || '').trim() || (pt ? 'oi' : 'there');
  const pet = String(petName || '').trim() || (pt ? 'seu cão' : 'your dog');
  const url = String(dashboardUrl || '').trim();
  const flavorList = joinList(flavors);
  const subject = pt
    ? `A tigela de ${pet} já está na fila`
    : `${pet}’s bowl is on the board`;
  const text = [
    pt ? `Oi ${name}, a assinatura de ${pet} foi confirmada.` : `Hi ${name}, ${pet}’s subscription is confirmed.`,
    planName ? `${pt ? 'Plano' : 'Plan'}: ${planName}` : '',
    flavorList ? `${pt ? 'Sabores' : 'Flavors'}: ${flavorList}` : '',
    totalLabel ? `${pt ? 'Total' : 'Total'}: ${totalLabel}` : '',
    url
  ].filter(Boolean).join('\n');

  const innerHtml = [
    paragraphHtml(pt
      ? `Oi ${name}, o primeiro ciclo de ${pet} entrou na cozinha. Daqui para a frente, a carta chega quando a tigela muda de lugar — cobrada, pausada ou a caminho.`
      : `Hi ${name}, ${pet}’s first cycle is in the kitchen. From here, a letter arrives when the bowl moves — charged, paused, or on the way.`),
    pillsHtml(flavors),
    detailsTableHtml([
      { label: pt ? 'Cão' : 'Dog', value: pet },
      { label: pt ? 'Plano' : 'Plan', value: planName },
      { label: pt ? 'Ciclo' : 'Cycle', value: cycleLabel },
      { label: pt ? 'Total' : 'Total', value: totalLabel }
    ]),
    url ? buttonHtml({ href: url, label: pt ? 'Ver meu plano' : 'See my plan' }) : ''
  ].join('');

  return {
    id: 'order-confirmed',
    subject,
    text,
    html: wrapEmailHtml({
      locale: locale || 'pt-BR',
      preheader: pt ? 'Assinatura confirmada. A tigela entrou na fila.' : 'Subscription confirmed. The bowl is on the board.',
      kicker: pt ? 'Primeiro ciclo' : 'First cycle',
      title: pt ? `A tigela de ${pet}` : `${pet}’s bowl`,
      innerHtml
    })
  };
}

function buildPaymentFailedEmail({
  firstName,
  petName,
  amountLabel,
  updatePaymentUrl,
  locale
} = {}) {
  const pt = isPortuguese(locale || 'pt-BR');
  const name = String(firstName || '').trim() || (pt ? 'oi' : 'there');
  const pet = String(petName || '').trim() || (pt ? 'seu cão' : 'your dog');
  const url = String(updatePaymentUrl || '').trim();
  const subject = pt ? 'A cobrança da tigela não passou' : 'The bowl charge did not go through';
  const text = pt
    ? `Oi ${name}, a cobrança de ${pet}${amountLabel ? ` (${amountLabel})` : ''} não foi concluída. Atualize o pagamento: ${url}`
    : `Hi ${name}, ${pet}’s charge${amountLabel ? ` (${amountLabel})` : ''} did not complete. Update payment: ${url}`;

  const innerHtml = [
    paragraphHtml(pt
      ? `Oi ${name}, tentamos cobrar o ciclo de ${pet} e o cartão recusou. A fila pausa até o pagamento voltar a passar.`
      : `Hi ${name}, we tried to charge ${pet}’s cycle and the card declined. The line waits until payment goes through.`),
    amountLabel ? detailsTableHtml([{ label: pt ? 'Valor' : 'Amount', value: amountLabel }]) : '',
    url ? buttonHtml({ href: url, label: pt ? 'Atualizar pagamento' : 'Update payment' }) : '',
    mutedHtml(pt
      ? 'Se já resolveu, ignore esta carta. O próximo ciclo segue no ritmo combinado.'
      : 'If you already fixed it, ignore this letter. The next cycle keeps the agreed rhythm.')
  ].join('');

  return {
    id: 'payment-failed',
    subject,
    text,
    html: wrapEmailHtml({
      locale: locale || 'pt-BR',
      preheader: pt ? 'O cartão recusou. A tigela espera.' : 'The card declined. The bowl is waiting.',
      kicker: pt ? 'Cobrança' : 'Billing',
      title: pt ? 'A conta da mesa voltou' : 'The check came back',
      innerHtml
    })
  };
}

function buildShippedEmail({
  firstName,
  petName,
  trackingNumber,
  carrier,
  trackingUrl,
  locale
} = {}) {
  const pt = isPortuguese(locale || 'pt-BR');
  const name = String(firstName || '').trim() || (pt ? 'oi' : 'there');
  const pet = String(petName || '').trim() || (pt ? 'seu cão' : 'your dog');
  const tracking = String(trackingNumber || '').trim();
  const url = String(trackingUrl || '').trim();
  const subject = pt ? `A tigela de ${pet} saiu da cozinha` : `${pet}’s bowl left the kitchen`;
  const text = [
    pt ? `Oi ${name}, o envio de ${pet} está a caminho.` : `Hi ${name}, ${pet}’s shipment is on the way.`,
    tracking ? `${pt ? 'Rastreio' : 'Tracking'}: ${tracking}` : '',
    url
  ].filter(Boolean).join('\n');

  const innerHtml = [
    paragraphHtml(pt
      ? `Oi ${name}, as tigelas de ${pet} deixaram a bancada. Guarde o código — é o fio entre a cozinha e a porta.`
      : `Hi ${name}, ${pet}’s bowls left the counter. Keep the code — it is the thread between the kitchen and the door.`),
    tracking ? codeWellHtml(tracking) : '',
    detailsTableHtml([
      { label: pt ? 'Cão' : 'Dog', value: pet },
      { label: pt ? 'Transportadora' : 'Carrier', value: carrier }
    ]),
    url ? buttonHtml({ href: url, label: pt ? 'Acompanhar envio' : 'Track shipment' }) : ''
  ].join('');

  return {
    id: 'shipped',
    subject,
    text,
    html: wrapEmailHtml({
      locale: locale || 'pt-BR',
      preheader: pt ? 'Saiu para entrega. O código de rastreio está nesta carta.' : 'Out for delivery. The tracking code is in this letter.',
      kicker: pt ? 'Entrega' : 'Delivery',
      title: pt ? 'A caminho da tigela' : 'On the way to the bowl',
      innerHtml
    })
  };
}

function buildAdminNewSubscriptionEmail({
  customerName,
  customerEmail,
  petName,
  planName,
  totalLabel,
  adminUrl,
  locale
} = {}) {
  const pt = isPortuguese(locale || 'pt-BR');
  const subject = pt ? 'Nova assinatura paga na Eden Bowls' : 'New paid Eden Bowls subscription';
  const text = [
    pt ? 'Uma nova assinatura foi paga.' : 'A new subscription was paid.',
    customerName,
    customerEmail,
    petName,
    planName,
    totalLabel,
    adminUrl
  ].filter(Boolean).join('\n');

  const innerHtml = [
    paragraphHtml(pt
      ? 'Entrou um primeiro ciclo pago. Confira o cliente e a tigela no painel.'
      : 'A first paid cycle just landed. Check the customer and the bowl in the panel.'),
    detailsTableHtml([
      { label: pt ? 'Cliente' : 'Customer', value: customerName },
      { label: 'E-mail', value: customerEmail },
      { label: pt ? 'Cão' : 'Dog', value: petName },
      { label: pt ? 'Plano' : 'Plan', value: planName },
      { label: pt ? 'Total' : 'Total', value: totalLabel }
    ]),
    adminUrl ? buttonHtml({ href: adminUrl, label: pt ? 'Abrir no painel' : 'Open in the panel' }) : ''
  ].join('');

  return {
    id: 'admin-new-subscription',
    subject,
    text,
    html: wrapEmailHtml({
      locale: locale || 'pt-BR',
      preheader: pt ? 'Primeiro ciclo pago. Abrir no painel.' : 'First paid cycle. Open in the panel.',
      kicker: pt ? 'Operação' : 'Ops',
      title: pt ? 'Nova tigela na fila' : 'A new bowl on the board',
      innerHtml
    })
  };
}

function buildRenewalEmail({
  firstName,
  petName,
  flavors,
  totalLabel,
  nextDeliveryLabel,
  dashboardUrl,
  locale
} = {}) {
  const pt = isPortuguese(locale || 'pt-BR');
  const name = String(firstName || '').trim() || (pt ? 'oi' : 'there');
  const pet = String(petName || '').trim() || (pt ? 'seu cão' : 'your dog');
  const url = String(dashboardUrl || '').trim();
  const subject = pt ? `O ciclo de ${pet} foi cobrado` : `${pet}’s cycle was charged`;
  const text = pt
    ? `Oi ${name}, o ciclo de ${pet} foi cobrado${totalLabel ? ` (${totalLabel})` : ''}.`
    : `Hi ${name}, ${pet}’s cycle was charged${totalLabel ? ` (${totalLabel})` : ''}.`;

  const innerHtml = [
    paragraphHtml(pt
      ? `Oi ${name}, o ritmo da tigela de ${pet} segue. Esta carta é o recibo do ciclo — não um novo pedido solto.`
      : `Hi ${name}, ${pet}’s bowl keeps its rhythm. This letter is the cycle receipt — not a one-off order.`),
    pillsHtml(flavors),
    detailsTableHtml([
      { label: pt ? 'Cão' : 'Dog', value: pet },
      { label: pt ? 'Cobrado' : 'Charged', value: totalLabel },
      { label: pt ? 'Próxima entrega' : 'Next delivery', value: nextDeliveryLabel }
    ]),
    url ? buttonHtml({ href: url, label: pt ? 'Ver o ciclo' : 'See the cycle' }) : ''
  ].join('');

  return {
    id: 'renewal',
    subject,
    text,
    html: wrapEmailHtml({
      locale: locale || 'pt-BR',
      preheader: pt ? 'Recibo do ciclo. A tigela continua.' : 'Cycle receipt. The bowl continues.',
      kicker: pt ? 'Renovação' : 'Renewal',
      title: pt ? 'Outra volta na mesa' : 'Another turn at the table',
      innerHtml
    })
  };
}

function buildPausedEmail({
  firstName,
  petName,
  resumeAtLabel,
  dashboardUrl,
  locale
} = {}) {
  const pt = isPortuguese(locale || 'pt-BR');
  const name = String(firstName || '').trim() || (pt ? 'oi' : 'there');
  const pet = String(petName || '').trim() || (pt ? 'seu cão' : 'your dog');
  const url = String(dashboardUrl || '').trim();
  const subject = pt ? `A tigela de ${pet} está pausada` : `${pet}’s bowl is paused`;
  const text = pt
    ? `Oi ${name}, a assinatura de ${pet} foi pausada.`
    : `Hi ${name}, ${pet}’s subscription is paused.`;

  const innerHtml = [
    paragraphHtml(pt
      ? `Oi ${name}, a cozinha guarda o lugar de ${pet}. Nada sai até você retomar.`
      : `Hi ${name}, the kitchen is holding ${pet}’s place. Nothing leaves until you resume.`),
    detailsTableHtml([
      { label: pt ? 'Cão' : 'Dog', value: pet },
      { label: pt ? 'Retomar em' : 'Resume on', value: resumeAtLabel }
    ]),
    url ? buttonHtml({ href: url, label: pt ? 'Retomar plano' : 'Resume plan' }) : ''
  ].join('');

  return {
    id: 'paused',
    subject,
    text,
    html: wrapEmailHtml({
      locale: locale || 'pt-BR',
      preheader: pt ? 'A fila espera. Você retoma quando quiser.' : 'The line waits. You resume when you want.',
      kicker: pt ? 'Pausa' : 'Pause',
      title: pt ? 'A tigela na prateleira' : 'The bowl on the shelf',
      innerHtml
    })
  };
}

function buildResumedEmail({
  firstName,
  petName,
  nextDeliveryLabel,
  dashboardUrl,
  locale
} = {}) {
  const pt = isPortuguese(locale || 'pt-BR');
  const name = String(firstName || '').trim() || (pt ? 'oi' : 'there');
  const pet = String(petName || '').trim() || (pt ? 'seu cão' : 'your dog');
  const url = String(dashboardUrl || '').trim();
  const subject = pt ? `A tigela de ${pet} voltou à fila` : `${pet}’s bowl is back on the board`;
  const text = pt
    ? `Oi ${name}, a assinatura de ${pet} foi retomada.`
    : `Hi ${name}, ${pet}’s subscription is resumed.`;

  const innerHtml = [
    paragraphHtml(pt
      ? `Oi ${name}, ${pet} voltou ao ritmo. A próxima tigela já tem data na bancada.`
      : `Hi ${name}, ${pet} is back in rhythm. The next bowl already has a date on the counter.`),
    detailsTableHtml([
      { label: pt ? 'Cão' : 'Dog', value: pet },
      { label: pt ? 'Próxima entrega' : 'Next delivery', value: nextDeliveryLabel }
    ]),
    url ? buttonHtml({ href: url, label: pt ? 'Ver meu plano' : 'See my plan' }) : ''
  ].join('');

  return {
    id: 'resumed',
    subject,
    text,
    html: wrapEmailHtml({
      locale: locale || 'pt-BR',
      preheader: pt ? 'A pausa acabou. A tigela volta a sair.' : 'The pause is over. The bowl leaves again.',
      kicker: pt ? 'Retomada' : 'Resume',
      title: pt ? 'De volta à bancada' : 'Back on the counter',
      innerHtml
    })
  };
}

function buildCancelledEmail({
  firstName,
  petName,
  endsAtLabel,
  dashboardUrl,
  locale
} = {}) {
  const pt = isPortuguese(locale || 'pt-BR');
  const name = String(firstName || '').trim() || (pt ? 'oi' : 'there');
  const pet = String(petName || '').trim() || (pt ? 'seu cão' : 'your dog');
  const url = String(dashboardUrl || '').trim();
  const subject = pt ? `A assinatura de ${pet} foi encerrada` : `${pet}’s subscription is ending`;
  const text = pt
    ? `Oi ${name}, a assinatura de ${pet} foi cancelada${endsAtLabel ? ` e segue até ${endsAtLabel}` : ''}.`
    : `Hi ${name}, ${pet}’s subscription is cancelled${endsAtLabel ? ` and runs until ${endsAtLabel}` : ''}.`;

  const innerHtml = [
    paragraphHtml(pt
      ? `Oi ${name}, recebemos o encerramento da tigela de ${pet}. Se ainda houver ciclo pago, ele chega até o fim combinado.`
      : `Hi ${name}, we received the end of ${pet}’s bowl. If a paid cycle remains, it still arrives through the agreed date.`),
    detailsTableHtml([
      { label: pt ? 'Cão' : 'Dog', value: pet },
      { label: pt ? 'Válida até' : 'Active until', value: endsAtLabel }
    ]),
    url ? buttonHtml({ href: url, label: pt ? 'Reabrir um plano' : 'Start a plan again' }) : ''
  ].join('');

  return {
    id: 'cancelled',
    subject,
    text,
    html: wrapEmailHtml({
      locale: locale || 'pt-BR',
      preheader: pt ? 'A mesa guarda o lugar, se você voltar.' : 'The table keeps a place, if you return.',
      kicker: pt ? 'Cancelamento' : 'Cancellation',
      title: pt ? 'A última tigela deste ciclo' : 'The last bowl of this cycle',
      innerHtml
    })
  };
}

function buildPlanChangedEmail({
  firstName,
  petName,
  planName,
  flavors,
  totalLabel,
  dashboardUrl,
  locale
} = {}) {
  const pt = isPortuguese(locale || 'pt-BR');
  const name = String(firstName || '').trim() || (pt ? 'oi' : 'there');
  const pet = String(petName || '').trim() || (pt ? 'seu cão' : 'your dog');
  const url = String(dashboardUrl || '').trim();
  const subject = pt ? `O plano de ${pet} mudou` : `${pet}’s plan changed`;
  const text = pt
    ? `Oi ${name}, o plano de ${pet} foi atualizado${planName ? `: ${planName}` : ''}.`
    : `Hi ${name}, ${pet}’s plan was updated${planName ? `: ${planName}` : ''}.`;

  const innerHtml = [
    paragraphHtml(pt
      ? `Oi ${name}, a receita da tigela de ${pet} foi reescrita. Confira sabores e ciclo — a próxima saída já usa este cardápio.`
      : `Hi ${name}, ${pet}’s bowl recipe was rewritten. Check flavors and cycle — the next ship-out already uses this menu.`),
    pillsHtml(flavors),
    detailsTableHtml([
      { label: pt ? 'Cão' : 'Dog', value: pet },
      { label: pt ? 'Plano' : 'Plan', value: planName },
      { label: pt ? 'Total' : 'Total', value: totalLabel }
    ]),
    url ? buttonHtml({ href: url, label: pt ? 'Ver detalhes' : 'See details' }) : ''
  ].join('');

  return {
    id: 'plan-changed',
    subject,
    text,
    html: wrapEmailHtml({
      locale: locale || 'pt-BR',
      preheader: pt ? 'Novo cardápio na tigela.' : 'A new menu in the bowl.',
      kicker: pt ? 'Plano' : 'Plan',
      title: pt ? 'O cardápio mudou' : 'The menu changed',
      innerHtml
    })
  };
}

module.exports = {
  buildAdminNewSubscriptionEmail,
  buildCancelledEmail,
  buildOrderConfirmedEmail,
  buildPasswordResetEmail,
  buildPausedEmail,
  buildPaymentFailedEmail,
  buildPlanChangedEmail,
  buildRenewalEmail,
  buildResumedEmail,
  buildShippedEmail
};
