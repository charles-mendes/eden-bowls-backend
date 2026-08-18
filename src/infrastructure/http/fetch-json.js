async function fetchJson(url, options = {}) {
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 5000;
  const headers = options.headers || {};
  const method = options.method || 'GET';
  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method,
      headers,
      signal: controller.signal
    });
    const text = await response.text();
    let body = null;

    try {
      body = text ? JSON.parse(text) : null;
    } catch (_error) {
      body = null;
    }

    return {
      ok: response.ok,
      status: Number(response.status) || 0,
      body
    };
  } catch (error) {
    const aborted = Boolean(error && (error.name === 'AbortError' || error.code === 'ABORT_ERR'));
    return {
      ok: false,
      status: 0,
      body: null,
      timeout: aborted,
      networkError: !aborted
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  fetchJson
};
