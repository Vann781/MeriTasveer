import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ensureDecodableImage,
  isHeif,
  isProcessableImage,
} from '../src/utils/imageConverter.js';

describe('imageConverter', () => {
  it('detects HEIF by mime type and by file name', () => {
    assert.equal(isHeif({ mimeType: 'image/heif' }), true);
    assert.equal(isHeif({ mimeType: 'image/heic' }), true);
    assert.equal(isHeif({ name: 'IMG_8927.HEIC' }), true);
    assert.equal(isHeif({ name: 'img_1.heic' }), true);
    // Drive occasionally reports a generic type, so the name is the fallback.
    assert.equal(isHeif({ mimeType: 'application/octet-stream', name: 'IMG.HEIC' }), true);

    assert.equal(isHeif({ mimeType: 'image/jpeg', name: 'IMG_0001.jpg' }), false);
    assert.equal(isHeif({}), false);
  });

  it('accepts the formats the pipeline can handle and rejects video', () => {
    assert.equal(isProcessableImage({ mimeType: 'image/jpeg' }), true);
    assert.equal(isProcessableImage({ mimeType: 'image/png' }), true);
    assert.equal(isProcessableImage({ mimeType: 'image/webp' }), true);
    assert.equal(isProcessableImage({ mimeType: 'image/heif' }), true);

    assert.equal(isProcessableImage({ mimeType: 'video/mp4', name: 'clip.mp4' }), false);
    assert.equal(isProcessableImage({ mimeType: 'video/quicktime' }), false);
  });

  it('passes non-HEIF images through untouched', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    const result = await ensureDecodableImage(jpeg, { mimeType: 'image/jpeg', name: 'a.jpg' });

    assert.equal(result.converted, false);
    assert.equal(result.buffer, jpeg); // same buffer, not a copy
    assert.equal(result.mimeType, 'image/jpeg');
  });

  it('reports a clear error when HEIF data is corrupt', async () => {
    const notHeif = Buffer.from('definitely not an image');
    await assert.rejects(
      () => ensureDecodableImage(notHeif, { mimeType: 'image/heic', name: 'broken.heic' }),
      /Could not convert HEIC\/HEIF image to JPEG/,
    );
  });
});
