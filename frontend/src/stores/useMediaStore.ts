import { create } from 'zustand';

interface DeviceInfo {
  deviceId: string;
  label: string;
}

interface MediaState {
  localStream: MediaStream | null;
  screenStream: MediaStream | null;
  audioDevices: DeviceInfo[];
  videoDevices: DeviceInfo[];
  audioOutputs: DeviceInfo[];
  selectedAudioInput: string;
  selectedVideoInput: string;
  selectedAudioOutput: string;
  isAudioMuted: boolean;
  isVideoMuted: boolean;
  isScreenSharing: boolean;
  error: string | null;

  // Actions
  startLocalStream: () => Promise<MediaStream>;
  stopLocalStream: () => void;
  toggleAudio: () => void;
  toggleVideo: () => void;
  startScreenShare: () => Promise<MediaStream | null>;
  stopScreenShare: () => void;
  enumerateDevices: () => Promise<void>;
  setAudioInput: (deviceId: string) => Promise<void>;
  setVideoInput: (deviceId: string) => Promise<void>;
  setAudioOutput: (deviceId: string) => void;
  clearError: () => void;
}

export const useMediaStore = create<MediaState>((set, get) => {
  // Listen for device plugs/unplugs
  if (typeof window !== 'undefined' && navigator.mediaDevices) {
    navigator.mediaDevices.addEventListener('devicechange', () => {
      get().enumerateDevices().catch(console.error);
    });
  }

  return {
    localStream: null,
    screenStream: null,
    audioDevices: [],
    videoDevices: [],
    audioOutputs: [],
    selectedAudioInput: '',
    selectedVideoInput: '',
    selectedAudioOutput: '',
    isAudioMuted: false,
    isVideoMuted: false,
    isScreenSharing: false,
    error: null,

    startLocalStream: async () => {
      const { selectedAudioInput, selectedVideoInput, localStream } = get();
      
      // Stop existing stream if running to prevent track leaks
      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
      }

      const constraints: MediaStreamConstraints = {
        audio: {
          deviceId: selectedAudioInput ? { exact: selectedAudioInput } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: {
          deviceId: selectedVideoInput ? { exact: selectedVideoInput } : undefined,
          width: { ideal: 1280, min: 640 },
          height: { ideal: 720, min: 480 },
          frameRate: { ideal: 30, max: 60 },
          facingMode: 'user',
        },
      };

      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        
        // Sync initial muted preferences to the track states
        const audioTrack = stream.getAudioTracks()[0];
        const videoTrack = stream.getVideoTracks()[0];
        
        if (audioTrack) audioTrack.enabled = !get().isAudioMuted;
        if (videoTrack) videoTrack.enabled = !get().isVideoMuted;

        set({ localStream: stream, error: null });
        await get().enumerateDevices();
        return stream;
      } catch (err: any) {
        console.error('Error accessing media devices:', err);
        let errorMsg = 'Failed to access camera and microphone.';
        if (err.name === 'NotAllowedError') {
          errorMsg = 'Camera and microphone permissions denied. Please enable them in browser settings.';
        } else if (err.name === 'NotFoundError') {
          errorMsg = 'No audio or video input devices found.';
        }
        set({ error: errorMsg });
        throw err;
      }
    },

    stopLocalStream: () => {
      const { localStream, screenStream } = get();
      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
      }
      if (screenStream) {
        screenStream.getTracks().forEach((track) => track.stop());
      }
      set({ localStream: null, screenStream: null, isScreenSharing: false });
    },

    toggleAudio: () => {
      const { localStream, isAudioMuted } = get();
      const newMuteState = !isAudioMuted;
      
      if (localStream) {
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
          audioTrack.enabled = !newMuteState;
        }
      }
      set({ isAudioMuted: newMuteState });
    },

    toggleVideo: () => {
      const { localStream, isVideoMuted } = get();
      const newVideoMuteState = !isVideoMuted;

      if (localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
          videoTrack.enabled = !newVideoMuteState;
        }
      }
      set({ isVideoMuted: newVideoMuteState });
    },

    startScreenShare: async () => {
      if (get().isScreenSharing) return get().screenStream;

      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            cursor: 'always',
            displaySurface: 'monitor',
          } as any,
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
          },
        });

        // Listen for screen sharing stop event from the browser UI
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
          videoTrack.addEventListener('ended', () => {
            get().stopScreenShare();
          });
        }

        set({ screenStream: stream, isScreenSharing: true, error: null });
        return stream;
      } catch (err: any) {
        console.error('Error sharing screen:', err);
        if (err.name !== 'NotAllowedError') {
          set({ error: 'Failed to start screen sharing' });
        }
        return null;
      }
    },

    stopScreenShare: () => {
      const { screenStream } = get();
      if (screenStream) {
        screenStream.getTracks().forEach((track) => track.stop());
      }
      set({ screenStream: null, isScreenSharing: false });
    },

    enumerateDevices: async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        
        const audioDevs: DeviceInfo[] = [];
        const videoDevs: DeviceInfo[] = [];
        const audioOuts: DeviceInfo[] = [];

        devices.forEach((d) => {
          const info = {
            deviceId: d.deviceId,
            label: d.label || `${d.kind} (${d.deviceId.slice(0, 5)}...)`,
          };
          if (d.kind === 'audioinput') audioDevs.push(info);
          else if (d.kind === 'videoinput') videoDevs.push(info);
          else if (d.kind === 'audiooutput') audioOuts.push(info);
        });

        const current = get();
        set({
          audioDevices: audioDevs,
          videoDevices: videoDevs,
          audioOutputs: audioOuts,
          selectedAudioInput: current.selectedAudioInput || audioDevs[0]?.deviceId || '',
          selectedVideoInput: current.selectedVideoInput || videoDevs[0]?.deviceId || '',
          selectedAudioOutput: current.selectedAudioOutput || audioOuts[0]?.deviceId || '',
        });
      } catch (err) {
        console.error('Error enumerating devices:', err);
      }
    },

    setAudioInput: async (deviceId) => {
      set({ selectedAudioInput: deviceId });
      const { localStream } = get();
      if (localStream) {
        // Hot swap track
        await get().startLocalStream();
      }
    },

    setVideoInput: async (deviceId) => {
      set({ selectedVideoInput: deviceId });
      const { localStream } = get();
      if (localStream) {
        // Hot swap track
        await get().startLocalStream();
      }
    },

    setAudioOutput: (deviceId) => {
      set({ selectedAudioOutput: deviceId });
      // Apply output device to all remote video/audio elements (handled in UI components)
    },

    clearError: () => set({ error: null }),
  };
});
