# Gates e pontos em aberto

Pontos levantados na revisão do plano (incl. feedback externo) que **fazem sentido no projeto**, mas não são só “código”: dependem de negócio, cliente ou UPS.

Status:

- **GATE** — bloqueia go-live em produção com `quote_mode=ups` até resolver.
- **ACEITO v1** — risco consciente; documentado; não bloqueia implementação CIE.
- **ABERTO** — precisa confirmação do cliente/ops antes ou durante o go-live.

---

## 1. Gelo seco / produto congelado × UPS Ground — GATE

**Por que importa:** o produto Eden Bowls é frozen (terms). UPS pode exigir serviço/embalagem especial (dry ice). Se Ground (`03`) não for elegível, o default `allowed_service_codes: ['03']` está errado para produção.

**Evidência no projeto:** copy legal fala em refeições frozen; zero regra dry ice / hazmat no código.

**O que fazer:**

1. Cliente confirma com UPS / representante comercial: Ground serve? Precisa dry ice declaration? Outro service code?
2. Ops ajusta `allowed_service_codes` no admin **antes** de ligar `quote_mode=ups` em produção.
3. Código já prevê lista editável — não precisa redeploy para trocar serviço.

**Não fazer:** ir live só com Ground “no chute”.

---

## 2. Gap cotação (checkout) × custo real (etiqueta) — ACEITO v1

**Por que importa:** assinatura é recorrente. Cliente é cobrado no Stripe com o `shipping.cost` do select (onboarding/edit). Etiqueta UPS pode ser gerada dias/meses depois, com tarifa diferente. A empresa absorve a diferença.

**Evidência no projeto:** `stripe-billing-client.js` usa `shipping.cost` em `add_invoice_items` na criação da subscription; não há re-cotação automática em renewal ligada à UPS.

**Decisão v1:** aceitar o risco de margem. Sem alterar cobrança Stripe na geração da etiqueta.

**Mitigações leves (podem entrar na UI admin):**

- Exibir `quoted_shipping_cost` vs `ups_monetary_value` no detalhe do shipment.
- Ops monitora divergências e ajusta `package` / serviços / fallback cost se necessário.

**Futuro (fora da v1):** re-cotar na renewal e/ou na etiqueta e atualizar preço cobrado — ver [fora-desta-entrega.md](./fora-desta-entrega.md).

**Ação com o cliente:** aceite explícito desse modelo de margem.

---

## 3. PO Box — resolvido na v1 (implementar)

UPS Ground não entrega em caixa postal. Hoje o checkout **não** valida PO Box.

**Ação de desenvolvimento (não é gate de negócio):**

- Regex / detecção em line1/line2 US.
- Bloquear no checkout e EditSubscription.
- Rejeitar no `createShipment`.

Detalhe no [plano-desenvolvimento.md](./plano-desenvolvimento.md).

---

## 4. Idempotência na criação de etiqueta — resolvido na v1 (implementar)

Unique no DB não cobre: UPS Shipping OK → crash antes de gravar → retry cria segunda etiqueta real.

**Ação de desenvolvimento:** fluxo idempotente (check ativo → pending/lock → UPS → persist; recovery por `ups_shipment_id`). Ver plano.

---

## 5. Peso / dimensão fixos — ACEITO v1

Pedidos com mais/menos bowls podem ter peso real diferente do default. Cotar sempre igual pode errar para mais ou para menos.

**Decisão v1:** package fixo no admin. Ops deve calibrar para o **maior** pacote típico (mais seguro para margem do que subestimar).

**Futuro:** peso derivado de packs/plan — fora da v1.

---

## 6. Label storage (path vs base64) — DECIDIDO

- **Usar:** arquivo em disco + `label_path` no DB (`LocalLabelStorage`).
- **Não usar:** base64 na tabela; S3 nesta entrega (projeto não tem S3 hoje; avatars já são locais).

---

## 7. Timeout Rating no checkout — resolvido na v1 (implementar)

Fallback cobre falha total; UPS lenta sem timeout trava o checkout.

**Ação:** `UPS_HTTP_TIMEOUT_MS` default 5000 → trata como falha → fallback se habilitado.

---

## 8. CIE não reflete preço real — ABERTO (QA)

Sandbox UPS costuma devolver valores fictícios.

**Ação:**

- Documentar para QA: não “bater” preço CIE com produção.
- Validação de margem / tarifa negociada só com app em produção + conta shipper real.

---

## 9. `data/shipping-settings.json` órfão — resolvido na v1 (implementar)

Arquivo existe mas runtime usa MySQL + defaults em código.

**Ação:** remover ou marcar DEPRECATED nesta feature para não confundir o próximo dev.

---

## Checklist antes de `quote_mode=ups` em produção

- [ ] Conta UPS do cliente + Account Number no env de produção
- [ ] App UPS aprovado para produção (Rating, Shipping, Tracking)
- [ ] Client ID/Secret de produção no env
- [ ] ship-from (warehouse) preenchido no admin
- [ ] package dims/weight calibrados
- [ ] **Confirmação dry ice / serviço permitido** → `allowed_service_codes` ajustado
- [ ] Aceite do risco de margem cotação × etiqueta
- [ ] Teste ponta a ponta em CIE (fluxo técnico)
- [ ] Teste de tarifa real em produção com envio de teste controlado
- [ ] PO Box guard e fallback cobertos por teste
