/**
 * End-to-end search test: three real selfies against every photo in one event.
 *
 *   npm run test:search -- "Event name" [selfie folder]
 *
 * Prints every photo ranked by match score and writes a crop of the
 * best-matching face from each photo to <selfie folder>/review/, named by
 * score, so a human can confirm the matches are really that person.
 *
 * This is a Phase 3 proving tool. The real participant search arrives in
 * Phase 5 as POST /api/events/:eventId/search.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { config } from '../src/config.js';
import { GoogleDriveService } from '../src/services/googleDrive.js';
import { FaceRecognitionService, compareEmbeddings } from '../src/services/faceRecognition.js';
import { ensureDecodableImage } from '../src/utils/imageConverter.js';

const [eventName, selfieDirArg] = process.argv.slice(2);
const selfieDir = path.resolve(config.backendRoot, selfieDirArg ?? '../vayu');

if (!eventName) {
  console.error('Usage: npm run test:search -- "Event name" [selfie folder]');
  process.exit(1);
}

const drive = new GoogleDriveService();
const face = new FaceRecognitionService();
await face.load();

// --- selfies -------------------------------------------------------------
const selfieFiles = fs
  .readdirSync(selfieDir)
  .filter((f) => /\.(jpe?g|png|webp|heic|heif)$/i.test(f))
  .sort();

if (selfieFiles.length === 0) {
  console.error(`No images found in ${selfieDir}`);
  process.exit(1);
}

console.log(`Selfies from ${selfieDir}\n`);
const selfieEmbeddings = [];

for (const file of selfieFiles) {
  const full = path.join(selfieDir, file);
  const { buffer } = await ensureDecodableImage(fs.readFileSync(full), { name: file });
  const faces = await face.detectAndEmbed(buffer);

  if (faces.length === 0) {
    console.log(`  ${file}: no face detected — rejected`);
  } else if (faces.length > 1) {
    console.log(`  ${file}: ${faces.length} faces — rejected, needs one person only`);
  } else {
    console.log(`  ${file}: face detected (score ${faces[0].score.toFixed(2)})`);
    selfieEmbeddings.push(faces[0].embedding);
  }
}

if (selfieEmbeddings.length === 0) {
  console.error('\nNo usable selfies.');
  process.exit(1);
}

// The same person photographed three times: how consistent are they? This is
// the ceiling for what to expect against event photos.
const agreement = [];
for (let i = 0; i < selfieEmbeddings.length; i += 1) {
  for (let j = i + 1; j < selfieEmbeddings.length; j += 1) {
    agreement.push(compareEmbeddings(selfieEmbeddings[i], selfieEmbeddings[j]));
  }
}
if (agreement.length) {
  console.log(`  agreement between selfies: ${agreement.map((a) => a.toFixed(3)).join(', ')}`);
}

// --- event ---------------------------------------------------------------
const events = await drive.listEvents();
const event = events.find((e) => e.name.trim().toLowerCase() === eventName.trim().toLowerCase());

if (!event) {
  console.error(`\nEvent not found: "${eventName}"`);
  console.error(`Available: ${events.map((e) => e.name.trim()).join(', ')}`);
  process.exit(1);
}

const photos = await drive.listPhotos(event.id);
console.log(`\nSearching "${event.name.trim()}" — ${photos.length} photos\n`);

const reviewDir = path.join(selfieDir, 'review');
fs.rmSync(reviewDir, { recursive: true, force: true });
fs.mkdirSync(reviewDir, { recursive: true });

const results = [];
let facesScanned = 0;

for (const [index, photo] of photos.entries()) {
  const raw = await drive.downloadFileToBuffer(photo.id);
  const { buffer } = await ensureDecodableImage(raw, photo);
  const { image, faces } = await face.detectFaces(buffer);
  facesScanned += faces.length;

  let best = { score: 0, face: null, perSelfie: selfieEmbeddings.map(() => 0) };

  for (const detected of faces) {
    const embedding = await face.generateEmbedding(image, detected);
    const perSelfie = selfieEmbeddings.map((s) => compareEmbeddings(s, embedding));
    const score = Math.max(...perSelfie);
    if (score > best.score) best = { score, face: detected, perSelfie };
  }

  if (best.face) {
    // Crop with margin so the face is recognizable in the review image.
    const [x1, y1, x2, y2] = best.face.box;
    const margin = Math.round((x2 - x1) * 0.4);
    const left = Math.max(0, x1 - margin);
    const top = Math.max(0, y1 - margin);

    await sharp(image.data, {
      raw: { width: image.width, height: image.height, channels: 3 },
    })
      .extract({
        left,
        top,
        width: Math.min(image.width - left, x2 - x1 + margin * 2),
        height: Math.min(image.height - top, y2 - y1 + margin * 2),
      })
      .resize(200, 200, { fit: 'cover' })
      .jpeg({ quality: 90 })
      .toFile(path.join(reviewDir, `${best.score.toFixed(3)}_${path.parse(photo.name).name}.jpg`));
  }

  results.push({
    name: photo.name,
    faces: faces.length,
    score: best.score,
    perSelfie: best.perSelfie,
    faceWidth: best.face ? best.face.box[2] - best.face.box[0] : 0,
  });

  process.stdout.write(`\r  scanned ${index + 1}/${photos.length}`);
}

// --- report --------------------------------------------------------------
const threshold = config.faceMatchThreshold;
results.sort((a, b) => b.score - a.score);
const matches = results.filter((r) => r.score >= threshold);

const line = (r) =>
  `  ${r.score.toFixed(3)}  [${r.perSelfie.map((s) => s.toFixed(2)).join(' ')}]  ` +
  `${String(r.faceWidth).padStart(3)}px face  ${r.faces} in photo  ${r.name}`;

console.log(`\n\nMatches at threshold ${threshold}: ${matches.length} of ${photos.length} photos\n`);
for (const r of matches) console.log(line(r));

console.log('\nClosest non-matches:');
for (const r of results.filter((r) => r.score < threshold).slice(0, 8)) console.log(line(r));

console.log(`\n${facesScanned} faces scanned across ${photos.length} photos.`);
console.log(`Face crops written to ${reviewDir} — filename is the match score.`);
