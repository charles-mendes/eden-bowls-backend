const fs = require('fs');
const path = require('path');
const { buildCourierDeliveredEmail, buildCourierOutForDeliveryEmail } = require('../src/core/email/transactional-emails');

const designerTitle = (locale, id) => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'new-designer-emails', locale, `${id}.html`), 'utf8');
  return html.match(/<title>([^<]*)<\/title>/)[1].replace(/&#39;|&apos;/g, "'");
};

describe('courier out-for-delivery letter', () => {
  test('pt-BR with a link names the pet and shows the track button', () => {
    const content = buildCourierOutForDeliveryEmail({ firstName: 'Ana', petName: 'Luna', trackingUrl: 'https://trip.uber.com/abc123', locale: 'pt-BR' });
    expect(content.subject).toBe('A tigela da Luna saiu para entrega');
    expect(content.subject).toBe(designerTitle('pt', 'courier-out-for-delivery'));
    expect(content.html).toContain('Oi, Ana.');
    expect(content.html).toContain('href="https://trip.uber.com/abc123"');
    expect(content.html).toContain('Acompanhar entrega');
    expect(content.text).toContain('https://trip.uber.com/abc123');
  });

  test('pt-BR without a link has no button and says we will write again', () => {
    const content = buildCourierOutForDeliveryEmail({ firstName: 'Ana', petName: 'Luna', locale: 'pt-BR' });
    expect(content.html).not.toContain('Acompanhar entrega');
    expect(content.html).toContain('Avisamos de novo');
  });

  test('en-US matches the designer title, with and without a link', () => {
    const withLink = buildCourierOutForDeliveryEmail({ firstName: 'Ana', petName: 'Luna', trackingUrl: 'https://trip.uber.com/abc123', locale: 'en-US' });
    expect(withLink.subject).toBe(designerTitle('en', 'courier-out-for-delivery'));
    expect(withLink.html).toContain('Track delivery');
    const withoutLink = buildCourierOutForDeliveryEmail({ petName: 'Luna', locale: 'en-US' });
    expect(withoutLink.html).not.toContain('Track delivery');
    expect(withoutLink.html).toContain('Hi,');
  });

  test('carries no tracking number and no UPS', () => {
    const content = buildCourierOutForDeliveryEmail({ petName: 'Luna', trackingUrl: 'https://trip.uber.com/abc123', locale: 'pt-BR' });
    expect(content.html).not.toContain('UPS');
    expect(content.html).not.toContain('Transportadora');
  });
});

describe('courier delivered letter', () => {
  test.each([['pt', 'pt-BR', 'A tigela da Luna foi entregue', 'Ver meu plano'], ['en', 'en-US', "Luna's bowl has been delivered", 'View my plan']])(
    '%s matches the designer title', (dir, locale, subject, button) => {
      const content = buildCourierDeliveredEmail({ firstName: 'Ana', petName: 'Luna', dashboardUrl: 'https://edenbowls.com/dashboard/plans', locale });
      expect(content.subject).toBe(subject);
      expect(content.subject).toBe(designerTitle(dir, 'courier-delivered'));
      expect(content.html).toContain(button);
    }
  );
});
