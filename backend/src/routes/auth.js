import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { google } from 'googleapis';
import { config } from '../config.js';
import { getDb } from '../db/database.js';
import * as queries from '../db/queries.js';
import { AppError } from '../middleware/errorHandler.js';
import { isAdminEmail } from '../middleware/auth.js';
import {
  SESSION_COOKIE,
  cookieOptions,
  createSessionToken,
  readCookie,
} from '../utils/session.js';

/**
 * Google sign-in for participants.
 *
 *   /api/auth/google -> Google consent -> /api/auth/google/callback -> cookie
 *
 * This is a separate Google identity from the service account that reads the
 * organizer's Drive: this one only says who the participant is. The client
 * secret never leaves the backend.
 */
const router = Router();

const OAUTH_SCOPES = ['openid', 'email', 'profile'];
const STATE_COOKIE = 'eps_oauth_state';

function oauthClient() {
  const { clientId, clientSecret, redirectUri } = config.googleOAuth;

  if (!clientId || !clientSecret) {
    throw new AppError('Google sign-in is not configured on this server.', 503);
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

/** GET /api/auth/google — start the login flow. */
router.get('/google', (req, res) => {
  const client = oauthClient();

  // Random state, echoed back by Google, so another site cannot trigger a
  // login callback on a visitor's behalf.
  const state = randomBytes(16).toString('base64url');
  res.cookie(STATE_COOKIE, state, { ...cookieOptions({ days: 1 }), maxAge: 10 * 60 * 1000 });

  res.redirect(
    client.generateAuthUrl({ scope: OAUTH_SCOPES, state, prompt: 'select_account' }),
  );
});

/** GET /api/auth/google/callback — Google sends the participant back here. */
router.get('/google/callback', async (req, res) => {
  const { code, state } = req.query;
  const expectedState = readCookie(req, STATE_COOKIE);
  res.clearCookie(STATE_COOKIE, { path: '/' });

  if (!code) throw new AppError('Sign-in was cancelled.', 400);
  if (!state || !expectedState || state !== expectedState) {
    throw new AppError('Sign-in could not be verified. Please try again.', 400);
  }

  const client = oauthClient();
  const { tokens } = await client.getToken(String(code));

  // The ID token is signed by Google; verifying it proves who the user is
  // without a further API call.
  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: config.googleOAuth.clientId,
  });
  const profile = ticket.getPayload();

  if (!profile?.sub || !profile.email) {
    throw new AppError('Google did not return an account. Please try again.', 400);
  }

  const user = queries.upsertUser(getDb(), {
    googleUserId: profile.sub,
    email: profile.email,
    name: profile.name ?? null,
    profilePicture: profile.picture ?? null,
  });

  res.cookie(SESSION_COOKIE, createSessionToken(user.id), cookieOptions());
  res.redirect(config.frontendUrl);
});

/** GET /api/auth/me — who is signed in. */
router.get('/me', (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: { message: 'Not signed in' } });
    return;
  }

  res.json({
    id: req.user.id,
    email: req.user.email,
    name: req.user.name,
    profilePicture: req.user.profile_picture,
    isAdmin: isAdminEmail(req.user.email),
  });
});

/** POST /api/auth/logout — clear the session. */
router.post('/logout', (req, res) => {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ ok: true });
});

export default router;
