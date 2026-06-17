import { Server, Socket } from 'socket.io';
import { prisma } from '../config/db.js';
import { verifyAccessToken } from '../utils/jwt.js';
import { logger } from '../utils/logger.js';

interface SocketData {
  userId?: string;
  email?: string;
  name?: string;
  roomId?: string;
  role?: string;
}

export const setupMeetingSockets = (io: Server) => {
  // Authentication Middleware for socket connections
  io.use(async (socket: Socket & { data: SocketData }, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization;
      
      // If no token is provided, check if room allows guest access (represented here by checking database)
      if (!token) {
        // We will extract room ID if passed in queries to allow guest name registration
        const guestName = socket.handshake.query.guestName as string;
        const roomSlug = socket.handshake.query.roomSlug as string;

        if (guestName && roomSlug) {
          socket.data = {
            name: guestName,
            userId: undefined, // guest has no persistent user
            email: undefined,
          };
          return next();
        }
        return next(new Error('Authentication failed: Token or guest credentials required'));
      }

      // Verify token
      let cleanedToken = token;
      if (token.startsWith('Bearer ')) {
        cleanedToken = token.split(' ')[1];
      }

      const payload = verifyAccessToken(cleanedToken);
      const user = await prisma.user.findUnique({ where: { id: payload.userId } });

      if (!user) {
        return next(new Error('User not found'));
      }

      socket.data = {
        userId: user.id,
        email: user.email,
        name: user.name,
      };

      next();
    } catch (err: any) {
      logger.warn('Socket authentication rejected', { error: err.message });
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', (socket: Socket & { data: SocketData }) => {
    logger.debug('New socket connected', { socketId: socket.id, user: socket.data.name });

    // 1. Join Room Flow (supports waiting rooms and locks)
    socket.on('room:join', async ({ roomSlug, isMuted = false, isCameraOff = false }) => {
      try {
        const room = await prisma.meetingRoom.findUnique({
          where: { slug: roomSlug },
          include: { host: true },
        });

        if (!room || room.status !== 'ACTIVE') {
          socket.emit('room:error', { message: 'Meeting room does not exist or is inactive' });
          return;
        }

        const isHost = socket.data.userId === room.hostId;
        const participantRole = isHost ? 'HOST' : 'PARTICIPANT';
        socket.data.roomId = room.id;
        socket.data.role = participantRole;

        // Verify lock state
        if (room.isLocked && !isHost) {
          socket.emit('room:error', { message: 'This room is locked by the host' });
          return;
        }

        // Verify waiting room status
        if (room.isWaitingRoomEnabled && !isHost) {
          // Join the waiting channel
          const waitingRoomId = `${room.id}:waiting`;
          socket.join(waitingRoomId);
          
          // Notify the host about the new waiting peer
          io.to(room.id).emit('waiting-room:joined', {
            peerId: socket.id,
            name: socket.data.name || 'Guest User',
            userId: socket.data.userId,
          });

          socket.emit('waiting-room:wait');
          logger.info('Participant entered waiting room', { peerId: socket.id, roomSlug });
          return;
        }

        // Add to active participants
        await addParticipantToRoom(socket, room.id, participantRole, isMuted, isCameraOff);
      } catch (error: any) {
        logger.error('Room join error', { error: error.message });
        socket.emit('room:error', { message: 'Failed to join the room' });
      }
    });

    // 2. Waiting Room Action: Approve Participant
    socket.on('waiting-room:approve', async ({ targetPeerId }) => {
      const { roomId, role } = socket.data;
      if (!roomId || role !== 'HOST') {
        socket.emit('room:error', { message: 'Unauthorized host action' });
        return;
      }

      const targetSocket = io.sockets.sockets.get(targetPeerId) as (Socket & { data: SocketData }) | undefined;
      if (!targetSocket) {
        socket.emit('room:error', { message: 'Target participant disconnected' });
        return;
      }

      try {
        // Remove target socket from waiting room channel
        targetSocket.leave(`${roomId}:waiting`);
        // Notify target that they are approved
        targetSocket.emit('waiting-room:approved');

        // Add participant to the room
        await addParticipantToRoom(targetSocket, roomId, 'PARTICIPANT', false, false);
      } catch (error: any) {
        logger.error('Waiting room approval error', { error: error.message });
      }
    });

    // 3. Waiting Room Action: Reject Participant
    socket.on('waiting-room:reject', ({ targetPeerId }) => {
      const { roomId, role } = socket.data;
      if (!roomId || role !== 'HOST') {
        socket.emit('room:error', { message: 'Unauthorized host action' });
        return;
      }

      const targetSocket = io.sockets.sockets.get(targetPeerId);
      if (targetSocket) {
        targetSocket.leave(`${roomId}:waiting`);
        targetSocket.emit('waiting-room:rejected');
      }
    });

    // 4. WebRTC Signaling Relay (SDP offers/answers and ICE candidates)
    socket.on('signal:send', ({ targetPeerId, signalData }) => {
      const { roomId } = socket.data;
      if (!roomId) return;

      logger.debug('Relaying signaling packet', { from: socket.id, to: targetPeerId });
      io.to(targetPeerId).emit('signal:receive', {
        senderPeerId: socket.id,
        signalData,
      });
    });

    // 5. Track/Status State Sync
    socket.on('participant:update-status', async ({ isMuted, isCameraOff }) => {
      const { roomId } = socket.data;
      if (!roomId) return;

      try {
        await prisma.meetingParticipant.updateMany({
          where: { socketId: socket.id, leftAt: null },
          data: { isMuted, isCameraOff },
        });

        socket.to(roomId).emit('participant:status-updated', {
          peerId: socket.id,
          isMuted,
          isCameraOff,
        });
      } catch (error: any) {
        logger.error('Update status sync error', { error: error.message });
      }
    });

    // 6. Raise Hand
    socket.on('hand:raise', async ({ isRaised }) => {
      const { roomId } = socket.data;
      if (!roomId) return;

      try {
        await prisma.meetingParticipant.updateMany({
          where: { socketId: socket.id, leftAt: null },
          data: { handRaised: isRaised },
        });

        io.to(roomId).emit('hand:raised', {
          peerId: socket.id,
          isRaised,
        });
      } catch (error: any) {
        logger.error('Hand raise error', { error: error.message });
      }
    });

    // 7. Active Speaker Signaling
    socket.on('active-speaker:change', ({ isSpeaking }) => {
      const { roomId } = socket.data;
      if (!roomId) return;

      // Broadcast active speaker to other peers
      socket.to(roomId).emit('active-speaker:updated', {
        peerId: socket.id,
        isSpeaking,
      });
    });

    // 8. Chat Message
    socket.on('chat:message', async ({ content }) => {
      const { roomId, name, userId } = socket.data;
      if (!roomId || !name) return;

      try {
        const message = await prisma.chatMessage.create({
          data: {
            roomId,
            senderId: userId || null,
            senderName: name,
            content,
          },
        });

        io.to(roomId).emit('chat:message-received', {
          id: message.id,
          senderPeerId: socket.id,
          senderName: name,
          content,
          timestamp: message.timestamp,
        });
      } catch (error: any) {
        logger.error('Chat message write error', { error: error.message });
      }
    });

    // 9. Host Actions (Mute, Kick, Toggle Lock/Waiting Room)
    socket.on('host:action', async ({ action, targetPeerId, value }) => {
      const { roomId, role } = socket.data;
      if (!roomId || role !== 'HOST') {
        socket.emit('room:error', { message: 'Unauthorized host action' });
        return;
      }

      try {
        if (action === 'mute' && targetPeerId) {
          // Send direct mute command to peer
          io.to(targetPeerId).emit('host:action-received', { action: 'mute' });
          logger.info('Host muted participant', { targetPeerId, roomId });
        } 
        
        else if (action === 'kick' && targetPeerId) {
          // Send kick command
          io.to(targetPeerId).emit('host:action-received', { action: 'kick' });
          logger.info('Host kicked participant', { targetPeerId, roomId });
        } 
        
        else if (action === 'toggle-lock') {
          const lockedState = !!value;
          await prisma.meetingRoom.update({
            where: { id: roomId },
            data: { isLocked: lockedState },
          });
          io.to(roomId).emit('room:settings-changed', { isLocked: lockedState });
          logger.info('Host changed lock state', { lockedState, roomId });
        } 
        
        else if (action === 'toggle-waiting') {
          const waitingState = !!value;
          await prisma.meetingRoom.update({
            where: { id: roomId },
            data: { isWaitingRoomEnabled: waitingState },
          });
          io.to(roomId).emit('room:settings-changed', { isWaitingRoomEnabled: waitingState });
          logger.info('Host changed waiting room state', { waitingState, roomId });
        }
      } catch (error: any) {
        logger.error('Host action exception', { error: error.message });
      }
    });

    // 10. Disconnect/Leave Flow
    socket.on('room:leave', () => {
      handleDisconnect(socket, io);
    });

    socket.on('disconnect', () => {
      handleDisconnect(socket, io);
    });
  });
};

// Helper: Add approved participant to database and broadcast entry
const addParticipantToRoom = async (
  socket: Socket & { data: SocketData },
  roomId: string,
  role: 'HOST' | 'PARTICIPANT',
  isMuted: boolean,
  isCameraOff: boolean
) => {
  const name = socket.data.name || 'Anonymous User';
  
  // Register in DB
  const participant = await prisma.meetingParticipant.create({
    data: {
      roomId,
      userId: socket.data.userId || null,
      name,
      role,
      socketId: socket.id,
      isMuted,
      isCameraOff,
    },
  });

  socket.join(roomId);

  // Retrieve current active peers in this room (excluding self)
  const currentPeers = await prisma.meetingParticipant.findMany({
    where: {
      roomId,
      state: 'APPROVED',
      leftAt: null,
      socketId: { not: socket.id },
    },
    select: {
      socketId: true,
      name: true,
      role: true,
      isMuted: true,
      isCameraOff: true,
      handRaised: true,
    },
  });

  // 1. Reply back to joined socket with room meta details and existing peers list
  socket.emit('room:joined', {
    selfPeerId: socket.id,
    currentParticipants: currentPeers.map(p => ({
      peerId: p.socketId,
      name: p.name,
      role: p.role,
      isMuted: p.isMuted,
      isCameraOff: p.isCameraOff,
      handRaised: p.handRaised,
    })),
  });

  // 2. Broadcast user entrance to all existing active peers in the room
  socket.to(roomId).emit('room:peer-joined', {
    peerId: socket.id,
    name,
    role,
    isMuted,
    isCameraOff,
    handRaised: false,
  });

  logger.info('Participant successfully joined room', {
    roomId,
    peerId: socket.id,
    role,
    name,
  });
};

// Helper: Disconnect and clean up participant records
const handleDisconnect = async (socket: Socket & { data: SocketData }, io: Server) => {
  const { roomId } = socket.data;
  if (!roomId) return;

  try {
    // Locate the active participant record
    const participant = await prisma.meetingParticipant.findFirst({
      where: { socketId: socket.id, leftAt: null },
    });

    if (participant) {
      await prisma.meetingParticipant.update({
        where: { id: participant.id },
        data: {
          leftAt: new Date(),
          state: 'LEFT',
        },
      });

      // Broadcast peer departure
      io.to(roomId).emit('room:peer-left', { peerId: socket.id });
      
      // Clean host waiting room queue alerts if target socket was waiting
      io.to(roomId).emit('waiting-room:left', { peerId: socket.id });

      logger.info('Participant left room, database synced', {
        roomId,
        peerId: socket.id,
        name: socket.data.name,
      });

      // Clean rooms check: if no participants remain, we set room to INACTIVE (optional cleanup)
      // const activeCount = await prisma.meetingParticipant.count({
      //   where: { roomId, leftAt: null, state: 'APPROVED' },
      // });
      //
      // if (activeCount === 0) {
      //   await prisma.meetingRoom.update({
      //     where: { id: roomId },
      //     data: { status: 'INACTIVE' },
      //   });
      //   logger.info('Meeting room set to INACTIVE (all peers left)', { roomId });
      // }
    }
  } catch (error: any) {
    logger.error('Socket disconnection cleanup error', { error: error.message });
  } finally {
    socket.leave(roomId);
    socket.data.roomId = undefined;
  }
};
