import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { login, logout, me, refresh, register } from '../controllers/auth.controller.js';
import { createRoom, getRoom, getRoomParticipants, updateRoomSettings } from '../controllers/room.controller.js';
import { authenticateJWT } from '../middlewares/auth.js';
import { env } from '../config/env.js';

const apiRouter = Router();

// Rate limiters for security
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Limit each IP to 20 auth requests per window
  message: { error: 'Too many authentication attempts, please try again later' },
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // Limit each IP to 100 requests per minute
  message: { error: 'Too many requests, please slow down' },
});

// Auth Routes
apiRouter.post('/auth/register', authLimiter, register);
apiRouter.post('/auth/login', authLimiter, login);
apiRouter.post('/auth/refresh', refresh);
apiRouter.post('/auth/logout', logout);
apiRouter.get('/auth/me', authenticateJWT as any, me as any);

// ICE Servers Route (Public)
apiRouter.get('/ice-servers', (req, res) => {
  const urls = env.TURN_SERVER_URLS ? env.TURN_SERVER_URLS.split(',') : ['stun:stun.l.google.com:19302'];
  const servers = urls.map(url => {
    const server: any = { urls: url.trim() };
    if (env.TURN_USERNAME && env.TURN_CREDENTIAL && (url.trim().startsWith('turn:') || url.trim().startsWith('turns:'))) {
      server.username = env.TURN_USERNAME;
      server.credential = env.TURN_CREDENTIAL;
    }
    return server;
  });
  res.json({ iceServers: servers });
});

// Room Routes
apiRouter.post('/rooms', apiLimiter, authenticateJWT as any, createRoom as any);
apiRouter.get('/rooms/:slug', apiLimiter, authenticateJWT as any, getRoom as any);
apiRouter.patch('/rooms/:slug/settings', apiLimiter, authenticateJWT as any, updateRoomSettings as any);
apiRouter.get('/rooms/:slug/participants', apiLimiter, authenticateJWT as any, getRoomParticipants as any);

export default apiRouter;
