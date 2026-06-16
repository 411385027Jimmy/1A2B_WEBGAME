export interface Player {
  id: string; // Connection ID
  name: string;
  score: number;
  isOnline: boolean;
  joinedAt: number;
}

export interface GuessRecord {
  id: string;
  playerName: string;
  playerId: string;
  guessStr: string;
  aCount: number;
  bCount: number;
  timestamp: number;
}

export interface ChatMessage {
  id: string;
  playerName: string;
  text: string;
  timestamp: number;
  isSystem?: boolean;
}

export type GameStatus = 'WAITING_FOR_PLAYERS' | 'WAITING_FOR_SECRET' | 'GUESSING' | 'ROUND_OVER';

export interface GameState {
  players: Player[];
  creatorId: string | null; // ID of the player currently setting the secret code
  isSecretSet: boolean;
  status: GameStatus;
  currentRound: number;
  history: GuessRecord[];
  chats: ChatMessage[];
}

export type SocketMessage =
  | { type: 'STATE_UPDATE'; state: GameState; yourId: string }
  | { type: 'JOIN'; name: string }
  | { type: 'SET_SECRET'; secret: string }
  | { type: 'GUESS'; guess: string }
  | { type: 'CHAT'; text: string }
  | { type: 'RESTART_ROUND' }
  | { type: 'ERROR'; message: string };
