import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import healthRoutes from './routes/health.js';
import authRoutes from './routes/auth.js';
import eventRoutes from './routes/events.js';
import photoRoutes from './routes/photos.js';
import adminRoutes from './routes/admin.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { attachUser, requireAdmin, requireAuth } from './middleware/auth.js';

/**
 * `services` lets tests substitute Google Drive. In normal use the routes fall
 * back to the real service.
 */
export function createApp(services = {}) {
  const app = express();

  app.disable('x-powered-by');
  app.use(cors({ origin: config.corsOrigin, credentials: true }));
  app.use(express.json());

  if (services.drive) app.locals.driveService = services.drive;

  // Every route can see who is signed in; only some insist on it.
  app.use(attachUser);

  app.use('/api/health', healthRoutes);
  app.use('/api/auth', authRoutes);

  // Events, searches and photos are for signed-in participants only.
  app.use('/api/events', requireAuth, eventRoutes);
  app.use('/api/searches', requireAuth, photoRoutes);

  // Organizers only.
  app.use('/api/admin', requireAdmin, adminRoutes);

  // In production the built frontend is served from here too, so the browser
  // sees one origin and the session cookie is never treated as third-party.
  if (config.serveFrontend && fs.existsSync(config.frontendDist)) {
    app.use(express.static(config.frontendDist, { maxAge: '1h', index: false }));

    // Anything that is not an API call is a client-side route.
    app.get(/^(?!\/api\/).*/, (req, res) => {
      res.sendFile(path.join(config.frontendDist, 'index.html'));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp();
