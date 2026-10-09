# Products Flavors Migration Notes (WordPress -> Node)

## 1. Dependencias WordPress identificadas

## 1.1 WooCommerce
- Tipo de post product.
- Produtos variaveis e variacoes (WC_Product_Variable / WC_Product_Variation).
- Leitura de atributos de variacao para flavor e weight.

## 1.2 Taxonomias
- product_cat para filtro category_slug.
- product_tag para composicao de tags no payload.
- Possivel uso de pa_* para resolver nomes de atributos de variacao.

## 1.3 Campos personalizados (post meta)
- _cmpb_plan_country
- _cmpb_plan_days
- _stripe_product_id
- _stripe_price_id
- _stripe_price_ids_by_currency
- _{zoneId}_regular_price
- _{zoneId}_sale_price
- _{zoneId}_sale_price_dates
- _{zoneId}_sale_price_dates_from
- _{zoneId}_sale_price_dates_to

## 1.4 Plugins envolvidos
- custom-meal-plan-builder (registro da rota e regra principal).
- WooCommerce Price Based on Country (mapeamento de zona por moeda).
- pawbowl-stripe-billing (provisionamento/sincronizacao de metas Stripe).

## 1.5 Rate limit / infraestrutura WP
- Controle via transient por chave hash(scope|ip|user-agent).
- Armazenamento depende da infra: wp_options ou object cache.

## 1.6 Tabelas utilizadas (provaveis)
- wp_posts (produtos/variacoes)
- wp_postmeta (metas de plano, stripe, precos por zona)
- wp_terms
- wp_term_taxonomy
- wp_term_relationships
- wp_options (transients, quando sem object cache)

Necessario investigar:
- Prefixo real de tabelas por ambiente.
- Se existe cache distribuido (Redis/Memcached) alterando comportamento dos transients.

---

## 2. Pontos de atencao para migracao

## 2.1 Riscos funcionais
1. Divergencia de filtro de elegibilidade em flavors
- Se regra Stripe estrita nao for replicada, frontend pode listar itens impossiveis de vender.

2. Divergencia de precificacao
- A logica atual prioriza sale_price ativo por moeda/zona; erro aqui afeta valor final exibido.

3. Divergencia de normalizacao de atributos
- Flavor/weight sao inferidos por nomes de chaves; dados heterogeneos podem quebrar consistencia.

4. Divergencia de contrato de erro
- Clientes podem depender de codigos/mensagens/status especificos (422/404/429).

5. Rate limiting inconsistente
- Mudar algoritmo/chave pode abrir margem para abuso ou falso bloqueio.

## 2.2 Diferencas entre WordPress e Node.js
- WordPress trabalha com modelo EAV (postmeta) e taxonomias genericas.
- Node tende a usar schema explicito com relacionamentos bem definidos.
- WordPress possui funcoes de sanitizacao e utilitarios nativos; no Node isso deve ser explicitado.
- Integracoes de preco por pais em WP podem estar acopladas a plugin; no Node sera necessario desacoplar ou portar regras.

## 2.3 Informacoes que precisam ser investigadas
- Necessario investigar: fonte oficial do contrato (OpenAPI atualizada x comportamento real em runtime).
- Necessario investigar: cobertura de testes atuais para essa rota (casos positivos e negativos).
- Necessario investigar: volume de catalogo e impacto de performance para consulta sem cache WP.
- Necessario investigar: estrategia de invalidacao de cache quando preco/meta Stripe muda.
- Necessario investigar: como tratar produtos simples vs variaveis em todos os mercados.
- Necessario investigar: como mapear fielmente zonas de preco para politica de moeda no Node.

---

## 3. Checklist de readiness para iniciar implementacao futura

1. Congelar contrato de entrada/saida da rota (incluindo erros).
2. Extrair snapshot real de dados (produtos, variacoes, metas, tags, categorias).
3. Validar matriz country x currency com negocio.
4. Definir fonte de verdade de preco por moeda no ambiente Node.
5. Definir regra oficial para elegibilidade Stripe em flavors.
6. Definir estrategia de rate limit e observabilidade (logs/metricas/traces).
7. Aprovar plano de testes de regressao comparando Node x WordPress.

---

## 4. Fontes mapeadas no codigo atual (referencia)

- custom-meal-plan-builder.php
- includes/api-routes.php
- includes/meal-plan-service.php
- includes/product-config.php
- includes/wc-country-pricing.php
- includes/security.php
- pawbowl-stripe-billing/src/class-stripe-sync-service.php

Observacao:
- Esta documentacao foi elaborada a partir do comportamento observado no codigo atual, sem implementacao de rota em Node nesta etapa.