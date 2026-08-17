import { getDb } from '../db/database.js';
import * as queries from '../db/queries.js';
import { getGoogleDriveService } from './googleDrive.js';
import { getFaceRecognitionService } from './faceRecognition.js';
import { ensureDecodableImage, isProcessableImage } from '../utils/imageConverter.js';
import { AppError } from '../middleware/errorHandler.js';

/**
 * Turns a Google Drive event folder into rows in SQLite:
 *
 *   Drive folder -> photos -> faces -> embeddings -> SQLite
 *
 * Photos are held in memory only while their faces are measured, then dropped.
 * Nothing is written to disk and nothing is sent back to Drive: the originals
 * stay where the organizer put them.
 */

/** How many photos to download ahead while the current one is processed. */
const PREFETCH = 2;

/**
 * Downloads run ahead of face processing so the CPU is not idle waiting on the
 * network. Failures are carried through rather than thrown, so one bad file
 * cannot abort a long run.
 */
async function* withPrefetch(items, load, ahead = PREFETCH) {
  const queue = [];
  let next = 0;

  const fill = () => {
    while (queue.length < ahead && next < items.length) {
      const item = items[next];
      next += 1;
      queue.push({
        item,
        promise: load(item).then(
          (value) => ({ value }),
          (error) => ({ error }),
        ),
      });
    }
  };

  fill();
  while (queue.length > 0) {
    const { item, promise } = queue.shift();
    fill();
    yield { item, ...(await promise) };
  }
}

export class IndexingService {
  constructor({ db, drive, faceRecognition } = {}) {
    this.db = db ?? null;
    this.drive = drive ?? null;
    this.face = faceRecognition ?? null;
  }

  get database() {
    return (this.db ??= getDb());
  }

  get driveService() {
    return (this.drive ??= getGoogleDriveService());
  }

  get faceService() {
    return (this.face ??= getFaceRecognitionService());
  }

  /**
   * Reads the Drive root folder and makes sure every event folder has a row.
   * Events are never deleted here — an event whose folder disappears keeps its
   * indexed photos until someone removes it deliberately.
   */
  async syncEvents() {
    const folders = await this.driveService.listEvents();
    const before = queries.listEvents(this.database).length;

    for (const folder of folders) {
      queries.upsertEvent(this.database, {
        driveFolderId: folder.id,
        name: folder.name.trim(),
      });
    }

    const total = queries.listEvents(this.database).length;
    return { discovered: folders.length, added: total - before, total };
  }

  /**
   * Indexes one event from scratch. Re-running replaces the previous index,
   * which is the simple and safe approach the README asks for.
   */
  async indexEvent(eventId, { onProgress } = {}) {
    const event = queries.getEvent(this.database, eventId);
    if (!event) throw new AppError('Event not found', 404);

    const started = Date.now();
    queries.setEventStatus(this.database, event.id, 'indexing');

    try {
      await this.faceService.load();

      const driveFiles = await this.driveService.listPhotos(event.drive_folder_id);
      const images = driveFiles.filter(isProcessableImage);

      // Old rows go only once the new listing is in hand, so a Drive failure
      // cannot leave the event with nothing.
      queries.clearEventIndex(this.database, event.id);

      const stats = {
        event: event.name,
        total: images.length,
        skippedUnsupported: driveFiles.length - images.length,
        processed: 0,
        failed: 0,
        faces: 0,
        photosWithFaces: 0,
      };

      const download = async (file) => {
        const raw = await this.driveService.downloadFileToBuffer(file.id);
        return ensureDecodableImage(raw, file);
      };

      for await (const { item: file, value, error } of withPrefetch(images, download)) {
        if (error) {
          stats.failed += 1;
          console.error(`[index] ${file.name}: download failed — ${error.message}`);
          onProgress?.({ ...stats, current: file.name });
          continue;
        }

        try {
          const faces = await this.faceService.detectAndEmbed(value.buffer);
          this.#storePhoto(event.id, file, faces);

          stats.processed += 1;
          stats.faces += faces.length;
          if (faces.length > 0) stats.photosWithFaces += 1;
        } catch (err) {
          stats.failed += 1;
          console.error(`[index] ${file.name}: processing failed — ${err.message}`);
        }

        onProgress?.({ ...stats, current: file.name });
      }

      queries.setEventStatus(this.database, event.id, 'ready', {
        indexedAt: new Date().toISOString(),
      });

      return { ...stats, durationMs: Date.now() - started };
    } catch (err) {
      queries.setEventStatus(this.database, event.id, 'failed');
      throw err;
    }
  }

  /** One photo and all of its faces are written together or not at all. */
  #storePhoto(eventId, file, faces) {
    const write = this.database.transaction(() => {
      const photo = queries.insertPhoto(this.database, {
        eventId,
        driveFileId: file.id,
        fileName: file.name,
        mimeType: file.mimeType,
      });

      for (const face of faces) {
        queries.insertEmbedding(this.database, {
          photoId: photo.id,
          embedding: face.embedding,
          faceIndex: face.faceIndex,
        });
      }
    });

    write();
  }
}

let instance = null;

export function getIndexingService() {
  instance ??= new IndexingService();
  return instance;
}
