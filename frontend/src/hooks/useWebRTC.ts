import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useMediaStore } from '../stores/useMediaStore';
import { useMeetingStore, Participant } from '../stores/useMeetingStore';
import { useAuthStore } from '../stores/useAuthStore';

const ICE_SERVERS_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ],
  iceCandidatePoolSize: 10,
};

export interface PeerDiagnostics {
  peerId: string;
  name: string;
  connectionState: RTCIceConnectionState;
  signalingState: RTCSignalingState;
  bitrateReceived: number; // in kbps
  bitrateSent: number; // in kbps
  packetsLost: number;
  rtt: number; // ms
  fps: number;
}

export const useWebRTC = (roomSlug: string, guestName?: string, mediaReady: boolean = false) => {
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [diagnostics, setDiagnostics] = useState<Record<string, PeerDiagnostics>>({});
  
  const socketRef = useRef<Socket | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const sendersRef = useRef<Map<string, Map<string, RTCRtpSender>>>(new Map()); // Map<peerId, Map<trackKind, sender>>
  const streamMapRef = useRef<Record<string, MediaStream>>({});

  const { localStream, isAudioMuted, isVideoMuted, screenStream, isScreenSharing } = useMediaStore();
  const {
    initializeMeeting,
    setSelfPeerId,
    addParticipant,
    removeParticipant,
    updateParticipant,
    setParticipants,
    addToWaitingQueue,
    removeFromWaitingQueue,
    addChatMessage,
    setWaitingState,
    setApprovedState,
    setKickedState,
    setRoomSettings,
    setActiveSpeaker,
    resetMeeting,
  } = useMeetingStore();

  const { accessToken, user } = useAuthStore();

  // Helper to add remote streams cleanly
  const addRemoteStream = (peerId: string, stream: MediaStream) => {
    streamMapRef.current[peerId] = stream;
    setRemoteStreams({ ...streamMapRef.current });
  };

  // Helper to remove remote streams
  const removeRemoteStream = (peerId: string) => {
    delete streamMapRef.current[peerId];
    setRemoteStreams({ ...streamMapRef.current });
    setDiagnostics((prev) => {
      const copy = { ...prev };
      delete copy[peerId];
      return copy;
    });
  };

  const iceServersRef = useRef<RTCConfiguration>({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
    ],
    iceCandidatePoolSize: 10,
  });

  // Fetch dynamic ICE configuration on mount
  useEffect(() => {
    const fetchIceServers = async () => {
      try {
        let backendUrl = process.env.NEXT_PUBLIC_SIGNALING_URL;
        if (!backendUrl && typeof window !== 'undefined') {
          const host = window.location.hostname;
          backendUrl = `http://${host}:5000`;
        }
        if (!backendUrl) {
          backendUrl = 'http://localhost:5000';
        }

        const res = await fetch(`${backendUrl}/api/ice-servers`);
        if (res.ok) {
          const data = await res.json();
          if (data.iceServers && data.iceServers.length > 0) {
            iceServersRef.current = {
              iceServers: data.iceServers,
              iceCandidatePoolSize: 10,
            };
            console.log('Loaded dynamic ICE configuration:', data.iceServers);
          }
        }
      } catch (err) {
        console.warn('Failed to fetch dynamic ICE configuration, falling back to default STUN:', err);
      }
    };

    fetchIceServers();
  }, []);

  // 1. Initialize Socket.IO connection
  useEffect(() => {
    if (!roomSlug || !mediaReady) return;

    // Use a short delay before connecting to prevent React StrictMode double-mount from aborting the connection handshake and logging warnings.
    const connectTimeout = setTimeout(() => {
      initializeMeeting(roomSlug);

      let backendUrl = process.env.NEXT_PUBLIC_SIGNALING_URL;
      if (!backendUrl && typeof window !== 'undefined') {
        const host = window.location.hostname;
        backendUrl = `http://${host}:5000`;
      }
      if (!backendUrl) {
        backendUrl = 'http://localhost:5000';
      }
      
      // Configure socket authorization
      const socket = io(`${backendUrl}`, {
        auth: {
          token: accessToken || undefined,
        },
        query: guestName ? { guestName, roomSlug } : { roomSlug },
        transports: ['polling', 'websocket'],
      });

      socketRef.current = socket;

      // --- Socket Listeners ---
      socket.on('connect', () => {
        console.log('Connected to signaling server:', socket.id);
        setSelfPeerId(socket.id!);
        
        // Request to join room
        socket.emit('room:join', {
          roomSlug,
          isMuted: isAudioMuted,
          isCameraOff: isVideoMuted,
        });
      });

      socket.on('room:joined', ({ selfPeerId, currentParticipants }) => {
        console.log('Joined room successfully as:', selfPeerId);
        setApprovedState(true);

        // Add other peers to Zustand store
        currentParticipants.forEach((p: Participant) => {
          addParticipant(p);
          // We initiate WebRTC connections to everyone who is already in the room
          initiatePeerConnection(p.peerId, p.name, true);
        });
      });

      socket.on('room:peer-joined', ({ peerId, name, role, isMuted, isCameraOff }) => {
        console.log('New peer joined room:', peerId, name);
        addParticipant({ peerId, name, role, isMuted, isCameraOff, handRaised: false });
        
        // The joining peer will initiate connection, so we prepare to receive their offer
        initiatePeerConnection(peerId, name, false);
      });

      socket.on('room:peer-left', ({ peerId }) => {
        console.log('Peer left room:', peerId);
        cleanupPeer(peerId);
        removeParticipant(peerId);
      });

      socket.on('waiting-room:wait', () => {
        console.log('Entered waiting room queue...');
        setWaitingState(true);
      });

      socket.on('waiting-room:approved', () => {
        console.log('Approved by host. Joining call...');
        socket.emit('room:join', {
          roomSlug,
          isMuted: isAudioMuted,
          isCameraOff: isVideoMuted,
        });
      });

      socket.on('waiting-room:rejected', () => {
        console.log('Rejected by host.');
        setWaitingState(false);
        setKickedState(true);
        socket.disconnect();
      });

      socket.on('waiting-room:joined', (peer) => {
        console.log('Host alert: peer waiting to join:', peer);
        addToWaitingQueue(peer);
      });

      socket.on('waiting-room:left', ({ peerId }) => {
        removeFromWaitingQueue(peerId);
      });

      socket.on('signal:receive', async ({ senderPeerId, signalData }) => {
        const pc = peersRef.current.get(senderPeerId);
        if (!pc) return;

        try {
          if (signalData.sdp) {
            await pc.setRemoteDescription(new RTCSessionDescription(signalData.sdp));
            
            if (signalData.sdp.type === 'offer') {
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              socket.emit('signal:send', {
                targetPeerId: senderPeerId,
                signalData: { sdp: pc.localDescription },
              });
            }
          } else if (signalData.candidate) {
            await pc.addIceCandidate(new RTCIceCandidate(signalData.candidate));
          }
        } catch (err) {
          console.error('Error handling WebRTC signaling:', err);
        }
      });

      socket.on('participant:status-updated', ({ peerId, isMuted, isCameraOff }) => {
        updateParticipant(peerId, { isMuted, isCameraOff });
      });

      socket.on('hand:raised', ({ peerId, isRaised }) => {
        updateParticipant(peerId, { handRaised: isRaised });
      });

      socket.on('active-speaker:updated', ({ peerId, isSpeaking }) => {
        updateParticipant(peerId, { isSpeaking });
        if (isSpeaking) {
          setActiveSpeaker(peerId);
        }
      });

      socket.on('chat:message-received', (message) => {
        addChatMessage(message);
      });

      socket.on('room:settings-changed', (settings) => {
        setRoomSettings(settings);
      });

      socket.on('host:action-received', ({ action }) => {
        console.log('Host command received:', action);
        if (action === 'mute') {
          // Force mute local microphone
          const { toggleAudio, isAudioMuted } = useMediaStore.getState();
          if (!isAudioMuted) {
            toggleAudio();
            // Notify backend/peers about self mute
            socket.emit('participant:update-status', {
              isMuted: true,
              isCameraOff: useMediaStore.getState().isVideoMuted,
            });
          }
        } else if (action === 'kick') {
          setKickedState(true);
          socket.disconnect();
          cleanupAllPeers();
          resetMeeting();
        }
      });

      socket.on('connect_error', (err) => {
        console.error('Socket connection error:', err.message);
      });

      socket.on('room:error', ({ message }) => {
        console.error('Room error:', message);
        alert(message);
      });
    }, 100);

    return () => {
      clearTimeout(connectTimeout);
      if (socketRef.current) {
        console.log('Unmounting useWebRTC, cleaning up connections');
        cleanupAllPeers();
        resetMeeting();
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [roomSlug, accessToken, guestName, mediaReady]);

  // 2. WebRTC Peer Connection Core Logic
  const initiatePeerConnection = (peerId: string, peerName: string, isInitiator: boolean) => {
    if (peersRef.current.has(peerId)) return;

    console.log(`Setting up RTCPeerConnection for ${peerId} (isInitiator: ${isInitiator})`);
    const pc = new RTCPeerConnection(iceServersRef.current);
    peersRef.current.set(peerId, pc);
    sendersRef.current.set(peerId, new Map());

    // ICE Candidate handler
    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit('signal:send', {
          targetPeerId: peerId,
          signalData: { candidate: event.candidate },
        });
      }
    };

    // Track stream reception
    pc.ontrack = (event) => {
      console.log('Received remote track from peer:', peerId, event.track.kind);
      
      let remoteStream = streamMapRef.current[peerId];
      if (!remoteStream) {
        remoteStream = event.streams[0] || new MediaStream();
      }
      
      if (event.track) {
        const hasTrack = remoteStream.getTracks().some(t => t.id === event.track.id);
        if (!hasTrack) {
          remoteStream.addTrack(event.track);
        }
      }
      
      addRemoteStream(peerId, remoteStream);
    };

    // ICE Connection State Change - Reconnection / ICE Restart Logic
    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      console.log(`ICE Connection State with ${peerId} changed to: ${state}`);
      
      // Update diagnostics panel state
      setDiagnostics((prev) => ({
        ...prev,
        [peerId]: {
          ...(prev[peerId] || {
            peerId,
            name: peerName,
            bitrateReceived: 0,
            bitrateSent: 0,
            packetsLost: 0,
            rtt: 0,
            fps: 0,
          }),
          connectionState: state,
          signalingState: pc.signalingState,
        },
      }));

      if (state === 'failed' || state === 'disconnected') {
        console.warn(`Connection with ${peerId} failed. Attempting ICE restart...`);
        triggerICERestart(peerId);
      }
    };

    // Negotiation Needed
    pc.onnegotiationneeded = async () => {
      if (!isInitiator) return; // Only initiator triggers the initial offer
      
      try {
        console.log('Negotiation needed, creating offer for:', peerId);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        
        socketRef.current?.emit('signal:send', {
          targetPeerId: peerId,
          signalData: { sdp: pc.localDescription },
        });
      } catch (err) {
        console.error('Error during negotiation:', err);
      }
    };

    // Allocate local stream tracks to peer connection
    if (localStream) {
      localStream.getTracks().forEach((track) => {
        const sender = pc.addTrack(track, localStream);
        sendersRef.current.get(peerId)!.set(track.kind, sender);
      });
    }

    // Allocate screen share track if already active
    if (screenStream && isScreenSharing) {
      screenStream.getTracks().forEach((track) => {
        const sender = pc.addTrack(track, screenStream);
        sendersRef.current.get(peerId)!.set(`screen:${track.kind}`, sender);
      });
    }
  };

  const triggerICERestart = async (peerId: string) => {
    const pc = peersRef.current.get(peerId);
    if (!pc) return;

    try {
      console.log(`Triggering ICE Restart for: ${peerId}`);
      const offer = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(offer);

      socketRef.current?.emit('signal:send', {
        targetPeerId: peerId,
        signalData: { sdp: pc.localDescription },
      });
    } catch (err) {
      console.error('Failed to trigger ICE Restart:', err);
    }
  };

  // 3. Hot-swapping local track tracks (e.g. Mute/Unmute or device changes)
  useEffect(() => {
    if (!localStream) return;

    peersRef.current.forEach((pc, peerId) => {
      const peerSenders = sendersRef.current.get(peerId);
      if (!peerSenders) return;

      localStream.getTracks().forEach((track) => {
        const existingSender = peerSenders.get(track.kind);
        
        if (existingSender) {
          // Replace track directly without renegotiation (highly optimized)
          existingSender.replaceTrack(track).catch((err) => {
            console.error(`Error replacing ${track.kind} track for ${peerId}:`, err);
          });
        } else {
          // If track wasn't added before, add it now
          const sender = pc.addTrack(track, localStream);
          peerSenders.set(track.kind, sender);
        }
      });
    });
  }, [localStream]);

  const negotiatePeerConnection = async (peerId: string, pc: RTCPeerConnection) => {
    try {
      console.log('Manually negotiating connection for:', peerId);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      socketRef.current?.emit('signal:send', {
        targetPeerId: peerId,
        signalData: { sdp: pc.localDescription },
      });
    } catch (err) {
      console.error('Failed to negotiate peer connection:', err);
    }
  };

  // 4. Hot-swapping screen share track
  useEffect(() => {
    peersRef.current.forEach(async (pc, peerId) => {
      const peerSenders = sendersRef.current.get(peerId);
      if (!peerSenders) return;

      const screenVideoTrack = screenStream?.getVideoTracks()[0];
      const existingScreenSender = peerSenders.get('screen:video');

      if (isScreenSharing && screenVideoTrack) {
        if (existingScreenSender) {
          existingScreenSender.replaceTrack(screenVideoTrack).catch(console.error);
        } else {
          const sender = pc.addTrack(screenVideoTrack, screenStream!);
          peerSenders.set('screen:video', sender);
          await negotiatePeerConnection(peerId, pc);
        }
      } else {
        // Screen share stopped: remove screen share track from PeerConnection
        if (existingScreenSender) {
          try {
            pc.removeTrack(existingScreenSender);
            peerSenders.delete('screen:video');
            await negotiatePeerConnection(peerId, pc);
          } catch (e) {
            console.warn('Failed removing screen share track', e);
          }
        }
      }
    });
  }, [screenStream, isScreenSharing]);

  // 5. Diagnostics stats collector loop (getStats)
  useEffect(() => {
    const statsInterval = setInterval(async () => {
      if (peersRef.current.size === 0) return;

      const newDiagnostics: Record<string, PeerDiagnostics> = {};

      for (const [peerId, pc] of peersRef.current.entries()) {
        const participant = useMeetingStore.getState().participants.find(p => p.peerId === peerId);
        const name = participant?.name || 'Peer';

        try {
          const stats = await pc.getStats();
          let bitrateReceived = 0;
          let bitrateSent = 0;
          let packetsLost = 0;
          let rtt = 0;
          let fps = 0;

          stats.forEach((report) => {
            if (report.type === 'inbound-rtp' && report.kind === 'video') {
              bitrateReceived = Math.round((report.bytesReceived * 8) / 1000 / 1); // rough estimates
              packetsLost = report.packetsLost || 0;
              fps = report.framesPerSecond || 0;
            }
            if (report.type === 'outbound-rtp' && report.kind === 'video') {
              bitrateSent = Math.round((report.bytesSent * 8) / 1000 / 1);
            }
            if (report.type === 'candidate-pair' && report.state === 'succeeded') {
              rtt = Math.round((report.currentRoundTripTime || 0) * 1000);
            }
          });

          newDiagnostics[peerId] = {
            peerId,
            name,
            connectionState: pc.iceConnectionState,
            signalingState: pc.signalingState,
            bitrateReceived,
            bitrateSent,
            packetsLost,
            rtt,
            fps,
          };
        } catch (err) {
          // stats get fails occasionally
        }
      }

      setDiagnostics(newDiagnostics);
    }, 2000);

    return () => clearInterval(statsInterval);
  }, []);

  // 6. Cleanups
  const cleanupPeer = (peerId: string) => {
    const pc = peersRef.current.get(peerId);
    if (pc) {
      pc.close();
      peersRef.current.delete(peerId);
    }
    sendersRef.current.delete(peerId);
    removeRemoteStream(peerId);
  };

  const cleanupAllPeers = () => {
    peersRef.current.forEach((pc) => pc.close());
    peersRef.current.clear();
    sendersRef.current.clear();
    setRemoteStreams({});
    streamMapRef.current = {};
    setDiagnostics({});
  };

  // Helper actions exposed to UI
  const sendMessage = (content: string) => {
    socketRef.current?.emit('chat:message', { content });
  };

  const updateStatus = (isMuted: boolean, isCameraOff: boolean) => {
    socketRef.current?.emit('participant:update-status', { isMuted, isCameraOff });
  };

  const raiseHand = (isRaised: boolean) => {
    socketRef.current?.emit('hand:raise', { isRaised });
  };

  const toggleWaitingApprove = (targetPeerId: string) => {
    socketRef.current?.emit('waiting-room:approve', { targetPeerId });
  };

  const toggleWaitingReject = (targetPeerId: string) => {
    socketRef.current?.emit('waiting-room:reject', { targetPeerId });
  };

  const hostAction = (action: string, targetPeerId?: string, value?: any) => {
    socketRef.current?.emit('host:action', { action, targetPeerId, value });
  };

  const emitActiveSpeaker = (isSpeaking: boolean) => {
    socketRef.current?.emit('active-speaker:change', { isSpeaking });
  };

  return {
    remoteStreams,
    diagnostics,
    sendMessage,
    updateStatus,
    raiseHand,
    toggleWaitingApprove,
    toggleWaitingReject,
    hostAction,
    emitActiveSpeaker,
  };
};
