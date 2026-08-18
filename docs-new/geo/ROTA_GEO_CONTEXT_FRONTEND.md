# Rota geo context para o frontend (consumo no Node)

## Endpoint

Alvo no backend Node:

```http
GET /api/v1/geo/context
```

Local: `http://localhost:3000/api/v1/geo/context`

Em QA, depois do proxy apontar para o Express: a rota REST continua `/api/v1/geo/context`. O prefixo `/qa-api` (se existir) e rewrite, nao parte do path Express.

Hoje o front ainda chama o WordPress:

```text
GET {VITE_API_BASE_URL}/custom/v1/geo/context
```

Arquivo: `eden-bowls/src/lib/geo/backendGeo.ts`.

A rota **ainda nao existe** no Node. Com `VITE_API_BASE_URL=http://localhost:3000` e `VITE_GEO_SIM_FORCE_ENABLED` diferente de `true`, o `fetch` falha e o `GeoProvider` cai no fallback.

## Objetivo

Devolver dominio + pais + IP para o `GeoProvider`. A tela `/plan` nao chama a URL direto: le `useGeoContext().geoState`.

Mudanca de contrato em relacao ao WP: **so o path**. Body, headers obrigatorios e JSON de sucesso permanecem iguais, de proposito, para `backendGeo.ts` continuar normalizando do mesmo jeito.

## Requisitos de autenticacao

Rota publica. Nao envie token, `x-session-token` nem cookie.

O CORS do Node (`src/app.js`) ja aceita `Origin` nas origens de `CORS_ORIGINS` (default `http://localhost:5173`).

## Request

Sem body e sem query params.

Headers uteis (opcionais; o Node usa para detectar dominio):

- `Origin` — o browser envia em CORS
- `Referer`
- `X-Forwarded-Host` — so em proxy

O front continua enviando so:

```http
Accept: application/json
```

Nao enviar `X-Eden-Country` / `X-Eden-Domain` nesta rota. Esses headers sao para snapshot/recommendation/products **depois** que o geo ja rodou. Envia-los aqui nao deve alterar a deteccao (a rota ignora mercado declarado pelo cliente).

## Resposta de sucesso

```json
{
  "success": true,
  "data": {
    "domain": "com",
    "country": "US",
    "ip": "8.8.8.8",
    "region": null,
    "source": "backend",
    "presetId": null
  }
}
```

| Campo | Valores | Uso na tela de plano |
|---|---|---|
| `domain` | `com` ou `com.br` | **e o que o plano usa** para pais/moeda/catalogo |
| `country` | `US`, `BR`, `OTHER`, `UNKNOWN` | modal/redirect de regiao; nao define mercado do plano |
| `ip` | string, pode ser vazia | diagnostico |
| `region` | sempre `null` | nao implementado |
| `source` | sempre `backend` | o front tambem forca `backend` |
| `presetId` | sempre `null` | so existe em simulacao local |

HTTP de erro proprio da rota: so `503` se o service nao estiver wired. Falha de MaxMind vira `country: "UNKNOWN"` com HTTP 200.

Se `response.ok === false`, `fetchBackendGeoState` lanca e o `GeoProvider` aplica:

```ts
FALLBACK_GEO_STATE = {
  domain: 'com',
  country: 'UNKNOWN',
  ip: null,
  region: null,
  source: 'fallback',
  presetId: null,
}
```

A tela de plano assume mercado US.

## O que muda no frontend na migracao

### 1. Path em `backendGeo.ts`

De:

```ts
`${resolveApiBaseUrl()}/custom/v1/geo/context`
```

Para:

```ts
`${resolveApiBaseUrl()}/api/v1/geo/context`
```

`resolveApiBaseUrl()` ja tira a barra final de `VITE_API_BASE_URL`.

### 2. Base URL

Apontar `VITE_API_BASE_URL` para o Node (`http://localhost:3000` no dev), nao para a base `/wp-json` do WordPress.

Se o app ainda misturar WP e Node, geo precisa da base **Node**. Nao concatenar `/wp-json` neste fetch.

### 3. Simulacao local

Se `VITE_GEO_SIM_FORCE_ENABLED=true`, o `GeoProvider` usa `SimulatedGeoSource` e **nao chama** a rota. Estado vem de `localStorage['eden:geo-sim']`.

Para exercitar o Node de verdade: desligar essa flag.

### 4. Mock E2E

Ajustar `eden-bowls/e2e/helpers/mockApi.ts` de `/custom/v1/geo/context` para `/api/v1/geo/context`, mantendo o payload `{ domain: 'com', country: 'US', ... }`.

### 5. Normalizacao (permanece)

`backendGeo.ts` ja faz:

- `domain` diferente de `com.br` → `com`
- `country` fora de `US|BR|OTHER|UNKNOWN` → `UNKNOWN`
- `ip` / `region` ausentes → `null`
- forca `source: 'backend'`, `presetId: null`

Nao precisa mudar essa camada se o Node devolver o mesmo JSON.

## Regras usadas pela tela `/plan` (inalteradas)

1. `localeCountry = geoState.domain === 'com.br' ? 'BR' : 'US'`.
2. Moeda: BR → `BRL`, senao `USD`.
3. Catalogo: `fetchFlavorProducts(localeCountry)` (Node `GET /api/v1/products`).
4. Consumo fallback: BR em g/kg, US em oz.
5. i18n: `com.br` → pt-BR, senao en-US.
6. Pais MaxMind (`geoState.country`) **nao** escolhe o mercado do plano; so alimenta auto-redirect/modal de regiao.

Redirect continua no front (`features/region-experience`). O Node **nao** implementa `/geo/redirect`.

Com `geoState` resolvido e sem `eden:region-preference`:

- `.com` + pais `BR` → `https://www.edenbowls.com.br` + path atual
- `.com.br` + pais `US` → `https://www.edenbowls.com` + path atual
- `.com` + `US` ou `.com.br` + `BR` → permanece
- `OTHER` ou `UNKNOWN` → `RegionModal`

## Exemplo de uso no frontend

```ts
const response = await fetch(`${apiBase}/api/v1/geo/context`, {
  method: 'GET',
  headers: { Accept: 'application/json' },
})

const json = await response.json()
// json.data.domain, json.data.country, json.data.ip
```

Cadeia real:

`backendGeo.ts` → `GeoContext.tsx` → `Plan.tsx` / i18n / `region-experience`.

Depois, o mesmo `domain` vira header nas rotas Node de plano:

```http
X-Eden-Domain: com.br
X-Eden-Country: BR
```

Esses headers sao lidos por `parseRequestMarket` em snapshot, recommendation, etc. — nao por `/geo/context`.

## Arquivos do fluxo

| Papel | Arquivo |
|---|---|
| Chamada HTTP | `eden-bowls/src/lib/geo/backendGeo.ts` |
| Estado global | `eden-bowls/src/contexts/GeoContext.tsx` |
| Tipos | `eden-bowls/src/types/geo.ts` |
| Fallback / simulacao | `eden-bowls/src/config/geo.ts` |
| Tela de plano | `eden-bowls/src/pages/plan/Plan.tsx` |
| Mock E2E | `eden-bowls/e2e/helpers/mockApi.ts` |
| Rota Node (a implementar) | `eden-bowls-backend/src/api/routes/geo.routes.js` |

Documentacao da aplicacao no Express: [APLICACAO_GEO_CONTEXT.md](./APLICACAO_GEO_CONTEXT.md).
Contrato da rota: [ROTA_GEO_CONTEXT.md](./ROTA_GEO_CONTEXT.md).
