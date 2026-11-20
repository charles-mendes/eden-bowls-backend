# Fora desta entrega (v1)

Escopo explicitamente **não** incluído. Evita scope creep durante a implementação.

| Item | Motivo de ficar fora |
|------|----------------------|
| Multi-opção de serviço no checkout (Ground + 2nd Day + …) | UX da v1 é uma opção só |
| Etiqueta automática no webhook `invoice.paid` | Operação manual no admin primeiro; menos risco |
| Re-cotação UPS que **altera** cobrança Stripe em renewals | Decisão de margem da v1: cliente paga cotação do select |
| Peso/dimensão dinâmicos por quantidade de bowls/packs | Calibrar package fixo no admin na v1 |
| UPS Address Validation API completa | Só guard PO Box na v1 |
| S3 / cloud blob para labels | Projeto usa storage local hoje |
| Integração FedEx API | Substituição é UPS; FedEx era só label do frete fixo |
| Mudança do frete BR (distance) | BR permanece como está |
| Página de Orders dedicada no admin | Reusar `SubscriptionDetailPage` + invoices |
| Tracking push / webhooks UPS | Poll/refresh sob demanda no admin + snapshot no billing_history |

Quando algum item acima virar prioridade, abrir feature/doc nova (ou seção “v2” nesta pasta) em vez de misturar na v1.
