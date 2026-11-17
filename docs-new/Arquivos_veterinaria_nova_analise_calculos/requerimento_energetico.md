# Requerimento Energético de acordo com Constantes e Variáveis

## Aba 1 — Consumo alim. comp.

### Guia Alimentar

As duas planilhas de origem usam o mesmo cálculo e mudam apenas os valores preenchidos. Por isso, as tabelas abaixo mostram os dois casos lado a lado:

- **Exemplo 1:** planilha *Requerimento energético de acordo com constantes e variáveis*
- **Exemplo 2:** planilha *Calculadora consumo*

#### Cálculo para CÃES

| Passo | Descrição | Exemplo 1 | Exemplo 2 | Observação |
|---|---|---|---|---|
| Passo 1 | Escolher Fator (Tab. 1) | 85 | 130 | DEFINIR |
| Passo 2 | Incluir peso do CÃO (kg) | 30 | 45 | DEFINIR |
| — | NEM = Necessidade Energética de Manutenção (kcal/dia) | 1.089,58 | 2.258,67 | NÃO MEXER · fórmula: `Fator × Peso^0,75` |
| Passo 3 | Escolher EM da dieta (Tab. 2) (kcal/kg) | 1.150 | 1.500 | DEFINIR |
| Passo 4 | Consumo de dieta recomendado (g/dia) | 947,46 | 1.505,78 | fórmula: `NEM × 1000 / EM` |

**Dividir a quantidade diária em:** 2 refeições para adultos · 3 refeições para filhotes

> ⚠️ O Exemplo 2 é um cão gigante (45 kg) calculado com fator 130. Pela orientação da zootecnista (ver *Fatores para raças gigantes*), o fator máximo para cães gigantes adultos em manutenção é 115, e só para não castrados com alta atividade e escore abaixo. Com fator 130, a necessidade energética provavelmente está superestimada.

#### Cálculo para GATOS

| Passo | Descrição | Exemplo 1 | Exemplo 2 | Observação |
|---|---|---|---|---|
| Passo 1 | Escolher Fator (Tab. 1) | 60 (gato em ambiente interno) | 100 (gato ativo) | DEFINIR |
| Passo 2 | Incluir peso do GATO (kg) | 7,5 | 3,8 | DEFINIR |
| — | NEM = Necessidade Energética de Manutenção (kcal/dia) | 231,44 | 244,60 | NÃO MEXER · fórmula: `Fator × Peso^0,67` |
| — | NEM = Necessidade Energética de Manutenção — GATO OBESO (kcal/dia) | 134,33 | 170,57 | fórmula: `Fator × Peso^0,4` |
| Passo 3 | Escolher EM da dieta (Tab. 2) (kcal/kg) | 957 | 1.200 | DEFINIR |
| Passo 4 | Consumo de dieta recomendado (g/dia) — GATO NORMAL | 241,84 | 203,83 | fórmula: `NEM × 1000 / EM` |
| Passo 4 | Consumo de dieta recomendado (g/dia) — GATO OBESO | 140,37 | 142,15 | fórmula: `NEM obeso × 1000 / EM` |

**Dividir a quantidade diária em:** 3 ou mais refeições

### Porte dos cães

| Porte | Faixa de peso |
|---|---|
| Mini | até 5 kg |
| Pequeno | 6 a 10 kg |
| Médio | 11 a 25 kg |
| Grande | 26 a 40 kg |
| Gigante | > 40 kg |

> Para cães do porte **Gigante**, use os fatores da seção *Fatores para raças gigantes*. Para os demais portes, use os fatores da Tabela 1 e da aba Constantes.

### Perguntas aos tutores

| Pergunta | Resposta |
|---|---|
| Peso do cão (kg) | 30 |
| Nível de atividade física | ALTO |
| Castrado? | SIM |
| Score corporal | ACIMA |
| Combinação | SIM-ALTO-ACIMA |

> A combinação é gerada pela concatenação `Castrado - Nível de atividade - Score corporal` e corresponde a um fator na aba **Constantes**.

### Tabela 1 — Fatores para cálculo de exigência energética

| Fator | Descrição | Estágio fisiológico | Faixa de referência |
|---|---|---|---|
| 210 | Cão filhote, até 50% do peso adulto | Crescimento | |
| 175 | Cão filhote, 50% a 80% do peso adulto | Crescimento | |
| 140 | Cão filhote, 80% a 100% do peso adulto | Crescimento | |
| 80 | Cão adulto, obeso (pelo menos 20% acima do peso ideal) | Manutenção | |
| 90 | Cão adulto, castrado, sobrepeso (10 a 20% acima do peso) | Manutenção | |
| 95 | Cão adulto, atividade baixa (caminhada < 1h/dia) | Manutenção | |
| 105 | Cão adulto, raça específica como Terra Nova | Manutenção | |
| 110 | Cão adulto, atividade moderada (baixo impacto: 1–3h/dia) | Manutenção | |
| 110 | Cão adulto, 3 a 7 anos | Manutenção | 95 a 130 |
| 165 | Cão adulto, atividade alta (3–6h/dia) — cães de trabalho, Sheep dogs | Manutenção | 150 a 175 |
| 130 | Cão adulto, 1 a 2 anos | Manutenção | 125 a 140 |
| 125 | Cão adulto, atividade moderada (alto impacto: 1–3h/dia) | Manutenção | |
| 200 | Cão adulto, raça específica como Dog Alemão | Manutenção | 200 a 250 |
| 95 | Cão adulto idoso (> 7 anos) que mora em apto e não passeia ou sai pouco (< 1h/dia) | Sênior | 80 a 120 |
| 132 | Cadela gestante, primeiras 4 semanas | Gestante | |
| 60 | Gatos em ambiente interno | — | 52 a 75 |
| 100 | Gatos ativos | — | |

*Fonte: NRC (2006), FEDIAF (2020)*

> **Observação sobre Terra Nova e Dog Alemão (orientação da zootecnista Izabella):** mesmo nessas raças, a recomendação é usar como ponto de partida os fatores para raças gigantes (ver seção abaixo), e não os valores 105 e 200 desta tabela. Por causa do porte, esses cães precisam de muita energia no total para manutenção, mas o metabolismo por kg costuma ser mais lento. Superestimar a necessidade energética é comum nesses casos e aumenta o risco de ganho de peso.

### Fatores para raças gigantes (porte Gigante, > 40 kg — cães adultos em manutenção)

**Aplica-se apenas a cães de porte Gigante.** Esta tabela é específica para esse porte e não substitui os fatores gerais.

Orientação enviada por **Izabella — Zootecnista, Nutrição de cães e gatos (CRMV-PR 01687ZP)**.

As raças gigantes predominantes na região costumam ter um metabolismo menos acelerado que o de cães de porte menor. Os fatores abaixo servem de base para a estimativa energética em **kcal/kg^0,75** e já estão ajustados para esse perfil.

| Condição | Nível de atividade | Score ABAIXO | Score ADEQUADO | Score ACIMA |
|---|---|---|---|---|
| Castrado | Baixa | 95 | 85 | 75 |
| Castrado | Moderada | 100 | 90 | 80 |
| Castrado | Alta | 105 | 95 | 85 |
| Não castrado | Baixa | 100 | 95 | 85 |
| Não castrado | Moderada | 105 | 100 | 90 |
| Não castrado | Alta | 115 | 105 | 95 |

**Quando usar:**

- Os fatores são uma base geral de manutenção para cães adultos desse perfil.
- Casos específicos devem ser avaliados individualmente, porque os fatores podem precisar de ajuste. Exemplos: cães de trabalho, cães com atividade intensa, rotina física muito acima da média ou demandas bem particulares.
- Isto não é ciência exata, e sim fisiologia aplicada. Os valores são um ponto de partida e devem sempre vir acompanhados da análise individual de cada paciente: escore corporal, rotina, composição corporal, resposta ao plano alimentar e particularidades do caso.

### Cálculo alimento completo

| Peso do animal (kg) | Qtd. g/dia |
|---|---|
| 1 a 5 | 80 a 276 |
| 6 a 10 | 0 a 0 |
| 11 a 15 | 0 a 0 |
| 16 a 20 | 0 a 0 |
| 21 a 30 | 0 a 0 |
| 31 a 40 | 0 a 0 |

> Os valores desta tabela vêm de células fora da área visível da planilha (colunas N/O em um arquivo, Q/R no outro). Nos dois arquivos, as faixas acima de 5 kg estão zeradas.
>
> As planilhas não trazem a **Tabela 2 (EM da dieta)**, embora o Passo 3 faça referência a ela. A EM é a energia metabolizável do alimento em kcal/kg e deve ser tirada do rótulo ou da ficha técnica da ração.

### Cálculo de petiscos (aba "Consumo petisco")

*Fonte: planilha Calculadora consumo.*

> ℹ️ **Status atual: não vendemos petiscos, e este cálculo não afeta o Guia Alimentar.**
>
> - O consumo de ração do Guia Alimentar (Passo 4) usa **100% da NEM**. Não há desconto de petiscos no cálculo principal.
> - Esta seção serve só como **referência**, para orientar tutores que já dão petiscos por conta própria.
> - **Orientação ao tutor:** quem dá petiscos deve reduzir a ração na mesma proporção, para que os petiscos não passem de 10% da energia diária e o cão não ganhe peso. Quem não dá petiscos segue normalmente a quantidade calculada.
> - Se um dia passarmos a vender petiscos, esta tabela pode servir de base para descontar a energia deles da ração.

A regra usada é que os petiscos devem representar no máximo **10% da energia diária** (NEM) do cão.

**Parâmetros (podem ser alterados):**

| Parâmetro | Valor |
|---|---|
| Fator | 100 |
| EM do petisco (kcal/kg) | 3.925 |
| Peso de 1 unidade de petisco (g) | 5 |

**Fórmulas:**

- NEM (kcal/dia) = `Fator × Peso^0,75`
- Energia de petisco (kcal/dia) = `NEM × 0,10`
- Petisco (g/dia) = `kcal de petisco × 1000 / EM do petisco`
- Unidades/dia = `g/dia ÷ peso de 1 unidade`

**Resultado por faixa de peso** (os valores de cada coluna vão do peso mínimo ao peso máximo da faixa):

| Peso do animal (kg) | NEM (kcal/dia) | 10% para petisco (kcal/dia) | Petisco (g/dia) | Unidades/dia |
|---|---|---|---|---|
| 1 a 5 | 100,0 a 334,4 | 10,0 a 33,4 | 2,5 a 8,5 | 0,5 a 1,7 |
| 6 a 10 | 383,4 a 562,3 | 38,3 a 56,2 | 9,8 a 14,3 | 2,0 a 2,9 |
| 11 a 15 | 604,0 a 762,2 | 60,4 a 76,2 | 15,4 a 19,4 | 3,1 a 3,9 |
| 16 a 20 | 800,0 a 945,7 | 80,0 a 94,6 | 20,4 a 24,1 | 4,1 a 4,8 |
| 21 a 30 | 981,0 a 1.281,9 | 98,1 a 128,2 | 25,0 a 32,7 | 5,0 a 6,5 |
| 31 a 40 | 1.313,8 a 1.590,5 | 131,4 a 159,1 | 33,5 a 40,5 | 6,7 a 8,1 |

> Esta tabela usa um fator fixo de 100 para todas as faixas. Para cães castrados, pouco ativos ou com escore acima do ideal (fatores 75–85 na aba Constantes), a quantidade de petisco permitida fica proporcionalmente menor.

---

## Aba 2 — Constantes

### Opções disponíveis

| Castrado | Nível de atividade física | Score corporal |
|---|---|---|
| SIM | BAIXO | ABAIXO |
| NÃO | ALTO | ADEQUADO |
| | MODERADA | ACIMA |

### Combinações (Castrado – Nível de atividade física – Score corporal)

Os fatores dependem do **porte** do cão:

- **Fator geral:** o valor que está na aba Constantes da planilha. Vale para os demais portes.
- **Fator para raças gigantes (> 40 kg):** os valores enviados pela zootecnista Izabella no e-mail *"Cálculo estimado de gasto energético em cães de raças gigantes"*.

| Combinação | Fator geral (planilha) | Fator raças gigantes (> 40 kg) |
|---|---|---|
| SIM-BAIXO-ABAIXO | 95 | 95 |
| SIM-BAIXO-ADEQUADO | 85 | 85 |
| SIM-BAIXO-ACIMA | 75 | 75 |
| SIM-ALTO-ABAIXO | 95 | 105 |
| SIM-ALTO-ADEQUADO | 95 | 95 |
| SIM-ALTO-ACIMA | 85 | 85 |
| SIM-MODERADA-ABAIXO | 95 | 100 |
| SIM-MODERADA-ADEQUADO | 85 | 90 |
| SIM-MODERADA-ACIMA | 75 | 80 |
| NÃO-BAIXO-ABAIXO | 100 | 100 |
| NÃO-BAIXO-ADEQUADO | 95 | 95 |
| NÃO-BAIXO-ACIMA | 85 | 85 |
| NÃO-ALTO-ABAIXO | 100 | 115 |
| NÃO-ALTO-ADEQUADO | 95 | 105 |
| NÃO-ALTO-ACIMA | 85 | 95 |
| NÃO-MODERADA-ABAIXO | 85 | 105 |
| NÃO-MODERADA-ADEQUADO | 95 | 100 |
| NÃO-MODERADA-ACIMA | 85 | 90 |

> ❓ **Ponto a confirmar com a Izabella:** segundo o e-mail, as raças gigantes têm metabolismo *menos* acelerado que cães menores, então o esperado seria que os fatores para gigantes fossem iguais ou menores que os gerais. Na comparação acima, porém, os fatores para gigantes são iguais ou **maiores** em todas as combinações (ex.: NÃO-ALTO-ABAIXO 100 → 115). Além disso, a tabela geral tem algumas sequências pouco intuitivas, como NÃO-MODERADA-ABAIXO = 85, menor que o ADEQUADO (95). Vale confirmar se a aba Constantes está atualizada ou se é a "linha que eu já havia te enviado" a que ela se refere.
