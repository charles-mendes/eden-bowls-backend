// Teste de fumaça do SMTP Brevo. Lê as credenciais do ambiente (node --env-file=...)
// e nunca imprime usuário completo nem senha.
// Uso: node --env-file=$HOME/.eden-brevo-prod.env scripts/brevo-smoke.js destinatario@exemplo.com
// Guia: scripts/brevo-smoke.md
const nodemailer = require('nodemailer');

const to = process.argv[2];
if (!to) {
  console.error('Informe o destinatário: node --env-file=<arquivo> scripts/brevo-smoke.js voce@exemplo.com');
  process.exit(2);
}

const host = process.env.AUTH_SMTP_HOST || 'smtp-relay.brevo.com';
const port = Number(process.env.AUTH_SMTP_PORT || 587);
const user = process.env.AUTH_SMTP_USER || '';
const pass = process.env.AUTH_SMTP_PASS || '';
const encryption = String(process.env.AUTH_SMTP_ENCRYPTION || 'tls').toLowerCase();
const from = process.env.AUTH_MAIL_FROM || '';
const fromName = process.env.AUTH_MAIL_FROM_NAME || 'Eden Bowls';

const mask = (v) => (v ? `${v.slice(0, 3)}***${v.slice(-2)} (${v.length} chars)` : '(vazio)');
console.log('host:', host, '| port:', port, '| encryption:', encryption);
console.log('user:', mask(user), '| pass:', pass ? `definida (${pass.length} chars)` : '(vazia)');
console.log('from:', from || '(vazio)');

if (!user || !pass || !from) {
  console.error('Faltam AUTH_SMTP_USER, AUTH_SMTP_PASS ou AUTH_MAIL_FROM no arquivo.');
  process.exit(2);
}

const transport = nodemailer.createTransport({
  host,
  port,
  secure: encryption === 'ssl',
  requireTLS: encryption === 'tls',
  auth: { user, pass }
});

(async () => {
  try {
    await transport.verify();
    console.log('OK: login SMTP aceito pela Brevo.');
    const info = await transport.sendMail({
      from: { name: fromName, address: from },
      to,
      subject: `[TESTE] Brevo produção ${new Date().toISOString()}`,
      text: 'E-mail de teste do SMTP de produção da Eden Bowls. Pode ignorar.'
    });
    console.log('OK: enviado. messageId:', info.messageId, '| response:', info.response);
    console.log('accepted:', info.accepted, '| rejected:', info.rejected);
  } catch (err) {
    // Mensagens da Brevo não contêm a senha; mesmo assim só mostramos código e resposta.
    console.error('FALHOU:', err.code || '', err.responseCode || '', err.response || err.message);
    process.exit(1);
  }
})();
