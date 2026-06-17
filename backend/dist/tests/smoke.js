import { createServer } from 'http';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { prisma } from '../config/db.js';
import apiRouter from '../routes/api.js';
import { logger } from '../utils/logger.js';
const app = express();
app.use(cors());
app.use(express.json());
app.use(cookieParser());
app.use('/api', apiRouter);
const testServer = createServer(app);
const TEST_PORT = 5055;
const BASE_URL = `http://localhost:${TEST_PORT}/api`;
const runSmokeTests = async () => {
    try {
        // 1. Start test server
        await new Promise((resolve) => {
            testServer.listen(TEST_PORT, () => {
                logger.info(`🧪 Test server started on port ${TEST_PORT}`);
                resolve();
            });
        });
        // Clean test database records if they exist
        await prisma.chatMessage.deleteMany().catch(() => { });
        await prisma.meetingParticipant.deleteMany().catch(() => { });
        await prisma.meetingRoom.deleteMany().catch(() => { });
        await prisma.user.deleteMany().catch(() => { });
        logger.info('🧪 Test DB cleared');
        // 2. Test Registration
        const registerPayload = {
            email: 'tester@enterprise.com',
            name: 'Test Engineer',
            password: 'password123',
        };
        const regRes = await fetch(`${BASE_URL}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(registerPayload),
        });
        const regData = await regRes.json();
        if (regRes.status !== 201 || !regData.user || regData.user.email !== registerPayload.email) {
            throw new Error(`❌ Registration failed. Status: ${regRes.status}, Body: ${JSON.stringify(regData)}`);
        }
        logger.info('✅ Test Registration Succeeded');
        // 3. Test Login
        const loginPayload = {
            email: 'tester@enterprise.com',
            password: 'password123',
        };
        const loginRes = await fetch(`${BASE_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(loginPayload),
        });
        const loginData = await loginRes.json();
        if (loginRes.status !== 200 || !loginData.accessToken || !loginData.user) {
            throw new Error(`❌ Login failed. Status: ${loginRes.status}, Body: ${JSON.stringify(loginData)}`);
        }
        const token = loginData.accessToken;
        logger.info('✅ Test Login Succeeded');
        // 4. Test Authenticated profile fetching
        const meRes = await fetch(`${BASE_URL}/auth/me`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
            },
        });
        const meData = await meRes.json();
        if (meRes.status !== 200 || !meData.user || meData.user.name !== 'Test Engineer') {
            throw new Error(`❌ Profile fetch failed. Status: ${meRes.status}, Body: ${JSON.stringify(meData)}`);
        }
        logger.info('✅ Test Profile Succeeded');
        // 5. Test Room Creation
        const roomPayload = {
            name: 'Project Sync Room',
            isLocked: false,
            isWaitingRoomEnabled: true,
        };
        const roomRes = await fetch(`${BASE_URL}/rooms`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify(roomPayload),
        });
        const roomData = await roomRes.json();
        if (roomRes.status !== 201 || !roomData.room || !roomData.room.slug) {
            throw new Error(`❌ Room creation failed. Status: ${roomRes.status}, Body: ${JSON.stringify(roomData)}`);
        }
        const slug = roomData.room.slug;
        logger.info(`✅ Test Room Creation Succeeded (Slug: ${slug})`);
        // 6. Test Fetching Room details
        const getRoomRes = await fetch(`${BASE_URL}/rooms/${slug}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
            },
        });
        const getRoomData = await getRoomRes.json();
        if (getRoomRes.status !== 200 || !getRoomData.room || getRoomData.room.slug !== slug) {
            throw new Error(`❌ Fetch room failed. Status: ${getRoomRes.status}, Body: ${JSON.stringify(getRoomData)}`);
        }
        logger.info('✅ Test Fetch Room Details Succeeded');
        // All checks passed
        logger.info('🎉 All smoke tests passed successfully!');
        cleanup(0);
    }
    catch (error) {
        logger.error('❌ Integration smoke test encountered errors', { error: error.message });
        cleanup(1);
    }
};
const cleanup = (code) => {
    testServer.close(async () => {
        await prisma.$disconnect();
        logger.info('🔌 Closed server and database connections.');
        process.exit(code);
    });
};
runSmokeTests();
//# sourceMappingURL=smoke.js.map