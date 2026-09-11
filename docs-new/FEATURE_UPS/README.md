# FEATURE_UPS — Frete Estados Unidos (UPS)

Documentação da integração UPS para o mercado US: cotação (Rating), etiqueta (Shipping) e rastreio (Tracking).

## Índice

| Arquivo | Conteúdo |
|---------|----------|
| [plano-desenvolvimento.md](./plano-desenvolvimento.md) | Plano técnico completo: arquitetura, arquivos, ordem de implementação |
| [decisoes-travadas.md](./decisoes-travadas.md) | Decisões já fechadas para a 1ª entrega |
| [gates-e-pontos-em-aberto.md](./gates-e-pontos-em-aberto.md) | Gates de negócio, riscos e o que ainda depende do cliente/UPS |
| [fora-desta-entrega.md](./fora-desta-entrega.md) | Escopo explicitamente fora da v1 |

## Resumo

- **Hoje (código):** suporte a `quote_mode` US `fixed` | `ups`, Rating no `POST /shipping/v1/calculate`, etiquetas em `ups_shipments` + storage local, tracking no `billing_history` / PlanDetail, config no admin Shipping e fulfillment no SubscriptionDetail.
- **Default operacional:** permanece `quote_mode=fixed` até credenciais UPS + gate de dry ice.
- **Repos:** `eden-bowls-backend`, loja `eden-bowls`, painel `eden-bowls-admin`.

## Status da implementação

Código da 1ª entrega aterrissado nos três repos. Go-live com `quote_mode=ups` ainda depende dos [gates](./gates-e-pontos-em-aberto.md) (dry ice, conta UPS, CIE vs produção).

## Links UPS

- Catálogo / portal: https://developer.ups.com/catalog?loc=pt_BR
- CIE (sandbox): `https://wwwcie.ups.com`
- Produção: `https://onlinetools.ups.com`
