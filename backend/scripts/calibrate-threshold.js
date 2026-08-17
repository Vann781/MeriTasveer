/**
 * Works out a sensible FACE_MATCH_THRESHOLD from real event photos.
 *
 * Compares every face against every face from *other* photos in one event.
 * Most pairs are different people and score near zero; the smaller group of
 * high scores is the same person appearing in several photos. The gap between
 * those two groups is where the threshold belongs.
 *
 * Run with: npm run calibrate  ["Event name"]  [photo count]
 */
import { GoogleDriveService } from '../src/services/googleDrive.js';
import { FaceRecognitionService, compareEmbeddings } from '../src/services/faceRecognition.js';
import { ensureDecodableImage } from '../src/utils/imageConverter.js';

const [eventArg, countArg] = process.argv.slice(2);
const photoLimit = Number(countArg) || 40;

const drive = new GoogleDriveService();
const face = new FaceRecognitionService();

await face.load();
const events = await drive.listEvents();

const event = eventArg
  ? events.find((e) => e.name.trim().toLowerCase() === eventArg.trim().toLowerCase())
  : events.find((e) => e.name.trim() === 'Alumini folder') ?? events[0];

if (!event) {
  console.error(`Event not found. Available: ${events.map((e) => e.name.trim()).join(', ')}`);
  process.exit(1);
}

const photos = (await drive.listPhotos(event.id)).slice(0, photoLimit);
console.log(`Calibrating on "${event.name.trim()}" — ${photos.length} photos\n`);

const faces = [];

for (const [index, photo] of photos.entries()) {
  const original = await drive.downloadFileToBuffer(photo.id);
  const { buffer } = await ensureDecodableImage(original, photo);
  const detected = await face.detectAndEmbed(buffer);
  for (const f of detected) faces.push({ photo: index, embedding: f.embedding });
  process.stdout.write(`\r  processed ${index + 1}/${photos.length} photos, ${faces.length} faces`);
}

console.log('\n');

// Only compare faces from different photos — two faces in one photo are
// different people by definition and would skew the low end.
const scores = [];
for (let i = 0; i < faces.length; i += 1) {
  for (let j = i + 1; j < faces.length; j += 1) {
    if (faces[i].photo !== faces[j].photo) {
      scores.push(compareEmbeddings(faces[i].embedding, faces[j].embedding));
    }
  }
}

if (scores.length === 0) {
  console.error('Not enough faces to compare.');
  process.exit(1);
}

// Histogram in 0.05 buckets, from -1 to 1.
const bucketSize = 0.05;
const buckets = new Map();
for (const score of scores) {
  const bucket = Math.floor(score / bucketSize) * bucketSize;
  buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
}

const ordered = [...buckets.entries()].sort((a, b) => a[0] - b[0]);
const peak = Math.max(...ordered.map(([, count]) => count));

console.log(`  ${scores.length} cross-photo face pairs\n`);
for (const [bucket, count] of ordered) {
  if (bucket < -0.2) continue;
  const bar = '#'.repeat(Math.max(1, Math.round((count / peak) * 50)));
  console.log(`  ${bucket.toFixed(2)}  ${count.toString().padStart(6)}  ${bar}`);
}

// The valley between "different people" and "same person".
const candidates = ordered.filter(([bucket]) => bucket >= 0.2 && bucket <= 0.75);
const valley = candidates.reduce((lowest, entry) => (entry[1] < lowest[1] ? entry : lowest), candidates[0]);

const above = (t) => scores.filter((s) => s >= t).length;

console.log('\n  Pairs treated as the same person:');
for (const t of [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6]) {
  console.log(`    ${t.toFixed(2)}  ${above(t).toString().padStart(6)}  (${((above(t) / scores.length) * 100).toFixed(2)}% of pairs)`);
}

if (valley) {
  console.log(`\n  Quietest bucket between the two groups: ${valley[0].toFixed(2)} (${valley[1]} pairs)`);
  console.log('  A threshold at or just above that value separates them.');
}
