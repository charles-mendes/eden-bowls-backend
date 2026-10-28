const { HttpError } = require('../core/http-error');
const { parseLegalPublication } = require('../core/legal-documents');

function actorIdOf(actor) {
  const id = actor && (actor.userId || actor.id);
  return id ? Number(id) : null;
}

function notFound() {
  return new HttpError(404, 'Legal document not found.', { code: 'legal_document_not_found' });
}

function publicPayload(document) {
  return { market: document.market, kind: document.kind, version: document.version, published_at: document.publishedAt, body_markdown: document.body };
}

// Privacy policy and terms of use per market (legal-documents): the store reads the current version, the
// admin publishes a new one, and a consent records a version that was published.
class LegalDocumentsService {
  constructor({ repository, auditRepository = null, dataSource = null } = {}) {
    this.repository = repository;
    this.auditRepository = auditRepository;
    this.dataSource = dataSource;
  }

  async current(market, kind) {
    const document = await this.repository.current(market, kind);
    if (!document) {
      throw notFound();
    }
    return publicPayload(document);
  }

  // The current version id, or null before any publication.
  async currentVersion(market, kind) {
    const document = await this.repository.current(market, kind);
    return document ? document.version : null;
  }

  async isPublished(market, kind, version) {
    return Boolean(version && await this.repository.findVersion(market, kind, version));
  }

  async overview(market, kind) {
    const [current, versions] = await Promise.all([this.repository.current(market, kind), this.repository.versions(market, kind)]);
    return {
      market,
      kind,
      current: current ? publicPayload(current) : null,
      versions: versions.map((item) => ({ version: item.version, published_at: item.publishedAt, published_by: item.publishedBy }))
    };
  }

  async version(market, kind, version) {
    const document = await this.repository.findVersion(market, kind, version);
    if (!document) {
      throw notFound();
    }
    return publicPayload(document);
  }

  async publish(market, kind, input, actor = {}) {
    const { version, body } = parseLegalPublication(input);
    const work = async (manager) => {
      await this.repository.publish({ market, kind, version, body, actorId: actorIdOf(actor) }, manager);
      if (this.auditRepository && typeof this.auditRepository.createIn === 'function') {
        await this.auditRepository.createIn(manager, {
          actorUserId: actorIdOf(actor),
          actorEmail: (actor && actor.email) || null,
          action: 'legal.document.publish',
          metadata: { market, kind, version }
        });
      }
    };
    if (this.dataSource && typeof this.dataSource.transaction === 'function') {
      await this.dataSource.transaction(work);
    } else {
      await work(this.dataSource);
    }
    return this.overview(market, kind);
  }
}

module.exports = {
  LegalDocumentsService
};
