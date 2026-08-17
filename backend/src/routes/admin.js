import { Router } from 'express';
import { getDb } from '../db/database.js';
import * as queries from '../db/queries.js';
import { AppError } from '../middleware/errorHandler.js';
import { getIndexQueue } from '../services/indexQueue.js';
import { getIndexingService } from '../services/indexing.js';

/**
 * The organizer's dashboard. Everything here is behind requireAdmin, which
 * checks the signed-in email against ADMIN_EMAILS.
 */
const router = Router();

/** GET /api/admin/events — every event with its indexing state. */
router.get('/events', (req, res) => {
  const queue = getIndexQueue();

  const events = queries.listEventsForAdmin(getDb()).map((event) => ({
    id: event.id,
    name: event.name,
    status: event.status,
    photoCount: event.photo_count,
    faceCount: event.face_count,
    indexedAt: event.indexed_at,
    progress: queue.progressFor(event.id),
  }));

  res.json({ events, busyWith: queue.busyWith });
});

/**
 * POST /api/admin/events/sync — pick up folders added in Drive since startup.
 */
router.post('/events/sync', async (req, res) => {
  const result = await getIndexingService().syncEvents();
  res.json(result);
});

/**
 * POST /api/admin/events/:eventId/index — index or re-index an event.
 * Returns straight away with 202: indexing runs in the background and the
 * dashboard polls for progress.
 */
router.post('/events/:eventId/index', (req, res) => {
  const eventId = Number(req.params.eventId);
  const event = queries.getEvent(getDb(), eventId);
  if (!event) throw new AppError('Event not found', 404);

  const { accepted, reason } = getIndexQueue().start(event.id);
  if (!accepted) throw new AppError(reason, 409);

  res.status(202).json({ id: event.id, name: event.name, status: 'indexing' });
});

export default router;
