import heicConvert from 'heic-convert';

/**
 * iPhone photos arrive as HEIC/HEIF, which no Node face-recognition library can
 * decode. This converts them to JPEG in memory so the rest of the pipeline only
 * ever deals with JPEG/PNG. Conversion is pure JS (libheif compiled to WASM), so
 * there is nothing to install on the machine.
 *
 * Converted bytes are never written to Google Drive or stored — the original
 * stays untouched in the organizer's Drive.
 */

const HEIF_MIME_TYPES = new Set(['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence']);
const HEIF_EXTENSIONS = /\.(heic|heif)$/i;

/** JPEG quality for converted images: high enough for face detail, ~1/3 the size. */
const JPEG_QUALITY = 0.92;

/** Formats the pipeline can decode once conversion has happened. */
const SUPPORTED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function isHeif({ mimeType, name } = {}) {
  if (mimeType && HEIF_MIME_TYPES.has(mimeType.toLowerCase())) return true;
  return Boolean(name && HEIF_EXTENSIONS.test(name));
}

/** True when the pipeline can handle the file, with conversion if needed. */
export function isProcessableImage({ mimeType, name } = {}) {
  if (isHeif({ mimeType, name })) return true;
  return Boolean(mimeType && SUPPORTED_MIME_TYPES.has(mimeType.toLowerCase()));
}

export class ImageConversionError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'ImageConversionError';
    this.cause = cause;
  }
}

/** Converts a HEIC/HEIF buffer to JPEG. */
export async function heifToJpeg(buffer) {
  try {
    const output = await heicConvert({ buffer, format: 'JPEG', quality: JPEG_QUALITY });
    return Buffer.from(output);
  } catch (err) {
    throw new ImageConversionError('Could not convert HEIC/HEIF image to JPEG', err);
  }
}

/**
 * Normalizes any supported image to something decodable.
 * Returns the original buffer untouched when no conversion is needed.
 */
export async function ensureDecodableImage(buffer, { mimeType, name } = {}) {
  if (!isHeif({ mimeType, name })) {
    return { buffer, mimeType: mimeType ?? null, converted: false };
  }

  const jpeg = await heifToJpeg(buffer);
  return { buffer: jpeg, mimeType: 'image/jpeg', converted: true };
}
