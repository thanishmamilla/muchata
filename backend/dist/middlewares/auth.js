import { verifyAccessToken } from '../utils/jwt.js';
import { logger } from '../utils/logger.js';
export const authenticateJWT = (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        let token = '';
        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.split(' ')[1];
        }
        else if (req.cookies && req.cookies.accessToken) {
            token = req.cookies.accessToken;
        }
        if (!token) {
            res.status(401).json({ error: 'Access token required' });
            return;
        }
        const payload = verifyAccessToken(token);
        req.user = payload;
        next();
    }
    catch (error) {
        logger.warn('Authentication failed', { message: error.message });
        res.status(403).json({ error: 'Invalid or expired access token' });
    }
};
//# sourceMappingURL=auth.js.map