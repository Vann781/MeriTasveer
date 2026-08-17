/**
 * HEIC/HEIF conversion check against real Drive photos.
 *
 *   Drive -> HEIF photo -> convert -> valid JPEG (in memory)
 *
 * Run with: npm run test:heic  [number of photos, default 3]
 */
import { GoogleDriveService } from '../src/services/googleDrive.js';
import { ensureDecodableImage, isHeif } from '../src/utils/imageConverter.js';

const sampleSize = Number(process.argv[2]) || 3;

/** Reads width/height straight from the JPEG SOF marker — proves it decodes. */
function jpegSize(buffer) {
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;

  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);

    // SOF0..SOF15, skipping the non-frame markers in that range.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

const drive = new GoogleDriveService();

console.log('HEIC/HEIF conversion check\n');

const events = await drive.listEvents();
const heifPhotos = [];

for (const event of events) {
  if (heifPhotos.length >= sampleSize) break;
  const photos = await drive.listPhotos(event.id);
  for (const photo of photos.filter(isHeif)) {
    heifPhotos.push({ ...photo, eventName: event.name.trim() });
    if (heifPhotos.length >= sampleSize) break;
  }
}

if (heifPhotos.length === 0) {
  console.log('No HEIC/HEIF photos found in Drive — nothing to convert.');
  process.exit(0);
}

console.log(`Testing ${heifPhotos.length} HEIF photo(s):\n`);

let failures = 0;
const convertTimes = [];

for (const photo of heifPhotos) {
  process.stdout.write(`  ${photo.name} (${photo.eventName}) ... `);

  try {
    const t0 = process.hrtime.bigint();
    const original = await drive.downloadFileToBuffer(photo.id);
    const t1 = process.hrtime.bigint();
    const result = await ensureDecodableImage(original, photo);
    const t2 = process.hrtime.bigint();

    const downloadSecs = Number(t1 - t0) / 1e9;
    const convertSecs = Number(t2 - t1) / 1e9;
    convertTimes.push(convertSecs);

    const size = jpegSize(result.buffer);
    if (!result.converted) throw new Error('was not recognized as HEIF');
    if (!size) throw new Error('output is not a readable JPEG');

    console.log(
      `OK  ${mb(original.length)} HEIF -> ${mb(result.buffer.length)} JPEG ` +
        `${size.width}x${size.height}  (download ${downloadSecs.toFixed(1)}s, ` +
        `convert ${convertSecs.toFixed(1)}s)`,
    );
  } catch (err) {
    failures += 1;
    console.log(`FAILED — ${err.message}`);
  }
}

// Non-HEIF images must pass through untouched.
const jpegSample = { name: 'photo.jpg', mimeType: 'image/jpeg' };
const passthrough = await ensureDecodableImage(Buffer.from([0xff, 0xd8, 0xff]), jpegSample);
if (passthrough.converted) {
  failures += 1;
  console.log('\n  JPEG passthrough FAILED — a JPEG was needlessly converted');
} else {
  console.log('\n  JPEG passthrough OK — non-HEIF images are left untouched');
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}

if (convertTimes.length > 0) {
  const average = convertTimes.reduce((sum, t) => sum + t, 0) / convertTimes.length;
  console.log(`  average conversion: ${average.toFixed(1)}s per photo`);
}

console.log('\nHEIC/HEIF conversion is working.');
