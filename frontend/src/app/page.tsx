'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/useAuthStore';
import { useMediaStore } from '@/stores/useMediaStore';
import { 
  Video, 
  Keyboard, 
  Plus, 
  VideoOff, 
  Mic, 
  MicOff, 
  Settings, 
  LogOut, 
  LogIn, 
  UserPlus,
  HelpCircle,
  Volume2
} from 'lucide-react';

export default function LobbyPage() {
  const router = useRouter();
  const { user, logout, isAuthenticated, accessToken } = useAuthStore();

  const getBackendUrl = () => {
    let url = process.env.NEXT_PUBLIC_SIGNALING_URL;
    if (!url && typeof window !== 'undefined') {
      url = `http://${window.location.hostname}:5000`;
    }
    return url || 'http://localhost:5000';
  };
  const { 
    localStream, 
    startLocalStream, 
    stopLocalStream, 
    audioDevices, 
    videoDevices,
    selectedAudioInput,
    selectedVideoInput,
    setAudioInput,
    setVideoInput,
    isAudioMuted,
    isVideoMuted,
    toggleAudio,
    toggleVideo,
    error: mediaError
  } = useMediaStore();

  const [roomCode, setRoomCode] = useState('');
  const [guestName, setGuestName] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const localVideoRef = useRef<HTMLVideoElement | null>(null);

  // 1. Initialise local camera preview on mount
  useEffect(() => {
    startLocalStream().catch((err) => {
      console.warn('Initial media stream preview blocked or failed:', err);
    });
    return () => {
      stopLocalStream();
    };
  }, []);

  // 2. Attach video stream to visual preview tag
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  // 3. Create instant meeting (Auth users only)
  const handleCreateMeeting = async () => {
    setJoinError(null);
    setIsCreatingRoom(true);

    try {
      const backendUrl = getBackendUrl();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }

      const res = await fetch(`${backendUrl}/api/rooms`, {
        method: 'POST',
        headers,
        credentials: 'include',
      });

      const data = await res.json();
      if (res.ok) {
        // Stop preview tracks and navigate to room
        stopLocalStream();
        router.push(`/meeting/${data.room.slug}`);
      } else {
        setJoinError(data.error || 'Failed to generate meeting room');
      }
    } catch (err) {
      console.error(err);
      setJoinError('Network connectivity failure, please try again.');
    } finally {
      setIsCreatingRoom(false);
    }
  };

  // 4. Join existing meeting
  const handleJoinMeeting = async (e: React.FormEvent) => {
    e.preventDefault();
    setJoinError(null);

    // Code normalization (remove dashes/spaces/slashes)
    const cleanedCode = roomCode.trim().replace(/[^a-zA-Z0-9-]/g, '').toLowerCase();
    if (!cleanedCode) {
      setJoinError('Please enter a valid meeting code');
      return;
    }

    // Auth validation
    if (!isAuthenticated && !guestName.trim()) {
      setJoinError('Please enter your name to join as a guest, or login first.');
      return;
    }

    try {
      const backendUrl = getBackendUrl();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }

      const res = await fetch(`${backendUrl}/api/rooms/${cleanedCode}`, {
        method: 'GET',
        headers,
        credentials: 'include',
      });

      if (res.ok) {
        stopLocalStream();
        if (isAuthenticated) {
          router.push(`/meeting/${cleanedCode}`);
        } else {
          // Store guest identity query param
          router.push(`/meeting/${cleanedCode}?guestName=${encodeURIComponent(guestName.trim())}`);
        }
      } else {
        const data = await res.json();
        setJoinError(data.error || 'Meeting room not found or inactive');
      }
    } catch (err) {
      console.error(err);
      setJoinError('Server connection issue. Please verify your connection.');
    }
  };

  const handleLogout = async () => {
    try {
      const backendUrl = getBackendUrl();
      const headers: Record<string, string> = {};
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }
      await fetch(`${backendUrl}/api/auth/logout`, { 
        method: 'POST', 
        headers,
        credentials: 'include' 
      });
      logout();
    } catch (err) {
      console.error(err);
      logout();
    }
  };

  return (
    <div className="min-h-screen bg-[#070b13] flex flex-col">
      {/* Top Navbar */}
      <header className="border-b border-slate-800/60 bg-[#070b13]/80 backdrop-blur-md sticky top-0 z-50 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="bg-blue-600 p-2 rounded-lg text-white">
            <Video className="h-5 w-5" />
          </div>
          <span className="font-bold text-lg tracking-tight bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
            Muchhata
          </span>
        </div>

        <div className="flex items-center gap-3">
          {isAuthenticated && user ? (
            <>
              <div className="flex items-center gap-2.5 mr-2">
                <div className="h-8 w-8 rounded-full bg-indigo-600/30 border border-indigo-500/20 text-indigo-400 font-bold flex items-center justify-center text-sm">
                  {user.name.charAt(0).toUpperCase()}
                </div>
                <span className="text-sm font-medium text-slate-300 hidden md:inline">{user.name}</span>
              </div>
              <button 
                onClick={handleLogout}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-rose-400 border border-rose-500/20 bg-rose-500/5 rounded-lg hover:bg-rose-500/10 cursor-pointer"
              >
                <LogOut className="h-3.5 w-3.5" />
                Sign Out
              </button>
            </>
          ) : (
            <>
              <button 
                onClick={() => router.push('/login')}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-slate-300 hover:text-white cursor-pointer"
              >
                <LogIn className="h-4 w-4" />
                Sign In
              </button>
              <button 
                onClick={() => router.push('/register')}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg shadow-md shadow-blue-600/15 cursor-pointer"
              >
                <UserPlus className="h-4 w-4" />
                Sign Up
              </button>
            </>
          )}
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-10 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
        
        {/* Left: Call Actions Column */}
        <div className="lg:col-span-5 flex flex-col justify-center space-y-8">
          <div className="space-y-4">
            <h1 className="text-4xl md:text-5xl font-black tracking-tight text-white leading-tight">
              Enterprise-grade<br/>
              <span className="bg-gradient-to-r from-blue-400 via-indigo-400 to-purple-400 bg-clip-text text-transparent">
                video conferencing
              </span><br/>
              for everyone.
            </h1>
            <p className="text-slate-400 text-base max-w-md">
              Secure, HD crystal-clear screen sharing, live chat, and robust group meetings built for scalable startup remote work.
            </p>
          </div>

          {joinError && (
            <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-950/20 px-4 py-3 text-sm text-red-400 max-w-md">
              <span className="font-semibold">Error:</span>
              <span>{joinError}</span>
            </div>
          )}

          <div className="space-y-6 max-w-md">
            {/* CTA action buttons */}
            {isAuthenticated ? (
              <button
                onClick={handleCreateMeeting}
                disabled={isCreatingRoom}
                className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-bold py-3.5 px-6 rounded-xl transition-all shadow-lg shadow-blue-600/25 cursor-pointer disabled:opacity-50"
              >
                {isCreatingRoom ? (
                  <span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent"></span>
                ) : (
                  <>
                    <Plus className="h-5 w-5" />
                    New Meeting
                  </>
                )}
              </button>
            ) : (
              <div className="p-4 rounded-xl bg-blue-950/10 border border-blue-500/10 space-y-3">
                <p className="text-xs text-blue-300 font-semibold uppercase tracking-wider">Host controls restricted</p>
                <p className="text-xs text-slate-400">Please authenticate to host new rooms, or join below as a guest participant.</p>
              </div>
            )}

            <div className="relative flex py-2 items-center">
              <div className="flex-grow border-t border-slate-800"></div>
              <span className="flex-shrink mx-4 text-slate-500 text-xs font-semibold uppercase tracking-wider">or</span>
              <div className="flex-grow border-t border-slate-800"></div>
            </div>

            {/* Join Room Form */}
            <form onSubmit={handleJoinMeeting} className="space-y-4">
              {!isAuthenticated && (
                <div>
                  <input
                    type="text"
                    required
                    placeholder="Enter your name to join"
                    value={guestName}
                    onChange={(e) => setGuestName(e.target.value)}
                    className="w-full rounded-xl px-4 py-3 text-sm glass-input"
                  />
                </div>
              )}
              
              <div className="flex gap-2.5">
                <div className="relative flex-1">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                    <Keyboard className="h-4 w-4" />
                  </div>
                  <input
                    type="text"
                    required
                    placeholder="abc-defg-hij (Room Code)"
                    value={roomCode}
                    onChange={(e) => setRoomCode(e.target.value)}
                    className="w-full rounded-xl pl-9 pr-4 py-3 text-sm glass-input font-mono tracking-wider placeholder:font-sans placeholder:tracking-normal"
                  />
                </div>
                
                <button
                  type="submit"
                  className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-bold px-6 rounded-xl transition-all cursor-pointer text-sm"
                >
                  Join
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Right: Pre-call device preview screen */}
        <div className="lg:col-span-7 flex justify-center">
          <div className="w-full max-w-xl rounded-2xl glass-panel p-6 shadow-2xl relative overflow-hidden">
            {/* Visual Header */}
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                <Volume2 className="h-4 w-4 text-emerald-400" />
                Pre-Call Device Check
              </h3>
              <button
                onClick={() => setShowSettings(!showSettings)}
                className="p-1.5 rounded-lg border border-slate-800 bg-slate-900/50 hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                <Settings className="h-4 w-4" />
              </button>
            </div>

            {/* Video Preview feed */}
            <div className="relative aspect-video rounded-xl bg-slate-950 border border-slate-800/80 overflow-hidden flex items-center justify-center">
              {localStream && !isVideoMuted ? (
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="h-full w-full object-cover mirror-video"
                />
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <div className="p-4 rounded-full bg-slate-900 border border-slate-800 text-slate-500">
                    <VideoOff className="h-8 w-8" />
                  </div>
                  <p className="text-slate-400 text-xs font-medium">Camera is turned off</p>
                </div>
              )}

              {/* Status Pill overlays */}
              <div className="absolute bottom-4 left-4 right-4 flex justify-between items-center z-10 pointer-events-none">
                <div className="flex gap-2">
                  <span className={`px-2.5 py-1 rounded-md text-[10px] font-bold border backdrop-blur-md ${isAudioMuted ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'}`}>
                    {isAudioMuted ? 'Muted' : 'Mic Active'}
                  </span>
                  <span className={`px-2.5 py-1 rounded-md text-[10px] font-bold border backdrop-blur-md ${isVideoMuted ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'}`}>
                    {isVideoMuted ? 'Video Off' : 'Video Active'}
                  </span>
                </div>
              </div>
            </div>

            {/* Mic and camera inline toggles */}
            <div className="flex items-center justify-center gap-4 mt-6">
              <button
                onClick={toggleAudio}
                className={`p-3.5 rounded-full border transition-all cursor-pointer ${isAudioMuted ? 'bg-rose-500/15 border-rose-500/30 text-rose-400 hover:bg-rose-500/25' : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-white'}`}
              >
                {isAudioMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
              </button>

              <button
                onClick={toggleVideo}
                className={`p-3.5 rounded-full border transition-all cursor-pointer ${isVideoMuted ? 'bg-rose-500/15 border-rose-500/30 text-rose-400 hover:bg-rose-500/25' : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-white'}`}
              >
                {isVideoMuted ? <VideoOff className="h-5 w-5" /> : <Video className="h-5 w-5" />}
              </button>
            </div>

            {/* Expandable Media Settings Panel */}
            {showSettings && (
              <div className="mt-6 border-t border-slate-800/80 pt-5 space-y-4 animate-fadeIn">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Device Selectors</h4>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1">Microphone</label>
                    <select
                      value={selectedAudioInput}
                      onChange={(e) => setAudioInput(e.target.value)}
                      className="w-full text-xs rounded-lg px-3 py-2 bg-slate-950 border border-slate-800 text-slate-300 focus:outline-none focus:border-blue-500"
                    >
                      {audioDevices.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1">Camera</label>
                    <select
                      value={selectedVideoInput}
                      onChange={(e) => setVideoInput(e.target.value)}
                      className="w-full text-xs rounded-lg px-3 py-2 bg-slate-950 border border-slate-800 text-slate-300 focus:outline-none focus:border-blue-500"
                    >
                      {videoDevices.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            )}

            {mediaError && (
              <div className="mt-4 text-center text-xs text-rose-400 bg-rose-950/20 border border-rose-500/10 p-2.5 rounded-lg">
                ⚠️ {mediaError}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-6 border-t border-slate-800/40 text-center text-xs text-slate-500 bg-[#070b13]">
        <div className="flex justify-center items-center gap-1">
          <span>Muchhata Enterprise Call Manager v1.0.0</span>
          <span>•</span>
          <a href="#" className="hover:underline">Documentation</a>
          <span>•</span>
          <a href="#" className="hover:underline">Security Whitepaper</a>
        </div>
      </footer>
    </div>
  );
}
