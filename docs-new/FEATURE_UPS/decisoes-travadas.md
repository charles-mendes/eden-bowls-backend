# Decisões travadas (v1)

Estas decisões estão fechadas para a primeira entrega. Não reabrir no meio da implementação sem acordo explícito.

## Escopo e UX

| Decisão | Valor |
|---------|--------|
| APIs UPS na v1 | Rating + Shipping (etiqueta) + Tracking |
| Opções no checkout US | **Uma** opção só |
| Qual serviço | Preferir Ground (`03`); se ausente, mais barata entre `allowed_service_codes` |
| Service codes no código | **Não** hardcoded — lista editável no admin |
| Quando gerar etiqueta | No **admin**, por invoice pago — **não** no checkout |
| Multi-opção no checkout | Fora — ver [fora-desta-entrega.md](./fora-desta-entrega.md) |

## Segurança e config

| Decisão | Valor |
|---------|--------|
| Client ID / Secret / Account | Somente **env** (`UPS_*`) |
| Admin edita | ship-from, package, `allowed_service_codes`, `quote_mode`, fallback, cost fixo |
| `quote_mode` inicial | Manter `'fixed'` até credenciais + gate dry ice; depois `'ups'` |

## Resiliência

| Decisão | Valor |
|---------|--------|
| Timeout HTTP UPS | Default **5000 ms** (`UPS_HTTP_TIMEOUT_MS`) |
| Falha ou timeout no Rating | Se `fallback_enabled`, usar `us.cost` fixo (`source: 'fallback'`) |
| Objetivo do fallback | Não travar venda no checkout |

## Etiqueta e storage

| Decisão | Valor |
|---------|--------|
| Formato no DB | `label_path` (arquivo em disco) |
| Storage | Local (padrão `LocalAvatarStorage`) — diretório **privado** |
| base64 na tabela | **Não** |
| S3 / blob cloud | **Não** nesta entrega |
| Idempotência | Um shipment ativo por `stripe_invoice_id`; retry não cria segunda etiqueta UPS |

## Endereço e pacote

| Decisão | Valor |
|---------|--------|
| PO Box US | **Rejeitar** no checkout, edit subscription e createShipment |
| Address Validation API UPS completa | Fora da v1 (só guard PO Box) |
| Peso / dimensão | Fixos nos settings admin (defaults operacionais) |
| Peso dinâmico por bowls/packs | Fora da v1 |

## Cobrança vs custo UPS

| Decisão | Valor |
|---------|--------|
| O que o cliente paga | `shipping.cost` cotado no checkout/edit (Stripe) |
| O que a empresa paga à UPS | Tarifa na geração da etiqueta (pode diferir) |
| Reajustar Stripe automaticamente | **Não** na v1 |
| Visibilidade no admin | Opcional: mostrar quoted vs `ups_monetary_value` |

## Ambientes

| Decisão | Valor |
|---------|--------|
| Dev / QA integração | CIE (`wwwcie.ups.com`) |
| Produção | `onlinetools.ups.com` após aprovação do app |
| Preços no CIE | Fictícios — **não** usar para validar margem real |

## Limpeza

| Decisão | Valor |
|---------|--------|
| `data/shipping-settings.json` | Remover ou marcar DEPRECATED (não é runtime) |
