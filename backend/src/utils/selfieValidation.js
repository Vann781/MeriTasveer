import { AppError } from '../middleware/errorHandler.js';
import { ensureDecodableImage } from './imageConverter.js';
import { SELFIE_FIELDS } from '../middleware/upload.js';

/**
 * Checks the three selfies and turns them into three embeddings.
 *
 * Validation follows README section 8: the file must exist, be a readable
 * image, and contain exactly one face. Messages are the participant-facing
 * wording from section 51 — no technical detail leaks out.
 *
 * The selfie buffers are used here and then dropped. Nothing is persisted.
 */
export async function validateAndEmbedSelfies(files, faceService) {
  const missing = SELFIE_FIELDS.filter((field) => !files?.[field]?.[0]);
  if (missing.length > 0) {
    throw new AppError('Please upload all three selfies.', 400);
  }

  await faceService.load();
  const embeddings = [];

  for (const [index, field] of SELFIE_FIELDS.entries()) {
    const file = files[field][0];
    const position = index + 1;

    let image;
    try {
      image = await ensureDecodableImage(file.buffer, {
        mimeType: file.mimetype,
        name: file.originalname,
      });
    } catch {
      throw new AppError(`Selfie ${position} could not be read. Please upload another photo.`, 400);
    }

    let faces;
    try {
      faces = await faceService.detectAndEmbed(image.buffer);
    } catch {
      throw new AppError(`Selfie ${position} could not be read. Please upload another photo.`, 400);
    }

    if (faces.length === 0) {
      throw new AppError(
        `We couldn't detect a face in selfie ${position}. Please upload a clearer photo.`,
        400,
      );
    }
    if (faces.length > 1) {
      throw new AppError(`Please upload a selfie containing only you (selfie ${position}).`, 400);
    }

    embeddings.push(faces[0].embedding);
  }

  return embeddings;
}
