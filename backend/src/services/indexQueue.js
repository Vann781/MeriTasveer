import { getIndexingService } from './indexing.js';

/**
 * Indexing takes minutes, so an admin request cannot wait for it. This starts
 * the work in the background and keeps a progress snapshot the dashboard can
 * poll; the durable state lives in events.status.
 *
 * One job at a time on purpose: face detection is CPU-bound, and running two
 * events at once makes both slower rather than either faster.
 */
export class IndexQueue {
  constructor({ indexing } = {}) {
    this.indexing = indexing ?? null;
    this.current = null;
    this.progress = new Map();
  }

  get indexingService() {
    return (this.indexing ??= getIndexingService());
  }

  get busyWith() {
    return this.current;
  }

  /** Latest known progress for an event, if it has been indexed this run. */
  progressFor(eventId) {
    return this.progress.get(eventId) ?? null;
  }

  /**
   * Kicks off indexing. Returns immediately: the caller polls for progress.
   * Rejects politely if something else is already running.
   */
  start(eventId) {
    if (this.current !== null) {
      return { accepted: false, reason: 'Another event is being indexed. Please wait.' };
    }

    this.current = eventId;
    this.progress.set(eventId, { state: 'indexing', processed: 0, total: null, faces: 0 });

    // Deliberately not awaited — the HTTP response goes back straight away.
    this.indexingService
      .indexEvent(eventId, {
        onProgress: (stats) => {
          this.progress.set(eventId, {
            state: 'indexing',
            processed: stats.processed + stats.failed,
            total: stats.total,
            faces: stats.faces,
          });
        },
      })
      .then((result) => {
        this.progress.set(eventId, {
          state: 'ready',
          processed: result.processed,
          total: result.total,
          faces: result.faces,
          failed: result.failed,
          durationMs: result.durationMs,
        });
      })
      .catch((err) => {
        console.error(`[index] event ${eventId} failed`, err);
        this.progress.set(eventId, { state: 'failed', error: err.message });
      })
      .finally(() => {
        this.current = null;
      });

    return { accepted: true };
  }
}

let instance = null;

export function getIndexQueue() {
  instance ??= new IndexQueue();
  return instance;
}
