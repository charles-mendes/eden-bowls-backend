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

// "EB-2026-000418 (PDF em anexo)" when the letter carries the invoice PDF; empty otherwise.
function attachedInvoiceLabel(pt, invoiceNumber) {
  const number = String(invoiceNumber || '').trim();
  if (!number) return '';
  return pt ? `${number} (PDF em anexo)` : `${number} (PDF attached)`;
}

function renderLetter(fields) {
  return wrapEmailHtml(fields);
}

function buildPasswordResetEmail({
  firstName,
  resetUrl,
  locale,
  assetBaseUrl,
  allowRelativeAssets
} = {}) {
  const pt = isPortuguese(locale || 'pt-BR');
  const hello = greet(pt, firstName);
  const url = String(resetUrl || '').trim();
  const subject = pt ? 'Redefinir sua senha da Eden Bowls' : 'Reset your Eden Bowls password';
  const text = pt
    ? `${hello} Recebemos um pedido para redefinir a senha da sua conta. Se foi você, abra este link para criar uma nova senha: ${url}\nO link só pode ser usado uma vez e expira em pouco tempo. Se não foi você quem pediu, ignore este e-mail. Sua senha continua a mesma.`
    : `${hello} we received a request to reset the password for your account. If that was you, open this link to choose a new one: ${url}\nThis link can only be used once and expires shortly. If you did not request this, you can ignore this email. Your password stays the same.`;

  const innerHtml = [
    paragraphHtml(pt
      ? `${hello} Recebemos um pedido para redefinir a senha da sua conta. Se foi você, clique no botão abaixo para criar uma nova senha.`
      : `${hello} we received a request to reset the password for your account. If that was you, click the button below to choose a new one.`),
    url ? buttonHtml({ href: url, label: pt ? 'Criar nova senha' : 'Choose a new password' }) : '',
    mutedHtml(pt
      ? 'O link só pode ser usado uma vez e expira em pouco tempo. Se não foi você quem pediu, ignore este e-mail. Sua senha continua a mesma.'
      : 'This link can only be used once and expires shortly. If you did not request this, you can ignore this email. Your password stays the same.')
  ].join('');

  return {
    id: 'password-reset',
    subject,
    text,
    html: renderLetter({
      locale: locale || 'pt-BR',
      preheader: pt ? 'Crie uma nova senha em poucos passos.' : 'Create a new password in a few steps.',
      kicker: pt ? 'Conta' : 'Account',
      title: pt ? 'Redefinir senha' : 'Reset your password',
      innerHtml,
      assetBaseUrl,
      allowRelativeAssets
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
  firstDeliveryLabel,
  invoiceNumber,
  dashboardUrl,
  locale,
  assetBaseUrl,
  allowRelativeAssets
} = {}) {
  const pt = isPortuguese(locale || 'pt-BR');
  const hello = greet(pt, firstName);
  const pet = petLabel(pt, petName);
  const url = String(dashboardUrl || '').trim();
  const flavorList = joinList(flavors);
  const invoiceLabel = attachedInvoiceLabel(pt, invoiceNumber);
  // The first delivery date comes from the same estimate the production queue stores for this payment.
  const firstDelivery = String(firstDeliveryLabel || '').trim();
  const opening = pt
    ? (firstDelivery
      ? `${hello} O pagamento foi aprovado e a assinatura da ${pet} está ativa. A primeira entrega está prevista para ${firstDelivery}.`
      : `${hello} O pagamento foi aprovado e a assinatura da ${pet} está ativa. Nossa cozinha já começou a preparar a primeira entrega.`)
    : (firstDelivery
      ? `${hello} your payment was approved and ${pet}'s subscription is active. Your first delivery is planned for ${firstDelivery}.`
      : `${hello} your payment was approved and ${pet}'s subscription is active. Our kitchen has already started preparing the first delivery.`);
  const subject = pt
    ? `A tigela da ${pet} entrou na cozinha`
    : `${pet}'s bowl is in the kitchen`;
  const text = [
    opening,
    firstDelivery ? `${pt ? 'Primeira entrega' : 'First delivery'}: ${firstDelivery}` : '',
    flavorList ? `${pt ? 'Sabores' : 'Flavors'}: ${flavorList}` : '',
    `${pt ? 'Pet' : 'Pet'}: ${pet}`,
    planName ? `${pt ? 'Plano' : 'Plan'}: ${planName}` : '',
    cycleLabel ? `${pt ? 'Frequência' : 'Frequency'}: ${cycleLabel}` : '',
    totalLabel ? `${pt ? 'Total' : 'Total'}: ${totalLabel}` : '',
    invoiceLabel ? `${pt ? 'Fatura' : 'Invoice'}: ${invoiceLabel}` : '',
    url
  ].filter(Boolean).join('\n');

  const innerHtml = [
    paragraphHtml(pt
      ? `${opening} Daqui para a frente, você recebe um e-mail sempre que a tigela dela mudar de lugar: cobrada, enviada, pausada ou com o plano ajustado.`
      : `${opening} From now on, you'll get an email whenever the bowl moves: charged, shipped, paused or updated.`),
    pillsHtml(flavors),
    detailsTableHtml([
      { label: 'Pet', value: pet },
      { label: pt ? 'Primeira entrega' : 'First delivery', value: firstDelivery },
      { label: pt ? 'Plano' : 'Plan', value: planName },
      { label: pt ? 'Frequência' : 'Frequency', value: cycleLabel },
      { label: 'Total', value: totalLabel },
      { label: pt ? 'Fatura' : 'Invoice', value: invoiceLabel }
    ]),
    url ? buttonHtml({ href: url, label: pt ? 'Ver meu plano' : 'View my plan' }) : ''
  ].join('');

  return {
    id: 'order-confirmed',
    subject,
    text,
    html: renderLetter({
      locale: locale || 'pt-BR',
      preheader: pt
        ? (firstDelivery ? `Assinatura confirmada. Primeira entrega prevista para ${firstDelivery}.` : 'Assinatura confirmada. A primeira entrega já está sendo preparada.')
        : (firstDelivery ? `Subscription confirmed. First delivery planned for ${firstDelivery}.` : 'Subscription confirmed. The first delivery is already being prepared.'),
      kicker: pt ? 'Primeiro ciclo' : 'First cycle',
      title: subject,
      innerHtml,
      assetBaseUrl,
      allowRelativeAssets
    })
  };
}

function buildPaymentFailedEmail({
  firstName,
  petName,
  amountLabel,
  updatePaymentUrl,
  locale,
  assetBaseUrl,
  allowRelativeAssets
} = {}) {
  const pt = isPortuguese(locale || 'pt-BR');
  const hello = greet(pt, firstName);
  const pet = petLabel(pt, petName);
  const url = String(updatePaymentUrl || '').trim();
  const subject = pt
    ? `Não conseguimos processar o pagamento da ${pet}`
    : `We couldn't process ${pet}'s payment`;
  const text = [
    pt
      ? `${hello} Tentamos cobrar o ciclo da ${pet}, mas o cartão não autorizou o pagamento. A tigela fica em espera até o pagamento ser confirmado.`
      : `${hello} we tried to charge ${pet}'s cycle, but the card didn't authorize the payment. The bowl is on hold until the payment is confirmed.`,
    amountLabel ? `${pt ? 'Valor' : 'Amount'}: ${amountLabel}` : '',
    url,
    pt
      ? 'Se você já resolveu, pode ignorar este e-mail. O próximo ciclo segue normalmente.'
      : "If you've already fixed this, you can ignore this email. The next cycle will continue as usual."
  ].filter(Boolean).join('\n');

  const innerHtml = [
    paragraphHtml(pt
      ? `${hello} Tentamos cobrar o ciclo da ${pet}, mas o cartão não autorizou o pagamento. A tigela dela fica em espera até o pagamento ser confirmado. É só atualizar a forma de pagamento.`
      : `${hello} we tried to charge ${pet}'s cycle, but the card didn't authorize the payment. The bowl is on hold until the payment is confirmed. Just update your payment method.`),
    detailsTableHtml([{ label: pt ? 'Valor' : 'Amount', value: amountLabel }]),
    url ? buttonHtml({ href: url, label: pt ? 'Atualizar pagamento' : 'Update payment method' }) : '',
    mutedHtml(pt
      ? 'Se você já resolveu, pode ignorar este e-mail. O próximo ciclo segue normalmente.'
      : "If you've already fixed this, you can ignore this email. The next cycle will continue as usual.")
  ].join('');

  return {
    id: 'payment-failed',
    subject,
    text,
    html: renderLetter({
      locale: locale || 'pt-BR',
      preheader: pt
        ? 'Atualize a forma de pagamento para a cozinha voltar a preparar as tigelas.'
        : 'Update your payment method so the kitchen can get back to preparing the bowls.',
      kicker: pt ? 'Pagamento' : 'Payment',
      title: pt ? 'O pagamento não foi aprovado' : "Your payment didn't go through",
      innerHtml,
      assetBaseUrl,
      allowRelativeAssets
    })
  };
}

function buildShippedEmail({
  firstName,
  petName,
  trackingNumber,
  carrier,
  trackingUrl,
  locale,
  assetBaseUrl,
  allowRelativeAssets
} = {}) {
  const pt = isPortuguese(locale || 'pt-BR');
  const hello = greet(pt, firstName);
  const pet = petLabel(pt, petName);
  const tracking = String(trackingNumber || '').trim();
  const url = String(trackingUrl || '').trim();
  const shipper = String(carrier || '').trim() || 'UPS';
  const subject = pt
    ? `A tigela da ${pet} saiu da cozinha`
    : `${pet}'s bowl has left the kitchen`;
  const text = [
    pt
      ? `${hello} As refeições da ${pet} já estão a caminho com a ${shipper}.`
      : `${hello} ${pet}'s meals are on their way with ${shipper}.`,
    tracking ? `${pt ? 'Rastreio' : 'Tracking'}: ${tracking}` : '',
    `${pt ? 'Pet' : 'Pet'}: ${pet}`,
    `${pt ? 'Transportadora' : 'Carrier'}: ${shipper}`,
    url
  ].filter(Boolean).join('\n');

  const innerHtml = [
    paragraphHtml(pt
      ? `${hello} As refeições da ${pet} já estão a caminho com a ${shipper}. Use o código abaixo para acompanhar a entrega até a sua porta.`
      : `${hello} ${pet}'s meals are on their way with ${shipper}. Use the number below to follow the delivery to your door.`),
    tracking ? codeWellHtml(tracking) : '',
    detailsTableHtml([
      { label: 'Pet', value: pet },
      { label: pt ? 'Transportadora' : 'Carrier', value: shipper }
    ]),
    url ? buttonHtml({ href: url, label: pt ? 'Rastrear entrega' : 'Track delivery' }) : ''
  ].join('');

  return {
    id: 'shipped',
    subject,
    text,
    html: renderLetter({
      locale: locale || 'pt-BR',
      preheader: pt
        ? 'Seu pedido foi enviado. O código de rastreio está aqui.'
        : 'Your order has shipped. Your tracking number is here.',
      kicker: pt ? 'Entrega' : 'Delivery',
      title: subject,
      innerHtml,
      assetBaseUrl,
      allowRelativeAssets
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
  locale,
  assetBaseUrl,
  allowRelativeAssets
} = {}) {
  const pt = isPortuguese(locale || 'pt-BR');
  const subject = pt ? 'Nova assinatura paga na Eden Bowls' : 'New paid subscription on Eden Bowls';
  const text = [
    pt
      ? 'Uma nova assinatura acaba de ser paga. Confira os dados do cliente e do plano no painel.'
      : 'A new subscription has just been paid. Check the customer and plan details in the dashboard.',
    customerName ? `${pt ? 'Cliente' : 'Customer'}: ${customerName}` : '',
    customerEmail ? `E-mail: ${customerEmail}` : '',
    petName ? `Pet: ${petName}` : '',
    planName ? `${pt ? 'Plano' : 'Plan'}: ${planName}` : '',
    totalLabel ? `Total: ${totalLabel}` : '',
    adminUrl
  ].filter(Boolean).join('\n');

  const innerHtml = [
    paragraphHtml(pt
      ? 'Uma nova assinatura acaba de ser paga. Confira os dados do cliente e do plano no painel.'
      : 'A new subscription has just been paid. Check the customer and plan details in the dashboard.'),
    detailsTableHtml([
      { label: pt ? 'Cliente' : 'Customer', value: customerName },
      { label: pt ? 'E-mail' : 'Email', value: customerEmail },
      { label: 'Pet', value: petName },
      { label: pt ? 'Plano' : 'Plan', value: planName },
      { label: 'Total', value: totalLabel }
    ]),
    adminUrl ? buttonHtml({ href: adminUrl, label: pt ? 'Abrir no painel' : 'Open dashboard' }) : ''
  ].join('');

  return {
    id: 'admin-new-subscription',
    subject,
    text,
    html: renderLetter({
      locale: locale || 'pt-BR',
      preheader: pt ? 'Primeiro ciclo pago. Confira no painel.' : 'First cycle paid. Check the dashboard.',
      kicker: pt ? 'Operação' : 'Operations',
      title: pt ? 'Nova tigela na fila' : 'New bowl in the queue',
      innerHtml,
      assetBaseUrl,
      allowRelativeAssets
    })
  };
}

function buildRenewalEmail({
  firstName,
  petName,
  flavors,
  totalLabel,
  nextDeliveryLabel,
  invoiceNumber,
  dashboardUrl,
  locale,
  assetBaseUrl,
  allowRelativeAssets
} = {}) {
  const pt = isPortuguese(locale || 'pt-BR');
  const hello = greet(pt, firstName);
  const pet = petLabel(pt, petName);
  const url = String(dashboardUrl || '').trim();
  const flavorList = joinList(flavors);
  const invoiceLabel = attachedInvoiceLabel(pt, invoiceNumber);
  const subject = pt
    ? `Mais um ciclo na cozinha: recibo da ${pet}`
    : `Another cycle in the kitchen: ${pet}'s receipt`;
  const text = [
    pt
      ? `${hello} A assinatura da ${pet} foi renovada e o pagamento do novo ciclo está confirmado. Este e-mail é o seu recibo.`
      : `${hello} ${pet}'s subscription has been renewed and the payment for the new cycle is confirmed. This email is your receipt.`,
    flavorList ? `${pt ? 'Sabores' : 'Flavors'}: ${flavorList}` : '',
    `Pet: ${pet}`,
    totalLabel ? `${pt ? 'Valor cobrado' : 'Amount charged'}: ${totalLabel}` : '',
    nextDeliveryLabel ? `${pt ? 'Próxima entrega' : 'Next delivery'}: ${nextDeliveryLabel}` : '',
    invoiceLabel ? `${pt ? 'Fatura' : 'Invoice'}: ${invoiceLabel}` : '',
    url
  ].filter(Boolean).join('\n');

  const innerHtml = [
    paragraphHtml(pt
      ? `${hello} A assinatura da ${pet} foi renovada e o pagamento do novo ciclo está confirmado. Este e-mail é o seu recibo. Não precisa fazer nada: a cozinha segue no ritmo combinado.`
      : `${hello} ${pet}'s subscription has been renewed and the payment for the new cycle is confirmed. This email is your receipt. Nothing to do: the kitchen keeps its usual rhythm.`),
    pillsHtml(flavors),
    detailsTableHtml([
      { label: 'Pet', value: pet },
      { label: pt ? 'Valor cobrado' : 'Amount charged', value: totalLabel },
      { label: pt ? 'Próxima entrega' : 'Next delivery', value: nextDeliveryLabel },
      { label: pt ? 'Fatura' : 'Invoice', value: invoiceLabel }
    ]),
    url ? buttonHtml({ href: url, label: pt ? 'Ver detalhes do ciclo' : 'View cycle details' }) : ''
  ].join('');

  return {
    id: 'renewal',
    subject,
    text,
    html: renderLetter({
      locale: locale || 'pt-BR',
      preheader: pt
        ? 'Pagamento confirmado. A próxima entrega já tem data.'
        : 'Payment confirmed. Your next delivery is scheduled.',
      kicker: pt ? 'Renovação' : 'Renewal',
      title: pt ? 'Mais um ciclo na cozinha' : 'Another cycle in the kitchen',
      innerHtml,
      assetBaseUrl,
      allowRelativeAssets
    })
  };
}

function buildPausedEmail({
  firstName,
  petName,
  resumeAtLabel,
  dashboardUrl,
  locale,
  assetBaseUrl,
  allowRelativeAssets
} = {}) {
  const pt = isPortuguese(locale || 'pt-BR');
  const hello = greet(pt, firstName);
  const pet = petLabel(pt, petName);
  const url = String(dashboardUrl || '').trim();
  const resume = String(resumeAtLabel || '').trim();
  const subject = pt
    ? `A tigela da ${pet} está pausada`
    : `${pet}'s bowl is paused`;
  const text = [
    pt
      ? `${hello} Pausamos a assinatura da ${pet} como você pediu. Enquanto estiver pausada, não haverá entregas nem cobranças.`
      : `${hello} we've paused ${pet}'s subscription as you asked. While it's paused, there won't be any deliveries or charges.`,
    `Pet: ${pet}`,
    resume ? `${pt ? 'Retomada prevista' : 'Scheduled to resume'}: ${resume}` : '',
    url
  ].filter(Boolean).join('\n');

  const innerHtml = [
    paragraphHtml(pt
      ? `${hello} Pausamos a assinatura da ${pet} como você pediu. Enquanto estiver pausada, não haverá entregas nem cobranças. A cozinha guarda o lugar dela, e você retoma quando quiser.`
      : `${hello} we've paused ${pet}'s subscription as you asked. While it's paused, there won't be any deliveries or charges. The kitchen keeps the place, and you can resume whenever you like.`),
    detailsTableHtml([
      { label: 'Pet', value: pet },
      { label: pt ? 'Retomada prevista' : 'Scheduled to resume', value: resume }
    ]),
    url ? buttonHtml({ href: url, label: pt ? 'Retomar assinatura' : 'Resume subscription' }) : ''
  ].join('');

  return {
    id: 'paused',
    subject,
    text,
    html: renderLetter({
      locale: locale || 'pt-BR',
      preheader: pt
        ? 'Nenhuma entrega ou cobrança até você retomar.'
        : 'No deliveries or charges until you resume.',
      kicker: pt ? 'Pausa' : 'Paused',
      title: subject,
      innerHtml,
      assetBaseUrl,
      allowRelativeAssets
    })
  };
}

function buildResumedEmail({
  firstName,
  petName,
  nextDeliveryLabel,
  dashboardUrl,
  locale,
  assetBaseUrl,
  allowRelativeAssets
} = {}) {
  const pt = isPortuguese(locale || 'pt-BR');
  const hello = greet(pt, firstName);
  const pet = petLabel(pt, petName);
  const url = String(dashboardUrl || '').trim();
  const subject = pt
    ? `A ${pet} está de volta à cozinha`
    : `${pet} is back in the kitchen`;
  const text = [
    pt
      ? `${hello} A assinatura da ${pet} está ativa de novo e as entregas voltam ao ritmo normal.`
      : `${hello} ${pet}'s subscription is active again and deliveries are back on schedule.`,
    `Pet: ${pet}`,
    nextDeliveryLabel ? `${pt ? 'Próxima entrega' : 'Next delivery'}: ${nextDeliveryLabel}` : '',
    url
  ].filter(Boolean).join('\n');

  const innerHtml = [
    paragraphHtml(pt
      ? `${hello} A assinatura da ${pet} está ativa de novo e as entregas voltam ao ritmo normal. A próxima tigela já tem data marcada.`
      : `${hello} ${pet}'s subscription is active again and deliveries are back on schedule. The next bowl already has a date.`),
    detailsTableHtml([
      { label: 'Pet', value: pet },
      { label: pt ? 'Próxima entrega' : 'Next delivery', value: nextDeliveryLabel }
    ]),
    url ? buttonHtml({ href: url, label: pt ? 'Ver meu plano' : 'View my plan' }) : ''
  ].join('');

  return {
    id: 'resumed',
    subject,
    text,
    html: renderLetter({
      locale: locale || 'pt-BR',
      preheader: pt
        ? 'Assinatura retomada. As entregas voltam ao ritmo normal.'
        : 'Subscription resumed. Deliveries are back on schedule.',
      kicker: pt ? 'Retomada' : 'Resumed',
      title: subject,
      innerHtml,
      assetBaseUrl,
      allowRelativeAssets
    })
  };
}

function buildCancelledEmail({
  firstName,
  petName,
  endsAtLabel,
  dashboardUrl,
  locale,
  assetBaseUrl,
  allowRelativeAssets
} = {}) {
  const pt = isPortuguese(locale || 'pt-BR');
  const hello = greet(pt, firstName);
  const pet = petLabel(pt, petName);
  const url = String(dashboardUrl || '').trim();
  const subject = pt
    ? `A assinatura da ${pet} foi encerrada`
    : `${pet}'s subscription has been cancelled`;
  const text = [
    pt
      ? `${hello} Confirmamos o cancelamento da assinatura da ${pet}. Se ainda houver um ciclo pago, as entregas continuam até o fim dele; depois disso, não haverá novas cobranças.`
      : `${hello} we've confirmed the cancellation of ${pet}'s subscription. If there's a paid cycle still running, deliveries continue until it ends; after that, there will be no further charges.`,
    `Pet: ${pet}`,
    endsAtLabel ? `${pt ? 'Válida até' : 'Active until'}: ${endsAtLabel}` : '',
    url
  ].filter(Boolean).join('\n');

  const innerHtml = [
    paragraphHtml(pt
      ? `${hello} Confirmamos o cancelamento da assinatura da ${pet}. Se ainda houver um ciclo pago, as entregas continuam até o fim dele; depois disso, não haverá novas cobranças.`
      : `${hello} we've confirmed the cancellation of ${pet}'s subscription. If there's a paid cycle still running, deliveries continue until it ends; after that, there will be no further charges.`),
    detailsTableHtml([
      { label: 'Pet', value: pet },
      { label: pt ? 'Válida até' : 'Active until', value: endsAtLabel }
    ]),
    url ? buttonHtml({ href: url, label: pt ? 'Reativar assinatura' : 'Reactivate subscription' }) : '',
    mutedHtml(pt
      ? `Se mudar de ideia, a cozinha fica de portas abertas: é só reativar, que o plano e as preferências da ${pet} continuam salvos.`
      : `If you change your mind, the kitchen door stays open: just reactivate, and ${pet}'s plan and preferences will still be saved.`)
  ].join('');

  return {
    id: 'cancelled',
    subject,
    text,
    html: renderLetter({
      locale: locale || 'pt-BR',
      preheader: pt
        ? `Sentiremos falta da ${pet}. A cozinha fica de portas abertas.`
        : `We'll miss ${pet}. The kitchen door stays open.`,
      kicker: pt ? 'Cancelamento' : 'Cancellation',
      title: pt ? 'Assinatura encerrada' : 'Subscription cancelled',
      innerHtml,
      assetBaseUrl,
      allowRelativeAssets
    })
  };
}

// Sent when the customer turns automatic renewal off. The date is the last contracted delivery.
function autoRenewOffSentence(pt, endsOnLabel) {
  if (pt) {
    return endsOnLabel
      ? `Renovação automática desligada. Seu plano termina depois da última entrega, em ${endsOnLabel}.`
      : 'Renovação automática desligada. Seu plano termina depois da última entrega contratada.';
  }
  return endsOnLabel
    ? `Automatic renewal is off. Your plan ends after your last delivery, on ${endsOnLabel}.`
    : 'Automatic renewal is off. Your plan ends after your last contracted delivery.';
}

function buildAutoRenewOffEmail({
  firstName,
  petName,
  endsOnLabel,
  dashboardUrl,
  locale,
  assetBaseUrl,
  allowRelativeAssets
} = {}) {
  const pt = isPortuguese(locale || 'pt-BR');
  const hello = greet(pt, firstName);
  const pet = petLabel(pt, petName);
  const url = String(dashboardUrl || '').trim();
  const sentence = autoRenewOffSentence(pt, endsOnLabel);
  const subject = pt ? 'Renovação automática desligada' : 'Automatic renewal is off';
  const text = [
    `${hello} ${sentence}`,
    `Pet: ${pet}`,
    endsOnLabel ? `${pt ? 'Última entrega' : 'Last delivery'}: ${endsOnLabel}` : '',
    url
  ].filter(Boolean).join('\n');

  const innerHtml = [
    paragraphHtml(`${hello} ${sentence}`),
    detailsTableHtml([
      { label: 'Pet', value: pet },
      { label: pt ? 'Última entrega' : 'Last delivery', value: endsOnLabel }
    ]),
    url ? buttonHtml({ href: url, label: pt ? 'Religar renovação' : 'Turn renewal back on' }) : '',
    mutedHtml(pt
      ? 'Se mudar de ideia antes da última entrega, é só religar a renovação no Meu Plano.'
      : 'If you change your mind before the last delivery, just turn renewal back on in My Plan.')
  ].join('');

  return {
    id: 'auto-renew-off',
    subject,
    text,
    html: renderLetter({
      locale: locale || 'pt-BR',
      preheader: sentence,
      kicker: pt ? 'Renovação' : 'Renewal',
      title: subject,
      innerHtml,
      assetBaseUrl,
      allowRelativeAssets
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
  locale,
  assetBaseUrl,
  allowRelativeAssets
} = {}) {
  const pt = isPortuguese(locale || 'pt-BR');
  const hello = greet(pt, firstName);
  const pet = petLabel(pt, petName);
  const url = String(dashboardUrl || '').trim();
  const flavorList = joinList(flavors);
  const subject = pt
    ? `O cardápio da ${pet} mudou`
    : `${pet}'s menu has changed`;
  const text = [
    pt
      ? `${hello} As alterações no plano da ${pet} foram salvas, e a próxima entrega já sai com o novo cardápio.`
      : `${hello} the changes to ${pet}'s plan have been saved, and the next delivery will go out with the new menu.`,
    flavorList ? `${pt ? 'Sabores' : 'Flavors'}: ${flavorList}` : '',
    `Pet: ${pet}`,
    planName ? `${pt ? 'Plano' : 'Plan'}: ${planName}` : '',
    totalLabel ? `Total: ${totalLabel}` : '',
    url
  ].filter(Boolean).join('\n');

  const innerHtml = [
    paragraphHtml(pt
      ? `${hello} As alterações no plano da ${pet} foram salvas, e a próxima entrega já sai com o novo cardápio. Confira o resumo abaixo.`
      : `${hello} the changes to ${pet}'s plan have been saved, and the next delivery will go out with the new menu. Here's a summary.`),
    pillsHtml(flavors),
    detailsTableHtml([
      { label: 'Pet', value: pet },
      { label: pt ? 'Plano' : 'Plan', value: planName },
      { label: 'Total', value: totalLabel }
    ]),
    url ? buttonHtml({ href: url, label: pt ? 'Ver detalhes' : 'View details' }) : ''
  ].join('');

  return {
    id: 'plan-changed',
    subject,
    text,
    html: renderLetter({
      locale: locale || 'pt-BR',
      preheader: pt ? 'Confira os novos sabores e o ciclo.' : 'Check the new recipes and cycle.',
      kicker: pt ? 'Plano' : 'Plan',
      title: subject,
      innerHtml,
      assetBaseUrl,
      allowRelativeAssets
    })
  };
}

// Carries the invoice PDF as an attachment; the body only points to it.
function buildInvoiceEmail({
  firstName,
  invoiceNumber,
  totalLabel,
  issuedLabel,
  paid,
  dashboardUrl,
  locale,
  assetBaseUrl,
  allowRelativeAssets
} = {}) {
  const pt = isPortuguese(locale || 'pt-BR');
  const hello = greet(pt, firstName);
  const url = String(dashboardUrl || '').trim();
  const subject = pt ? `Sua fatura Eden Bowls ${invoiceNumber}` : `Your Eden Bowls invoice ${invoiceNumber}`;
  const intro = pt
    ? `${hello} A fatura ${invoiceNumber} está anexada a este e-mail em PDF.`
    : `${hello} Invoice ${invoiceNumber} is attached to this email as a PDF.`;
  const statusLabel = pt ? (paid ? 'Paga' : 'Pagamento pendente') : (paid ? 'Paid' : 'Payment due');
  const text = [
    intro,
    `${pt ? 'Fatura' : 'Invoice'}: ${invoiceNumber}`,
    issuedLabel ? `${pt ? 'Emissão' : 'Issued'}: ${issuedLabel}` : '',
    totalLabel ? `Total: ${totalLabel}` : '',
    `Status: ${statusLabel}`,
    url
  ].filter(Boolean).join('\n');

  const innerHtml = [
    paragraphHtml(intro),
    detailsTableHtml([
      { label: pt ? 'Fatura' : 'Invoice', value: invoiceNumber },
      { label: pt ? 'Emissão' : 'Issued', value: issuedLabel },
      { label: 'Total', value: totalLabel },
      { label: 'Status', value: statusLabel }
    ]),
    mutedHtml(pt
      ? 'Guarde este e-mail: o PDF anexado é o seu comprovante.'
      : 'Keep this email: the attached PDF is your record.'),
    url ? buttonHtml({ href: url, label: pt ? 'Ver meu plano' : 'View my plan' }) : ''
  ].join('');

  return {
    id: 'invoice',
    subject,
    text,
    html: renderLetter({
      locale: locale || 'pt-BR',
      preheader: pt ? `Fatura ${invoiceNumber} em anexo.` : `Invoice ${invoiceNumber} attached.`,
      kicker: pt ? 'Fatura' : 'Invoice',
      title: pt ? 'Sua fatura chegou' : 'Your invoice is here',
      innerHtml,
      assetBaseUrl,
      allowRelativeAssets
    })
  };
}

module.exports = {
  buildAdminNewSubscriptionEmail,
  buildInvoiceEmail,
  buildAutoRenewOffEmail,
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
