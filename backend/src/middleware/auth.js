import { config } from '../config.js';
import { getDb } from '../db/database.js';
import * as queries from '../db/queries.js';
import { AppError } from './errorHandler.js';
import { SESSION_COOKIE, readCookie, readSessionToken } from '../utils/session.js';

/** Is this email one of the organizers listed in ADMIN_EMAILS? */
export function isAdminEmail(email, admins = config.adminEmails) {
  return Boolean(email) && admins.includes(email.toLowerCase());
}

/** Loads the signed-in user onto req.user, or leaves it undefined. */
export function attachUser(req, res, next) {
  const userId = readSessionToken(readCookie(req, SESSION_COOKIE));
  if (userId) {
    const user = queries.getUser(getDb(), userId);
    if (user) {
      req.user = { ...user, isAdmin: isAdminEmail(user.email) };
    }
  }
  next();
}

/** Blocks anyone who is not signed in. */
export function requireAuth(req, res, next) {
  if (!req.user) throw new AppError('Please sign in to continue.', 401);
  next();
}

/** Blocks anyone who is not an organizer. */
export function requireAdmin(req, res, next) {
  if (!req.user) throw new AppError('Please sign in to continue.', 401);
  if (!req.user.isAdmin) throw new AppError('Not authorized', 403);
  next();
}
