import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
export const generateAccessToken = (userId, email) => {
    return jwt.sign({ userId, email }, env.JWT_SECRET, {
        expiresIn: '15m',
    });
};
export const generateRefreshToken = (userId) => {
    return jwt.sign({ userId }, env.JWT_REFRESH_SECRET, {
        expiresIn: '7d',
    });
};
export const verifyAccessToken = (token) => {
    return jwt.verify(token, env.JWT_SECRET);
};
export const verifyRefreshToken = (token) => {
    return jwt.verify(token, env.JWT_REFRESH_SECRET);
};
//# sourceMappingURL=jwt.js.map