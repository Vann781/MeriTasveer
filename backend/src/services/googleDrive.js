import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { google } from 'googleapis';
import { config } from '../config.js';
import { AppError } from '../middleware/errorHandler.js';

// Read-only: this application never modifies the organizer's Drive.
const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.readonly'];

// Drive IDs are URL-safe base64-ish strings. Validating before building a query
// keeps anything user-supplied out of the Drive query language.
const DRIVE_ID_PATTERN = /^[A-Za-z0-9_-]{10,}$/;

const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';

/** Network blips and Drive rate limits are common over a long indexing run. */
const RETRY_DELAYS_MS = [500, 1500, 4000];
const RETRYABLE_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE']);

function isRetryable(err) {
  if (RETRYABLE_CODES.has(err?.code)) return true;
  const status = err?.status ?? err?.response?.status;
  return status === 429 || (status >= 500 && status < 600);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Retries a Drive call a few times, backing off between attempts. */
async function withRetry(operation) {
  let lastError;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      if (!isRetryable(err) || attempt === RETRY_DELAYS_MS.length) break;
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }

  throw lastError;
}

export function isValidDriveId(id) {
  return typeof id === 'string' && DRIVE_ID_PATTERN.test(id);
}

/**
 * All Google Drive access lives here. Nothing outside this service knows about
 * the Drive API, and no Drive URL or credential ever leaves it.
 */
export class GoogleDriveService {
  constructor(options = {}) {
    this.rootFolderId = options.rootFolderId ?? config.googleDrive.rootFolderId;
    this.keyFile = options.keyFile ?? config.googleDrive.serviceAccountKeyFile;
    this.keyJson = options.keyJson ?? config.googleDrive.serviceAccountJson;
    this.tempDir = options.tempDir ?? config.tempDir;
    this.drive = null;
  }

  /** The service account key, from the environment or from a file on disk. */
  #credentials() {
    if (this.keyJson) {
      try {
        return JSON.parse(this.keyJson);
      } catch {
        throw new AppError('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON', 500);
      }
    }
    return JSON.parse(fs.readFileSync(this.keyFile, 'utf8'));
  }

  /** Fails fast with an actionable message instead of a raw Google error. */
  assertConfigured() {
    if (!this.rootFolderId) {
      throw new AppError('GOOGLE_DRIVE_ROOT_FOLDER_ID is not set in backend/.env', 500);
    }
    if (!isValidDriveId(this.rootFolderId)) {
      throw new AppError('GOOGLE_DRIVE_ROOT_FOLDER_ID does not look like a Drive folder ID', 500);
    }
    if (this.keyJson) return; // supplied through the environment

    if (!this.keyFile) {
      throw new AppError(
        'Set GOOGLE_SERVICE_ACCOUNT_JSON, or GOOGLE_SERVICE_ACCOUNT_KEY_FILE pointing at the key',
        500,
      );
    }
    if (!fs.existsSync(this.keyFile)) {
      throw new AppError(`Service account key file not found at ${this.keyFile}`, 500);
    }
  }

  async getClient() {
    if (this.drive) return this.drive;

    this.assertConfigured();
    const auth = new google.auth.GoogleAuth({
      credentials: this.#credentials(),
      scopes: DRIVE_SCOPES,
    });
    this.drive = google.drive({ version: 'v3', auth });
    return this.drive;
  }

  /** Email of the service account the Drive folder must be shared with. */
  async getServiceAccountEmail() {
    this.assertConfigured();
    return this.#credentials().client_email ?? null;
  }

  /** Runs a files.list query, following pagination. */
  async #listAll(query, fields) {
    const drive = await this.getClient();
    const files = [];
    let pageToken;

    do {
      const { data } = await withRetry(() =>
        drive.files.list({
          q: query,
          fields: `nextPageToken, files(${fields})`,
          orderBy: 'name',
          pageSize: 200,
          pageToken,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        }),
      );
      files.push(...(data.files ?? []));
      pageToken = data.nextPageToken;
    } while (pageToken);

    return files;
  }

  /** Metadata for the configured root folder — useful to confirm access. */
  async getRootFolder() {
    const drive = await this.getClient();
    const { data } = await drive.files.get({
      fileId: this.rootFolderId,
      fields: 'id, name, mimeType',
      supportsAllDrives: true,
    });
    return { id: data.id, name: data.name };
  }

  /** Every direct subfolder of the root folder is an event. */
  async listEvents() {
    this.assertConfigured();
    const folders = await this.#listAll(
      `'${this.rootFolderId}' in parents and mimeType = '${FOLDER_MIME_TYPE}' and trashed = false`,
      'id, name',
    );
    return folders.map((folder) => ({ id: folder.id, name: folder.name }));
  }

  /**
   * Image files in an event folder, including nested subfolders — organizers
   * sometimes split an event into "Day 1" / "Day 2". Videos are ignored.
   */
  async listPhotos(eventFolderId, { maxDepth = 3 } = {}) {
    if (!isValidDriveId(eventFolderId)) {
      throw new AppError('Invalid event ID', 400);
    }

    const photos = [];
    const seen = new Set();
    let level = [eventFolderId];

    for (let depth = 0; depth <= maxDepth && level.length > 0; depth += 1) {
      const next = [];

      for (const folderId of level) {
        const files = await this.#listAll(
          `'${folderId}' in parents and trashed = false`,
          'id, name, mimeType',
        );

        for (const file of files) {
          if (file.mimeType === FOLDER_MIME_TYPE) {
            next.push(file.id);
          } else if (file.mimeType?.startsWith('image/') && !seen.has(file.id)) {
            seen.add(file.id);
            photos.push({ id: file.id, name: file.name, mimeType: file.mimeType });
          }
        }
      }

      level = next;
    }

    return photos;
  }

  /**
   * Confirms a folder really is one of the root folder's events, so the API
   * can never be used to read arbitrary folders the service account can see.
   */
  async isEventFolder(folderId) {
    if (!isValidDriveId(folderId)) return false;

    const drive = await this.getClient();
    try {
      const { data } = await drive.files.get({
        fileId: folderId,
        fields: 'id, name, mimeType, parents',
        supportsAllDrives: true,
      });
      const isFolder = data.mimeType === FOLDER_MIME_TYPE;
      const isChildOfRoot = (data.parents ?? []).includes(this.rootFolderId);
      return isFolder && isChildOfRoot ? { id: data.id, name: data.name } : false;
    } catch (err) {
      if (err?.status === 404 || err?.code === 404) return false;
      throw err;
    }
  }

  /** Raw file contents as a readable stream. */
  async downloadFile(fileId) {
    if (!isValidDriveId(fileId)) {
      throw new AppError('Invalid file ID', 400);
    }
    const drive = await this.getClient();
    const response = await drive.files.get(
      { fileId, alt: 'media', supportsAllDrives: true },
      { responseType: 'stream' },
    );
    return response.data;
  }

  /**
   * File contents in memory — used by indexing, which never keeps the bytes.
   * The retry wraps the whole download because connections drop mid-stream.
   */
  async downloadFileToBuffer(fileId) {
    return withRetry(async () => {
      const stream = await this.downloadFile(fileId);
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      return Buffer.concat(chunks);
    });
  }

  /**
   * Downloads a file to a temporary location for processing.
   * The caller is responsible for deleting it — images are never kept.
   */
  async downloadFileToTemp(fileId, fileName = fileId) {
    fs.mkdirSync(this.tempDir, { recursive: true });
    const tempPath = path.join(this.tempDir, `${Date.now()}-${path.basename(fileName)}`);

    await withRetry(async () => {
      const stream = await this.downloadFile(fileId);
      await pipeline(stream, fs.createWriteStream(tempPath));
    });

    return tempPath;
  }
}

let instance = null;

/** Shared instance, created on first use so the app boots without credentials. */
export function getGoogleDriveService() {
  instance ??= new GoogleDriveService();
  return instance;
}
