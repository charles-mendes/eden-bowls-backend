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

**Resposta da UPS (cliente por telefone, 2026-11-09):**

- Ground (`03`) aceita gelo seco. `allowed_service_codes: ['03']` continua correto.
- O gelo seco precisa ser declarado no envio como Dry Ice / Carbon Dioxide, Solid — UN1845, com a marcação e o processamento que a UPS exige.

- Quantidade: **500 g (0,5 kg) de gelo seco por caixa**, qualquer que seja o tamanho da caixa (especificação Eden Bowls, 2026-11-09). Fica abaixo do limite de 2,5 kg por pacote a partir do qual a UPS exige contrato de Hazardous Materials e documentos de envio no aéreo doméstico. Esse valor é o padrão da configuração no admin.

- Conta UPS: **não precisa** de habilitação Dangerous Goods/Hazmat. Envio doméstico (origem Boca Raton, FL) de produto não perigoso, com gelo seco usado só como refrigerante, é isento do contrato de Dangerous Goods. A declaração continua obrigatória e precisa ser feita por sistema aprovado pela UPS (API, WorldShip, CampusShip).
- Taxa: o Rate & Service Guide UPS 2026 (atualizado em 17/04/2026) publica **US$ 8,55 por pacote com Dry Ice**. A UPS também diz que o Ground entre os 48 estados contíguos não é regulado para gelo seco, então ainda não se sabe se essa taxa é cobrada no Ground. A Rating API aceita `PackageServiceOptions.DryIce` (`RegulationSet: CFR`, `DryIceWeight` com `UnitOfMeasurement`). Com a declaração, a cotação já traz a taxa, se houver.

**Ainda em aberto:**

- Se os US$ 8,55 são cobrados no Ground. O CIE devolve valores fictícios (ver item 8), então isso só se confirma com um envio de teste controlado em produção, comparando a cotação com a fatura UPS.

**No código (change `ups-dry-ice-declaration`):** a etiqueta e as duas cotações (checkout e simulação do admin) declaram o gelo seco do pacote como UN1845. O bloco é `Package.PackageServiceOptions.DryIce`, com `RegulationSet: 'CFR'` e `DryIceWeight` em kg (código `00`, uma casa decimal). Não vai `MedicalUseIndicator`. O peso vem da configuração `package.dry_ice_kg` em `shipping_us_settings` (coluna `package_dry_ice_kg`): 0,5 kg no deploy, editável no admin de 0,1 a 2,5 kg e nunca maior que o peso do pacote (422 `invalid_dry_ice_kg`). O formato foi conferido no OpenAPI oficial da UPS (`UPS-API/api-documentation`, `Shipping.yaml` e `Rating.yaml`).

**Antes de fechar o gate:** testar no CIE a simulação, uma cotação no formato do checkout (CEP real com a cidade fictícia `City` / `NY` que o checkout manda) e uma etiqueta. A UPS faz checagem de rota (lane check) do gelo seco por CEP e cidade. Se recusar só a cotação do checkout, o checkout precisa passar a mandar cidade e estado reais.

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

**Feito (2026-10-26):** arquivo removido no change `move-business-data-1-read-from-api`. As configurações de frete vêm só de `shipping_br_settings` / `shipping_us_settings`.

---

## 10. Instruções de entrega na etiqueta UPS — ABERTO (teste manual em CIE)

Change `checkout-delivery-instructions`. O cliente escreve instruções de entrega no checkout (BR e US). No Brasil o entregador lê na fila do painel. Nos EUA a etiqueta **não** leva o texto; a fila de etiquetas mostra para quem embala.

**Conferido no schema oficial** (`UPS-API/api-documentation`, `Shipping.yaml`, endpoint `/api/shipments/v2409/ship`, 2026-11-13):

| Campo | O que o schema diz | Serve para instrução ao motorista? |
|---|---|---|
| `ShipTo` | `Name`, `AttentionName`, `Phone`, `FaxNumber`, `EMailAddress`, `Address`, `LocationID`, `TaxIdentificationNumber`. Nenhum campo de instrução. | Não existe |
| `LabelSpecification.Instruction` | Código `01`/`02` de "EXCHANGE-LIKE ITEM ONLY" / "EXCHANGE-DRIVER INSTRUCTIONS INSIDE". | Só envio de troca |
| `PackageServiceOptions.HandlingInstructions` | Instrução de manuseio do UPS Premier. | Só UPS Premier (saúde) |
| `Package.ReferenceNumber` | Até 5 por pacote, `Value` com até 35 caracteres, válido em US/US. Texto do remetente, sai na etiqueta. | Possível, mas é referência do remetente |
| `ShipTo.Phone.Number` | Obrigatório só em Next Day Air Early e envio internacional. Nos EUA: código de área + 7 dígitos (10 dígitos), com ramal opcional de 4. | — |

**Decisão desta change:** enviar só `ShipTo.Phone` (endereço da assinatura, depois `billing_phone` da conta, normalizado para 10 dígitos; sem número válido, nada é enviado). O texto da instrução não vai para a UPS.

**Teste manual em CIE (pessoa com acesso, a IA não tem):**

1. Comprar uma etiqueta Ground US/US com `Package.ReferenceNumber: [{ Value: "LEAVE AT BACK DOOR" }]`.
2. Ver se o texto sai na etiqueta GIF e onde. Repetir com 35 caracteres e com acento ("PORTÃO") para ver o que a UPS faz.
3. Comprar uma etiqueta com `ShipTo.Phone.Number` de 10 dígitos e confirmar que não há aviso.

Se o texto sair legível, abrir uma change separada para mandar a instrução em ASCII, cortada em 35 caracteres. Mesmo assim, o motorista não tem obrigação de ler a referência; o aviso do checkout dos EUA continua.

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
