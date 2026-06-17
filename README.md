# Enterprise Video Conferencing Platform (Google Meet Clone)

A complete, production-ready, real-time video conferencing platform inspired by Google Meet, Zoom, and Microsoft Teams. It features HD video streaming, high-quality Opus audio prioritization, screen sharing, real-time text chat, waiting lobbies, host administrative actions, dynamic WebRTC bandwidth control, and a developer diagnostics telemetry panel.

---

## 🏗️ Architecture Overview

The system is split into two modular sub-applications to support deployment scalability:

1. **Frontend (Next.js App Router)**: 
   - A highly optimized, responsive UI built with Tailwind CSS, Lucide Icons, and Framer Motion animations.
   - Leverages **Zustand** stores for decoupled, high-performance state management (Auth, Media, and Room contexts) preventing redundant page re-renders.
   - Executes peer-to-peer (P2P) WebRTC negotiations directly on client browsers utilizing a client-side mesh router.
   - Deploys natively to serverless platforms like **Vercel**.

2. **Backend (Node.js + Express + Socket.IO)**:
   - A stateful, long-running Node.js process serving RESTful APIs and coordinating WebRTC signaling.
   - Utilizes **Socket.IO** to relay SDP offers/answers, ICE candidates, and host control actions between peers.
   - Persists room history, participant logs, and chat records in **PostgreSQL** via **Prisma ORM**.
   - Integrates **Redis** to synchronize socket events across multiple server nodes, preparing the system for horizontal autoscaling.
   - Deploys to stateful platforms like **Railway, Render, Fly.io, or VPS Instances (AWS/DigitalOcean)**.

```
                  ┌──────────────────────┐
                  │   Next.js Frontend   │
                  │   (Vercel Hosting)   │
                  └──────────┬───────────┘
                             │
            HTTP Requests    │   WebSocket Connections
             & JSON API      │   (WebRTC Signaling)
                             ▼
                  ┌──────────────────────┐
                  │ Express Signaler     │
                  │ (Render / Railway)   │
                  └─────┬──────────┬─────┘
                        │          │
         Prisma Queries │          │ Pub/Sub Event Sync
                        ▼          ▼
               ┌──────────┐      ┌─────────┐
               │ Postgres │      │  Redis  │
               └──────────┘      └─────────┘
```

---

## 📂 Folder Structure

```
/meet-clone
  ├── backend/                   # Node.js Express server code
  │   ├── prisma/                # Prisma schema definitions (PostgreSQL)
  │   └── src/
  │       ├── config/            # Environment & database client setups
  │       ├── controllers/       # HTTP route handlers (Auth, Rooms)
  │       ├── middlewares/       # Express & Socket authorization filters
  │       ├── routes/            # HTTP endpoint router
  │       ├── sockets/           # WebRTC signaling & Room socket handlers
  │       ├── tests/             # Integration smoke tests
  │       ├── utils/             # Winston logger & JWT helpers
  │       └── server.ts          # Server entrypoint
  ├── frontend/                  # Next.js App Router client code
  │   └── src/
  │       ├── app/               # Page routes (Lobby, Login, Register, Room)
  │       ├── components/        # UI widgets & Auth session restoration wrappers
  │       ├── hooks/             # useWebRTC multi-peer connection engine
  │       └── stores/            # Zustand state stores (Auth, Media, Meeting)
  ├── docker-compose.yml         # Local container orchestration
  ├── .env.example               # Environmental templates
  └── README.md                  # System manual (this file)
```

---

## 🚀 Setup & Execution Guide

### Prerequisite Environments
Ensure you have the following installed on your machine:
- Node.js (v18.x or v20.x+)
- npm (v9.x or v10.x+)
- Docker and Docker Compose (Optional, for simplified database/redis execution)

---

### Method A: Running Locally (Individual Services)

#### Step 1: Set Up Backend Infrastructure
1. Open a terminal and navigate to the backend folder:
   ```bash
   cd backend
   ```
2. Copy the environment configuration:
   ```bash
   cp .env.example .env
   ```
3. Run container services for PostgreSQL and Redis. If you have Docker installed, spin them up instantly via the root compose file:
   ```bash
   docker-compose up -d postgres redis
   ```
4. Install dependencies:
   ```bash
   npm install
   ```
5. Apply database migrations and generate the client code:
   ```bash
   npx prisma db push
   npx prisma generate
   ```
6. Start the backend in development hot-reloading mode:
   ```bash
   npm run dev
   ```
   The backend signaling server will boot on `http://localhost:5000`.

#### Step 2: Set Up Frontend Client
1. Open a new terminal and navigate to the frontend folder:
   ```bash
   cd ../frontend
   ```
2. Install client dependencies:
   ```bash
   npm install
   ```
3. Copy environment configurations:
   Create a `.env.local` file inside the `frontend/` directory:
   ```env
   NEXT_PUBLIC_SIGNALING_URL=http://localhost:5000
   ```
4. Run the Next.js development server:
   ```bash
   npm run dev
   ```
   The application UI will start on `http://localhost:3000`.

---

### Method B: Running via Docker Compose (Single Command)
To spin up the complete production-configured stack (PostgreSQL, Redis, backend, frontend) automatically, run:
```bash
docker-compose up --build
```
- Frontend UI: `http://localhost:3000`
- Backend API: `http://localhost:5000`
- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`

---

## 🧪 Verification & Integration Tests

### Running Automated Integration Tests
We have built a custom programmatic integration test inside the backend to verify database writes, password hashes, Express routing, and room creation tokens:
1. Navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Run the test command:
   ```bash
   npm run test
   ```
   This script will programmatically spin up an Express server instance on port `5055`, clear testing DB tables, verify `/api/auth/register`, perform JWT logins, fetch profiles, and assert secure Room Slug generation before cleanly disconnecting.

### Manual Verification Checklist
1. **Lobby & Pre-Call Preview**: Load `http://localhost:3000`. Toggle camera and microphone buttons. Verify that browser prompts trigger correct permission requests. plug/unplug headset or camera and check that list changes in the Settings selector.
2. **Room creation**: Log in or sign up. Click **New Meeting** in the lobby. You should immediately land on a meeting room slug styled like `/meeting/abc-defg-hij`.
3. **P2P Video grid call**: Open an incognito browser tab. Copy-paste the room link. Join as a guest by inputting a guest name.
   - Verify that both tabs receive mutual SDP signals and establish HD video connections.
   - Verify that microphone audio level triggers the Active Speaker neon-emerald border highlighting.
4. **Host Controls**: In the host tab, open the **Participants** drawer. Click **Mute** or **Kick** on the guest peer. Verify that the guest’s client respects the command immediately (mutes their microphone or redirects them to the kicked splash page).
5. **Waiting Lobbies**: Turn on **Waiting Room** in the settings panel. Open a new incognito window and join. Verify the newcomer sees "Waiting to enter" and the Host gets a admit/deny notification prompt in the sidebar.

---

## 📈 Observability & Debugging Panel

An enterprise application must be observable. The meeting workspace features an inline developer **Telemetry Panel**. Click the **Telemetry** button in the header of any call.

This panel hooks directly into `RTCPeerConnection.getStats()` and updates every 2 seconds:
- **ICE State**: Live status of ICE candidate pairings (`connected`, `checking`, `failed`, `disconnected`).
- **RTT Latency**: Precise round-trip travel time for packets (measured in milliseconds).
- **Download/Upload Bandwidth**: Dynamic bitrate tracking in kbps for remote streams.
- **Packets Lost**: Cumulative count of packets lost during transit, highlighting network congestion or poor traversal.
- **Video FPS**: Frame-rate metrics showing current stream performance.

---

## 🛡️ Security Model

1. **Authentication**: Handled via JWT access tokens and secure, HttpOnly, SameSite cookies. Refresh tokens are automatically rotated to maintain active user sessions.
2. **Socket Security**: The Socket.IO connection handshake validates the user token in middleware, rejecting connections before establishing event listeners.
3. **Input Sanitization**: Request bodies are parsed and validated using **Zod** schema constraints.
4. **Rate Limiting**: Custom Express rate limiters protect registration, login, and room slugs from brute-force scans.
5. **Helmet Configuration**: Express HTTP response headers are hardened to prevent XSS, clickjacking, and frame injection attacks.

---

## 🎛️ Scaling & SFU (Selective Forwarding Unit) Transition Roadmap

### Why transition to an SFU?
Our active implementation utilizes a **WebRTC Mesh (P2P)** network topology. Each peer connects to every other peer:

```
  Mesh (P2P): O(N²) Uploads             SFU Media Server: O(N) Uploads
      
        A ───► B                             ┌─────────────┐
        │ ◄─── │                             │             │
        │      │                 A ────────► │             │ ────────► B
        ▼      ▼                 A ◄──────── │  SFU Router │ ◄──────── B
        C ◄──► D                             │ (mediasoup) │
                                 C ────────► │             │ ────────► D
                                 C ◄──────── │             │ ◄──────── D
                                             └─────────────┘
```

For $N$ users, each client must upload $N-1$ video streams and download $N-1$ video streams. This causes heavy CPU and network bandwidth strain on mobile devices and laptops when rooms exceed 4-5 participants.

An **SFU (Selective Forwarding Unit)** intercepts media streams. Each participant uploads exactly **1** stream to the SFU, and the SFU selectively replicates and routes it to the other $N-1$ participants.

### The SFU Architecture Transition Plan
Our client and server signallers are decoupled using clear interface protocols, enabling a drop-in media server like **mediasoup** or **LiveKit** to replace P2P connections:

1. **Client-side Adaptions**:
   - Instead of maintaining a Map of `RTCPeerConnection` for each peer ID, the client maintains exactly **two** transport connections:
     - `sendTransport`: Handles uploading local audio, video, and screen share tracks to the SFU.
     - `recvTransport`: Handles downloading select remote tracks from the SFU.
   - We replace the `initiatePeerConnection(peerId)` call in `useWebRTC.ts` with:
     ```typescript
     const consumer = await recvTransport.consume({ id, producerId, kind, rtpParameters });
     const stream = new MediaStream([consumer.track]);
     addRemoteStream(peerId, stream);
     ```

2. **Server-side Adaptions**:
   - Integrate **mediasoup** node worker processes (`mediasoup.createWorker()`).
   - Create a media Router for each room: `const router = await worker.createRouter({ mediaCodecs })`.
   - Instead of relaying signaling packets directly between peer sockets, the socket signaller handles:
     - `createWebRtcTransport`: Requests the server router to provision a media pipeline.
     - `connectWebRtcTransport`: Binds client DTLS settings.
     - `produce`: Registers a local client track on the router.
     - `consume`: Commands the router to forward a producer track to a target consumer.
