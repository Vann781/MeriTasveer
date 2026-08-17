import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ort from 'onnxruntime-node';
import sharp from 'sharp';
import { config } from '../config.js';

/**
 * Face detection and embedding, isolated behind one service so the models can
 * be swapped later without touching the rest of the app.
 *
 *   image -> detect faces (SCRFD) -> align each face -> embed (ArcFace) -> 512-d vector
 *
 * Two ONNX models from the InsightFace "buffalo_l" pack run on onnxruntime-node
 * (CPU). Both ship as plain files in backend/models/ — see npm run models:download.
 */

export const MODELS_DIR = config.modelsDir;

/**
 * Two model sets from InsightFace, both served by the Immich project.
 *
 *   large — SCRFD-10g + ArcFace r50. The most accurate, and what the default
 *           threshold was calibrated against. Needs roughly 400 MB of RAM.
 *   small — SCRFD-500m + MobileFaceNet. About a tenth the size and far
 *           quicker, at some cost in accuracy. Fits a 512 MB host.
 *
 * Set FACE_MODEL to choose. Recalibrate FACE_MATCH_THRESHOLD when switching:
 * the two models do not produce comparable similarity scores.
 */
const MODEL_SETS = {
  large: {
    detector: {
      name: 'detector',
      file: path.join(MODELS_DIR, 'scrfd_10g.onnx'),
      url: 'https://huggingface.co/immich-app/buffalo_l/resolve/main/detection/model.onnx',
      minBytes: 16_000_000,
    },
    recognizer: {
      name: 'recognizer',
      file: path.join(MODELS_DIR, 'arcface_r50.onnx'),
      url: 'https://huggingface.co/immich-app/buffalo_l/resolve/main/recognition/model.onnx',
      minBytes: 170_000_000,
    },
  },
  small: {
    detector: {
      name: 'detector',
      file: path.join(MODELS_DIR, 'scrfd_500m.onnx'),
      url: 'https://huggingface.co/immich-app/buffalo_s/resolve/main/detection/model.onnx',
      minBytes: 2_000_000,
    },
    recognizer: {
      name: 'recognizer',
      file: path.join(MODELS_DIR, 'mobilefacenet.onnx'),
      url: 'https://huggingface.co/immich-app/buffalo_s/resolve/main/recognition/model.onnx',
      minBytes: 12_000_000,
    },
  },
};

export const MODEL_SET = MODEL_SETS[config.faceModel] ? config.faceModel : 'large';
export const MODELS = MODEL_SETS[MODEL_SET];

/** SCRFD runs on a square input; 640 is the size the model was trained for. */
const DETECTOR_SIZE = 640;
const DETECTOR_STRIDES = [8, 16, 32];
const DETECTOR_ANCHORS_PER_CELL = 2;

/** ArcFace expects a 112x112 crop aligned to these five reference points. */
const ARCFACE_SIZE = 112;
const ARCFACE_REFERENCE = [
  [38.2946, 51.6963], // left eye
  [73.5318, 51.5014], // right eye
  [56.0252, 71.7366], // nose
  [41.5493, 92.3655], // left mouth corner
  [70.7299, 92.2041], // right mouth corner
];

const DEFAULTS = {
  /** Photos are worked on at this size — faces stay legible, memory stays sane. */
  maxWorkingSize: 1600,
  /** Detector confidence. Lower finds more faces and more false positives. */
  detectionThreshold: 0.5,
  /** Overlapping detections above this IoU are merged. */
  nmsThreshold: 0.4,
  /** Faces smaller than this (in working-image pixels) are too blurry to embed. */
  minFaceSize: 32,
  /** CPU threads per inference. More than 8 stops helping on this workload. */
  threads: Math.min(8, Math.max(1, os.cpus().length - 1)),
};

export class FaceRecognitionError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'FaceRecognitionError';
    this.cause = cause;
  }
}

export class FaceRecognitionService {
  constructor(options = {}) {
    this.options = { ...DEFAULTS, ...options };
    this.detector = null;
    this.recognizer = null;
  }

  /** Loads both ONNX models. Safe to call repeatedly. */
  async load() {
    if (this.detector && this.recognizer) return;

    for (const model of Object.values(MODELS)) {
      if (!fs.existsSync(model.file)) {
        throw new FaceRecognitionError(
          `Model "${model.name}" is missing. Run: npm run models:download`,
        );
      }
    }

    // Thread count is set explicitly rather than left to the default. Measured
    // cost is 250-800ms per face either way: ResNet-50 on the ONNX CPU
    // provider is simply the floor here, and it dominates indexing time.
    const sessionOptions = {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all',
      intraOpNumThreads: this.options.threads,
    };
    [this.detector, this.recognizer] = await Promise.all([
      ort.InferenceSession.create(MODELS.detector.file, sessionOptions),
      ort.InferenceSession.create(MODELS.recognizer.file, sessionOptions),
    ]);
  }

  /**
   * Decodes an image to raw RGB, honouring EXIF rotation (phone photos are
   * routinely stored sideways) and capping the size we work at.
   */
  async #toWorkingImage(imageBuffer) {
    try {
      const { data, info } = await sharp(imageBuffer)
        .rotate()
        .resize({
          width: this.options.maxWorkingSize,
          height: this.options.maxWorkingSize,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      return { data, width: info.width, height: info.height };
    } catch (err) {
      throw new FaceRecognitionError('Could not decode image', err);
    }
  }

  /** Letterboxes the working image into the detector's square input tensor. */
  async #toDetectorInput(image) {
    const scale = Math.min(DETECTOR_SIZE / image.width, DETECTOR_SIZE / image.height);

    const padded = await sharp(image.data, {
      raw: { width: image.width, height: image.height, channels: 3 },
    })
      .resize(DETECTOR_SIZE, DETECTOR_SIZE, {
        fit: 'contain',
        position: 'left top',
        background: { r: 0, g: 0, b: 0 },
      })
      .raw()
      .toBuffer();

    // NCHW float tensor, normalized the way SCRFD was trained.
    const pixels = DETECTOR_SIZE * DETECTOR_SIZE;
    const tensor = new Float32Array(3 * pixels);
    for (let i = 0; i < pixels; i += 1) {
      tensor[i] = (padded[i * 3] - 127.5) / 128;
      tensor[pixels + i] = (padded[i * 3 + 1] - 127.5) / 128;
      tensor[2 * pixels + i] = (padded[i * 3 + 2] - 127.5) / 128;
    }

    return {
      tensor: new ort.Tensor('float32', tensor, [1, 3, DETECTOR_SIZE, DETECTOR_SIZE]),
      scale,
    };
  }

  /**
   * SCRFD returns nine tensors: scores, box offsets and landmark offsets for
   * each of three strides. They are grouped by their last dimension rather than
   * by name, so a differently-named export still works.
   */
  #decodeDetections(outputs, scale) {
    const tensors = Object.values(outputs);
    const byWidth = (width) =>
      tensors
        .filter((t) => t.dims[t.dims.length - 1] === width)
        .sort((a, b) => b.dims[0] - a.dims[0]); // stride 8 has the most anchors

    const scores = byWidth(1);
    const boxes = byWidth(4);
    const landmarks = byWidth(10);

    if (scores.length !== 3 || boxes.length !== 3 || landmarks.length !== 3) {
      throw new FaceRecognitionError('Unexpected detector output shape');
    }

    const faces = [];

    DETECTOR_STRIDES.forEach((stride, index) => {
      const score = scores[index].data;
      const box = boxes[index].data;
      const kps = landmarks[index].data;
      const cells = DETECTOR_SIZE / stride;

      for (let i = 0; i < score.length; i += 1) {
        if (score[i] < this.options.detectionThreshold) continue;

        // Anchors walk the feature map row by row, two per cell.
        const cell = Math.floor(i / DETECTOR_ANCHORS_PER_CELL);
        const cx = (cell % cells) * stride;
        const cy = Math.floor(cell / cells) * stride;

        // Predictions are distances from the anchor centre, in stride units.
        const x1 = (cx - box[i * 4] * stride) / scale;
        const y1 = (cy - box[i * 4 + 1] * stride) / scale;
        const x2 = (cx + box[i * 4 + 2] * stride) / scale;
        const y2 = (cy + box[i * 4 + 3] * stride) / scale;

        const points = [];
        for (let p = 0; p < 5; p += 1) {
          points.push([
            (cx + kps[i * 10 + p * 2] * stride) / scale,
            (cy + kps[i * 10 + p * 2 + 1] * stride) / scale,
          ]);
        }

        faces.push({ score: score[i], box: [x1, y1, x2, y2], landmarks: points });
      }
    });

    return this.#nonMaximumSuppression(faces);
  }

  /** Keeps the highest-scoring detection out of each overlapping cluster. */
  #nonMaximumSuppression(faces) {
    const area = ([x1, y1, x2, y2]) => Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const sorted = [...faces].sort((a, b) => b.score - a.score);
    const kept = [];

    for (const face of sorted) {
      const overlaps = kept.some((other) => {
        const x1 = Math.max(face.box[0], other.box[0]);
        const y1 = Math.max(face.box[1], other.box[1]);
        const x2 = Math.min(face.box[2], other.box[2]);
        const y2 = Math.min(face.box[3], other.box[3]);
        const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
        const union = area(face.box) + area(other.box) - intersection;
        return union > 0 && intersection / union > this.options.nmsThreshold;
      });

      if (!overlaps) kept.push(face);
    }

    return kept;
  }

  /** Detects every face in an image. Returns boxes, scores and 5 landmarks. */
  async detectFaces(imageBuffer) {
    await this.load();
    const image = await this.#toWorkingImage(imageBuffer);
    return { image, faces: await this.#detectInWorkingImage(image) };
  }

  async #detectInWorkingImage(image) {
    const { tensor, scale } = await this.#toDetectorInput(image);
    const outputs = await this.detector.run({ [this.detector.inputNames[0]]: tensor });

    return this.#decodeDetections(outputs, scale)
      .filter((face) => {
        const width = face.box[2] - face.box[0];
        const height = face.box[3] - face.box[1];
        return width >= this.options.minFaceSize && height >= this.options.minFaceSize;
      })
      .map((face) => ({
        score: face.score,
        box: face.box.map(Math.round),
        landmarks: face.landmarks,
      }));
  }

  /**
   * Warps a face onto ArcFace's 112x112 reference layout using the five
   * landmarks, so eyes and mouth land in the same place for every face
   * regardless of head tilt or distance.
   */
  #alignFace(image, landmarks) {
    const transform = similarityTransform(landmarks, ARCFACE_REFERENCE);
    const pixels = ARCFACE_SIZE * ARCFACE_SIZE;
    const tensor = new Float32Array(3 * pixels);

    for (let y = 0; y < ARCFACE_SIZE; y += 1) {
      for (let x = 0; x < ARCFACE_SIZE; x += 1) {
        const [sx, sy] = transform.invert(x + 0.5, y + 0.5);
        const [r, g, b] = sampleBilinear(image, sx - 0.5, sy - 0.5);
        const i = y * ARCFACE_SIZE + x;
        tensor[i] = (r - 127.5) / 127.5;
        tensor[pixels + i] = (g - 127.5) / 127.5;
        tensor[2 * pixels + i] = (b - 127.5) / 127.5;
      }
    }

    return new ort.Tensor('float32', tensor, [1, 3, ARCFACE_SIZE, ARCFACE_SIZE]);
  }

  /** Produces one L2-normalized 512-d embedding for a detected face. */
  async generateEmbedding(image, face) {
    await this.load();
    const input = this.#alignFace(image, face.landmarks);
    const outputs = await this.recognizer.run({ [this.recognizer.inputNames[0]]: input });
    return normalize(Object.values(outputs)[0].data);
  }

  /**
   * The call the rest of the app uses: every face in a photo, with its
   * embedding. Decoding and detection happen once per image.
   */
  async detectAndEmbed(imageBuffer) {
    const { image, faces } = await this.detectFaces(imageBuffer);

    const results = [];
    for (const [index, face] of faces.entries()) {
      results.push({
        faceIndex: index,
        score: face.score,
        box: face.box,
        embedding: await this.generateEmbedding(image, face),
      });
    }
    return results;
  }
}

/**
 * Cosine similarity of two L2-normalized embeddings: 1.0 is identical,
 * around 0 is unrelated. This is the number compared against
 * FACE_MATCH_THRESHOLD.
 */
export function compareEmbeddings(a, b) {
  if (a.length !== b.length) {
    throw new FaceRecognitionError('Cannot compare embeddings of different sizes');
  }
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += a[i] * b[i];
  return dot;
}

export function normalize(vector) {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const magnitude = Math.sqrt(sum) || 1;

  const result = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i += 1) result[i] = vector[i] / magnitude;
  return result;
}

/**
 * Least-squares similarity transform (scale + rotation + translation) mapping
 * one point set onto another. Solved with complex arithmetic: in 2D a
 * similarity is multiplication by a single complex number plus an offset.
 */
export function similarityTransform(from, to) {
  const n = from.length;
  const mean = (points, axis) => points.reduce((sum, p) => sum + p[axis], 0) / n;

  const fx = mean(from, 0);
  const fy = mean(from, 1);
  const tx = mean(to, 0);
  const ty = mean(to, 1);

  // a = Σ conj(p) * q / Σ |p|², with p and q the centred point sets.
  let realPart = 0;
  let imagPart = 0;
  let energy = 0;

  for (let i = 0; i < n; i += 1) {
    const px = from[i][0] - fx;
    const py = from[i][1] - fy;
    const qx = to[i][0] - tx;
    const qy = to[i][1] - ty;

    realPart += px * qx + py * qy;
    imagPart += px * qy - py * qx;
    energy += px * px + py * py;
  }

  if (energy === 0) throw new FaceRecognitionError('Degenerate landmarks');

  const ar = realPart / energy;
  const ai = imagPart / energy;

  return {
    /** Maps a source point to the aligned frame. */
    apply(x, y) {
      const dx = x - fx;
      const dy = y - fy;
      return [ar * dx - ai * dy + tx, ai * dx + ar * dy + ty];
    },
    /** Maps an aligned-frame point back to the source image. */
    invert(x, y) {
      const dx = x - tx;
      const dy = y - ty;
      const denominator = ar * ar + ai * ai;
      return [(ar * dx + ai * dy) / denominator + fx, (ar * dy - ai * dx) / denominator + fy];
    },
  };
}

/** Bilinear pixel lookup, clamped at the image edges. */
function sampleBilinear(image, x, y) {
  const { data, width, height } = image;

  const x0 = Math.min(Math.max(Math.floor(x), 0), width - 1);
  const y0 = Math.min(Math.max(Math.floor(y), 0), height - 1);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);

  const wx = Math.min(Math.max(x - x0, 0), 1);
  const wy = Math.min(Math.max(y - y0, 0), 1);

  const at = (px, py, channel) => data[(py * width + px) * 3 + channel];
  const channel = (c) =>
    at(x0, y0, c) * (1 - wx) * (1 - wy) +
    at(x1, y0, c) * wx * (1 - wy) +
    at(x0, y1, c) * (1 - wx) * wy +
    at(x1, y1, c) * wx * wy;

  return [channel(0), channel(1), channel(2)];
}

let instance = null;

export function getFaceRecognitionService() {
  instance ??= new FaceRecognitionService();
  return instance;
}
