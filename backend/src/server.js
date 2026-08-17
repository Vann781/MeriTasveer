import app from './app.js';
import { config } from './config.js';
import { initDb } from './db/database.js';
import * as queries from './db/queries.js';
import { getIndexingService } from './services/indexing.js';

const db = initDb();

// Nothing is indexing immediately after a restart, so any event still marked
// "indexing" was interrupted. Mark it failed so it can be retried.
const interrupted = queries.resetInterruptedIndexing(db);
if (interrupted > 0) {
  console.warn(`${interrupted} interrupted index run(s) marked as failed.`);
}

app.listen(config.port, async () => {
  console.log(`Event Photo Finder API listening on http://localhost:${config.port}`);
  console.log(`Health check: http://localhost:${config.port}/api/health`);

  if (!config.googleDrive.rootFolderId) {
    console.warn('Warning: GOOGLE_DRIVE_ROOT_FOLDER_ID is not set — /api/events will be empty.');
    return;
  }

  // Pick up folders added in Drive since the last run. Best effort: the API
  // still serves whatever is already in the database if Drive is unreachable.
  try {
    const { total, added } = await getIndexingService().syncEvents();
    console.log(`Events synced from Drive: ${total} total${added ? `, ${added} new` : ''}`);
  } catch (err) {
    console.warn(`Warning: could not sync events from Drive — ${err.message}`);
  }
});
