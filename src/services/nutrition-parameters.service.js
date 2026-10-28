const { HttpError } = require('../core/http-error');
const { parseNutritionParameters } = require('../core/nutrition-parameters');

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
    const [published, draft, history] = await Promise.all([
      this.repository.published(),
      this.repository.draft(),
      this.repository.history()
    ]);
    return { published, draft, history };
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
    return this.repository.saveDraft({ parameters, actorId: actorIdOf(actor) });
  }

  // A previous set as the new draft, to publish it again.
  async copyToDraft(setId, actor = {}) {
    const set = await this.repository.findById(setId);
    if (!set || set.status === 'draft') {
      throw new HttpError(404, 'Nutrition parameter set not found.', { code: 'nutrition_parameter_set_not_found' });
    }
    return this.repository.saveDraft({ parameters: parseNutritionParameters(set.parameters), actorId: actorIdOf(actor) });
  }

  async discardDraft() {
    await this.repository.deleteDraft();
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
          metadata: { from_set_id: previous.id, to_set_id: draft.id }
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
