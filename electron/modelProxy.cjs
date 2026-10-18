function normalizeModelProxyBaseUrl(value) {
  const url = new URL(value.trim());
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'Local proxy testing requires a loopback URL without credentials or query parameters.',
    );
  }
  url.pathname = url.pathname.replace(/\/v1(?:\/messages)?\/?$/, '').replace(/\/$/, '');
  const root = url.toString().replace(/\/$/, '');
  return { root, apiBase: `${root}/v1` };
}

function readModelProxyConfig(settings) {
  const config = settings.modelProxy;
  if (config?.enabled === false || (!config?.baseUrl && !config?.model)) return undefined;
  if (!config.baseUrl?.trim() || !config.model?.trim()) {
    throw new Error('Local proxy testing requires both a base URL and model.');
  }
  return { ...normalizeModelProxyBaseUrl(config.baseUrl), model: config.model.trim() };
}

async function resolveModelProxyConfig(settings) {
  const config = readModelProxyConfig(settings);
  if (!config) return undefined;
  const response = await fetch(`${config.apiBase}/models`, {
    signal: AbortSignal.timeout(15000),
    redirect: 'error',
  });
  if (!response.ok)
    throw new Error(`Local proxy model discovery failed (HTTP ${response.status}).`);
  const payload = await response.json();
  if (!Array.isArray(payload?.data)) throw new Error('Invalid local proxy model catalog.');
  const available = payload.data
    .filter(
      (entry) =>
        !entry.served_on || entry.served_on.includes('/v1/messages') || entry.messages_route,
    )
    .map((entry) => entry.id);
  if (!available.includes(config.model)) {
    throw new Error(`Configured local proxy model is unavailable: ${config.model}`);
  }
  return config;
}

module.exports = { normalizeModelProxyBaseUrl, readModelProxyConfig, resolveModelProxyConfig };
