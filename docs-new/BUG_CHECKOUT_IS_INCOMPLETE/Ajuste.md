O checkout falhou porque os pets nunca chegaram na tabela onboarding_pets. O plano foi salvo; os pets, não.

O que o erro significa
POST /api/v1/onboarding/subscription/checkout chama validateCheckoutState. missing: ["pets"] aparece quando o contexto de checkout não tem pets persistidos — a rota lê GET /onboarding/pets (onboarding_pets), não o JSON de plan-selection.

No HAR isso bate:

GET /onboarding/pets → pets: []
Não houve POST /pets/sync
POST /plan-selection, recurrence, endereço e frete passaram
Luna existia só no plan_selection, com UUID local (526fb705-…). Tobby estava na recommendation, mas não na selection (provavelmente desmarcado)
O backend tratava “tem pets” como onboarding_pets.length > 0. Plano preenchido não contava.

Por que o sync não rodou
Na /plan, o pet já tinha um petId gerado no cliente (localId / UUID). O frontend usava isso em preview (petId || localId) e pulava POST /pets/sync quando petId já existia. Depois do login, o refresh também não gravava os pets na conta.

Resultado: checkout via /plan → login → /checkout com plano ok e tabela de pets vazia → session_incomplete.

O que foi corrigido
Backend

hasPets também aceita pets habilitados em plan_selection
No checkout, se onboarding_pets estiver vazia, ensurePersistedPets faz upsert a partir do plan_selection e recarrega o contexto
O validator de /pets/sync aceita pet_id (o Zod estava descartando o campo)
Frontend

syncLocalPetsToApi sempre envia POST /pets/sync (com pet_id e local_id)
/plan sincroniza antes de ir ao checkout, mesmo quando o pet já tem UUID local
Com isso, o checkout do HAR deixa de falhar só porque os pets ficaram no JSON do plano e não na tabela. Se o backend já estiver com essas mudanças, vale repetir o fluxo /plan → login → checkout.