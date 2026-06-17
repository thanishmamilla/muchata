import { Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/db.js';
import { AuthenticatedRequest } from '../middlewares/auth.js';
import { logger } from '../utils/logger.js';

// Helper to generate Google Meet style room slugs (abc-defg-hij)
const generateRoomSlug = (): string => {
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  const gen = (len: number) => {
    let result = '';
    for (let i = 0; i < len; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  };
  return `${gen(3)}-${gen(4)}-${gen(3)}`;
};

const createRoomSchema = z.object({
  name: z.string().max(100).optional(),
  isLocked: z.boolean().optional().default(false),
  isWaitingRoomEnabled: z.boolean().optional().default(false),
});

const updateRoomSchema = z.object({
  isLocked: z.boolean().optional(),
  isWaitingRoomEnabled: z.boolean().optional(),
  name: z.string().max(100).optional(),
});

export const createRoom = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    const parsed = createRoomSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid room configuration' });
      return;
    }

    const { name, isLocked, isWaitingRoomEnabled } = parsed.data;

    let slug = generateRoomSlug();
    // Prevent collision
    let collision = await prisma.meetingRoom.findUnique({ where: { slug } });
    let attempts = 0;
    while (collision && attempts < 5) {
      slug = generateRoomSlug();
      collision = await prisma.meetingRoom.findUnique({ where: { slug } });
      attempts++;
    }

    const room = await prisma.meetingRoom.create({
      data: {
        slug,
        name,
        hostId: req.user.userId,
        isLocked,
        isWaitingRoomEnabled,
      },
    });

    logger.info('Meeting room created', { roomId: room.id, slug: room.slug });
    res.status(201).json({ room });
  } catch (error: any) {
    logger.error('Create room error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getRoom = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { slug } = req.params;

  try {
    const room = await prisma.meetingRoom.findUnique({
      where: { slug },
      include: {
        host: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!room || room.status !== 'ACTIVE') {
      res.status(404).json({ error: 'Meeting room not found or inactive' });
      return;
    }

    res.json({ room });
  } catch (error: any) {
    logger.error('Get room error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const updateRoomSettings = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const { slug } = req.params;

  try {
    const room = await prisma.meetingRoom.findUnique({ where: { slug } });

    if (!room) {
      res.status(404).json({ error: 'Meeting room not found' });
      return;
    }

    if (room.hostId !== req.user.userId) {
      res.status(403).json({ error: 'Only the host can update room settings' });
      return;
    }

    const parsed = updateRoomSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid settings configuration' });
      return;
    }

    const updatedRoom = await prisma.meetingRoom.update({
      where: { slug },
      data: parsed.data,
    });

    logger.info('Meeting room updated', { roomId: updatedRoom.id, settings: parsed.data });
    res.json({ room: updatedRoom });
  } catch (error: any) {
    logger.error('Update room settings error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getRoomParticipants = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { slug } = req.params;

  try {
    const room = await prisma.meetingRoom.findUnique({ where: { slug } });
    if (!room) {
      res.status(404).json({ error: 'Meeting room not found' });
      return;
    }

    const participants = await prisma.meetingParticipant.findMany({
      where: {
        roomId: room.id,
        state: 'APPROVED',
        leftAt: null,
      },
      select: {
        id: true,
        userId: true,
        name: true,
        role: true,
        socketId: true,
        isMuted: true,
        isCameraOff: true,
        handRaised: true,
        joinedAt: true,
      },
    });

    res.json({ participants });
  } catch (error: any) {
    logger.error('Get room participants error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
};
