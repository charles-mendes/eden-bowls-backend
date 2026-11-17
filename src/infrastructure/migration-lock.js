// The API and the cron start together on deploy and both run the migrations on boot. Without a lock they ran the
// same migrations at once: one crashed on "Duplicate column", data migrations ran twice and `migrations` got
// duplicate rows. A MySQL named lock makes the runs take turns: the one that waits finds nothing pending.
const LOCK_NAME = 'eden_bowls_migrations';
// The catalog split and the nutrition upgrades take seconds; a whole first deploy can take a few minutes.
const DEFAULT_WAIT_SECONDS = 600;

class MigrationLockError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MigrationLockError';
  }
}

function lockValue(rows) {
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return null;
  const value = Object.values(row)[0];
  return value == null ? null : Number(value);
}

/**
 * Runs the pending migrations while holding the named lock on one connection of the pool. The lock lives on that
 * connection, so it is released on RELEASE_LOCK or when the connection closes (a crashed process never keeps it).
 */
async function runMigrationsExclusively(dataSource, { logger, waitSeconds = DEFAULT_WAIT_SECONDS, lockName = LOCK_NAME } = {}) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  try {
    const got = lockValue(await runner.query('SELECT GET_LOCK(?, ?) AS got', [lockName, waitSeconds]));
    if (got !== 1) {
      throw new MigrationLockError(
        got === 0
          ? `Another process held the migration lock "${lockName}" for more than ${waitSeconds}s; no migration ran.`
          : `The migration lock "${lockName}" could not be taken; no migration ran.`
      );
    }
    try {
      const migrations = await dataSource.runMigrations();
      if (logger && typeof logger.info === 'function') {
        logger.info({ executed: migrations.map((migration) => migration.name) }, 'Migrations checked under the lock.');
      }
      return migrations;
    } finally {
      await runner.query('SELECT RELEASE_LOCK(?) AS released', [lockName]);
    }
  } finally {
    await runner.release();
  }
}

module.exports = {
  DEFAULT_WAIT_SECONDS,
  LOCK_NAME,
  MigrationLockError,
  runMigrationsExclusively
};
