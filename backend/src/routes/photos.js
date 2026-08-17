import { Router } from 'express';
import path from 'node:path';
import { getDb } from '../db/database.js';
import * as queries from '../db/queries.js';
import { AppError } from '../middleware/errorHandler.js';
import { getGoogleDriveService } from '../services/googleDrive.js';
import { heifToJpeg, isHeif } from '../utils/imageConverter.js';

/**
 * Photo delivery. Mounted at /api/searches, because a photo is only ever
 * reachable through the search that found it:
 *
 *   /api/searches/:token/photos/:photoId
 *
 * The image travels Drive -> backend -> participant. No Drive URL, Drive file
 * ID or credential ever reaches the browser, and a participant cannot walk the
 * photo IDs: every request is checked against the photos their own search
 * returned.
 */
const router = Router();

/** Resolves and authorizes a photo, or throws. */
function authorizePhoto(req) {
  const db = getDb();
  const session = queries.getActiveSearchSessionForUser(db, req.params.token, req.user.id);

  // One message for "no such search" and "expired", so nothing can be probed.
  if (!session) throw new AppError('This link has expired. Please search again.', 404);

  const photoId = Number(req.params.photoId);
  if (!Number.isInteger(photoId)) throw new AppError('Photo not found', 404);

  // The photo must be one this search actually returned — not merely a photo
  // from the same event, and certainly not from another event.
  if (!queries.searchSessionHasPhoto(db, session.id, photoId)) {
    throw new AppError('Photo not found', 404);
  }

  const photo = queries.getPhoto(db, photoId);
  if (!photo) throw new AppError('Photo not found', 404);

  return photo;
}

/** Fetches the bytes, converting HEIC so browsers can actually show them. */
async function fetchImage(req, photo) {
  const drive = req.app.locals.driveService ?? getGoogleDriveService();

  if (isHeif({ mimeType: photo.mime_type, name: photo.file_name })) {
    const original = await drive.downloadFileToBuffer(photo.drive_file_id);
    return {
      buffer: await heifToJpeg(original),
      mimeType: 'image/jpeg',
      fileName: `${path.parse(photo.file_name).name}.jpg`,
    };
  }

  return {
    stream: await drive.downloadFile(photo.drive_file_id),
    mimeType: photo.mime_type,
    fileName: photo.file_name,
  };
}

/** GET /api/searches/:token — the photos this search found. */
router.get('/:token', (req, res) => {
  const db = getDb();
  const session = queries.getActiveSearchSessionForUser(db, req.params.token, req.user.id);
  if (!session) throw new AppError('This link has expired. Please search again.', 404);

  const event = queries.getEvent(db, session.event_id);
  const photos = queries.listSearchSessionPhotos(db, session.id);

  res.json({
    event: { id: event.id, name: event.name },
    expiresAt: session.expires_at,
    photos: photos.map((photo) => ({ id: photo.id, name: photo.file_name })),
  });
});

/** GET /api/searches/:token/photos/:photoId — view a matched photo. */
router.get('/:token/photos/:photoId', async (req, res) => {
  const photo = authorizePhoto(req);
  const image = await fetchImage(req, photo);

  // Private: these are one participant's photos, never a shared cache.
  res.set('Cache-Control', 'private, max-age=300');
  res.type(image.mimeType);

  if (image.buffer) {
    res.send(image.buffer);
    return;
  }
  image.stream.pipe(res);
});

/** GET /api/searches/:token/photos/:photoId/download — save a matched photo. */
router.get('/:token/photos/:photoId/download', async (req, res) => {
  const photo = authorizePhoto(req);
  const image = await fetchImage(req, photo);

  res.set('Cache-Control', 'private, max-age=300');
  res.type(image.mimeType);
  res.attachment(image.fileName);

  if (image.buffer) {
    res.send(image.buffer);
    return;
  }
  image.stream.pipe(res);
});

export default router;
