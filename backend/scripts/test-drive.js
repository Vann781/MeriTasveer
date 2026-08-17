/**
 * Google Drive integration check (Phase 2).
 *
 *   Backend -> Google Drive -> Root folder -> Event folders -> Photos -> Download
 *
 * Run with: npm run test:drive
 * Exits 0 when the whole chain works, 1 with an actionable message otherwise.
 */
import fs from 'node:fs';
import { config } from '../src/config.js';
import { GoogleDriveService } from '../src/services/googleDrive.js';

const steps = 5;
let current = 0;

function step(title, detail) {
  current += 1;
  console.log(`[${current}/${steps}] ${title.padEnd(14)} ${detail}`);
}

function fail(title, detail, hints = []) {
  current += 1;
  console.error(`[${current}/${steps}] ${title.padEnd(14)} FAILED — ${detail}`);
  for (const hint of hints) console.error(`      → ${hint}`);
  process.exit(1);
}

/** Turn a Google API error into something the organizer can act on. */
function driveHints(err) {
  const status = err?.status ?? err?.code;
  if (status === 403) {
    return [
      'The service account cannot see this folder.',
      'Share the root folder in Google Drive with the service account email as "Viewer".',
      'Also confirm the Google Drive API is enabled for the project.',
    ];
  }
  if (status === 404) {
    return [
      'The folder ID was not found.',
      'Check GOOGLE_DRIVE_ROOT_FOLDER_ID — copy it from the folder URL:',
      'https://drive.google.com/drive/folders/<THIS_PART>',
    ];
  }
  return ['Check the network connection and the service account key file.'];
}

function formatBytes(bytes) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${(bytes / 1024).toFixed(0)} KB`;
}

const drive = new GoogleDriveService();

console.log('Google Drive integration check\n');

// 1 — configuration
try {
  drive.assertConfigured();
  step('Config', `root folder ID set, key file ${config.googleDrive.serviceAccountKeyFile}`);
} catch (err) {
  fail('Config', err.message, [
    'Copy backend/.env.example to backend/.env and fill in the Google Drive values.',
  ]);
}

// 2 — authentication
let email;
try {
  email = await drive.getServiceAccountEmail();
  await drive.getClient();
  step('Auth', `service account ${email}`);
} catch (err) {
  fail('Auth', err.message, ['Verify the service account JSON key file is valid.']);
}

// 3 — root folder
let root;
try {
  root = await drive.getRootFolder();
  step('Root folder', `"${root.name}"`);
} catch (err) {
  fail('Root folder', err.message, driveHints(err));
}

// 4 — event folders
let events = [];
try {
  events = await drive.listEvents();
  if (events.length === 0) {
    fail('Events', 'no subfolders found in the root folder', [
      `Add one folder per event inside "${root.name}", e.g. "XYZ Fun Activity".`,
    ]);
  }
  const names = events.map((e) => e.name.trim());
  const preview = names.slice(0, 5).join(', ');
  step('Events', `${events.length} found — ${preview}${names.length > 5 ? ', …' : ''}`);
} catch (err) {
  fail('Events', err.message, driveHints(err));
}

// 5 — photos + one temporary download
try {
  // Some event folders are empty, so try them in turn until one has images.
  let event;
  let photos = [];
  let emptyEvents = 0;

  for (const candidate of events) {
    photos = await drive.listPhotos(candidate.id);
    if (photos.length > 0) {
      event = candidate;
      break;
    }
    emptyEvents += 1;
  }

  if (!event) {
    fail('Photos', 'none of the event folders contain images', [
      'Add some JPG/PNG files to an event folder and run this check again.',
    ]);
  }
  if (emptyEvents > 0) {
    console.log(`      note: skipped ${emptyEvents} event folder(s) with no images`);
  }

  const photo = photos[0];
  const tempPath = await drive.downloadFileToTemp(photo.id, photo.name);
  const { size } = fs.statSync(tempPath);
  fs.unlinkSync(tempPath); // event images are never kept on the server

  step(
    'Photos',
    `"${event.name}": ${photos.length} images; downloaded ${photo.name} (${formatBytes(size)}) -> temp, deleted`,
  );
} catch (err) {
  fail('Photos', err.message, driveHints(err));
}

console.log('\nGoogle Drive integration is working.');
