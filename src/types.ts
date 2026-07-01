export interface Player {
  id: string;
  nickname: string;
  avatarId: number;
  isHost: boolean;
  isAlive: boolean;
  isOffline: boolean;
  role: string; // empty unless revealed or current player
  isMuted: boolean;
  revealedSheikh: boolean;
  isBot?: boolean;
}

export interface Message {
  id: string;
  senderId: string | null;
  senderName: string;
  text: string;
  time: string;
  isSystem: boolean;
  isDeadChat: boolean;
}

export interface GameEvent {
  id: string;
  icon: string;
  text: string;
  time: string;
  round: number;
}

export interface Room {
  code: string;
  players: Player[];
  status: "lobby" | "showing_roles" | "night" | "day" | "voting" | "game_over";
  round: number;
  dayDuration: number;
  timer: number;
  winner: "citizens" | "mafia" | null;
  nightOutcomeText: string;
  voteOutcomeText: string;
  votes: Record<string, string>;
  messages: Message[];
  eventsLog?: GameEvent[];
  hostId: string;
  phaseEndsAt: number;
  firstNightDeathOccurred?: boolean;
  firstVoteEliminationOccurred?: boolean;
  
  // Role specific choices for active user feedback
  mafiaTarget: string | null;
  muteTarget: string | null;
  doctorTarget: string | null;
  sniperTarget: string | null;
  sniperHasShot?: boolean;
  jokerChoice: "first_night_death" | "first_vote_elimination" | null;
}
