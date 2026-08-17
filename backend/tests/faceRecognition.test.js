import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  FaceRecognitionService,
  compareEmbeddings,
  normalize,
  similarityTransform,
} from '../src/services/faceRecognition.js';

const close = (a, b, tolerance = 1e-6) => Math.abs(a - b) < tolerance;

describe('embedding maths', () => {
  it('normalizes a vector to unit length', () => {
    const result = normalize(new Float32Array([3, 4]));
    assert.ok(close(result[0], 0.6, 1e-6));
    assert.ok(close(result[1], 0.8, 1e-6));
  });

  it('survives an all-zero vector instead of dividing by zero', () => {
    const result = normalize(new Float32Array([0, 0, 0]));
    assert.deepEqual([...result], [0, 0, 0]);
  });

  it('scores identical embeddings at 1 and opposite ones at -1', () => {
    const a = normalize(new Float32Array([1, 2, 3]));
    const b = normalize(new Float32Array([1, 2, 3]));
    const opposite = normalize(new Float32Array([-1, -2, -3]));

    assert.ok(close(compareEmbeddings(a, b), 1, 1e-5));
    assert.ok(close(compareEmbeddings(a, opposite), -1, 1e-5));
  });

  it('scores perpendicular embeddings at 0', () => {
    const a = normalize(new Float32Array([1, 0]));
    const b = normalize(new Float32Array([0, 1]));
    assert.ok(close(compareEmbeddings(a, b), 0, 1e-6));
  });

  it('refuses to compare embeddings of different sizes', () => {
    assert.throws(
      () => compareEmbeddings(new Float32Array(512), new Float32Array(128)),
      /different sizes/,
    );
  });
});

describe('face alignment transform', () => {
  // Landmarks rotated 30 degrees, scaled 2x and shifted. Recovering that
  // exactly is what puts every face in the same position for ArcFace.
  const reference = [
    [38.3, 51.7],
    [73.5, 51.5],
    [56.0, 71.7],
    [41.5, 92.4],
    [70.7, 92.2],
  ];

  const angle = Math.PI / 6;
  const scale = 2;
  const shift = [120, -40];

  const observed = reference.map(([x, y]) => [
    scale * (x * Math.cos(angle) - y * Math.sin(angle)) + shift[0],
    scale * (x * Math.sin(angle) + y * Math.cos(angle)) + shift[1],
  ]);

  it('maps observed landmarks back onto the reference layout', () => {
    const transform = similarityTransform(observed, reference);

    for (const [index, point] of observed.entries()) {
      const [x, y] = transform.apply(point[0], point[1]);
      assert.ok(close(x, reference[index][0], 1e-3), `x ${x} vs ${reference[index][0]}`);
      assert.ok(close(y, reference[index][1], 1e-3), `y ${y} vs ${reference[index][1]}`);
    }
  });

  it('inverts back to the original coordinates', () => {
    const transform = similarityTransform(observed, reference);

    for (const point of observed) {
      const [ax, ay] = transform.apply(point[0], point[1]);
      const [bx, by] = transform.invert(ax, ay);
      assert.ok(close(bx, point[0], 1e-3));
      assert.ok(close(by, point[1], 1e-3));
    }
  });

  it('rejects landmarks that are all the same point', () => {
    const degenerate = Array.from({ length: 5 }, () => [10, 10]);
    assert.throws(() => similarityTransform(degenerate, reference), /Degenerate landmarks/);
  });
});

describe('FaceRecognitionService', () => {
  it('explains how to fetch the models when they are missing', async () => {
    const service = new FaceRecognitionService();
    service.detector = null;

    // Only meaningful before models are downloaded; skip once they exist.
    const { existsSync } = await import('node:fs');
    const { MODELS } = await import('../src/services/faceRecognition.js');
    if (Object.values(MODELS).every((m) => existsSync(m.file))) return;

    await assert.rejects(() => service.load(), /npm run models:download/);
  });
});
