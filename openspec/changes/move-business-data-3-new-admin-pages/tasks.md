# Tasks

Fase 3 de 3. Depende das fases 1 e 2 aplicadas. Este change cobre a API e sai antes dos changes irmãos de mesmo nome no painel e na loja. Use o próximo número livre de migração e registre cada uma em `src/infrastructure/db.js`. Rode só os testes relacionados (`npx jest tests/<arquivo>`).

## 1. Permissões

- [ ] 1.1 Acrescentar `nutrition.settings.write`, `settings.read`, `settings.company.write`, `settings.email.write` e `legal.write` em `src/core/admin-roles.js`, com os papéis da decisão 4. Verificar com `tests/admin-roles.test.js`: cada papel tem exatamente as permissões novas previstas, e o veterinário não ganha `catalog.*` nem `settings.*`.

## 2. Parâmetros nutricionais

- [ ] 2.1 Fazer `nutrition-recommendation.js` receber `parameters` (todos os números e os três grupos de raça), com os valores atuais como padrão, sem mudar a ordem das regras (decisão 1). Verificar com `tests/nutrition-recommendation.test.js`: todos os testes atuais passam sem `parameters`, e um teste com `breed_groups.dogue` alterado muda só o fator do grupo.
- [ ] 2.2 Criar a migração de `nutrition_parameter_sets` com o primeiro conjunto publicado igual aos valores atuais, e o repositório com o publicado em `TtlCache` de 60 s. Verificar com `tests/nutrition-parameter-sets.migration.test.js` e `tests/nutrition-parameter-sets.repository.test.js`: o conjunto semeado é igual ao padrão do 2.1, e `down` remove a tabela.
- [ ] 2.3 Criar o serviço com rascunho único, validação (fatores de 1 a 400, NEM de 1000 a 8000, raça em no máximo um grupo, 422 `nutrition_parameters_invalid`), publicação em transação e auditoria `nutrition.parameters.publish` (decisão 2). Verificar com `tests/nutrition-parameters.service.test.js`: os cenários "Breed in two groups" e a publicação que aposenta o conjunto anterior.
- [ ] 2.4 Criar as rotas admin (ler o publicado e o histórico com `nutrition.simulate`; salvar e publicar o rascunho com `nutrition.settings.write`), aceitar `parameter_set: "draft"` no simulate e rodar `npm run routes:manifest`. Verificar com um teste de rotas novo e `tests/admin-nutrition.service.test.js`: os cenários "Simulate with a draft" e "Operator cannot publish", e com `tests/api-routes-manifest.test.js`.
- [ ] 2.5 Gravar `nutrition_parameter_set_id` com a recomendação do onboarding (migração de coluna e repositório). Verificar com `tests/onboarding-recommendation.repository.test.js`: o cenário "Recommendation records its version" e o cenário "Same result after deploy" sobre as entradas de `tests/nutrition-recommendation.test.js`.

## 3. Limites de fase da vida

- [ ] 3.1 Acrescentar ao repositório de limites a gravação de `life_stage_size_classes` e de `life_stage_breeds` (porte, inclusão, desativação) e, ao serviço, a validação (sênior maior que adulto, 1 a 240) e a auditoria `life_stage.limits.update` / `life_stage.breed.update`. Verificar com `tests/life-stage-limits.repository.test.js` e um teste de serviço: o cenário "Invalid limits".
- [ ] 3.2 Criar a prévia, que recalcula a fase dos pets com assinatura ativa do mercado com os limites propostos e devolve a contagem por transição sem gravar (decisão 3), e as rotas admin com `nutrition.settings.write`; rodar `npm run routes:manifest`. Verificar com `RUN_DB_INTEGRATION_TESTS=true npx jest tests/integration/life-stage-limits.integration.test.js`: o cenário "Preview before lowering the senior age" e as tabelas inalteradas depois da prévia.

## 4. Dados da empresa

- [ ] 4.1 Criar a migração de `company_profiles` com a semente de BR e US e a migração de `issuer_snapshot` em `customer_invoices`, preenchido nas faturas existentes com a semente (decisão 5). Verificar com testes de migração novos: os dois perfis semeados, o snapshot preenchido em todas as linhas, e `down` remove.
- [ ] 4.2 Criar repositório, serviço e rotas do perfil (`settings.read` / `settings.company.write`, validação do CNPJ com dígitos, store URL https, 422 `company_profile_invalid`, auditoria `settings.company.update`) e rodar `npm run routes:manifest`. Verificar com testes de serviço e de rotas novos: os cenários "Operator reads but cannot save" e "Invalid CNPJ".
- [ ] 4.3 Trocar `INVOICE_ISSUERS` por `issuerFor(locale, profile)` em `invoice-copy.js`, gravar o snapshot quando a fatura recebe o número e fazer `invoice-document.js` ler só o snapshot, seguindo a skill `eden-invoice`. Verificar com `tests/invoice-document.test.js` (o cenário "Invoice text unchanged after deploy", com as strings aprovadas) e `tests/customer-invoices.service.test.js` (os cenários "City change reaches new invoices" e "Reissue after a profile change"). Rodar `npm run invoice:previews -- /tmp/invoice-previews` e comparar com o PDF aprovado.
- [ ] 4.4 Fazer `company-address.js` e `BRAND.support` lerem o perfil do mercado da carta (US para cartas sem mercado) e remover `MAIL_COMPANY_*` de `env.js` e dos `.env*.example`. Verificar com `tests/company-address.test.js` e `tests/email-templates.test.js`: o cenário "Support email follows the market profile" e o rodapé atual igual com a semente.
- [ ] 4.5 Atualizar a skill `.claude/skills/eden-invoice/SKILL.md`: o emissor vem de `company_profiles`, e cada fatura guarda `issuer_snapshot`. Verificar lendo a tabela "Where everything lives" e a armadilha final da skill, que não podem mais dizer que o emissor é fixo em `invoice-copy.js`.

## 5. Documentos legais

- [ ] 5.1 Criar a migração de `legal_documents` com `helpers/seed-legal-documents.js` (os quatro `.md` atuais da loja, versão `2026-09-13`) (decisão 6). Verificar com um teste de migração novo: quatro linhas, corpo igual ao arquivo de origem, rodar de novo não duplica.
- [ ] 5.2 Criar repositório e serviço com publicação imutável (`legal.write`, 409 `legal_version_taken`, auditoria `legal.document.publish`), as rotas admin e a rota pública `GET /api/v1/legal/:kind?market=`, e rodar `npm run routes:manifest`. Verificar com testes de serviço e de rotas novos: os cenários "Publish new terms in US", "Version id already used" e "Store reads the BR privacy policy", 404 para tipo desconhecido e 400 `invalid_market`.
- [ ] 5.3 Trocar as constantes de `legal-documents.js` por `currentVersion(market, kind)` em `privacy.service.js`: grava a versão enviada quando publicada no mercado; senão, grava a vigente e registra aviso. Verificar com `tests/privacy.service.test.js` e `tests/auth.service.test.js`: os cenários "Customer accepts the version shown" e "Stale client sends an unknown version".

## 6. E-mails automáticos

- [ ] 6.1 Criar a migração de `automated_email_settings`, semeada a partir de `process.env` com os padrões de `env.js` (decisão 7). Verificar com um teste de migração novo: o cenário "Values after deploy" com um ambiente simulado.
- [ ] 6.2 Criar repositório, serviço e rotas (`settings.read` / `settings.email.write`, limites, 422, auditoria `settings.email.update`) e rodar `npm run routes:manifest`. Verificar com testes de serviço e de rotas novos: o cenário "Cap lower than batch".
- [ ] 6.3 Fazer `life-stage-change-email.service.js` e `life-stage-announcement.service.js` lerem a linha do mercado no início de cada execução, e remover as variáveis de `env.js`, `src/index.js` e dos `.env*.example`. Verificar com `tests/life-stage-change-email.test.js`, `tests/life-stage-announcement.test.js` e `tests/life-stage-announcement-run.test.js`: o cenário "Pause without restart".

## 7. Integração

- [ ] 7.1 Na base local com todas as migrações, conferir que nada visível mudou: as prévias da fatura batem com o PDF aprovado, as prévias de e-mail mostram o mesmo rodapé, uma simulação de cada teste de nutrição dá o mesmo resultado, e `GET /api/v1/legal/terms?market=BR` devolve o texto atual da loja. Registrar o resultado no PR.
