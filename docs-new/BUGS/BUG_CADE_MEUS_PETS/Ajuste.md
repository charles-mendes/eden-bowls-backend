A subscription da Luna existe. O GET /onboarding/pets voltava vazio porque ele só lia a tabela onboarding_pets, e essa tabela não é onde o checkout grava o pet da assinatura.

Por que a home ficou sem pets
O HAR mostra os dois lados:

GET /api/v1/subscriptions → plano com pets_names: ["luna"] e pet_ids: ["526fb705-…"]
GET /api/v1/onboarding/pets → pets: []
O checkout monta o snapshot da assinatura a partir do plan_selection. A listagem da home/onboarding lia só onboarding_pets com deleted_at IS NULL.

Com o ajuste anterior, o checkout passou a aceitar pets no JSON do plano mesmo sem linha na tabela. A Luna foi para o ledger da subscription; a tabela de pets continuou vazia.

Na /plan, depois do sync o front apagava o draft local (clearLocalOnboardingDraft). A home autenticada trata o backend como fonte da verdade. Draft limpo + GET vazio = nenhum pet na tela.

O Tobby nem entrou no plan-selection (estava desmarcado). Sem linha na tabela e sem draft, ele também some da UI.

O que foi corrigido
Backend — GET /onboarding/pets

Se a tabela estiver vazia, a rota agora:

Recupera pets do plan_selection
Se ainda estiver vazio, usa o pets_snapshot da subscription (é o caso da Luna no HAR)
Grava de volta em onboarding_pets para a próxima listagem
Frontend

A /plan não apaga mais os pets do draft ao ir para o checkout
O merge local/remoto mantém um pet local com petId que o GET ainda não devolveu (ex.: Tobby)
Reinicie o backend e recarregue a home. A Luna deve voltar no GET /onboarding/pets. O Tobby só reaparece se ainda estiver no draft do browser ou se tiver sido persistido na tabela; a subscription só tem a Luna.