/**
 * Errors thrown by services/routes carry a status and a user-safe message.
 * Anything else becomes a generic 500 — stack traces never reach the client.
 */
export class AppError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = 'AppError';
    this.status = status;
  }
}

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { message: 'Not found' } });
}

/** Errors coming back from the Google APIs client. */
function isDriveError(err) {
  return typeof err?.config?.url === 'string' && err.config.url.includes('googleapis.com');
}

// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity
export function errorHandler(err, req, res, next) {
  // Expected rejections (not signed in, not found, bad upload) are one line:
  // a stack trace for every 401 buries the failures that actually matter.
  // Anything unexpected keeps its full detail, server-side only.
  if (err instanceof AppError && err.status < 500) {
    console.warn(`[${err.status}] ${req.method} ${req.originalUrl} — ${err.message}`);
  } else {
    console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  }

  let status = 500;
  let message = 'Something went wrong. Please try again later.';

  if (err instanceof AppError) {
    status = err.status;
    message = err.message;
  } else if (isDriveError(err)) {
    status = 502;
    message = "We couldn't retrieve the photos right now. Please try again later.";
  }

  res.status(status).json({ error: { message } });
}
