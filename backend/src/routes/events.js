import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { getDb } from '../db/database.js';
import * as queries from '../db/queries.js';
import { AppError } from '../middleware/errorHandler.js';
import { selfieUpload } from '../middleware/upload.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { validateAndEmbedSelfies } from '../utils/selfieValidation.js';
import { getFaceRecognitionService } from '../services/faceRecognition.js';
import { getMatchingService } from '../services/matching.js';

const router = Router();

// Events come from the database rather than Drive: participants see internal
// IDs, never Drive folder IDs. Run `npm run index -- --list` to populate it.

/** GET /api/events — events discovered from Drive, with indexing status. */
router.get('/', (req, res) => {
  const events = queries.listEvents(getDb()).map((event) => ({
    id: event.id,
    name: event.name,
    status: event.status,
    photoCount: event.photo_count,
  }));

  res.json(events);
});

/** GET /api/events/:eventId — one event. */
router.get('/:eventId', (req, res) => {
  const event = queries.getEvent(getDb(), Number(req.params.eventId));
  if (!event) throw new AppError('Event not found', 404);

  res.json({
    id: event.id,
    name: event.name,
    status: event.status,
    photoCount: queries.countPhotos(getDb(), event.id),
  });
});

/**
 * GET /api/events/:eventId/photos — indexed photo metadata.
 * Drive file IDs stay on the server; only internal IDs are returned.
 */
router.get('/:eventId/photos', (req, res) => {
  const db = getDb();
  const event = queries.getEvent(db, Number(req.params.eventId));
  if (!event) throw new AppError('Event not found', 404);

  const photos = queries.listPhotos(db, event.id).map((photo) => ({
    id: photo.id,
    name: photo.file_name,
    mimeType: photo.mime_type,
  }));

  res.json(photos);
});

/**
 * POST /api/events/:eventId/search
 *
 * Three selfies in, matching photo IDs out. Only this event is searched.
 * Confidence scores stay on the server: participants see photos, not numbers.
 */
const searchLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 12,
  message: 'You have run a lot of searches. Please wait a few minutes and try again.',
});

router.post('/:eventId/search', searchLimit, selfieUpload, async (req, res) => {
  const eventId = Number(req.params.eventId);
  const event = queries.getEvent(getDb(), eventId);
  if (!event) throw new AppError('Event not found', 404);

  if (event.status !== 'ready') {
    throw new AppError('This event is still being prepared. Please try again later.', 409);
  }

  const selfieEmbeddings = await validateAndEmbedSelfies(req.files, getFaceRecognitionService());
  const result = getMatchingService().findMatches(selfieEmbeddings, event.id);

  console.log(
    `[search] event ${event.id} "${event.name}": ${result.matches.length} matches ` +
      `from ${result.searched.faces} faces in ${result.searched.photos} photos`,
  );

  const db = getDb();
  queries.deleteExpiredSearchSessions(db);

  // The token is what authorizes fetching these photos, and only these.
  const expiresAt = new Date(
    Date.now() + config.searchSessionTtlMinutes * 60_000,
  ).toISOString();

  const session = queries.createSearchSession(db, {
    token: randomBytes(32).toString('base64url'),
    eventId: event.id,
    userId: req.user.id,
    expiresAt,
    photoIds: result.matches.map((match) => match.photoId),
  });

  res.json({
    searchId: session.token,
    expiresAt: session.expires_at,
    event: result.event,
    matches: result.matches.map((match) => ({ photoId: match.photoId })),
  });
});

export default router;
