'use client';

import React, { useEffect, useRef, useState, use } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMediaStore } from '@/stores/useMediaStore';
import { useMeetingStore } from '@/stores/useMeetingStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { useWebRTC } from '@/hooks/useWebRTC';
import { 
  Mic, 
  MicOff, 
  Video as VideoIcon, 
  VideoOff, 
  Monitor, 
  MessageSquare, 
  Users, 
  Hand, 
  PhoneOff, 
  Settings, 
  VolumeX, 
  UserMinus, 
  Lock, 
  Unlock,
  Activity,
  Send,
  UserCheck2,
  X
} from 'lucide-react';

interface MeetingRoomProps {
  params: Promise<{ roomId: string }>;
}

interface RemoteAudioProps {
  stream: MediaStream;
  sinkId?: string;
}

const RemoteAudio = ({ stream, sinkId }: RemoteAudioProps) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (audioRef.current && stream) {
      const handleAddTrack = () => {
        if (audioRef.current) {
          audioRef.current.srcObject = stream;
          audioRef.current.play().catch(console.warn);
        }
      };

      // Set initially
      audioRef.current.srcObject = stream;
      audioRef.current.play().catch((err) => {
        console.warn('Audio play failed (waiting for user interaction):', err);
      });

      // Listen for future track additions (e.g., audio track arriving after video track)
      stream.addEventListener('addtrack', handleAddTrack);

      return () => {
        stream.removeEventListener('addtrack', handleAddTrack);
      };
    }
  }, [stream]);

  useEffect(() => {
    const audioEl = audioRef.current;
    if (audioEl && 'setSinkId' in audioEl) {
      const targetSinkId = sinkId === 'default' ? '' : (sinkId || '');
      // Only call setSinkId if it is actually different from the current sinkId
      if ((audioEl as any).sinkId !== targetSinkId) {
        (audioEl as any).setSinkId(targetSinkId).catch((err: any) => {
          console.warn('Failed to set audio sink ID:', err);
        });
      }
    }
  }, [sinkId]);

  return <audio ref={audioRef} autoPlay playsInline className="hidden" />;
};

interface RemoteVideoProps {
  stream: MediaStream;
  isCameraOff: boolean;
  className?: string;
}

const RemoteVideo = ({ stream, isCameraOff, className }: RemoteVideoProps) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (videoRef.current && stream && !isCameraOff) {
      const handleAddTrack = () => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      };

      videoRef.current.srcObject = stream;

      // Listen for future track additions (e.g., video track arriving after audio track)
      stream.addEventListener('addtrack', handleAddTrack);

      return () => {
        stream.removeEventListener('addtrack', handleAddTrack);
      };
    }
  }, [stream, isCameraOff]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted
      className={className}
    />
  );
};

export default function MeetingRoomPage({ params }: MeetingRoomProps) {
  const { roomId } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const guestName = searchParams.get('guestName') || undefined;

  const { isAuthenticated, user } = useAuthStore();
  const { 
    localStream, 
    screenStream,
    isAudioMuted, 
    isVideoMuted, 
    isScreenSharing,
    startLocalStream, 
    stopLocalStream,
    toggleAudio, 
    toggleVideo, 
    startScreenShare, 
    stopScreenShare,
    selectedAudioOutput
  } = useMediaStore();

  const {
    participants,
    waitingQueue,
    chatMessages,
    isWaiting,
    isApproved,
    isKicked,
    isRoomLocked,
    isWaitingRoomEnabled,
    activeSpeakerId,
    pinnedParticipantId,
    togglePinParticipant
  } = useMeetingStore();

  // WebRTC custom hook
  const {
    remoteStreams,
    diagnostics,
    sendMessage,
    updateStatus,
    raiseHand,
    toggleWaitingApprove,
    toggleWaitingReject,
    hostAction,
    emitActiveSpeaker
  } = useWebRTC(roomId, guestName);

  // UI state
  const [activeTab, setActiveTab] = useState<'chat' | 'participants' | 'settings' | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [localHandRaised, setLocalHandRaised] = useState(false);
  const [showDebug, setShowDebug] = useState(false);

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);
  const isHost = user && participants.find(p => p.role === 'HOST')?.name === user.name;

  // Initialize local camera and microphone stream on mount
  useEffect(() => {
    startLocalStream().catch((err) => {
      console.warn('Meeting room media stream acquisition failed:', err);
    });
    return () => {
      stopLocalStream();
    };
  }, []);

  // 1. Ensure local video track is rendering locally
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream, isVideoMuted]);

  // 2. Active Speaker Detection via Web Audio API Analyser
  useEffect(() => {
    if (!localStream || isAudioMuted) return;

    let audioContext: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let microphone: MediaStreamAudioSourceNode | null = null;
    let javascriptNode: ScriptProcessorNode | null = null;

    try {
      audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      analyser = audioContext.createAnalyser();
      microphone = audioContext.createMediaStreamSource(localStream);
      javascriptNode = audioContext.createScriptProcessor(2048, 1, 1);

      analyser.smoothingTimeConstant = 0.8;
      analyser.fftSize = 1024;

      microphone.connect(analyser);
      analyser.connect(javascriptNode);
      javascriptNode.connect(audioContext.destination);

      let speakingCounter = 0;
      let silentCounter = 0;
      let lastSpeakingState = false;

      javascriptNode.onaudioprocess = () => {
        const array = new Uint8Array(analyser!.frequencyBinCount);
        analyser!.getByteFrequencyData(array);
        let values = 0;

        const length = array.length;
        for (let i = 0; i < length; i++) {
          values += array[i];
        }

        const average = values / length;

        // Threshold (12 is quiet talking)
        if (average > 12) {
          speakingCounter++;
          silentCounter = 0;
          if (speakingCounter > 10 && !lastSpeakingState) {
            lastSpeakingState = true;
            emitActiveSpeaker(true);
          }
        } else {
          silentCounter++;
          speakingCounter = 0;
          if (silentCounter > 30 && lastSpeakingState) {
            lastSpeakingState = false;
            emitActiveSpeaker(false);
          }
        }
      };
    } catch (e) {
      console.warn('Web Audio API speaker detection failed to start:', e);
    }

    return () => {
      if (javascriptNode) javascriptNode.disconnect();
      if (microphone) microphone.disconnect();
      if (audioContext) audioContext.close();
    };
  }, [localStream, isAudioMuted]);

  // 3. Keep chat scrolled to bottom
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, activeTab]);

  // 4. Sync local state modifications with peer connections
  const handleToggleMic = () => {
    toggleAudio();
    updateStatus(!isAudioMuted, isVideoMuted);
  };

  const handleToggleCam = () => {
    toggleVideo();
    updateStatus(isAudioMuted, !isVideoMuted);
  };

  const handleToggleHand = () => {
    const nextHandState = !localHandRaised;
    setLocalHandRaised(nextHandState);
    raiseHand(nextHandState);
  };

  const handleToggleScreen = async () => {
    if (isScreenSharing) {
      stopScreenShare();
    } else {
      await startScreenShare();
    }
  };

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    sendMessage(chatInput.trim());
    setChatInput('');
  };

  const handleLeaveRoom = () => {
    router.push('/');
  };

  // --- RENDERING ROUTER STATES ---
  if (isKicked) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center bg-[#070b13] text-white">
        <div className="rounded-2xl glass-panel p-8 max-w-sm text-center shadow-2xl">
          <PhoneOff className="h-12 w-12 text-rose-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold">Removed from meeting</h2>
          <p className="text-sm text-slate-400 mt-2">You were removed from the conversation by the host.</p>
          <button
            onClick={() => router.push('/')}
            className="mt-6 w-full py-2.5 bg-blue-600 rounded-lg font-bold text-sm hover:bg-blue-500 cursor-pointer"
          >
            Return to Home
          </button>
        </div>
      </div>
    );
  }

  if (isWaiting) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center bg-[#070b13] text-white">
        <div className="rounded-2xl glass-panel p-8 max-w-sm text-center shadow-2xl">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-blue-500 border-t-transparent mx-auto mb-4"></div>
          <h2 className="text-lg font-bold">Waiting to enter...</h2>
          <p className="text-sm text-slate-400 mt-2">The host has been notified. They will admit you shortly.</p>
          <button
            onClick={() => router.push('/')}
            className="mt-6 w-full py-2 border border-slate-700 bg-slate-900 rounded-lg text-xs hover:bg-slate-800 cursor-pointer"
          >
            Cancel and Return
          </button>
        </div>
      </div>
    );
  }

  // Calculate dynamic layout classes
  const totalGridItems = participants.length + 1; // peers + self
  const getGridCols = () => {
    if (isScreenSharing || Object.keys(remoteStreams).some(peerId => pinnedParticipantId === peerId)) {
      return 'grid-cols-1 lg:grid-cols-12';
    }
    if (totalGridItems <= 1) return 'grid-cols-1';
    if (totalGridItems === 2) return 'grid-cols-1 md:grid-cols-2';
    if (totalGridItems <= 4) return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-2';
    return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';
  };

  return (
    <div className="h-screen w-screen bg-[#070b13] flex flex-col text-slate-100 overflow-hidden font-sans">
      {/* Hidden Remote Audio Feeds to ensure audio plays even when cameras are off */}
      {participants.map((p) => {
        const stream = remoteStreams[p.peerId];
        if (!stream) return null;
        return (
          <RemoteAudio
            key={`audio-${p.peerId}`}
            stream={stream}
            sinkId={selectedAudioOutput}
          />
        );
      })}
      
      {/* Top Header */}
      <header className="h-14 border-b border-slate-900 bg-slate-950 px-6 flex items-center justify-between z-10">
        <div className="flex items-center gap-3">
          <div className="px-2.5 py-1 bg-slate-800 rounded-md border border-slate-700 text-xs font-semibold font-mono text-slate-300">
            {roomId}
          </div>
          <span className="text-xs text-slate-500 font-semibold hidden md:inline">
            Active: {participants.length + 1} participant{participants.length !== 0 ? 's' : ''}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Debug toggle */}
          <button
            onClick={() => setShowDebug(!showDebug)}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${showDebug ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'}`}
          >
            <Activity className="h-3.5 w-3.5" />
            Telemetry
          </button>
        </div>
      </header>

      {/* Main workspace */}
      <div className="flex-1 flex overflow-hidden relative">
        
        {/* Core Media stream views */}
        <div className="flex-1 flex flex-col p-4 space-y-4 overflow-hidden relative">
          
          {/* Main Grid Wrapper */}
          <div className={`flex-1 grid ${getGridCols()} gap-4 items-center justify-center overflow-y-auto`}>
            
            {/* Screen sharing / Pin view layout handler */}
            {isScreenSharing ? (
              <div className="lg:col-span-8 h-full rounded-xl bg-black border border-slate-900 overflow-hidden relative flex items-center justify-center shadow-lg">
                <video
                  ref={(el) => {
                    if (el && screenStream) el.srcObject = screenStream;
                  }}
                  autoPlay
                  playsInline
                  muted
                  className="h-full w-full object-contain"
                />
                <div className="absolute top-4 left-4 bg-black/60 backdrop-blur-sm border border-slate-800 px-3 py-1.5 rounded-lg text-xs font-bold text-white flex items-center gap-1.5">
                  <Monitor className="h-3.5 w-3.5 text-blue-400" />
                  Your screen presentation
                </div>
              </div>
            ) : null}

            {/* Sub-grid of feeds */}
            <div className={`h-full ${isScreenSharing ? 'lg:col-span-4 flex flex-col space-y-4 overflow-y-auto' : 'col-span-full grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4'}`}>
              
              {/* Local Stream feed card */}
              <div className={`relative aspect-video rounded-xl bg-slate-950 border border-slate-800/80 overflow-hidden shadow-md group ${activeSpeakerId === null && !isAudioMuted ? 'active-speaker-ring' : ''}`}>
                {localStream && !isVideoMuted ? (
                  <video
                    ref={localVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="h-full w-full object-cover mirror-video"
                  />
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                    <div className="h-14 w-14 rounded-full bg-slate-900 border border-slate-850 flex items-center justify-center text-slate-500">
                      <VideoOff className="h-6 w-6" />
                    </div>
                    <span className="text-xs text-slate-400 font-semibold">{user?.name || 'You'} (Camera Off)</span>
                  </div>
                )}

                {/* Info Overlay */}
                <div className="absolute bottom-3 left-3 bg-black/60 backdrop-blur-sm px-2.5 py-1 rounded-md text-xs font-semibold text-white flex items-center gap-1.5">
                  <span>{user?.name || 'You'}</span>
                  {isAudioMuted ? <MicOff className="h-3 w-3 text-rose-500" /> : <Mic className="h-3 w-3 text-emerald-400" />}
                </div>

                {/* Hand indicator overlay */}
                {localHandRaised && (
                  <div className="absolute top-3 right-3 bg-yellow-500 text-slate-950 p-1.5 rounded-full border border-yellow-450 shadow-md">
                    <Hand className="h-4 w-4" />
                  </div>
                )}
              </div>

              {/* Remote Peer cards */}
              {participants.map((p) => {
                const stream = remoteStreams[p.peerId];
                const isSpeaking = activeSpeakerId === p.peerId;
                const isPinned = pinnedParticipantId === p.peerId;

                return (
                  <div
                    key={p.peerId}
                    onClick={() => togglePinParticipant(p.peerId)}
                    className={`relative aspect-video rounded-xl bg-slate-950 border border-slate-800/80 overflow-hidden shadow-md group cursor-pointer transition-all ${isSpeaking ? 'active-speaker-ring' : ''} ${isPinned ? 'border-blue-500 border-2' : ''}`}
                  >
                    {stream && !p.isCameraOff ? (
                      <RemoteVideo
                        stream={stream}
                        isCameraOff={p.isCameraOff}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                        <div className="h-14 w-14 rounded-full bg-slate-900 border border-slate-850 flex items-center justify-center text-indigo-400 font-bold text-lg">
                          {p.name.charAt(0).toUpperCase()}
                        </div>
                        <span className="text-xs text-slate-400 font-semibold">{p.name}</span>
                      </div>
                    )}

                    {/* Name/Audio badge overlay */}
                    <div className="absolute bottom-3 left-3 bg-black/60 backdrop-blur-sm px-2.5 py-1 rounded-md text-xs font-semibold text-white flex items-center gap-1.5">
                      <span>{p.name}</span>
                      {p.isMuted ? <MicOff className="h-3 w-3 text-rose-500" /> : <Mic className="h-3 w-3 text-emerald-400" />}
                    </div>

                    {/* Hand Indicator */}
                    {p.handRaised && (
                      <div className="absolute top-3 right-3 bg-yellow-500 text-slate-950 p-1.5 rounded-full border border-yellow-450 shadow-md">
                        <Hand className="h-4 w-4" />
                      </div>
                    )}
                  </div>
                );
              })}

            </div>
          </div>
        </div>

        {/* Telemetry panel */}
        {showDebug && (
          <div className="w-80 border-l border-slate-900 bg-slate-950 p-5 overflow-y-auto space-y-4 z-20">
            <div className="flex items-center justify-between border-b border-slate-900 pb-3">
              <h4 className="text-sm font-bold text-indigo-400 uppercase tracking-wider flex items-center gap-1.5">
                <Activity className="h-4.5 w-4.5" />
                Connection Stats
              </h4>
              <button onClick={() => setShowDebug(false)} className="text-slate-500 hover:text-white cursor-pointer">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4">
              {Object.keys(diagnostics).length === 0 ? (
                <p className="text-xs text-slate-500 italic">No peer connections active to generate telemetry.</p>
              ) : (
                Object.values(diagnostics).map((diag) => (
                  <div key={diag.peerId} className="p-3 bg-slate-900 rounded-lg border border-slate-800 text-xs space-y-2">
                    <p className="font-bold text-white border-b border-slate-800 pb-1">{diag.name}</p>
                    <div className="grid grid-cols-2 gap-y-1 text-slate-400 font-mono text-[10px]">
                      <div>ICE State:</div>
                      <div className={`text-right font-bold ${diag.connectionState === 'connected' ? 'text-emerald-400' : 'text-yellow-400'}`}>
                        {diag.connectionState}
                      </div>

                      <div>RTT Latency:</div>
                      <div className="text-right text-white font-bold">{diag.rtt} ms</div>

                      <div>Download:</div>
                      <div className="text-right text-white font-bold">{diag.bitrateReceived} kbps</div>

                      <div>Upload:</div>
                      <div className="text-right text-white font-bold">{diag.bitrateSent} kbps</div>

                      <div>Losses:</div>
                      <div className={`text-right font-bold ${diag.packetsLost > 0 ? 'text-rose-400' : 'text-slate-500'}`}>
                        {diag.packetsLost} pkts
                      </div>

                      <div>Video FPS:</div>
                      <div className="text-right text-white font-bold">{diag.fps} fps</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Dynamic Sidebar Drawers */}
        {activeTab && (
          <div className="w-80 border-l border-slate-900 bg-slate-950 flex flex-col z-20">
            
            {/* Sidebar Header */}
            <div className="p-4 border-b border-slate-900 flex items-center justify-between">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                {activeTab === 'chat' ? 'Room Chat' : activeTab === 'participants' ? 'Participants' : 'Meeting Controls'}
              </h3>
              <button onClick={() => setActiveTab(null)} className="text-slate-500 hover:text-white cursor-pointer">
                <X className="h-4.5 w-4.5" />
              </button>
            </div>

            {/* Sidebar Content switcher */}
            <div className="flex-1 overflow-y-auto">
              
              {/* CHAT TAB */}
              {activeTab === 'chat' && (
                <div className="h-full flex flex-col">
                  <div className="flex-1 p-4 space-y-3.5 overflow-y-auto text-xs">
                    {chatMessages.length === 0 ? (
                      <p className="text-slate-500 text-center italic mt-10">No messages in room yet.</p>
                    ) : (
                      chatMessages.map((msg) => (
                        <div key={msg.id} className="space-y-1">
                          <div className="flex items-center justify-between text-[10px] text-slate-500 font-semibold">
                            <span>{msg.senderName}</span>
                            <span>
                              {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          <div className="p-2.5 bg-slate-900 border border-slate-850 rounded-lg text-slate-200 break-words leading-normal">
                            {msg.content}
                          </div>
                        </div>
                      ))
                    )}
                    <div ref={chatBottomRef} />
                  </div>

                  {/* Chat Input */}
                  <form onSubmit={handleSendChat} className="p-3 border-t border-slate-900 flex gap-2">
                    <input
                      type="text"
                      placeholder="Type a message..."
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      className="flex-1 text-xs rounded-lg px-3 py-2 bg-slate-900 border border-slate-850 text-slate-200 focus:outline-none focus:border-blue-500"
                    />
                    <button type="submit" className="p-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg cursor-pointer">
                      <Send className="h-4 w-4" />
                    </button>
                  </form>
                </div>
              )}

              {/* PARTICIPANTS TAB */}
              {activeTab === 'participants' && (
                <div className="p-4 space-y-4">
                  {/* Host Queue (Waiting room admissions) */}
                  {isHost && waitingQueue.length > 0 && (
                    <div className="space-y-2.5">
                      <h4 className="text-[10px] font-bold text-amber-500 uppercase tracking-wider">Waiting Room ({waitingQueue.length})</h4>
                      <div className="space-y-2">
                        {waitingQueue.map((waitPeer) => (
                          <div key={waitPeer.peerId} className="flex items-center justify-between p-2 bg-amber-500/5 border border-amber-500/25 rounded-lg text-xs">
                            <span className="font-semibold text-slate-300">{waitPeer.name}</span>
                            <div className="flex gap-1.5">
                              <button
                                onClick={() => toggleWaitingApprove(waitPeer.peerId)}
                                className="px-2 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[10px] font-bold cursor-pointer"
                              >
                                Admit
                              </button>
                              <button
                                onClick={() => toggleWaitingReject(waitPeer.peerId)}
                                className="px-2 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded text-[10px] font-bold cursor-pointer"
                              >
                                Deny
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="border-b border-slate-900 my-4" />
                    </div>
                  )}

                  {/* Active List */}
                  <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Active Call list</h4>
                  <div className="space-y-2.5">
                    {/* Self */}
                    <div className="flex items-center justify-between text-xs p-2 bg-slate-900/50 rounded-lg border border-slate-900">
                      <span className="font-semibold text-white">{user?.name || 'You'} (Host)</span>
                      <div className="flex items-center gap-1.5 text-slate-400">
                        {isAudioMuted ? <MicOff className="h-3.5 w-3.5 text-rose-500" /> : <Mic className="h-3.5 w-3.5 text-emerald-400" />}
                      </div>
                    </div>

                    {/* Peers */}
                    {participants.map((p) => (
                      <div key={p.peerId} className="flex items-center justify-between text-xs p-2 bg-slate-900/50 rounded-lg border border-slate-900 group">
                        <span className="font-semibold text-slate-300">{p.name} {p.role === 'HOST' ? '(Host)' : ''}</span>
                        
                        <div className="flex items-center gap-2">
                          <div className="text-slate-500">
                            {p.isMuted ? <MicOff className="h-3.5 w-3.5 text-rose-500" /> : <Mic className="h-3.5 w-3.5 text-emerald-400" />}
                          </div>

                          {/* Host controls toggle */}
                          {isHost && (
                            <div className="opacity-0 group-hover:opacity-100 flex gap-1 transition-opacity">
                              <button
                                onClick={() => hostAction('mute', p.peerId)}
                                className="p-1 bg-slate-800 text-slate-400 hover:text-white rounded hover:bg-slate-700 cursor-pointer"
                                title="Mute Participant"
                              >
                                <VolumeX className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => hostAction('kick', p.peerId)}
                                className="p-1 bg-rose-600/10 text-rose-400 hover:text-white rounded hover:bg-rose-600 cursor-pointer"
                                title="Kick Participant"
                              >
                                <UserMinus className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* SETTINGS TAB */}
              {activeTab === 'settings' && (
                <div className="p-4 space-y-5 text-xs">
                  <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Host Admin Controls</h4>
                  
                  {isHost ? (
                    <div className="space-y-4">
                      {/* Lock Room Toggle */}
                      <div className="flex items-center justify-between p-3 bg-slate-900 rounded-lg border border-slate-850">
                        <div className="space-y-0.5">
                          <p className="font-bold text-white flex items-center gap-1.5">
                            {isRoomLocked ? <Lock className="h-3.5 w-3.5 text-rose-400" /> : <Unlock className="h-3.5 w-3.5 text-emerald-400" />}
                            Lock Meeting
                          </p>
                          <p className="text-[10px] text-slate-400">Block new members from joining.</p>
                        </div>
                        <button
                          onClick={() => hostAction('toggle-lock', undefined, !isRoomLocked)}
                          className={`px-3 py-1.5 rounded-md font-bold text-[10px] cursor-pointer ${isRoomLocked ? 'bg-rose-600 text-white' : 'bg-slate-850 hover:bg-slate-800 border border-slate-800 text-slate-300'}`}
                        >
                          {isRoomLocked ? 'Locked' : 'Unlock'}
                        </button>
                      </div>

                      {/* Waiting Room Toggle */}
                      <div className="flex items-center justify-between p-3 bg-slate-900 rounded-lg border border-slate-850">
                        <div className="space-y-0.5">
                          <p className="font-bold text-white flex items-center gap-1.5">
                            <UserCheck2 className="h-3.5 w-3.5 text-indigo-400" />
                            Waiting Room
                          </p>
                          <p className="text-[10px] text-slate-400">Host must approve entrants.</p>
                        </div>
                        <button
                          onClick={() => hostAction('toggle-waiting', undefined, !isWaitingRoomEnabled)}
                          className={`px-3 py-1.5 rounded-md font-bold text-[10px] cursor-pointer ${isWaitingRoomEnabled ? 'bg-indigo-600 text-white' : 'bg-slate-850 hover:bg-slate-800 border border-slate-800 text-slate-300'}`}
                        >
                          {isWaitingRoomEnabled ? 'Enabled' : 'Disabled'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-slate-500 italic">Only the meeting host can modify room locks and waiting lobbies.</p>
                  )}
                </div>
              )}

            </div>
          </div>
        )}

      </div>

      {/* Bottom Control Bar */}
      <footer className="h-20 bg-slate-950 border-t border-slate-900 px-6 flex items-center justify-between z-10">
        
        {/* Left: display metadata */}
        <div className="flex items-center gap-1 hidden md:flex">
          <span className="text-sm font-semibold text-white">Call Workspace</span>
          <span className="text-slate-600 font-bold">•</span>
          <span className="text-xs text-slate-400 font-semibold font-mono">{roomId}</span>
        </div>

        {/* Center: Main call toggles */}
        <div className="flex items-center gap-4">
          {/* Microphone */}
          <button
            onClick={handleToggleMic}
            className={`p-3.5 rounded-full border transition-all cursor-pointer ${isAudioMuted ? 'bg-rose-600/15 border-rose-500/30 text-rose-400 hover:bg-rose-600/25' : 'bg-slate-900 border-slate-800 hover:bg-slate-850 text-slate-300'}`}
            title={isAudioMuted ? 'Unmute microphone' : 'Mute microphone'}
          >
            {isAudioMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          </button>

          {/* Camera */}
          <button
            onClick={handleToggleCam}
            className={`p-3.5 rounded-full border transition-all cursor-pointer ${isVideoMuted ? 'bg-rose-600/15 border-rose-500/30 text-rose-400 hover:bg-rose-600/25' : 'bg-slate-900 border-slate-800 hover:bg-slate-850 text-slate-300'}`}
            title={isVideoMuted ? 'Turn webcam on' : 'Turn webcam off'}
          >
            {isVideoMuted ? <VideoOff className="h-5 w-5" /> : <VideoIcon className="h-5 w-5" />}
          </button>

          {/* Screen Share */}
          <button
            onClick={handleToggleScreen}
            className={`p-3.5 rounded-full border transition-all cursor-pointer ${isScreenSharing ? 'bg-blue-600 border-blue-500 text-white hover:bg-blue-500' : 'bg-slate-900 border-slate-800 hover:bg-slate-850 text-slate-300'}`}
            title={isScreenSharing ? 'Stop screen sharing' : 'Share screen'}
          >
            <Monitor className="h-5 w-5" />
          </button>

          {/* Raise Hand */}
          <button
            onClick={handleToggleHand}
            className={`p-3.5 rounded-full border transition-all cursor-pointer ${localHandRaised ? 'bg-yellow-500/20 border-yellow-500/35 text-yellow-400 hover:bg-yellow-500/30' : 'bg-slate-900 border-slate-800 hover:bg-slate-850 text-slate-300'}`}
            title="Raise hand"
          >
            <Hand className="h-5 w-5" />
          </button>

          {/* End Call */}
          <button
            onClick={handleLeaveRoom}
            className="p-3.5 rounded-full bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/20 transition-all cursor-pointer border border-rose-550 hover:scale-105"
            title="Leave meeting"
          >
            <PhoneOff className="h-5 w-5" />
          </button>
        </div>

        {/* Right: Drawer toggles */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setActiveTab(activeTab === 'chat' ? null : 'chat')}
            className={`p-2.5 rounded-lg border transition-all cursor-pointer relative ${activeTab === 'chat' ? 'bg-blue-600/15 border-blue-500/30 text-blue-400' : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'}`}
          >
            <MessageSquare className="h-4.5 w-4.5" />
            {chatMessages.length > 0 && activeTab !== 'chat' && (
              <span className="absolute -top-1 -right-1 h-2 w-2 bg-blue-500 rounded-full"></span>
            )}
          </button>

          <button
            onClick={() => setActiveTab(activeTab === 'participants' ? null : 'participants')}
            className={`p-2.5 rounded-lg border transition-all cursor-pointer relative ${activeTab === 'participants' ? 'bg-blue-600/15 border-blue-500/30 text-blue-400' : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'}`}
          >
            <Users className="h-4.5 w-4.5" />
            {waitingQueue.length > 0 && (
              <span className="absolute -top-1 -right-1 h-3 w-3 bg-amber-500 rounded-full text-[9px] font-black text-slate-950 flex items-center justify-center">
                {waitingQueue.length}
              </span>
            )}
          </button>

          {isHost && (
            <button
              onClick={() => setActiveTab(activeTab === 'settings' ? null : 'settings')}
              className={`p-2.5 rounded-lg border transition-all cursor-pointer ${activeTab === 'settings' ? 'bg-blue-600/15 border-blue-500/30 text-blue-400' : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'}`}
            >
              <Settings className="h-4.5 w-4.5" />
            </button>
          )}
        </div>
      </footer>

    </div>
  );
}
