/**
 * Indexes event photos into SQLite.
 *
 *   npm run index -- --list            show events and their status
 *   npm run index -- "Event name"      index one event
 *   npm run index -- --all             index every event that is not ready
 *   npm run index -- --all --force     re-index everything
 *
 * Photos are downloaded, measured and discarded. Only metadata and face
 * embeddings are stored; the images stay in Google Drive.
 */
import { initDb } from '../src/db/database.js';
import * as queries from '../src/db/queries.js';
import { IndexingService } from '../src/services/indexing.js';

const args = process.argv.slice(2);
const force = args.includes('--force');
const all = args.includes('--all');
const listOnly = args.includes('--list');
const eventName = args.find((a) => !a.startsWith('--'));

const db = initDb();
const indexing = new IndexingService({ db });

const duration = (ms) => {
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

console.log('Syncing events from Google Drive…');
const sync = await indexing.syncEvents();
console.log(`  ${sync.total} events (${sync.added} new)\n`);

const events = queries.listEvents(db);

if (listOnly || (!eventName && !all)) {
  const width = Math.max(...events.map((e) => e.name.length));
  for (const event of events) {
    const indexed = event.indexed_at ? ` indexed ${event.indexed_at.slice(0, 10)}` : '';
    console.log(
      `  ${event.name.padEnd(width)}  ${event.status.padEnd(9)}  ` +
        `${String(event.photo_count).padStart(4)} photos${indexed}`,
    );
  }
  if (!listOnly) console.log('\nPass an event name or --all to index.');
  process.exit(0);
}

const targets = all
  ? events.filter((e) => force || e.status !== 'ready')
  : [queries.getEventByName(db, eventName)].filter(Boolean);

if (targets.length === 0) {
  if (!all) {
    console.error(`Event not found: "${eventName}"`);
    console.error(`Available: ${events.map((e) => e.name).join(', ')}`);
    process.exit(1);
  }
  console.log('Nothing to index — every event is already ready. Use --force to redo them.');
  process.exit(0);
}

console.log(`Indexing ${targets.length} event(s)\n`);
const totals = { photos: 0, faces: 0, failed: 0, ms: 0 };

for (const target of targets) {
  process.stdout.write(`  ${target.name}\n`);

  const result = await indexing.indexEvent(target.id, {
    onProgress: (p) => {
      const done = p.processed + p.failed;
      process.stdout.write(
        `\r    ${String(done).padStart(4)}/${p.total} photos, ${p.faces} faces` +
          `${p.failed ? `, ${p.failed} failed` : ''}   `,
      );
    },
  });

  process.stdout.write(
    `\r    ${result.processed}/${result.total} photos, ${result.faces} faces in ` +
      `${result.photosWithFaces} photos` +
      `${result.failed ? `, ${result.failed} failed` : ''}` +
      `${result.skippedUnsupported ? `, ${result.skippedUnsupported} non-images skipped` : ''}` +
      `  (${duration(result.durationMs)})\n\n`,
  );

  totals.photos += result.processed;
  totals.faces += result.faces;
  totals.failed += result.failed;
  totals.ms += result.durationMs;
}

console.log(
  `Done: ${totals.photos} photos, ${totals.faces} faces` +
    `${totals.failed ? `, ${totals.failed} failed` : ''} in ${duration(totals.ms)}.`,
);
