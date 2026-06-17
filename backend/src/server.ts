import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { createClient } from 'redis';
import { createAdapter } from '@socket.io/redis-adapter';

import { env } from './config/env.js';
import { prisma } from './config/db.js';
import { logger } from './utils/logger.js';
import apiRouter from './routes/api.js';
import { setupMeetingSockets } from './sockets/meeting.socket.js';

const app = express();
const httpServer = createServer(app);

// 1. Dynamic CORS Origin Resolver (Allows localhost and any local network IP for mobile device testing)
const allowedOrigins = [
  env.FRONTEND_URL,
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

const isLocalNetwork = (origin: string) => {
  if (!origin) return false;
  return (
    origin.startsWith('http://localhost:') ||
    origin.startsWith('https://localhost:') ||
    origin.startsWith('http://127.0.0.1:') ||
    /^https?:\/\/(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/.test(origin)
  );
};

const isVercelOrigin = (origin: string) => {
  if (!origin) return false;
  return /^https:\/\/([a-zA-Z0-9-]+\.)*vercel\.app$/.test(origin);
};

const corsOriginResolver = (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
  if (!origin || allowedOrigins.includes(origin) || isLocalNetwork(origin) || isVercelOrigin(origin)) {
    callback(null, true);
  } else {
    callback(new Error(`Origin ${origin} not allowed by CORS`));
  }
};

// 1. HTTP Middlewares
app.use(
  cors({
    origin: corsOriginResolver,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  })
);
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Health Check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', environment: env.NODE_ENV });
});

// API Routes
app.use('/api', apiRouter);

// Global Error Handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled Exception occurred', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

// 2. Socket.IO Setup
const io = new Server(httpServer, {
  cors: {
    origin: corsOriginResolver,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  pingTimeout: 60000, // 60s
  pingInterval: 25000, // 25s
});

// 3. Redis Adapter for scaling Socket.IO state
const initializeRedisAdapter = async () => {
  try {
    const pubClient = createClient({
      url: env.REDIS_URL,
      socket: {
        reconnectStrategy: (retries) => {
          if (retries >= 1) {
            return new Error('Redis connection failed');
          }
          return 500; // wait 500ms before retrying once
        },
      },
    });
    const subClient = pubClient.duplicate();

    pubClient.on('error', (err) => logger.warn('Redis pubClient error', { error: err.message }));
    subClient.on('error', (err) => logger.warn('Redis subClient error', { error: err.message }));

    await Promise.all([pubClient.connect(), subClient.connect()]);
    
    io.adapter(createAdapter(pubClient, subClient));
    logger.info('✅ Socket.IO Redis Adapter initialized successfully');
  } catch (error: any) {
    logger.warn('⚠️ Redis connection failed. Falling back to local in-memory Socket.IO adapter.', {
      message: error.message,
    });
  }
};

// Start application
const startServer = async () => {
  // Test Database Connection
  try {
    await prisma.$connect();
    logger.info('✅ Database connected successfully');
  } catch (error: any) {
    logger.error('❌ Database connection failed', { error: error.message });
    process.exit(1);
  }

  // Set up socket scaling if possible
  await initializeRedisAdapter();

  // Set up socket routes
  setupMeetingSockets(io);

  // Bind and listen
  const PORT = env.PORT;
  httpServer.listen(PORT, () => {
    logger.info(`🚀 Server running in ${env.NODE_ENV} mode on port ${PORT}`);
  });
};

startServer().catch((err) => {
  logger.error('Server initialization crash', { error: err.message });
  process.exit(1);
});
