import multer from 'multer';
import { AppError } from './errorHandler.js';

/**
 * Selfie uploads. Files are kept in memory only — they are never written to
 * disk, never stored in the database and never sent to Google Drive. Once the
 * request finishes the buffers are garbage collected.
 */

export const SELFIE_FIELDS = ['selfie1', 'selfie2', 'selfie3'];

/** Generous enough for a modern phone photo, small enough to bound memory. */
const MAX_FILE_BYTES = 15 * 1024 * 1024;

// JPG/PNG/WEBP as required, plus HEIC because iPhones send it by default and
// the converter already handles it.
const ACCEPTED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: SELFIE_FIELDS.length },
  fileFilter(req, file, callback) {
    if (ACCEPTED_MIME_TYPES.has(file.mimetype.toLowerCase())) {
      callback(null, true);
      return;
    }
    callback(new AppError('Please upload JPG, PNG or WEBP images.', 400));
  },
});

const uploadSelfies = upload.fields(SELFIE_FIELDS.map((name) => ({ name, maxCount: 1 })));

/** Turns multer's errors into the same user-safe shape as everything else. */
export function selfieUpload(req, res, next) {
  uploadSelfies(req, res, (err) => {
    if (!err) {
      next();
      return;
    }
    if (err instanceof multer.MulterError) {
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? 'That image is too large. Please upload a photo under 15 MB.'
          : 'We could not read the uploaded files. Please try again.';
      next(new AppError(message, 400));
      return;
    }
    next(err);
  });
}
