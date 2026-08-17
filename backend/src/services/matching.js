import { getDb } from '../db/database.js';
import * as queries from '../db/queries.js';
import { compareEmbeddings } from './faceRecognition.js';
import { config } from '../config.js';
import { AppError } from '../middleware/errorHandler.js';

/**
 * Compares a participant's selfies against the faces stored for ONE event.
 *
 * Scoring, as required by README section 15:
 *
 *   faceScore(face)   = the best cosine similarity between that face and any
 *                       of the three selfies
 *   agreement(face)   = how many of the three selfies match it on their own
 *   photoScore(photo) = the best faceScore among the faces in that photo
 *
 * A photo matches when its best face reaches the threshold. Results are ranked
 * by agreement first and score second, so a photo that all three selfies
 * recognize outranks one that only a single selfie found — which is the point
 * of asking for three angles. Each photo appears once however many of its
 * faces or selfies matched.
 */
export class MatchingService {
  constructor({ db, threshold } = {}) {
    this.db = db ?? null;
    this.threshold = threshold ?? config.faceMatchThreshold;
  }

  get database() {
    return (this.db ??= getDb());
  }

  /**
   * Finds photos of one person within a single event.
   * The event ID is applied in the SQL query, so faces from other events are
   * never loaded, let alone compared.
   */
  findMatches(selfieEmbeddings, eventId) {
    if (!Array.isArray(selfieEmbeddings) || selfieEmbeddings.length === 0) {
      throw new AppError('No selfies to search with', 400);
    }

    const event = queries.getEvent(this.database, eventId);
    if (!event) throw new AppError('Event not found', 404);

    if (event.status !== 'ready') {
      throw new AppError('This event is still being prepared. Please try again later.', 409);
    }

    const faces = queries.loadEventEmbeddings(this.database, event.id);

    // Best face per photo, keyed by photo so duplicates collapse naturally.
    const best = new Map();

    for (const face of faces) {
      const similarities = selfieEmbeddings.map((selfie) =>
        compareEmbeddings(selfie, face.embedding),
      );

      const score = Math.max(...similarities);
      if (score < this.threshold) continue;

      const agreement = similarities.filter((s) => s >= this.threshold).length;
      const current = best.get(face.photoId);

      if (!current || agreement > current.agreement || score > current.score) {
        best.set(face.photoId, { photoId: face.photoId, score, agreement, similarities });
      }
    }

    const matches = [...best.values()].sort(
      (a, b) => b.agreement - a.agreement || b.score - a.score,
    );

    return {
      event: { id: event.id, name: event.name },
      matches,
      searched: { faces: faces.length, photos: queries.countPhotos(this.database, event.id) },
    };
  }
}

let instance = null;

export function getMatchingService() {
  instance ??= new MatchingService();
  return instance;
}
