import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

dotenv.config({ path: path.join(backendRoot, '.env') });

/** Resolve a possibly-relative path from the .env against the backend folder. */
function resolveFromBackend(value) {
  if (!value) return null;
  return path.isAbsolute(value) ? value : path.join(backendRoot, value);
}

export const config = Object.freeze({
  backendRoot,
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 5000,
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  /** Where participants land after signing in. */
  frontendUrl: process.env.FRONTEND_URL || process.env.CORS_ORIGIN || 'http://localhost:5173',

  databaseFile: resolveFromBackend(process.env.DATABASE_URL || './data/photo_finder.db'),
  tempDir: path.join(backendRoot, 'temp'),
  /** Where the ONNX model files live. Point at a mounted disk in production. */
  modelsDir: resolveFromBackend(process.env.MODELS_DIR || './models'),

  googleDrive: {
    rootFolderId: process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || '',
    serviceAccountKeyFile: resolveFromBackend(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE),
    // Hosts rarely let you upload a file, so the same JSON can be supplied
    // as an environment variable instead. Takes precedence over the file.
    serviceAccountJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '',
  },

  /**
   * In production one service serves both the API and the built frontend, so
   * they share an origin. That keeps the login cookie working: separate
   * hosts on onrender.com are cross-site, and the browser would drop it.
   */
  serveFrontend: process.env.SERVE_FRONTEND === 'true' || process.env.NODE_ENV === 'production',
  frontendDist: path.resolve(backendRoot, '..', 'frontend', 'dist'),

  // Phase 7 — participant Google login. Placeholders for now.
  googleOAuth: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: process.env.GOOGLE_REDIRECT_URI || '',
  },

  adminEmails: (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),

  /** Which face model set to load: "large" (most accurate) or "small". */
  faceModel: process.env.FACE_MODEL || 'large',

  // Cosine similarity between ArcFace embeddings, 0 to 1.
  // Calibrated on real event photos — see npm run calibrate.
  faceMatchThreshold: Number(process.env.FACE_MATCH_THRESHOLD) || 0.4,

  sessionSecret: process.env.SESSION_SECRET || '',

  /** How long a set of search results stays reachable. */
  searchSessionTtlMinutes: Number(process.env.SEARCH_SESSION_TTL_MINUTES) || 120,
});
