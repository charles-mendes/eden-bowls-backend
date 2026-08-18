# Rota geo context para o frontend

## Endpoint

GET /wp-json/custom/v1/geo/context

Em QA: `https://edenbowls.com/qa-api/wp-json/custom/v1/geo/context`

A rota ainda vive no WordPress (`headless-secure-registration`). O Node (`eden-bowls-backend`) **não** implementa equivalente.

## Objetivo

Devolver o contexto geográfico do visitante (domínio + país + IP) para o frontend decidir mercado, idioma, moeda e catálogo na tela `/plan`.

A tela de plano não chama a URL direto. `GeoProvider` dispara a request no mount do app e `Plan.tsx` lê `useGeoContext().geoState`.

## Requisitos de autenticação

Rota pública. `permission_callback` é `__return_true`.

Não envie token, `x-session-token` nem cookie WordPress. Os cookies do curl do browser são da sessão WP admin e são ignorados.

## Request

Sem body e sem query params.

Headers úteis (opcionais, mas usados para detectar domínio):

- `Origin`
- `Referer` (no curl de QA: `https://edenbowls.com/qa-app/plan`)
- `X-Forwarded-Host`

O frontend envia só:

```http
Accept: application/json
```

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
| `domain` | `com` ou `com.br` | **é o que o plano usa** para país/moeda/catálogo |
| `country` | `US`, `BR`, `OTHER`, `UNKNOWN` | modal/redirect de região; não define mercado do plano |
| `ip` | string, pode ser vazia | diagnóstico |
| `region` | sempre `null` | não implementado |
| `source` | sempre `backend` | o frontend também força `backend` |
| `presetId` | sempre `null` | só existe em simulação local |

HTTP de erro próprio da rota: não identificado. Falha de MaxMind vira `country: "UNKNOWN"` com HTTP 200.

## O que a rota precisa para funcionar

1. Plugin `headless-secure-registration` ativo.
2. REST do WP acessível (`/qa-api/wp-json` em QA).
3. Composer `maxmind-db/reader` carregado.
4. Arquivo `GeoLite2-Country.mmdb` no path `HSR_GEO_MAXMIND_DB_PATH` (default `/var/www/html/data/GeoLite2-Country.mmdb`).
5. IP público do cliente visível para o PHP (ou proxy headers se `HSR_GEO_TRUST_PROXY_HEADERS=true`).
6. Frontend com `VITE_API_BASE_URL` apontando para a base `/wp-json`, não para `http://localhost:3000`.
7. `VITE_GEO_SIM_FORCE_ENABLED` diferente de `true`. Se estiver `true`, o app **não chama** esta rota e usa `localStorage['eden:geo-sim']`.

Sem o `.mmdb` a rota ainda responde 200, mas `country` fica `UNKNOWN`.

## Regras usadas pela tela `/plan`

1. `localeCountry = geoState.domain === 'com.br' ? 'BR' : 'US'`.
2. Moeda: BR → `BRL`, senão `USD`.
3. Catálogo: `fetchFlavorProducts(localeCountry)`.
4. Consumo fallback: BR em g/kg, US em oz.
5. i18n: `com.br` → pt-BR, senão en-US.
6. País MaxMind (`geoState.country`) **não** escolhe o mercado do plano; só alimenta auto-redirect/modal de região.

Se a request falhar, o frontend cai em `domain: 'com'` / `country: 'UNKNOWN'` e o plano assume mercado US.

## Exemplo de uso no frontend

```ts
const response = await fetch(`${apiBase}/custom/v1/geo/context`, {
  method: 'GET',
  headers: { Accept: 'application/json' },
})

const json = await response.json()
// json.data.domain, json.data.country, json.data.ip
```

Implementação real: `src/lib/geo/backendGeo.ts` → `src/contexts/GeoContext.tsx` → `src/pages/plan/Plan.tsx`.

## Arquivos do fluxo

Documentação completa (WordPress + frontend + migração Node):

`eden-bowls-backend/docs/geo/DOCUMENTACAO_TECNICA_ROTA_CUSTOM_V1_GEO_CONTEXT.md`

Resumo dos arquivos:

- WP: `class-geo-api.php`, `class-geo-detection-service.php`, `class-plugin.php`
- Front chamada: `backendGeo.ts`, `GeoContext.tsx`, `App.tsx`, `AppShell.tsx`
- Front plano: `Plan.tsx`, `mealPlanProductsApi.ts`, `i18n/index.ts`
- Front região: `features/region-experience/**`
- E2E mock: `e2e/helpers/mockApi.ts`
