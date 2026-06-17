import { create } from 'zustand';

export interface Participant {
  peerId: string;
  name: string;
  role: 'HOST' | 'PARTICIPANT';
  isMuted: boolean;
  isCameraOff: boolean;
  handRaised: boolean;
  isSpeaking?: boolean;
}

export interface WaitingParticipant {
  peerId: string;
  name: string;
  userId?: string;
}

export interface ChatMessage {
  id: string;
  senderPeerId: string;
  senderName: string;
  content: string;
  timestamp: string | Date;
}

interface MeetingState {
  roomSlug: string | null;
  selfPeerId: string | null;
  participants: Participant[];
  waitingQueue: WaitingParticipant[];
  chatMessages: ChatMessage[];
  isWaiting: boolean;
  isApproved: boolean;
  isKicked: boolean;
  isRoomLocked: boolean;
  isWaitingRoomEnabled: boolean;
  activeSpeakerId: string | null;
  pinnedParticipantId: string | null;

  // Actions
  initializeMeeting: (roomSlug: string) => void;
  setSelfPeerId: (peerId: string) => void;
  addParticipant: (participant: Participant) => void;
  removeParticipant: (peerId: string) => void;
  updateParticipant: (peerId: string, updates: Partial<Participant>) => void;
  setParticipants: (participants: Participant[]) => void;
  addToWaitingQueue: (participant: WaitingParticipant) => void;
  removeFromWaitingQueue: (peerId: string) => void;
  addChatMessage: (message: ChatMessage) => void;
  setWaitingState: (isWaiting: boolean) => void;
  setApprovedState: (isApproved: boolean) => void;
  setKickedState: (isKicked: boolean) => void;
  setRoomSettings: (settings: { isLocked?: boolean; isWaitingRoomEnabled?: boolean }) => void;
  setActiveSpeaker: (peerId: string | null) => void;
  togglePinParticipant: (peerId: string) => void;
  resetMeeting: () => void;
}

export const useMeetingStore = create<MeetingState>((set) => ({
  roomSlug: null,
  selfPeerId: null,
  participants: [],
  waitingQueue: [],
  chatMessages: [],
  isWaiting: false,
  isApproved: false,
  isKicked: false,
  isRoomLocked: false,
  isWaitingRoomEnabled: false,
  activeSpeakerId: null,
  pinnedParticipantId: null,

  initializeMeeting: (roomSlug) => set({ roomSlug }),
  setSelfPeerId: (selfPeerId) => set({ selfPeerId }),
  addParticipant: (participant) =>
    set((state) => {
      // Avoid duplicates
      const exists = state.participants.some((p) => p.peerId === participant.peerId);
      if (exists) return {};
      return { participants: [...state.participants, participant] };
    }),
  removeParticipant: (peerId) =>
    set((state) => ({
      participants: state.participants.filter((p) => p.peerId !== peerId),
      // Reset active speaker or pinned if they left
      activeSpeakerId: state.activeSpeakerId === peerId ? null : state.activeSpeakerId,
      pinnedParticipantId: state.pinnedParticipantId === peerId ? null : state.pinnedParticipantId,
    })),
  updateParticipant: (peerId, updates) =>
    set((state) => ({
      participants: state.participants.map((p) =>
        p.peerId === peerId ? { ...p, ...updates } : p
      ),
    })),
  setParticipants: (participants) => set({ participants }),
  addToWaitingQueue: (participant) =>
    set((state) => {
      const exists = state.waitingQueue.some((p) => p.peerId === participant.peerId);
      if (exists) return {};
      return { waitingQueue: [...state.waitingQueue, participant] };
    }),
  removeFromWaitingQueue: (peerId) =>
    set((state) => ({
      waitingQueue: state.waitingQueue.filter((p) => p.peerId !== peerId),
    })),
  addChatMessage: (message) =>
    set((state) => ({
      chatMessages: [...state.chatMessages, message],
    })),
  setWaitingState: (isWaiting) => set({ isWaiting }),
  setApprovedState: (isApproved) => set({ isApproved, isWaiting: false }),
  setKickedState: (isKicked) => set({ isKicked }),
  setRoomSettings: (settings) =>
    set((state) => ({
      isRoomLocked: settings.isLocked !== undefined ? settings.isLocked : state.isRoomLocked,
      isWaitingRoomEnabled:
        settings.isWaitingRoomEnabled !== undefined
          ? settings.isWaitingRoomEnabled
          : state.isWaitingRoomEnabled,
    })),
  setActiveSpeaker: (activeSpeakerId) => set({ activeSpeakerId }),
  togglePinParticipant: (peerId) =>
    set((state) => ({
      pinnedParticipantId: state.pinnedParticipantId === peerId ? null : peerId,
    })),
  resetMeeting: () =>
    set({
      roomSlug: null,
      selfPeerId: null,
      participants: [],
      waitingQueue: [],
      chatMessages: [],
      isWaiting: false,
      isApproved: false,
      isKicked: false,
      isRoomLocked: false,
      isWaitingRoomEnabled: false,
      activeSpeakerId: null,
      pinnedParticipantId: null,
    }),
}));
