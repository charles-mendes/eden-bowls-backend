const { COMPANY_PROFILE_SEED, COMPANY_MARKETS, companyMarket } = require('../company-profile');

const REFRESH_MS = 60 * 1000;

// The company profile of each market as the email layout reads it (company-profile). The layout is
// synchronous, so this process keeps the last profiles read from company_profiles: loaded at start, read again
// every 60 s (the cache window of the repository) and replaced at once when the admin saves in this process.
// Before the first read, the data printed before the table applies.
const profiles = new Map(COMPANY_MARKETS.map((market) => [market, COMPANY_PROFILE_SEED[market]]));

function setCompanyProfile(market, profile) {
  if (profile) {
    profiles.set(companyMarket(market), profile);
  }
}

function companyProfileFor(market) {
  return profiles.get(companyMarket(market));
}

// Letters know their locale: Portuguese ones are BR letters, any other (OTP and invites included) reads as US.
function supportEmailFor(locale) {
  const market = String(locale || '').toLowerCase().startsWith('pt') ? 'BR' : 'US';
  return companyProfileFor(market).supportEmail;
}

async function refreshCompanyDirectory(repository, logger) {
  if (!repository || typeof repository.forMarket !== 'function') {
    return;
  }
  for (const market of COMPANY_MARKETS) {
    try {
      setCompanyProfile(market, await repository.forMarket(market));
    } catch (error) {
      if (logger && typeof logger.warn === 'function') {
        logger.warn({ err: error, market }, 'company profile refresh failed; keeping the last one read');
      }
    }
  }
}

// Reads the profiles now and every 60 s; the timer does not keep the process alive. Returns a stop function.
function startCompanyDirectory(repository, { logger, intervalMs = REFRESH_MS } = {}) {
  const ready = refreshCompanyDirectory(repository, logger);
  const timer = setInterval(() => { refreshCompanyDirectory(repository, logger); }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return { ready, stop: () => clearInterval(timer) };
}

function resetCompanyDirectory() {
  for (const market of COMPANY_MARKETS) {
    profiles.set(market, COMPANY_PROFILE_SEED[market]);
  }
}

module.exports = {
  companyProfileFor,
  refreshCompanyDirectory,
  resetCompanyDirectory,
  setCompanyProfile,
  startCompanyDirectory,
  supportEmailFor
};
