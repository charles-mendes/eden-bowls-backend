// Every text printed on the privacy export PDF (privacy-data-export), in pt-BR and en.
// The purposes and the sharing table are copied from the privacy policy version 2026-09-13 (legal-documents):
// "Como usamos as informações" / "How we use information" and "Compartilhamento e transferência internacional" /
// "Sharing and international transfers". DRAFT until the owner's review (task 5.1 of privacy-access-pdf).
// A change to the policy must change this file too; tests/privacy-export-copy.test.js checks the sharing table.

const SUPPORT_EMAIL = 'hello@edenbowls.com';

const EXPORT_COPY = {
  'pt-BR': {
    documentTitle: 'Seus dados',
    heading: 'Seus dados na Eden Bowls',
    requestLabel: 'SOLICITAÇÃO',
    exportedAtLabel: 'DADOS DE',
    typeLabel: { access: 'Acesso aos dados', portability: 'Portabilidade dos dados' },
    intro: 'Este documento reúne os dados pessoais que a Eden Bowls guarda sobre você, de onde eles vieram e para que são usados, como pede a LGPD (art. 18 e 19). Os dados estão como eram na data acima.',
    sourceLabel: 'ORIGEM',
    purposeLabel: 'FINALIDADE',
    noRecord: 'Nenhum registro.',
    empty: '—',
    yes: 'Sim',
    no: 'Não',
    itemLabel: (index) => `Registro ${index}`,
    sections: {
      profile: {
        title: 'Perfil',
        source: 'Informado por você no cadastro e na tela de perfil.',
        purpose: 'Criar e autenticar a conta. Enviar OTP, confirmações e atualizações de entrega. Enviar marketing somente se você tiver optado.',
        fields: {
          fullName: 'Nome',
          email: 'E-mail',
          phone: 'Telefone',
          countryCode: 'País do telefone',
          marketingOptIn: 'Aceita e-mails promocionais',
          cookieAnalytics: 'Cookies de analytics',
          cookieAds: 'Cookies de publicidade'
        }
      },
      delivery: {
        title: 'Endereço de entrega',
        source: 'Informado por você no cadastro, no checkout ou na tela de perfil.',
        purpose: 'Entregar os pedidos (frete BR/US).',
        fields: {
          recipientName: 'Quem recebe',
          address: 'Endereço',
          number: 'Número',
          complement: 'Complemento',
          neighborhood: 'Bairro',
          city: 'Cidade',
          state: 'Estado',
          zipCode: 'CEP / ZIP',
          country: 'País',
          deliveryInstructions: 'Instruções de entrega'
        }
      },
      pets: {
        title: 'Pets',
        source: 'Informado por você no cadastro de cada pet.',
        purpose: 'Calcular o plano alimentar e as porções.',
        fields: {
          name: 'Nome',
          breed: 'Raça',
          age: 'Idade',
          weight: 'Peso',
          size: 'Porte',
          activityLevel: 'Nível de atividade',
          petCondition: 'Condição corporal',
          neutered: 'Castrado'
        }
      },
      consents: {
        title: 'Consentimentos',
        source: 'Registrado quando você aceita ou recusa os termos, a política de privacidade, os cookies, os e-mails promocionais e a renovação automática.',
        purpose: 'Respeitar e comprovar as suas escolhas. Cumprir obrigações legais.',
        fields: {
          consentType: 'Sobre',
          status: 'Escolha',
          documentVersion: 'Versão do texto',
          source: 'Onde',
          createdAt: 'Data'
        }
      },
      subscriptions: {
        title: 'Assinaturas',
        source: 'Criado pela Stripe quando você assina e atualizado a cada cobrança.',
        purpose: 'Processar a assinatura e cobrar as recorrências.',
        fields: {
          status: 'Status',
          stripeSubscriptionId: 'Assinatura na Stripe',
          stripeCustomerId: 'Cliente na Stripe',
          currentPeriodEnd: 'Fim do período atual',
          cancelAtPeriodEnd: 'Cancela no fim do período',
          deliveryInstructions: 'Instruções de entrega'
        }
      },
      contacts: {
        title: 'Contatos da equipe Eden Bowls',
        source: 'Registrado pela equipe Eden Bowls quando fala com você pelo WhatsApp sobre a sua assinatura.',
        purpose: 'Resolver problemas de pagamento ou de entrega da assinatura.',
        fields: {
          createdAt: 'Data',
          channel: 'Canal',
          reason: 'Motivo',
          outcome: 'Resultado',
          note: 'Anotação'
        }
      },
      addressIssues: {
        title: 'Avisos de endereço',
        source: 'Gerado pelo sistema quando o endereço ou os dados fiscais impedem a entrega ou a nota fiscal.',
        purpose: 'Avisar você para corrigir o endereço e entregar o pedido.',
        fields: {
          codes: 'O que faltava',
          source: 'Detectado em',
          openedAt: 'Aberto em',
          emailSentAt: 'E-mail enviado em',
          resolvedAt: 'Resolvido em'
        }
      }
    },
    criteria: {
      title: 'Critérios usados',
      text: 'A porção diária e o plano de cada pet são calculados a partir da idade, do peso, do porte, do nível de atividade, da condição corporal e de o pet ser castrado ou não.'
    },
    sharing: {
      title: 'Com quem compartilhamos',
      intro: 'Empresas que tratam dados de clientes para a Eden Bowls, segundo a política de privacidade:',
      columns: { recipient: 'DESTINATÁRIO', purpose: 'FINALIDADE', place: 'ONDE' },
      rows: [
        { recipient: 'Stripe (contas BR e US)', purpose: 'Pagamento e assinatura', place: 'EUA e, conforme a conta, Brasil' },
        { recipient: 'Brevo (SMTP)', purpose: 'E-mail OTP / transacional', place: 'União Europeia (possível)' },
        { recipient: 'MaxMind', purpose: 'País a partir do IP (geo)', place: 'EUA' },
        { recipient: 'Nominatim / OpenStreetMap', purpose: 'Autocomplete e geocodificação de endereço', place: 'Servidores OSM (tipicamente fora do Brasil)' },
        { recipient: 'ViaCEP', purpose: 'Consulta de CEP', place: 'Brasil' },
        { recipient: 'OSRM', purpose: 'Distância de frete BR', place: 'Conforme o serviço de roteamento' },
        { recipient: 'UPS', purpose: 'Frete e etiqueta nos EUA', place: 'EUA' },
        { recipient: 'Google (GA4)', purpose: 'Analytics, se autorizado', place: 'EUA' }
      ],
      staff: 'A equipe interna da Eden Bowls acessa dados de clientes conforme o papel de cada pessoa (admin, operador, leitura, veterinária).'
    },
    notIncluded: {
      title: 'O que este arquivo não traz',
      intro: 'A política de privacidade descreve também estes dados, que ficam fora deste arquivo:',
      items: [
        'Senha: guardada só como hash, que não permite recuperar a senha.',
        'Foto de perfil e fotos dos pets: são imagens e aparecem no seu perfil.',
        'Marca e últimos quatro dígitos do cartão: guardados para mostrar o método de pagamento salvo. O número completo fica só na Stripe.',
        'Páginas visitadas: ficam no Google Analytics, se você autorizou. A Eden Bowls não as guarda.',
        'País pelo IP: calculado a cada acesso (MaxMind) e não é salvo.'
      ]
    },
    footer: {
      questionsPrefix: 'Dúvidas ou correções:',
      email: SUPPORT_EMAIL,
      pageLabel: (page, pages) => `Página ${page} de ${pages}`
    },
    values: {
      size: { small: 'Pequeno', medium: 'Médio', large: 'Grande' },
      activityLevel: { low: 'Baixo', medium: 'Moderado', high: 'Alto' },
      petCondition: { underweight: 'Abaixo do peso', ideal: 'Peso ideal', overweight: 'Acima do peso' },
      consentType: {
        terms: 'Termos de uso',
        privacy_policy: 'Política de privacidade',
        marketing_email: 'E-mails promocionais',
        analytics: 'Cookies de analytics',
        ads: 'Cookies de publicidade',
        share_opt_out: 'Não compartilhar dados',
        auto_renewal: 'Renovação automática'
      },
      consentStatus: { granted: 'Aceitou', denied: 'Recusou', withdrawn: 'Revogou' },
      consentSource: {
        otp_verify: 'Cadastro (código por e-mail)',
        checkout: 'Checkout',
        banner: 'Aviso de cookies',
        preferences: 'Preferências do perfil',
        gpc: 'Sinal GPC do navegador',
        do_not_sell: 'Página Do Not Sell'
      },
      addressIssueSource: {
        payment_check: 'Pagamento',
        nfe_check: 'Nota fiscal',
        ups_check: 'Etiqueta UPS',
        courier_check: 'Entrega local'
      },
      cookie: { granted: 'Autorizados', denied: 'Recusados' },
      subscriptionStatus: {
        active: 'Ativa',
        trialing: 'Em teste',
        past_due: 'Pagamento atrasado',
        canceled: 'Cancelada',
        incomplete: 'Incompleta',
        incomplete_expired: 'Expirada',
        unpaid: 'Não paga',
        paused: 'Pausada'
      },
      contactChannel: { whatsapp: 'WhatsApp' },
      contactReason: {
        payment_failed: 'Pagamento recusado',
        late: 'Pagamento atrasado',
        delivery_failed: 'Entrega falhou',
        address: 'Endereço'
      },
      contactOutcome: {
        no_answer: 'Sem resposta',
        customer_will_fix: 'Cliente vai corrigir',
        resolved: 'Resolvido'
      },
      addressIssueCode: {
        address_street_missing: 'Rua',
        address_number_missing: 'Número',
        address_neighborhood_missing: 'Bairro',
        address_city_missing: 'Cidade',
        address_state_missing: 'Estado',
        address_zipcode_invalid: 'CEP inválido',
        address_incomplete: 'Endereço incompleto',
        po_box_not_allowed: 'Caixa postal não aceita',
        military_address_not_supported: 'Endereço militar não atendido',
        recipient_name_missing: 'Nome de quem recebe',
        courier_address_unusable: 'Endereço recusado pela transportadora',
        tax_document_missing: 'CPF',
        fiscal_name_missing: 'Nome para a nota fiscal'
      }
    },
    age: (years, months) => {
      const parts = [];
      if (years) parts.push(`${years} ${years === 1 ? 'ano' : 'anos'}`);
      if (months) parts.push(`${months} ${months === 1 ? 'mês' : 'meses'}`);
      return parts.join(' e ');
    },
    filename: (requestId) => `eden-bowls-dados-${requestId}.pdf`
  },
  en: {
    documentTitle: 'Your data',
    heading: 'Your data at Eden Bowls',
    requestLabel: 'REQUEST',
    exportedAtLabel: 'DATA AS OF',
    typeLabel: { access: 'Access to data', portability: 'Data portability' },
    intro: 'This document lists the personal data Eden Bowls keeps about you, where it came from and what it is used for. The data is shown as it was on the date above.',
    sourceLabel: 'SOURCE',
    purposeLabel: 'PURPOSE',
    noRecord: 'No record.',
    empty: '—',
    yes: 'Yes',
    no: 'No',
    itemLabel: (index) => `Record ${index}`,
    sections: {
      profile: {
        title: 'Profile',
        source: 'Given by you at sign-up and on the profile screen.',
        purpose: 'Create and authenticate the account. Send OTP, confirmations, and delivery updates. Send marketing only if you opted in.',
        fields: {
          fullName: 'Name',
          email: 'Email',
          phone: 'Phone',
          countryCode: 'Phone country',
          marketingOptIn: 'Accepts promotional emails',
          cookieAnalytics: 'Analytics cookies',
          cookieAds: 'Advertising cookies'
        }
      },
      delivery: {
        title: 'Delivery address',
        source: 'Given by you at sign-up, at checkout, or on the profile screen.',
        purpose: 'Deliver orders (US/BR shipping).',
        fields: {
          recipientName: 'Recipient',
          address: 'Address',
          number: 'Number',
          complement: 'Address line 2',
          neighborhood: 'Neighborhood',
          city: 'City',
          state: 'State',
          zipCode: 'ZIP / CEP',
          country: 'Country',
          deliveryInstructions: 'Delivery instructions'
        }
      },
      pets: {
        title: 'Pets',
        source: 'Given by you when you added each pet.',
        purpose: 'Calculate the meal plan and the portions.',
        fields: {
          name: 'Name',
          breed: 'Breed',
          age: 'Age',
          weight: 'Weight',
          size: 'Size',
          activityLevel: 'Activity level',
          petCondition: 'Body condition',
          neutered: 'Neutered'
        }
      },
      consents: {
        title: 'Consents',
        source: 'Recorded when you accept or decline the terms, the privacy policy, cookies, promotional emails, and automatic renewal.',
        purpose: 'Respect and prove your choices. Meet legal obligations.',
        fields: {
          consentType: 'About',
          status: 'Choice',
          documentVersion: 'Text version',
          source: 'Where',
          createdAt: 'Date'
        }
      },
      subscriptions: {
        title: 'Subscriptions',
        source: 'Created by Stripe when you subscribe and updated on each charge.',
        purpose: 'Process the subscription and collect recurring payments.',
        fields: {
          status: 'Status',
          stripeSubscriptionId: 'Stripe subscription',
          stripeCustomerId: 'Stripe customer',
          currentPeriodEnd: 'Current period ends',
          cancelAtPeriodEnd: 'Cancels at period end',
          deliveryInstructions: 'Delivery instructions'
        }
      },
      contacts: {
        title: 'Contacts from the Eden Bowls team',
        source: 'Recorded by the Eden Bowls team when it talks to you on WhatsApp about your subscription.',
        purpose: 'Solve payment or delivery problems of the subscription.',
        fields: {
          createdAt: 'Date',
          channel: 'Channel',
          reason: 'Reason',
          outcome: 'Outcome',
          note: 'Note'
        }
      },
      addressIssues: {
        title: 'Address notices',
        source: 'Created by the system when the address or the tax data prevents the delivery or the invoice.',
        purpose: 'Ask you to fix the address and deliver the order.',
        fields: {
          codes: 'What was missing',
          source: 'Found at',
          openedAt: 'Opened',
          emailSentAt: 'Email sent',
          resolvedAt: 'Resolved'
        }
      }
    },
    criteria: {
      title: 'Criteria used',
      text: "Each pet's daily portion and plan are calculated from its age, weight, size, activity level, body condition, and whether it is neutered."
    },
    sharing: {
      title: 'Who we share with',
      intro: 'Companies that process customer data for Eden Bowls, as listed in the privacy policy:',
      columns: { recipient: 'RECIPIENT', purpose: 'PURPOSE', place: 'WHERE' },
      rows: [
        { recipient: 'Stripe (BR and US accounts)', purpose: 'Payments and subscriptions', place: 'United States and, depending on the account, Brazil' },
        { recipient: 'Brevo (SMTP)', purpose: 'OTP / transactional email', place: 'European Union (possible)' },
        { recipient: 'MaxMind', purpose: 'Country from IP (geo)', place: 'United States' },
        { recipient: 'Nominatim / OpenStreetMap', purpose: 'Address autocomplete and geocoding', place: 'OSM infrastructure (typically outside Brazil)' },
        { recipient: 'ViaCEP', purpose: 'Brazilian postal lookup', place: 'Brazil' },
        { recipient: 'OSRM', purpose: 'Brazil shipping distance', place: 'Routing host' },
        { recipient: 'UPS', purpose: 'US shipping and labels', place: 'United States' },
        { recipient: 'Google (GA4)', purpose: 'Analytics, if allowed', place: 'United States' }
      ],
      staff: 'Eden Bowls staff can access customer data according to role (admin, operator, readonly, veterinarian).'
    },
    notIncluded: {
      title: 'What this file does not include',
      intro: 'The privacy policy also describes this data, which is left out of this file:',
      items: [
        'Password: kept only as a hash, which cannot be turned back into the password.',
        'Profile photo and pet photos: they are images and show on your profile.',
        'Card brand and last four digits: kept to show the saved payment method. The full number stays only at Stripe.',
        'Pages visited: kept by Google Analytics, if you allowed it. Eden Bowls does not keep them.',
        'Country from IP: calculated on each visit (MaxMind) and not saved.'
      ]
    },
    footer: {
      questionsPrefix: 'Questions or corrections:',
      email: SUPPORT_EMAIL,
      pageLabel: (page, pages) => `Page ${page} of ${pages}`
    },
    values: {
      size: { small: 'Small', medium: 'Medium', large: 'Large' },
      activityLevel: { low: 'Low', medium: 'Moderate', high: 'High' },
      petCondition: { underweight: 'Underweight', ideal: 'Ideal weight', overweight: 'Overweight' },
      consentType: {
        terms: 'Terms of use',
        privacy_policy: 'Privacy policy',
        marketing_email: 'Promotional emails',
        analytics: 'Analytics cookies',
        ads: 'Advertising cookies',
        share_opt_out: 'Do not share my data',
        auto_renewal: 'Automatic renewal'
      },
      consentStatus: { granted: 'Accepted', denied: 'Declined', withdrawn: 'Withdrawn' },
      consentSource: {
        otp_verify: 'Sign-up (email code)',
        checkout: 'Checkout',
        banner: 'Cookie banner',
        preferences: 'Profile preferences',
        gpc: 'Browser GPC signal',
        do_not_sell: 'Do Not Sell page'
      },
      addressIssueSource: {
        payment_check: 'Payment',
        nfe_check: 'Tax invoice (NF-e)',
        ups_check: 'UPS label',
        courier_check: 'Local delivery'
      },
      cookie: { granted: 'Allowed', denied: 'Declined' },
      subscriptionStatus: {
        active: 'Active',
        trialing: 'Trial',
        past_due: 'Payment past due',
        canceled: 'Canceled',
        incomplete: 'Incomplete',
        incomplete_expired: 'Expired',
        unpaid: 'Unpaid',
        paused: 'Paused'
      },
      contactChannel: { whatsapp: 'WhatsApp' },
      contactReason: {
        payment_failed: 'Payment declined',
        late: 'Payment late',
        delivery_failed: 'Delivery failed',
        address: 'Address'
      },
      contactOutcome: {
        no_answer: 'No answer',
        customer_will_fix: 'Customer will fix it',
        resolved: 'Resolved'
      },
      addressIssueCode: {
        address_street_missing: 'Street',
        address_number_missing: 'Number',
        address_neighborhood_missing: 'Neighborhood',
        address_city_missing: 'City',
        address_state_missing: 'State',
        address_zipcode_invalid: 'Invalid ZIP',
        address_incomplete: 'Incomplete address',
        po_box_not_allowed: 'P.O. box not accepted',
        military_address_not_supported: 'Military address not served',
        recipient_name_missing: 'Recipient name',
        courier_address_unusable: 'Address refused by the carrier',
        tax_document_missing: 'CPF',
        fiscal_name_missing: 'Name for the tax invoice'
      }
    },
    age: (years, months) => {
      const parts = [];
      if (years) parts.push(`${years} ${years === 1 ? 'year' : 'years'}`);
      if (months) parts.push(`${months} ${months === 1 ? 'month' : 'months'}`);
      return parts.join(' and ');
    },
    filename: (requestId) => `eden-bowls-data-${requestId}.pdf`
  }
};

const EXPORT_LOCALES = Object.keys(EXPORT_COPY);

// The request's locale decides; without one (requests opened in the panel), the market does: BR → pt-BR, US → en.
function resolveExportLocale(row = {}) {
  const locale = String((row && row.locale) || '').trim().toLowerCase();
  if (locale.startsWith('pt')) return 'pt-BR';
  if (locale.startsWith('en')) return 'en';
  return String((row && row.market) || '').toUpperCase() === 'US' ? 'en' : 'pt-BR';
}

function exportCopy(locale) {
  return EXPORT_COPY[locale] || EXPORT_COPY['pt-BR'];
}

// A value the dictionary does not know is printed as it is stored, never dropped.
function translateValue(locale, group, value) {
  if (value === null || value === undefined || value === '') return null;
  const table = exportCopy(locale).values[group] || {};
  return Object.prototype.hasOwnProperty.call(table, value) ? table[value] : String(value);
}

module.exports = {
  EXPORT_COPY,
  EXPORT_LOCALES,
  exportCopy,
  resolveExportLocale,
  translateValue
};
