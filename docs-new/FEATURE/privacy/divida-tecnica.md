# Dívida técnica de privacidade

Isto **não substitui advogado**. O código trata `.com.br` como regime LGPD. No `.com`, GPC, Do Not Sell e Notice at Collection entram **por prudência operacional**, não como obrigação CCPA/CPRA confirmada: os limiares (receita, volume de consumidores, % de receita de sale/share) **ainda não foram validados**.

## Fora desta entrega

| Item | Por que ficou de fora |
|---|---|
| GTM extra, Meta Pixel, categoria de cookie de marketing | Não há pixel de ads em produção. Ads permanecem `denied`. |
| CMS de versões de política no admin | Versão = constante + git (`LEGAL_PRIVACY_VERSION` / `LEGAL_TERMS_VERSION`). |
| Portal DSAR sem login / formulário público anônimo | Risco de enumeração e engenharia social. Canal fallback: `hello@edenbowls.com` com verificação de identidade. |
| Sincronizar consentimento de visitante entre dispositivos | Cookie consent anônimo vive em `localStorage` (`edenbowls_cookie_consent:v2`) até o login em cada navegador. A escolha vale neste dispositivo. |
| Correção de dados semi-automatizada | MVP = ticket DSAR `correction` com SLA + self-service no perfil. Sem aplicar patch a partir do ticket. |
| E-mail automático de lembrete de SLA | O sinal na fila admin (badge **Atrasado**, ordenação por `due_at`) basta nesta entrega. |
| 50 leis estaduais dos EUA além de GPC / Do Not Sell / Notice | Fora de escopo. Controles US atuais são prudenciais. |
| Age-gate COPPA | Fora de escopo. |
| Apagar backups e logs históricos automaticamente | Retenção operacional / fiscal continua; exclusão da conta na plataforma não varre backups. |
| Confirmar se a operação `.com` atinge limiares CCPA | Até o advogado confirmar, controles US = **opcional-por-prudência**. Não descrever internamente como requisito legal já incidente. |

## Limitações conhecidas do que foi entregue

- Preferências de cookie de visitante **não sincronizam entre dispositivos** até o login em cada um.
- Correção via fila é manual (mesmo `due_at` de acesso/exclusão).
- Exclusão é da conta na plataforma; dados de cobrança podem permanecer no Stripe e em obrigação legal/fiscal.
- Não há decisão de adequação ANPD para os EUA; mecanismos contratuais (SCCs etc.) continuam placeholder “validar com advogado / contratos”.
