# Fase de vida por raça (L-01)

> **Status: aprovado.** O veterinário aprovou a tabela de limites e a lista de raças em 2026-10-18 (confirmação repassada por Charles Mendes). Esta é a resposta da L-01 de `eden-bowls/docs/regras-de-negocio/novos-sabores.md` e a fonte do requisito em `eden-bowls/openspec/changes/add-life-stage-recipes/specs/pet-life-stage/spec.md`.

## Pergunta

L-01: com que idade o filhote vira adulto e o adulto vira sênior? Depende do porte ou da raça?

## Resposta

Depende do porte. A raça só define a classe de porte. Os limites ficam por classe, e não por raça, como pede o `design.md` da OpenSpec `add-life-stage-recipes`.

| Classe (`life_stage_class`) | Peso adulto típico | PUPPY → ADULT | ADULT → SENIOR |
| --- | --- | --- | --- |
| `small` | até ~10 kg | 10 meses | 10 anos |
| `medium` | ~10–25 kg | 12 meses | 8 anos |
| `large` | ~25–45 kg | 15 meses | 7 anos |
| `giant` | acima de ~45 kg | 18 meses | 6 anos |

- PUPPY: do nascimento até `adult_from_months`.
- ADULT: de `adult_from_months` até `senior_from_years`.
- SENIOR: a partir de `senior_from_years`.

Os valores seguem a prática comum de nutrição canina. Raças grandes e gigantes crescem por mais tempo e envelhecem mais cedo.

Os limites e as raças `giant` ficam no banco, por mercado (BR e US), nas tabelas `life_stage_size_classes` e `life_stage_breeds`, e não em código nem em arquivo de configuração. O seed grava os valores desta tabela nos dois mercados, com o sênior em meses (120, 96, 84, 72). Assim uma veterinária poderá alterar limites ou adicionar raças pelo admin no futuro. Essa tela ainda não existe. Modelo de dados em `eden-bowls/openspec/changes/add-life-stage-recipes/design.md`, decisão 1.

## Classificação das raças

`breeds-life-stage.csv` traz as 448 raças de `wp_hsr_breeds` (base local, 2026-10-18), cada uma com `life_stage_class`, `adult_from_months` e `senior_from_years`.

- `small`, `medium` e `large` repetem a coluna `size` da tabela.
- `giant` não existe em `size`. 51 raças com `size = large` passaram para `giant` por terem adulto típico acima de ~45 kg (Dogue Alemão, São Bernardo, Mastiffs, Fila Brasileiro, Terra Nova, Leonberger, Kangal etc.).
- O pet guarda a raça como texto livre. A API compara esse texto com `name_pt` e `name_en` das raças `giant`, ignorando maiúsculas, acentos e espaços nas pontas. Se encontrar, a classe é `giant`. Se não, vale o `size` do cadastro. Sem `size` válido, vale `medium`.

## Observações sobre a tabela

- `GIANT_DOG_BREEDS` em `src/core/nutrition-recommendation.js` serve ao fator energético, não à fase de vida. Ela inclui Greyhound e Borzoi, que aqui ficam em `large` pelo peso.
- A tabela tem raças duplicadas: Leonberger (108, 214), Fila Brasileiro (102, 409), Central Asian Shepherd (152, 435), Anatolian Shepherd (110, 437), Belgian Malinois (79, 423), entre outras. O CSV classifica todas igualmente.
- O CSV tem 51 linhas `giant`, mas só 45 nomes distintos em inglês e 46 em português. O seed grava um registro por par distinto de nomes (português, inglês): são 47. A chave usa o par porque um nome em inglês pode ter duas grafias em português ("Pastor da Bucovina" / "Pastor de Bucovina").

## Idade atual (L-02 e L-03, respondidas em 2026-10-18)

- Referência: a data do cadastro, `age_recorded_at` em `onboarding_pets`. Idade atual = idade informada + meses de calendário completos desde `age_recorded_at`.
- Pets existentes recebem `age_recorded_at` a partir de `created_at`, não de `updated_at`: `updated_at` muda com qualquer alteração da linha (foto, nome, peso).
- `age_recorded_at` muda só quando a edição do pet muda a idade. O sync do onboarding não sobrescreve `age_years`, `age_months` nem `birth_date` de um pet que já existe.
- Data de nascimento opcional (`birth_date`) no cadastro e em Meus pets. Quando informada, a idade é calculada por ela.
- Quem informa "1 ano" tem exatamente 1 ano e 0 meses (12 meses) no mês do cadastro.
