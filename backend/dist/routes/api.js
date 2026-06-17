import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { login, logout, me, refresh, register } from '../controllers/auth.controller.js';
import { createRoom, getRoom, getRoomParticipants, updateRoomSettings } from '../controllers/room.controller.js';
import { authenticateJWT } from '../middlewares/auth.js';
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
apiRouter.get('/auth/me', authenticateJWT, me);
// Room Routes
apiRouter.post('/rooms', apiLimiter, authenticateJWT, createRoom);
apiRouter.get('/rooms/:slug', apiLimiter, authenticateJWT, getRoom);
apiRouter.patch('/rooms/:slug/settings', apiLimiter, authenticateJWT, updateRoomSettings);
apiRouter.get('/rooms/:slug/participants', apiLimiter, authenticateJWT, getRoomParticipants);
export default apiRouter;
//# sourceMappingURL=api.js.map