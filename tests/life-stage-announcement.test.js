const { buildSizeClassSeedRows } = require('../src/core/life-stage-seed');
const { LifeStageService } = require('../src/services/life-stage.service');
const { LifeStageAnnouncementService } = require('../src/services/life-stage-announcement.service');
const { buildLifeStageAnnouncementEmail } = require('../src/core/email/life-stage-emails');
const { listEmailPreviews } = require('../src/core/email/preview-fixtures');

const NOW = new Date('2026-10-19T12:00:00Z');
const RECIPES = [
  { key: 'beef', label: 'Bovino', life_stage: 'adult' },
  { key: 'puppy-chicken-pork', label: 'Receita de Frango e Porco para Filhotes', life_stage: 'puppy' },
  { key: 'senior-beef', label: 'Receita de Carne para Cães Sênior', life_stage: 'senior' }
];
const registered = { breed: '', size: 'medium', age_recorded_at: '2026-10-19T09:00:00.000Z', birth_date: null };
const puppy = (id, name) => ({ id, name, age_years: 0, age_months: 5, ...registered });
const adult = (id, name) => ({ id, name, age_years: 3, age_months: 0, ...registered });
const senior = (id, name) => ({ id, name, age_years: 9, age_months: 0, ...registered });

function plan(id, userId, petIds, pets, flavors = ['beef']) {
  return {
    id,
    userId,
    stripeSubscriptionId: `sub_${id}`,
    stripeAccount: 'br',
    email: `user${userId}@example.com`,
    address: { name: 'Ana Mendes' },
    planSelection: { pets: petIds.map((petId) => ({ pet_id: petId, selected_flavors: flavors, flavor_weights: flavors.map(() => 4) })) },
    pets
  };
}

function serviceWith(candidates, published = ['adult', 'puppy', 'senior']) {
  const limits = {};
  for (const row of buildSizeClassSeedRows().filter((item) => item.market === 'BR')) {
    limits[row.sizeClass] = { adultFromMonths: row.adultFromMonths, seniorFromMonths: row.seniorFromMonths };
  }
  const lifeStageService = new LifeStageService({
    repository: { forMarket: async () => ({ limits, breedClasses: new Map() }) },
    recipeLinesRepository: {
      listRecipeLines: async () => ({
        BR: {
          lineByKey: Object.fromEntries(RECIPES.map((recipe) => [recipe.key, recipe.life_stage])),
          publishedLines: new Set(published),
          publishedRecipes: RECIPES.filter((recipe) => published.includes(recipe.life_stage))
        }
      })
    },
    now: () => NOW
  });
  const repository = { listCandidates: jest.fn(async () => candidates) };
  return { service: new LifeStageAnnouncementService({ lifeStageService, repository }), repository };
}

describe('launch announcement recipients (2.13)', () => {
  test('a plan with a puppy and a senior gives one customer naming both dogs', async () => {
    const { service, repository } = serviceWith([
      plan(1, 7, ['p-luna', 'p-thor'], [puppy('p-luna', 'Luna'), senior('p-thor', 'Thor')])
    ]);
    const recipients = await service.recipients('BR');
    expect(repository.listCandidates).toHaveBeenCalledWith('br');
    expect(recipients).toHaveLength(1);
    expect(recipients[0]).toMatchObject({ userId: 7, email: 'user7@example.com', firstName: 'Ana' });
    expect(recipients[0].dogs).toEqual([
      { petId: 'p-luna', petName: 'Luna', stage: 'puppy', subscriptionRowId: 1, subscriptionId: 'sub_1', recipes: ['Receita de Frango e Porco para Filhotes'] },
      { petId: 'p-thor', petName: 'Thor', stage: 'senior', subscriptionRowId: 1, subscriptionId: 'sub_1', recipes: ['Receita de Carne para Cães Sênior'] }
    ]);
  });

  test('a senior already on senior recipes is not named', async () => {
    const { service } = serviceWith([plan(1, 7, ['p-thor'], [senior('p-thor', 'Thor')], ['senior-beef'])]);
    expect(await service.recipients('BR')).toEqual([]);
  });

  test('only the dog outside its line is named when the other already holds its line', async () => {
    const { service } = serviceWith([
      plan(1, 7, ['p-luna', 'p-thor'], [puppy('p-luna', 'Luna'), senior('p-thor', 'Thor')], ['puppy-chicken-pork'])
    ]);
    const recipients = await service.recipients('BR');
    expect(recipients[0].dogs.map((dog) => dog.petName)).toEqual(['Thor']);
  });

  test('adults only: no recipient', async () => {
    const { service } = serviceWith([plan(1, 7, ['p-rex'], [adult('p-rex', 'Rex')])]);
    expect(await service.recipients('BR')).toEqual([]);
  });

  test('a puppy on no active plan: no recipient', async () => {
    const { service } = serviceWith([plan(1, 7, ['p-rex'], [adult('p-rex', 'Rex'), puppy('p-luna', 'Luna')])]);
    expect(await service.recipients('BR')).toEqual([]);
  });

  test('already notified pets are not candidates, so a customer whose only puppy was announced gets nothing', async () => {
    // The repository leaves out pets with life_stage_announced_at (covered against MySQL in the integration test).
    const { service } = serviceWith([plan(1, 7, ['p-luna'], [])]);
    expect(await service.recipients('BR')).toEqual([]);
  });

  test('a dog on two plans of the customer is named once', async () => {
    const thor = senior('p-thor', 'Thor');
    const { service } = serviceWith([plan(1, 7, ['p-thor'], [thor]), plan(2, 7, ['p-thor'], [thor])]);
    const recipients = await service.recipients('BR');
    expect(recipients).toHaveLength(1);
    expect(recipients[0].dogs.map((dog) => dog.petId)).toEqual(['p-thor']);
  });

  test('a stage without a published recipe in the market is not announced', async () => {
    const { service } = serviceWith([
      plan(1, 7, ['p-luna', 'p-thor'], [puppy('p-luna', 'Luna'), senior('p-thor', 'Thor')])
    ], ['adult', 'senior']);
    const recipients = await service.recipients('BR');
    expect(recipients[0].dogs.map((dog) => dog.petName)).toEqual(['Thor']);
  });
});

describe('launch announcement letter (2.13)', () => {
  const dogs = [
    { petName: 'Luna', stage: 'puppy', recipes: ['Receita de Frango e Porco para Filhotes'], adjustUrl: 'https://edenbowls.com/dashboard/plans/sub_1/packs?pet=p-luna' },
    { petName: 'Thor', stage: 'senior', recipes: ['Receita de Carne para Cães Sênior'], adjustUrl: 'https://edenbowls.com/dashboard/plans/sub_1/packs?pet=p-thor' }
  ];

  test('pt-BR names each dog with a link to Ajustar packs of its plan', () => {
    const email = buildLifeStageAnnouncementEmail({ firstName: 'Ana', dogs, locale: 'pt-BR' });
    expect(email.subject).toBe('Novidade na Eden Bowls: receitas para filhotes e cães sênior');
    expect(email.text).toContain('Luna · fase Filhote');
    expect(email.text).toContain('Thor · fase Sênior');
    expect(email.html).toContain('Ajustar packs de Luna');
    expect(email.html).toContain('/dashboard/plans/sub_1/packs?pet=p-thor');
    expect(email.text).toContain('Os planos não mudam sozinhos');
  });

  test('footer: company line and unsubscribe line, no security note', () => {
    const email = buildLifeStageAnnouncementEmail({
      firstName: 'Ana',
      dogs,
      profileUrl: 'https://edenbowls.com/dashboard/profile',
      companyLine: 'C. C. J. Lovato Ltda · CNPJ 65.291.985/0001-05 · Rua Delmiro Fetter dos Santos, 94, Cajuru, Curitiba – PR, CEP 82950-130',
      locale: 'pt-BR'
    });
    expect(email.html).toContain('CNPJ 65.291.985/0001-05 · Rua Delmiro Fetter dos Santos, 94, Cajuru, Curitiba – PR, CEP 82950-130');
    expect(email.html).toContain('Abrir meu perfil');
    expect(email.html).not.toContain('Nunca compartilhe');
    expect(email.text).toContain('CEP 82950-130');
  });

  test('en-US for a senior only', () => {
    const email = buildLifeStageAnnouncementEmail({ firstName: 'Ana', dogs: [{ ...dogs[1], recipes: ['Beef Recipe for Senior Dogs'] }], locale: 'en-US' });
    expect(email.subject).toBe('New at Eden Bowls: recipes for senior dogs');
    expect(email.text).toContain('Thor · Senior stage');
    expect(email.html).toContain("Adjust Thor's packs");
  });

  test('the preview catalog has the announcement in both locales', () => {
    for (const locale of ['pt-BR', 'en-US']) {
      const item = listEmailPreviews({ locale }).find((entry) => entry.id === 'life-stage-announcement');
      expect(item.content.html).toContain('Luna');
      expect(item.content.html).toContain('Thor');
    }
  });
});
