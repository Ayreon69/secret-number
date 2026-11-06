// Registre des tables en mémoire, avec nettoyage des tables abandonnées.
import crypto from 'node:crypto';
import { Room } from './room';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const IDLE_MS = 30 * 60_000;

export class RoomManager {
  private rooms = new Map<string, Room>();

  constructor(private readonly setup: (room: Room) => void) {
    setInterval(() => this.sweep(), 5 * 60_000).unref();
  }

  get size(): number {
    return this.rooms.size;
  }

  create(): Room {
    let code = '';
    do {
      code = Array.from({ length: 4 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
    } while (this.rooms.has(code));
    const room = new Room(code);
    this.setup(room);
    this.rooms.set(code, room);
    return room;
  }

  get(code: unknown): Room | undefined {
    if (typeof code !== 'string') return undefined;
    return this.rooms.get(code.trim().toUpperCase());
  }

  private sweep(): void {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (room.humansOnline === 0 && now - room.lastActive > IDLE_MS) {
        room.dispose();
        this.rooms.delete(code);
      }
    }
  }
}
