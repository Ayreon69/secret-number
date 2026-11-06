// Contrat partagé entre le serveur et le client de Secret Number : constantes, réglages et vues.
// Chacun ne reçoit que sa propre vue : jamais le numéro de quelqu'un (pas même le sien) avant la fin,
// ni les tickets, les demandes, les résultats, la fiche ou les notes d'un autre.

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 10;
/** Les numéros secrets sont tirés entre 1 et 100, tous différents. */
export const LOW = 1;
export const HIGH = 100;

/** Les quatre tickets d'un carnet. */
export const TICKETS = ['plus', 'fois', 'divise', 'zero'] as const;
export type Ticket = (typeof TICKETS)[number];
export type Hand = Record<Ticket, number>;

/** Durées possibles de la partie, en minutes ; 0 : sans limite (la partie s'arrête quand tout le monde a rendu sa fiche). */
export const DURATIONS = [10, 15, 20, 30, 0] as const;
export type Duration = (typeof DURATIONS)[number];
/** À voix haute : on négocie autour de la table. Messages écrits : on peut aussi s'écrire, à une personne ou à tout le monde. */
export type Talk = 'voix' | 'ecrit';

/** Le dernier appel : le standard est fermé, on n'a plus que ce temps pour finir sa fiche. */
export const LAST_CALL_MS = 60_000;
/** Une demande de contact sans réponse tombe au bout de ce délai. */
export const REQUEST_MS = 45_000;
/** Le temps pendant lequel une ligne reste tracée sur le plan quand deux joueurs entrent en contact. */
export const CORD_MS = 4_000;
/** Une note ne dépasse pas cette longueur. */
export const NOTES_MAX = 2_000;
export const WHISPER_MAX = 140;

export const AVATARS = ['valise', 'parapluie', 'lunettes', 'chapeau', 'journal', 'cafe', 'casque', 'echarpe', 'renard', 'chat', 'hibou', 'velo'] as const;
export const EMOTES = ['👍', '😂', '😮', '🤔', '🤫', '😈', '👀', '🫡'] as const;
export const TAUNTS = ['On fait un Plus ?', 'Je te crois…', 'Menteur !', 'Alliance ?', 'Bien joué'] as const;

export type PlayerStatus = 'lobby' | 'playing' | 'spectator';

export interface Settings {
  minutes: Duration;
  talk: Talk;
}

export function isDuration(v: unknown): v is Duration {
  return typeof v === 'number' && (DURATIONS as readonly number[]).includes(v);
}

export function isTicket(v: unknown): v is Ticket {
  return typeof v === 'string' && (TICKETS as readonly string[]).includes(v);
}

export function isTalk(v: unknown): v is Talk {
  return v === 'voix' || v === 'ecrit';
}

export interface PlayerView {
  id: string;
  name: string;
  avatar: string;
  isBot: boolean;
  isHost: boolean;
  connected: boolean;
  autopilot: boolean;
  status: PlayerStatus;
  wins: number;
  /** Place autour du plan, de 1 à 10 ; null hors partie. */
  seat: number | null;
  /** A rendu sa fiche (tout le monde le voit, comme une copie posée sur la table). */
  done: boolean;
}

/** Ce qu'une somme trop petite ou trop grande laisse savoir : seulement une fourchette. */
export type Range = 'low' | 'high' | null;

/** Le résultat d'un contact, connu des deux seuls joueurs concernés. */
export interface ContactResult {
  id: number;
  type: Ticket;
  with: string;
  value: number;
  range: Range;
}

export interface Request {
  id: number;
  from: string;
  to: string;
  type: Ticket;
  endsAt: number;
}

/** Une ligne tracée un instant entre deux joueurs qui entrent en contact : tout le monde la voit, sans savoir quel ticket. */
export interface Cord {
  id: number;
  a: string;
  b: string;
}

export interface Whisper {
  id: number;
  from: string;
  /** null : à tout le monde. */
  to: string | null;
  text: string;
  at: number;
}

export interface Gift {
  id: number;
  from: string;
  type: Ticket;
}

/** Un refus, une demande tombée ou annulée : un mot pour celui qui attendait. */
export interface Notice {
  id: number;
  text: string;
}

export type Stage = 'open' | 'last' | 'closing';

export interface MeView {
  tickets: Hand;
  /** Carnets achetés en plus du premier : un point chacun. */
  bought: number;
  outgoing: Request | null;
  incoming: Request[];
  /** Les résultats pas encore rangés : une fois lus, ils disparaissent (on les note si on veut). */
  results: ContactResult[];
  gifts: Gift[];
  notices: Notice[];
  /** La fiche en cours : un numéro ou rien pour chaque joueur. */
  sheet: Record<string, number | null>;
  notes: string;
  inbox: Whisper[];
}

export interface GameView {
  order: string[];
  stage: Stage;
  /** Fin de la phase en cours (heure du serveur) ; 0 : sans limite. */
  endsAt: number;
  cords: Cord[];
  me: MeView | null;
}

export interface Score {
  own: number;
  right: number;
  wrong: number;
  bonus: number;
  /** Combien d'autres ont trouvé son numéro (un point de moins chacun). */
  found: number;
  bought: number;
  total: number;
}

export interface FinalPlayer {
  id: string;
  name: string;
  avatar: string;
  seat: number;
  number: number;
  sheet: Record<string, number | null>;
  score: Score;
  place: number;
  wins: number;
  winner: boolean;
  left: boolean;
}

export interface FinalContact {
  a: string;
  b: string;
  type: Ticket;
  value: number;
  range: Range;
}

export interface FinalView {
  minutes: Duration;
  players: FinalPlayer[];
  contacts: FinalContact[];
}

export interface RoomView {
  code: string;
  phase: 'lobby' | 'playing' | 'finished';
  me: string;
  hostId: string;
  settings: Settings;
  players: PlayerView[];
  game: GameView | null;
  final: FinalView | null;
  serverNow: number;
}

export type Ack<T = unknown> = (res: { ok: boolean; error?: string; data?: T }) => void;

// ───────────────────────────── Les tickets ─────────────────────────────

/** Combien de chiffres 0 on écrit en notant tous les nombres entiers strictement compris entre a et b. */
export function zerosBetween(a: number, b: number): number {
  let n = 0;
  for (let k = Math.min(a, b) + 1; k < Math.max(a, b); k++) {
    for (const ch of String(k)) if (ch === '0') n++;
  }
  return n;
}

/** Ce qu'apprennent deux joueurs qui donnent le même ticket. Le résultat est le même des deux côtés. */
export function contact(type: Ticket, a: number, b: number): { value: number; range: Range } {
  switch (type) {
    case 'plus': {
      // Une fourchette ne dit pas la vraie somme : la valeur n'est même pas envoyée.
      const s = a + b;
      if (s <= 20) return { value: 0, range: 'low' };
      if (s >= 180) return { value: 0, range: 'high' };
      return { value: s, range: null };
    }
    case 'fois':
      return { value: (a * b) % 10, range: null };
    case 'divise':
      return { value: Math.floor(Math.max(a, b) / Math.min(a, b)), range: null };
    case 'zero':
      return { value: zerosBetween(a, b), range: null };
  }
}

/** Le texte d'un résultat, tel que le joueur le lit : une fourchette cache la vraie somme. */
export function resultText(r: { value: number; range: Range }): string {
  if (r.range === 'low') return 'entre 3 et 20';
  if (r.range === 'high') return 'entre 180 et 199';
  return String(r.value);
}

export function emptyHand(): Hand {
  return { plus: 0, fois: 0, divise: 0, zero: 0 };
}
