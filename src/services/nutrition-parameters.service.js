const { HttpError } = require('../core/http-error');
const { parseNutritionParameters, upgradeNutritionParameters } = require('../core/nutrition-parameters');

const HISTORY_LIMIT = 50;
const VALUE_SECTIONS = ['base', 'state', 'combination', 'nem'];

// Each factor and breed group that differs between two parameter sets, as `{ field, from, to }`.
function changesBetween(before, after) {
  const changes = [];
  if (!before || !after) return changes;
  for (const section of VALUE_SECTIONS) {
    const keys = new Set([...Object.keys(before[section] || {}), ...Object.keys(after[section] || {})]);
    for (const key of keys) {
      const from = before[section] ? before[section][key] : undefined;
      const to = after[section] ? after[section][key] : undefined;
      if (from !== to) changes.push({ field: `${section}.${key}`, from: from === undefined ? null : from, to: to === undefined ? null : to });
    }
  }
  const groups = new Set([...Object.keys(before.breed_groups || {}), ...Object.keys(after.breed_groups || {})]);
  for (const group of groups) {
    const from = ((before.breed_groups || {})[group] || []).join(', ');
    const to = ((after.breed_groups || {})[group] || []).join(', ');
    if (from !== to) changes.push({ field: `breed_groups.${group}`, from, to });
  }
  return changes;
}

function actorIdOf(actor) {
  const id = actor && (actor.userId || actor.id);
  return id ? Number(id) : null;
}

// Draft, publication and history of the nutrition parameter set (nutrition-parameters). There is at most one
// draft; publishing retires the published set in the same transaction as the audit event.
class NutritionParametersService {
  constructor({ repository, auditRepository = null, dataSource = null } = {}) {
    this.repository = repository;
    this.auditRepository = auditRepository;
    this.dataSource = dataSource;
  }

  async overview() {
    const [published, draft, history, audit] = await Promise.all([
      this.repository.published(),
      this.repository.draft(),
      this.repository.history(),
      this.auditLog()
    ]);
    return { published, draft, history, audit };
  }

  // Draft saves, discards, copies and publications, newest first: who, when and what changed.
  async auditLog() {
    if (!this.auditRepository || typeof this.auditRepository.listByActionPrefix !== 'function') return [];
    return this.auditRepository.listByActionPrefix({ actionPrefix: 'nutrition.parameters.', limit: HISTORY_LIMIT });
  }

  // An audit event outside a transaction: the draft is not what customers get, so a failed write does not undo it.
  async record(actor, action, metadata) {
    if (!this.auditRepository || typeof this.auditRepository.create !== 'function') return;
    await this.auditRepository.create({ actorUserId: actorIdOf(actor), actorEmail: (actor && actor.email) || null, action, metadata });
  }

  // Parameters for a calculation: the published set, or the draft when asked (falls back to the published one).
  async parametersFor(selection = 'published') {
    if (selection === 'draft') {
      const draft = await this.repository.draft();
      if (!draft) {
        throw new HttpError(409, 'There is no nutrition parameter draft to simulate with.', { code: 'nutrition_draft_missing' });
      }
      return { id: draft.id, parameters: draft.parameters, status: 'draft' };
    }
    const published = await this.repository.published();
    return { id: published.id, parameters: published.parameters, status: 'published' };
  }

  async saveDraft(input, actor = {}) {
    const parameters = parseNutritionParameters(input);
    const [draft, published] = await Promise.all([this.repository.draft(), this.repository.published()]);
    const before = draft ? draft.parameters : published.parameters;
    const saved = await this.repository.saveDraft({ parameters, actorId: actorIdOf(actor) });
    await this.record(actor, 'nutrition.parameters.draft.save', { set_id: saved && saved.id, changes: changesBetween(before, parameters) });
    return saved;
  }

  // A previous set as the new draft, to publish it again.
  async copyToDraft(setId, actor = {}) {
    const set = await this.repository.findById(setId);
    if (!set || set.status === 'draft') {
      throw new HttpError(404, 'Nutrition parameter set not found.', { code: 'nutrition_parameter_set_not_found' });
    }
    const saved = await this.repository.saveDraft({ parameters: parseNutritionParameters(upgradeNutritionParameters(set.parameters)), actorId: actorIdOf(actor) });
    await this.record(actor, 'nutrition.parameters.copy_to_draft', { from_set_id: set.id, set_id: saved && saved.id });
    return saved;
  }

  async discardDraft(actor = {}) {
    const draft = await this.repository.draft();
    await this.repository.deleteDraft();
    if (draft) await this.record(actor, 'nutrition.parameters.draft.discard', { set_id: draft.id });
    return { discarded: true };
  }

  async publish(actor = {}) {
    const draft = await this.repository.draft();
    if (!draft) {
      throw new HttpError(409, 'There is no nutrition parameter draft to publish.', { code: 'nutrition_draft_missing' });
    }
    // A draft saved before a validation change is checked again before it reaches customers.
    parseNutritionParameters(draft.parameters);
    const previous = await this.repository.published();
    const work = async (manager) => {
      await this.repository.publishDraft({ draftId: draft.id, actorId: actorIdOf(actor) }, manager);
      if (this.auditRepository && typeof this.auditRepository.createIn === 'function') {
        await this.auditRepository.createIn(manager, {
          actorUserId: actorIdOf(actor),
          actorEmail: (actor && actor.email) || null,
          action: 'nutrition.parameters.publish',
          metadata: { from_set_id: previous.id, to_set_id: draft.id, changes: changesBetween(previous.parameters, draft.parameters) }
        });
      }
    };
    if (this.dataSource && typeof this.dataSource.transaction === 'function') {
      await this.dataSource.transaction(work);
    } else {
      await work(this.dataSource);
    }
    this.repository.clearCache();
    return this.repository.published();
  }
}

module.exports = {
  NutritionParametersService
};
