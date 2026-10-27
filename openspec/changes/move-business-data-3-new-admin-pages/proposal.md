# Proposal

## Why

Fase 3 de 3 da retirada de dados de negócio do código (fases 1 e 2: `move-business-data-1-read-from-api` e `move-business-data-2-existing-admin-pages`). Estes dados não cabem em nenhuma página atual do painel:

- **Parâmetros nutricionais.** Os fatores de energia e os grupos de raça do cálculo estão fixos em `src/core/nutrition-recommendation.js`. Os limites de fase da vida e as raças gigantes já estão no banco (`life_stage_size_classes`, `life_stage_breeds`), mas sem tela. Hoje a veterinária depende de deploy para ajustar qualquer um deles.
- **Dados da empresa.** Estão em três lugares que podem divergir: `invoice-copy.js` (fixo), `email/html.js` (fixo) e as variáveis `MAIL_COMPANY_*` do ambiente.
- **Documentos legais.** O texto fica nos `.md` da loja, e a versão aparece em duas constantes, uma na loja e outra na API.
- **E-mails automáticos.** Ligar, desligar ou limitar os avisos de fase da vida exige editar o `.env` e reiniciar a API.

Ao olhar o código de perto, a "lista de raças gigantes duplicada" da análise inicial são, na verdade, **duas regras diferentes da veterinária**. Uma é o porte gigante usado para a fase da vida (cerca de 45 raças, aprovada em 2026-10-18). A outra é o grupo energético do cálculo de kcal (grupo Dogue com fator 200, metabolismo lento com 95, Terra-nova com 105), com 9 raças. Este change não junta as duas listas: põe as duas na mesma tela, lado a lado, para a veterinária decidir.

## What Changes

- **Novo item "Parâmetros nutricionais" (grupo Ferramentas do painel).**
  - Abas: Fases da vida (meses de adulto e sênior por porte e mercado), Raças (porte e grupo energético) e Fatores (todos os números do cálculo).
  - Os fatores e os grupos energéticos passam a ser um conjunto versionado no banco. Publicar cria uma versão nova, e a recomendação registra qual versão usou. O Simulador pode rodar com um rascunho antes da publicação.
  - Mudar um limite de fase mostra antes quantos pets mudariam de fase.
  - A semente é idêntica aos valores atuais.
  - Permissão nova `nutrition.settings.write` para veterinária e admin.
- **Novo item "Configurações" (grupo Administração do painel), com três abas.**
  - **Empresa:** razão social, CNPJ/EIN, endereço, e-mail de suporte e URL da loja, por mercado. A fatura e os e-mails passam a ler daí. Cada fatura guarda uma cópia do emissor quando recebe o número, então refazer o PDF de uma fatura antiga mantém o emissor original. O texto impresso não muda com a semente.
  - **Documentos legais:** versão e texto da política de privacidade e dos termos de uso, por mercado. Publicar cria uma versão nova; uma versão publicada não é editada. Uma rota pública serve a versão vigente à loja, e o consentimento grava a versão que o cliente viu.
  - **E-mails automáticos:** ligar ou desligar o e-mail de mudança de fase por mercado, e o tamanho do lote e o limite diário dos anúncios.
- **BREAKING** (ambiente): `MAIL_COMPANY_*`, `LIFE_STAGE_CHANGE_EMAIL_ENABLED_*` e `LIFE_STAGE_ANNOUNCEMENT_*` deixam de ser lidas depois da migração, que copia os valores vigentes para o banco.

## Capabilities

### New Capabilities

- `nutrition-parameters`: fatores, grupos energéticos de raça e limites de fase da vida editáveis e versionados, com prévia de impacto.
- `company-profile`: dados da empresa por mercado usados pela fatura e pelos e-mails, com cópia na fatura emitida.
- `legal-documents`: versões publicadas da política e dos termos por mercado, servidas à loja e usadas no consentimento.
- `automated-email-settings`: chaves e limites dos e-mails automáticos de fase da vida editados no painel.

### Modified Capabilities

- `transactional-email-layout`: o e-mail de suporte do rodapé passa a vir dos dados da empresa do mercado, em vez de fixo.

## Impact

- API: migrações novas (`nutrition_parameter_sets`, `company_profiles`, `issuer_snapshot` em `customer_invoices`, `legal_documents`, `automated_email_settings`); `src/core/nutrition-recommendation.js`, `src/core/admin-roles.js`, `src/core/invoice/invoice-copy.js`, `src/core/invoice/invoice-document.js`, `src/services/customer-invoices.service.js`, `src/core/email/html.js`, `src/core/email/company-address.js`, `src/services/life-stage-announcement.service.js`, `src/services/life-stage-change-email.service.js`, `src/services/privacy.service.js`, `src/core/legal-documents.js`, `src/config/env.js`, `.env*.example`; rotas admin e públicas novas (`npm run routes:manifest`).
- Fatura: o layout aprovado não muda. O emissor sai dos dados da empresa com a mesma composição de texto de hoje (ver skill `eden-invoice`).
- Change irmão no painel (mesmo nome): duas páginas novas, os itens de menu e `roles.ts` com a permissão nova; `npm run contract:sync`.
- Change irmão na loja (mesmo nome): páginas legais e cadastro (`AuthModal`) leem a versão e o texto da API; saem `src/lib/legal/documentVersions.ts` e `src/content/*/legal/*.md`.
