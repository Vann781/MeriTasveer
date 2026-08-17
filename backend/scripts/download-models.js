/**
 * Downloads the face recognition models into backend/models/.
 *
 * Models are ~190 MB in total, so they are gitignored and fetched once.
 * Both come from the InsightFace "buffalo_l" pack, mirrored by the Immich
 * project, which uses these same models for photo face recognition.
 *
 * Run with: npm run models:download
 */
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { MODELS, MODELS_DIR } from '../src/services/faceRecognition.js';

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

fs.mkdirSync(MODELS_DIR, { recursive: true });

console.log(`Face recognition models -> ${MODELS_DIR}\n`);

for (const model of Object.values(MODELS)) {
  const exists = fs.existsSync(model.file) && fs.statSync(model.file).size >= model.minBytes;

  if (exists) {
    console.log(`  ${model.name.padEnd(12)} already present (${mb(fs.statSync(model.file).size)})`);
    continue;
  }

  process.stdout.write(`  ${model.name.padEnd(12)} downloading… `);

  const response = await fetch(model.url);
  if (!response.ok) {
    console.log('FAILED');
    console.error(`\nCould not download ${model.name}: HTTP ${response.status}`);
    console.error(`URL: ${model.url}`);
    process.exit(1);
  }

  // Write to a temporary name so an interrupted download is never mistaken
  // for a complete model file.
  const partial = `${model.file}.partial`;
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(partial));

  const { size } = fs.statSync(partial);
  if (size < model.minBytes) {
    fs.unlinkSync(partial);
    console.log('FAILED');
    console.error(`\n${model.name} downloaded only ${mb(size)}, expected at least ${mb(model.minBytes)}.`);
    process.exit(1);
  }

  fs.renameSync(partial, model.file);
  console.log(`done (${mb(size)})`);
}

console.log('\nModels ready.');
console.log(`Files: ${Object.values(MODELS).map((m) => path.basename(m.file)).join(', ')}`);
