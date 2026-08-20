function parsePageQuery(query = {}, options = {}) {
  const defaultPerPage = Number(options.defaultPerPage || 20);
  const maxPerPage = Number(options.maxPerPage || 100);
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const perPage = Math.min(maxPerPage, Math.max(1, Number.parseInt(query.perPage, 10) || defaultPerPage));

  return {
    page,
    perPage,
    offset: (page - 1) * perPage
  };
}

function paginatedEnvelope({ items, total, page, perPage }) {
  const safeTotal = Number(total || 0);
  return {
    total: safeTotal,
    page,
    perPage,
    totalPages: Math.max(1, Math.ceil(safeTotal / Math.max(1, perPage))),
    items
  };
}

module.exports = {
  paginatedEnvelope,
  parsePageQuery
};
