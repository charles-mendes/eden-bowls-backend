class AdminAuditService {
  constructor(options = {}) {
    this.repository = options.repository || null;
    this.logger = options.logger || { error() {}, info() {}, debug() {} };
  }

  async record(event = {}) {
    if (!this.repository || typeof this.repository.create !== 'function') {
      return;
    }

    const metadata = event.metadata && typeof event.metadata === 'object'
      ? { ...event.metadata }
      : {};
    delete metadata.password;
    delete metadata.temporaryPassword;
    delete metadata.user_pass;

    try {
      await this.repository.create({
        actorUserId: event.actorUserId || (event.actor && event.actor.userId) || null,
        actorEmail: event.actorEmail || (event.actor && event.actor.email) || null,
        action: event.action,
        targetUserId: event.targetUserId || (event.target && event.target.id) || null,
        targetEmail: event.targetEmail || (event.target && event.target.email) || null,
        metadata
      });
    } catch (error) {
      this.logger.error({ action: event.action, err: error && error.message }, 'Failed to write admin audit event.');
    }
  }
}

module.exports = {
  AdminAuditService
};
