/**
 * Face recognition proving test (Phase 3).
 *
 * Two modes:
 *
 *   npm run test:face
 *       Samples real photos from Google Drive and reports detection rate,
 *       face sizes, speed, and two sanity checks that need no labelled data:
 *         - stability:      the same face, re-encoded, must still match itself
 *         - discrimination: different people in one photo must NOT match
 *
 *   npm run test:face -- selfie1.jpg selfie2.jpg selfie3.jpg photo.jpg
 *       The README section 42 test: three selfies against one event photo.
 *       Prints face detection, embeddings and the match decision.
 */
import fs from 'node:fs';
import sharp from 'sharp';
import { config } from '../src/config.js';
import { GoogleDriveService } from '../src/services/googleDrive.js';
import { FaceRecognitionService, compareEmbeddings } from '../src/services/faceRecognition.js';
import { ensureDecodableImage, isHeif } from '../src/utils/imageConverter.js';

const args = process.argv.slice(2);
const face = new FaceRecognitionService();

const pct = (n, total) => `${((n / total) * 100).toFixed(0)}%`;
const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;

function stats(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: sum / sorted.length,
    median: sorted[Math.floor(sorted.length / 2)],
  };
}

/** Loads an image from disk, converting HEIC if needed. */
async function readImage(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  const raw = fs.readFileSync(filePath);
  const { buffer } = await ensureDecodableImage(raw, { name: filePath });
  return buffer;
}

// ---------------------------------------------------------------------------
// Mode 1 — three selfies against one photo (README section 42)
// ---------------------------------------------------------------------------
async function compareSelfiesToPhoto([s1, s2, s3, photoPath]) {
  const threshold = config.faceMatchThreshold;
  console.log('Face recognition test\n');
  await face.load();

  const selfieEmbeddings = [];

  for (const [index, selfiePath] of [s1, s2, s3].entries()) {
    const buffer = await readImage(selfiePath);
    const faces = await face.detectAndEmbed(buffer);

    if (faces.length === 0) {
      console.log(`  Selfie ${index + 1}  ${selfiePath}\n     no face detected — reject this selfie`);
      continue;
    }
    if (faces.length > 1) {
      console.log(
        `  Selfie ${index + 1}  ${selfiePath}\n     ${faces.length} faces detected — ask for a selfie of one person`,
      );
      continue;
    }

    const [only] = faces;
    console.log(
      `  Selfie ${index + 1}  ${selfiePath}\n` +
        `     face detected (score ${only.score.toFixed(2)}), ` +
        `${only.embedding.length}-d embedding generated`,
    );
    selfieEmbeddings.push(only.embedding);
  }

  if (selfieEmbeddings.length === 0) {
    console.error('\nNo usable selfies — cannot continue.');
    process.exit(1);
  }

  // How consistent are the three selfies with each other? They are the same
  // person, so this is a useful reference point for reading the scores below.
  if (selfieEmbeddings.length > 1) {
    const pairs = [];
    for (let i = 0; i < selfieEmbeddings.length; i += 1) {
      for (let j = i + 1; j < selfieEmbeddings.length; j += 1) {
        pairs.push(compareEmbeddings(selfieEmbeddings[i], selfieEmbeddings[j]));
      }
    }
    console.log(
      `\n  Selfie agreement: ${pairs.map((p) => p.toFixed(3)).join(', ')} ` +
        '(same person, so these should be high)',
    );
  }

  const photoBuffer = await readImage(photoPath);
  const photoFaces = await face.detectAndEmbed(photoBuffer);
  console.log(`\n  Photo    ${photoPath}\n     ${photoFaces.length} face(s) detected`);

  let best = 0;

  for (const photoFace of photoFaces) {
    const scores = selfieEmbeddings.map((selfie) => compareEmbeddings(selfie, photoFace.embedding));
    const strongest = Math.max(...scores);
    best = Math.max(best, strongest);

    console.log(
      `     face ${photoFace.faceIndex} at [${photoFace.box}] -> ` +
        `${scores.map((s) => s.toFixed(3)).join(' / ')}  ` +
        `best ${strongest.toFixed(3)} ${strongest >= threshold ? 'MATCH' : 'no match'}`,
    );
  }

  console.log(`\n  Threshold: ${threshold}  (FACE_MATCH_THRESHOLD)`);
  console.log(`  Result:    ${best >= threshold ? 'MATCH' : 'NO MATCH'} (best score ${best.toFixed(3)})`);
}

// ---------------------------------------------------------------------------
// Mode 2 — sanity benchmark over real Drive photos
// ---------------------------------------------------------------------------
async function benchmarkAgainstDrive() {
  const sampleSize = Number(process.env.SAMPLE_SIZE) || 15;
  const drive = new GoogleDriveService();

  console.log(`Face recognition benchmark on ${sampleSize} real event photos\n`);
  await face.load();

  // Spread the sample over several events rather than one.
  const events = await drive.listEvents();
  const sample = [];
  for (const event of events) {
    if (sample.length >= sampleSize) break;
    const photos = await drive.listPhotos(event.id);
    for (const photo of photos.slice(0, 3)) {
      if (sample.length >= sampleSize) break;
      sample.push({ ...photo, eventName: event.name.trim() });
    }
  }

  const faceCounts = [];
  const faceSizes = [];
  const times = [];
  const differentPeople = [];
  let photosWithFaces = 0;
  let heifCount = 0;
  const stabilityScores = [];

  for (const photo of sample) {
    const original = await drive.downloadFileToBuffer(photo.id);
    if (isHeif(photo)) heifCount += 1;
    const { buffer } = await ensureDecodableImage(original, photo);

    const started = Date.now();
    const faces = await face.detectAndEmbed(buffer);
    times.push(Date.now() - started);

    faceCounts.push(faces.length);
    if (faces.length > 0) photosWithFaces += 1;
    for (const f of faces) faceSizes.push(f.box[2] - f.box[0]);

    // Different faces in one photo are almost always different people.
    for (let i = 0; i < faces.length; i += 1) {
      for (let j = i + 1; j < faces.length; j += 1) {
        differentPeople.push(compareEmbeddings(faces[i].embedding, faces[j].embedding));
      }
    }

    // Same face after a 70% downscale and heavy JPEG recompression must still
    // match itself — this is what catches broken alignment or normalization.
    if (faces.length === 1) {
      const meta = await sharp(buffer).metadata();
      const degraded = await sharp(buffer)
        .rotate()
        .resize({ width: Math.round(meta.width * 0.7) })
        .jpeg({ quality: 70 })
        .toBuffer();
      const [again] = await face.detectAndEmbed(degraded);
      if (again) stabilityScores.push(compareEmbeddings(faces[0].embedding, again.embedding));
    }

    console.log(
      `  ${faces.length} face(s)  ${secs(times[times.length - 1]).padStart(6)}  ` +
        `${photo.name}  (${photo.eventName})`,
    );
  }

  const sizeStats = stats(faceSizes);
  const timeStats = stats(times);
  const stability = stats(stabilityScores);
  const discrimination = stats(differentPeople);

  console.log('\n  Detection');
  console.log(`    photos with at least one face  ${photosWithFaces}/${sample.length} (${pct(photosWithFaces, sample.length)})`);
  console.log(`    faces found                    ${faceCounts.reduce((a, b) => a + b, 0)}`);
  if (sizeStats) {
    console.log(
      `    face width (px)                min ${sizeStats.min}, median ${sizeStats.median}, max ${sizeStats.max}`,
    );
  }
  if (heifCount) console.log(`    HEIC photos converted          ${heifCount}`);

  console.log('\n  Speed');
  console.log(`    per photo                      median ${secs(timeStats.median)}, max ${secs(timeStats.max)}`);

  console.log('\n  Sanity checks');
  if (stability) {
    console.log(
      `    same face, degraded copy       mean ${stability.mean.toFixed(3)}, min ${stability.min.toFixed(3)}  ` +
        `(want > 0.8) ${stability.min > 0.8 ? 'PASS' : 'CHECK'}`,
    );
  } else {
    console.log('    same face, degraded copy       no single-face photos in the sample');
  }
  if (discrimination) {
    console.log(
      `    different people, same photo   mean ${discrimination.mean.toFixed(3)}, max ${discrimination.max.toFixed(3)}  ` +
        `(want < 0.4) ${discrimination.max < 0.4 ? 'PASS' : 'CHECK'}`,
    );
  } else {
    console.log('    different people, same photo   no multi-face photos in the sample');
  }

  const healthy =
    photosWithFaces > 0 &&
    (!stability || stability.min > 0.8) &&
    (!discrimination || discrimination.max < 0.4);

  console.log(`\n${healthy ? 'Face recognition is working.' : 'Face recognition needs attention.'}`);
  if (!healthy) process.exit(1);
}

if (args.length === 4) {
  await compareSelfiesToPhoto(args);
} else if (args.length === 0) {
  await benchmarkAgainstDrive();
} else {
  console.error('Usage:\n  npm run test:face\n  npm run test:face -- selfie1 selfie2 selfie3 photo');
  process.exit(1);
}
