# Autenticação em um Backend de E-commerce com Node.js

Guia prático do fluxo de autenticação recomendado: JWT de curta duração + refresh token via cookie `httpOnly`, com suporte a revogação.

---

## 1. Visão geral do fluxo

```
[Cliente]                          [Backend Node]                     [Banco/Redis]
    |                                    |                                  |
    |--- POST /login (email/senha) ----->|                                  |
    |                                    |--- valida credenciais ---------->|
    |                                    |<---------------------------------|
    |                                    |--- gera Access Token (JWT) ------|
    |                                    |--- gera Refresh Token -----------|
    |                                    |--- salva refresh token (hash) -->|
    |<--- Access Token (JSON) -----------|                                  |
    |<--- Refresh Token (cookie httpOnly)|                                  |
    |                                    |                                  |
    |--- GET /produtos (Bearer AT) ----->|                                  |
    |                                    |--- valida assinatura JWT         |
    |<--- resposta -----------------------|                                  |
    |                                    |                                  |
    |--- POST /refresh (cookie RT) ----->|                                  |
    |                                    |--- valida RT no banco ---------->|
    |                                    |<---------------------------------|
    |                                    |--- gera novo Access Token -------|
    |<--- novo Access Token -------------|                                  |
```

---

## 2. Por que não só "JWT + localStorage"

| Abordagem | Problema |
|---|---|
| JWT salvo em `localStorage` | Vulnerável a **XSS** — qualquer script malicioso na página consegue ler o token e se passar pelo usuário |
| JWT sem refresh token | Token de vida longa = janela grande de risco se vazar; token de vida curta = usuário precisa logar toda hora |
| JWT puro (sem registro no backend) | Impossível revogar (logout forçado, banimento, troca de senha) antes da expiração natural |

**Solução:** access token de vida curta (não fica exposto por muito tempo) + refresh token de vida longa guardado em cookie `httpOnly` (JS não acessa) + registro do refresh token no banco (permite revogar).

---

## 3. Estrutura de tokens

### Access Token (JWT)
- Vida curta: **15 minutos**
- Enviado no header: `Authorization: Bearer <token>`
- Guardado **em memória** no frontend (variável JS/estado da aplicação), nunca em `localStorage`
- Payload mínimo:
```json
{
  "sub": "user_id",
  "role": "customer",
  "iat": 1699999999,
  "exp": 1700000899
}
```

### Refresh Token
- Vida longa: **7 a 30 dias**
- Guardado em **cookie `httpOnly` + `secure` + `sameSite=strict`**
- Guardado também no banco (ou Redis), como **hash** (nunca em texto puro) — permite revogar e detectar reuso indevido

---

## 4. Estrutura de pastas sugerida

```
src/
├── routes/
│   ├── auth.routes.js
│   └── produtos.routes.js
├── controllers/
│   └── auth.controller.js
├── services/
│   ├── token.service.js
│   └── auth.service.js
├── middlewares/
│   └── authenticate.js
├── models/
│   └── refreshToken.model.js
└── app.js
```

---

## 5. Implementação das rotas principais

### `token.service.js`
```js
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

function generateAccessToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: '15m' }
  );
}

function generateRefreshToken() {
  return crypto.randomBytes(64).toString('hex');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

module.exports = { generateAccessToken, generateRefreshToken, hashToken };
```

### `POST /login`
```js
const { generateAccessToken, generateRefreshToken, hashToken } = require('../services/token.service');
const RefreshToken = require('../models/refreshToken.model');

async function login(req, res) {
  const user = await validarCredenciais(req.body.email, req.body.senha);
  if (!user) return res.status(401).json({ error: 'Credenciais inválidas' });

  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken();

  await RefreshToken.create({
    userId: user.id,
    tokenHash: hashToken(refreshToken),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 dias
  });

  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: true,        // exige HTTPS
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/refresh',    // cookie só é enviado nessa rota
  });

  res.json({ accessToken });
}
```

### `POST /refresh`
```js
async function refresh(req, res) {
  const token = req.cookies.refreshToken;
  if (!token) return res.status(401).json({ error: 'Sem refresh token' });

  const stored = await RefreshToken.findOne({ tokenHash: hashToken(token) });
  if (!stored || stored.expiresAt < new Date()) {
    return res.status(401).json({ error: 'Refresh token inválido ou expirado' });
  }

  const user = await User.findById(stored.userId);
  const newAccessToken = generateAccessToken(user);

  res.json({ accessToken: newAccessToken });
}
```

### `POST /logout`
```js
async function logout(req, res) {
  const token = req.cookies.refreshToken;
  if (token) {
    await RefreshToken.deleteOne({ tokenHash: hashToken(token) });
  }
  res.clearCookie('refreshToken', { path: '/refresh' });
  res.status(204).send();
}
```

### `middlewares/authenticate.js`
```js
const jwt = require('jsonwebtoken');

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token ausente' });
  }

  const token = authHeader.split(' ')[1];
  try {
    req.user = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }
}

module.exports = authenticate;
```

---

## 6. Revogação (o ponto que JWT puro não resolve)

Como o refresh token é registrado no banco, você consegue:

- **Logout real**: apaga o refresh token do banco (rota `/logout` acima)
- **Banimento/fraude**: apaga todos os refresh tokens do usuário → ele será deslogado assim que o access token atual expirar (no máx. 15 min depois)
- **Troca de senha**: apaga todos os refresh tokens do usuário, forçando novo login em todos os dispositivos
- **Detecção de roubo de token**: se um refresh token já usado/apagado for reapresentado, é sinal de token vazado — revogue toda a família de tokens daquele usuário

---

## 7. Checklist de segurança

- [ ] Access token nunca em `localStorage`
- [ ] Refresh token sempre em cookie `httpOnly` + `secure` + `sameSite`
- [ ] Refresh token guardado como hash no banco, nunca em texto puro
- [ ] HTTPS obrigatório em produção (cookie `secure` depende disso)
- [ ] Rate limiting nas rotas `/login` e `/refresh` (evitar brute force)
- [ ] Rotação de refresh token a cada uso (opcional, mas recomendado para e-commerce)
- [ ] CORS configurado explicitamente (`credentials: true` + origem específica, nunca `*`)

---

## 8. Variáveis de ambiente

```env
JWT_ACCESS_SECRET=chave-secreta-forte-aqui
NODE_ENV=production
```

---

## 9. Onboarding sem login (cadastro de pet) + sincronização depois

Esse é um caso de uso **diferente** do token: aqui o `localStorage` é apropriado, porque os dados (nome do pet, peso, raça, etc.) **não são sensíveis** como um token de autenticação. O desafio não é segurança, é **reconciliação de dados** — o usuário pode preencher isso anônimo e, na hora de logar/cadastrar, você não sabe se:

1. Ele é um usuário novo (sem conta) → cria a conta e os pets direto.
2. Ele já tem conta, mas **nenhum pet salvo** ainda → só adiciona os pets do onboarding.
3. Ele já tem conta **e já tem pets salvos** → pode ser um pet novo, ou pode ser o mesmo pet que ele já tinha cadastrado (ex: ele esqueceu que já tinha colocado o "Rex" e cadastrou de novo no onboarding).

O ponto 3 é o mais delicado, porque **não dá pra saber com certeza automaticamente** se "Rex, 12kg" do onboarding é o mesmo "Rex, 11kg" que já existe no banco, ou um segundo pet com o mesmo nome. Por isso o fluxo precisa ter uma etapa de **confirmação do usuário** quando houver ambiguidade, e não tentar resolver tudo silenciosamente.

### 9.1 Estrutura do rascunho no `localStorage`

```json
{
  "onboardingPets": [
    {
      "localId": "tmp_a1b2c3",
      "nome": "Rex",
      "especie": "cachorro",
      "raca": "vira-lata",
      "peso": 12.5,
      "idade": 3,
      "preenchidoEm": "2026-08-12T14:30:00Z"
    }
  ],
  "onboardingVersion": 1
}
```

- `localId`: id temporário gerado no client (ex: `crypto.randomUUID()`), usado só para controle local, nunca confundir com o `id` real do banco.
- `onboardingVersion`: útil se você mudar o formato do rascunho no futuro e precisar migrar/invalidar rascunhos antigos.
- Salve isso incrementalmente (a cada etapa do formulário), não só no final — assim se o usuário fechar a aba no meio, ele não perde o progresso.

```js
function salvarRascunhoPet(pet) {
  const draft = JSON.parse(localStorage.getItem('onboardingPets') || '[]');
  draft.push({ ...pet, localId: crypto.randomUUID(), preenchidoEm: new Date().toISOString() });
  localStorage.setItem('onboardingPets', JSON.stringify(draft));
}
```

### 9.2 Fluxo completo

```
[Onboarding anônimo]
        |
        |-- usuário preenche pet(s) --> salva em localStorage
        |
        v
[Usuário decide logar/cadastrar]
        |
        |-- login ou signup bem-sucedido (recebe accessToken)
        |
        v
[Frontend lê localStorage.onboardingPets]
        |
        |-- se vazio: não faz nada
        |-- se tiver dados: chama POST /pets/sync
        v
[Backend compara com pets já existentes do usuário]
        |
        |-- sem conflito: cria os pets direto
        |-- possível duplicata: retorna lista de "candidatos a conflito"
        v
[Frontend mostra tela de confirmação, se houver conflitos]
        |
        |-- usuário escolhe: "é o mesmo pet" (mescla) ou "é outro pet" (cria novo)
        v
[Frontend chama POST /pets/sync/resolve com as decisões]
        |
        v
[localStorage.onboardingPets é limpo]
```

### 9.3 Endpoint de sincronização

```js
// POST /pets/sync
// body: { pets: [{ localId, nome, especie, raca, peso, idade }] }
async function syncPets(req, res) {
  const userId = req.user.sub;
  const petsExistentes = await Pet.find({ userId });
  const petsRecebidos = req.body.pets;

  const paraCriar = [];
  const conflitos = [];

  for (const petLocal of petsRecebidos) {
    const possivelDuplicata = petsExistentes.find(p =>
      normalizar(p.nome) === normalizar(petLocal.nome) &&
      p.especie === petLocal.especie
    );

    if (possivelDuplicata) {
      conflitos.push({
        localId: petLocal.localId,
        petLocal,
        petExistente: possivelDuplicata,
      });
    } else {
      paraCriar.push(petLocal);
    }
  }

  // cria direto os que não têm conflito
  const criados = await Pet.insertMany(
    paraCriar.map(p => ({ ...p, userId }))
  );

  res.json({
    criados,
    conflitos, // frontend decide o que fazer com esses
  });
}

function normalizar(str) {
  return str.trim().toLowerCase();
}
```

> A comparação acima usa nome + espécie como heurística simples. Dependendo do seu domínio, pode valer a pena incluir raça ou idade aproximada no match — mas evite ficar sofisticado demais aqui; é mais seguro perguntar ao usuário do que adivinhar errado e mesclar pets diferentes.

### 9.4 Resolvendo conflitos (decisão do usuário)

Quando existem `conflitos`, o frontend mostra algo como:

> "Você já tem um pet chamado **Rex**. O que você preencheu agora é o mesmo pet ou um pet diferente?"
> [ É o mesmo, atualizar dados ] [ É outro pet, cadastrar separado ]

```js
// POST /pets/sync/resolve
// body: { decisoes: [{ localId, acao: 'mesclar' | 'criar_novo', petExistenteId?, petLocal }] }
async function resolveSyncConflicts(req, res) {
  const userId = req.user.sub;
  const resultados = [];

  for (const decisao of req.body.decisoes) {
    if (decisao.acao === 'mesclar') {
      const atualizado = await Pet.findOneAndUpdate(
        { _id: decisao.petExistenteId, userId },
        { $set: decisao.petLocal },
        { new: true }
      );
      resultados.push(atualizado);
    } else {
      const novo = await Pet.create({ ...decisao.petLocal, userId });
      resultados.push(novo);
    }
  }

  res.json({ pets: resultados });
}
```

Depois que a sincronização (e resolução, se houve) terminar com sucesso, o frontend limpa o rascunho:

```js
localStorage.removeItem('onboardingPets');
```

### 9.5 Casos extras a considerar

| Cenário | O que fazer |
|---|---|
| Usuário nunca loga (compra como convidado) | Mantenha os pets vinculados a um `guestId` (gerado no client, salvo em cookie ou localStorage) até ele criar conta — assim dá pra fazer o mesmo sync depois |
| Onboarding com mais de um pet | O `/pets/sync` já trata array — pode ter conflito em uns e não em outros, tudo na mesma resposta |
| Rascunho muito antigo (usuário voltou meses depois) | Vale invalidar rascunhos com `preenchidoEm` muito antigo, ou pelo menos avisar "esses dados são de X tempo atrás, confirma?" |
| Sync falha no meio (rede caiu) | Só limpe o `localStorage` **depois** da confirmação de sucesso do backend — nunca limpe otimisticamente antes da resposta |
| Usuário edita o pet localmente e tem conexão instável | Considere throttle/debounce no salvamento local, mas isso já é local, não precisa de retry de rede |

### 9.6 Resumo da diferença de tratamento

| Dado | Onde guardar antes do login | Por quê |
|---|---|---|
| Token de autenticação | Nunca em localStorage (ver seções 2-3) | Risco de roubo via XSS, dado sensível |
| Dados de onboarding (pet, preferências) | `localStorage` é aceitável | Dado não sensível, benefício de persistência > risco |
