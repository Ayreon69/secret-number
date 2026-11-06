// Le moteur de Secret Number, sans réseau ni minuterie : numéros secrets, tickets, demandes de contact,
// résultats, dons, fiches, notes, messages, et le décompte des points.
import crypto from 'node:crypto';
import {
  HIGH,
  LOW,
  NOTES_MAX,
  TICKETS,
  WHISPER_MAX,
  contact,
  emptyHand,
  type ContactResult,
  type Cord,
  type Gift,
  type Hand,
  type Notice,
  type Range,
  type Request,
  type Score,
  type Stage,
  type Ticket,
  type Whisper,
} from '../shared/protocol';

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const TICKET_NAME: Record<Ticket, string> = { plus: 'Plus', fois: 'Fois', divise: 'Divisé', zero: 'Zéro' };

export interface Contact {
  a: string;
  b: string;
  type: Ticket;
  value: number;
  range: Range;
}

export interface Row {
  id: string;
  number: number;
  sheet: Record<string, number | null>;
  bought: number;
  score: Score;
  place: number;
}

const INBOX_MAX = 40;

export class Game {
  readonly order: string[];
  readonly numbers = new Map<string, number>();
  readonly tickets = new Map<string, Hand>();
  readonly bought = new Map<string, number>();
  readonly sheets = new Map<string, Record<string, number | null>>();
  readonly notes = new Map<string, string>();
  readonly done = new Set<string>();
  readonly results = new Map<string, ContactResult[]>();
  readonly gifts = new Map<string, Gift[]>();
  readonly notices = new Map<string, Notice[]>();
  readonly inbox = new Map<string, Whisper[]>();
  readonly requests = new Map<number, Request>();
  readonly contacts: Contact[] = [];
  cords: (Cord & { until: number })[] = [];
  stage: Stage = 'open';
  private nextId = 1;

  constructor(order: string[], numbers?: number[]) {
    this.order = [...order];
    const pool = numbers ?? shuffle(Array.from({ length: HIGH - LOW + 1 }, (_, i) => LOW + i)).slice(0, order.length);
    if (pool.length < order.length || new Set(pool).size !== pool.length) throw new Error('numéros invalides');
    order.forEach((id, i) => {
      this.numbers.set(id, pool[i]);
      this.tickets.set(id, { plus: 1, fois: 1, divise: 1, zero: 1 });
      this.bought.set(id, 0);
      this.sheets.set(id, Object.fromEntries(order.map((o) => [o, null])));
      this.notes.set(id, '');
      this.results.set(id, []);
      this.gifts.set(id, []);
      this.notices.set(id, []);
      this.inbox.set(id, []);
    });
  }

  private id(): number {
    return this.nextId++;
  }

  has(id: string): boolean {
    return this.numbers.has(id);
  }

  get open(): boolean {
    return this.stage === 'open';
  }

  outgoingOf(id: string): Request | undefined {
    for (const r of this.requests.values()) if (r.from === id) return r;
    return undefined;
  }

  incomingOf(id: string): Request[] {
    return [...this.requests.values()].filter((r) => r.to === id);
  }

  /** Les tickets qu'on peut encore donner ou proposer : celui réservé par sa propre demande en attente ne compte pas. */
  free(id: string, type: Ticket): number {
    const n = this.tickets.get(id)?.[type] ?? 0;
    const out = this.outgoingOf(id);
    return out && out.type === type ? n - 1 : n;
  }

  notify(id: string, text: string): void {
    const list = this.notices.get(id);
    if (!list) return;
    list.push({ id: this.id(), text });
    if (list.length > 6) list.shift();
  }

  /**
   * Une demande de contact. Si l'autre avait déjà demandé la même chose dans l'autre sens, c'est une poignée de main :
   * le contact a lieu tout de suite.
   */
  ask(from: string, to: string, type: Ticket, endsAt: number): { request?: Request; contact?: Contact } | string {
    if (!this.open) return 'Le standard est fermé : plus de contact possible.';
    if (!this.has(from)) return 'Tu regardes la partie : tu joueras à la prochaine.';
    if (!this.has(to) || to === from) return 'Joueur introuvable.';
    const mirror = [...this.requests.values()].find((r) => r.from === to && r.to === from && r.type === type);
    if (mirror) {
      const done = this.answer(from, mirror.id, true);
      return typeof done === 'string' ? done : { contact: done.contact };
    }
    if (this.outgoingOf(from)) return 'Tu as déjà une demande en attente : annule-la d’abord.';
    if ((this.tickets.get(from)?.[type] ?? 0) <= 0) return `Tu n'as plus de ticket ${TICKET_NAME[type]}.`;
    const request: Request = { id: this.id(), from, to, type, endsAt };
    this.requests.set(request.id, request);
    return { request };
  }

  /** La réponse à une demande. Accepter dépense un ticket de chaque côté et donne le résultat aux deux. */
  answer(by: string, id: number, accept: boolean): { contact?: Contact; request: Request } | string {
    const r = this.requests.get(id);
    if (!r || r.to !== by) return 'Cette demande n’existe plus.';
    if (!accept) {
      this.requests.delete(id);
      return { request: r };
    }
    if (!this.open) return 'Le standard est fermé : plus de contact possible.';
    const mine = this.tickets.get(by)!;
    if (mine[r.type] <= 0) return `Tu n'as plus de ticket ${TICKET_NAME[r.type]}.`;
    const theirs = this.tickets.get(r.from)!;
    this.requests.delete(id);
    if (theirs[r.type] <= 0) {
      this.notify(by, 'Ce contact n’a pas pu se faire : il manquait un ticket en face.');
      this.notify(r.from, `Ce contact n’a pas pu se faire : il te manquait le ticket ${TICKET_NAME[r.type]}.`);
      return { request: r };
    }
    mine[r.type]--;
    theirs[r.type]--;
    // Le ticket dépensé était peut-être celui de sa propre demande en attente : elle tombe.
    const own = this.outgoingOf(by);
    if (own && own.type === r.type && mine[r.type] <= 0) {
      this.requests.delete(own.id);
      this.notify(own.to, 'Une demande de contact a été retirée.');
    }
    const res = contact(r.type, this.numbers.get(r.from)!, this.numbers.get(by)!);
    const c: Contact = { a: r.from, b: by, type: r.type, ...res };
    this.contacts.push(c);
    this.results.get(r.from)!.push({ id: this.id(), type: r.type, with: by, ...res });
    this.results.get(by)!.push({ id: this.id(), type: r.type, with: r.from, ...res });
    return { contact: c, request: r };
  }

  cancel(by: string): Request | string {
    const r = this.outgoingOf(by);
    if (!r) return 'Aucune demande en attente.';
    this.requests.delete(r.id);
    return r;
  }

  /** Les demandes dont le délai est passé tombent. */
  expire(now: number): Request[] {
    const gone: Request[] = [];
    for (const r of [...this.requests.values()]) {
      if (r.endsAt > now) continue;
      this.requests.delete(r.id);
      gone.push(r);
    }
    return gone;
  }

  buy(by: string): string | undefined {
    if (!this.open) return 'Le standard est fermé.';
    if (!this.has(by)) return 'Tu regardes la partie : tu joueras à la prochaine.';
    const hand = this.tickets.get(by)!;
    for (const t of TICKETS) hand[t]++;
    this.bought.set(by, (this.bought.get(by) ?? 0) + 1);
    return undefined;
  }

  give(by: string, to: string, type: Ticket): string | undefined {
    if (!this.open) return 'Le standard est fermé.';
    if (!this.has(by)) return 'Tu regardes la partie : tu joueras à la prochaine.';
    if (!this.has(to) || to === by) return 'Joueur introuvable.';
    if (this.free(by, type) <= 0) {
      return (this.tickets.get(by)?.[type] ?? 0) > 0 ? 'Ce ticket est réservé pour ta demande en attente.' : `Tu n'as plus de ticket ${TICKET_NAME[type]}.`;
    }
    this.tickets.get(by)![type]--;
    this.tickets.get(to)![type]++;
    this.gifts.get(to)!.push({ id: this.id(), from: by, type });
    return undefined;
  }

  /** Un résultat lu, un don vu ou un message d'information lu : on le range. */
  seen(by: string, kind: unknown, id: unknown): void {
    const key = kind === 'result' ? this.results : kind === 'gift' ? this.gifts : kind === 'notice' ? this.notices : null;
    const list = key?.get(by) as { id: number }[] | undefined;
    if (!list) return;
    const i = list.findIndex((x) => x.id === id);
    if (i >= 0) list.splice(i, 1);
  }

  setAnswer(by: string, target: string, value: unknown): string | undefined {
    if (this.stage === 'closing') return 'Les fiches sont ramassées.';
    const sheet = this.sheets.get(by);
    if (!sheet) return 'Tu regardes la partie : tu joueras à la prochaine.';
    if (!(target in sheet)) return 'Joueur introuvable.';
    if (value === null) sheet[target] = null;
    else if (typeof value === 'number' && Number.isInteger(value) && value >= LOW && value <= HIGH) sheet[target] = value;
    else return `Un numéro entre ${LOW} et ${HIGH}.`;
    return undefined;
  }

  setNotes(by: string, text: unknown): void {
    if (!this.notes.has(by) || typeof text !== 'string') return;
    this.notes.set(by, text.replace(/\r/g, '').slice(0, NOTES_MAX));
  }

  setDone(by: string, done: boolean): string | undefined {
    if (this.stage === 'closing') return undefined;
    if (!this.has(by)) return 'Tu regardes la partie : tu joueras à la prochaine.';
    if (done) this.done.add(by);
    else this.done.delete(by);
    return undefined;
  }

  whisper(from: string, to: string | null, text: unknown, at: number): string | undefined {
    if (this.stage === 'closing') return 'La partie est finie.';
    if (!this.has(from)) return 'Tu regardes la partie : tu joueras à la prochaine.';
    if (to !== null && (!this.has(to) || to === from)) return 'Joueur introuvable.';
    const clean = typeof text === 'string' ? text.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, WHISPER_MAX) : '';
    if (!clean) return 'Message vide.';
    const w: Whisper = { id: this.id(), from, to, text: clean, at };
    for (const id of to === null ? this.order : [from, to]) {
      const box = this.inbox.get(id)!;
      box.push(w);
      if (box.length > INBOX_MAX) box.shift();
    }
    return undefined;
  }

  addCord(a: string, b: string, until: number): void {
    this.cords.push({ id: this.id(), a, b, until });
  }

  dropCords(now: number): boolean {
    const before = this.cords.length;
    this.cords = this.cords.filter((c) => c.until > now);
    return this.cords.length !== before;
  }

  /** Le standard ferme : plus de contacts, de dons ni d'achats ; les demandes en attente tombent. */
  close(): Request[] {
    this.stage = 'last';
    const gone = [...this.requests.values()];
    this.requests.clear();
    return gone;
  }

  // ───────────────────────────── Décompte ─────────────────────────────

  score(id: string): Score {
    const sheet = this.sheets.get(id)!;
    const own = sheet[id] === this.numbers.get(id) ? 5 : -5;
    let right = 0;
    let wrong = 0;
    for (const o of this.order) {
      if (o === id || sheet[o] === null) continue;
      if (sheet[o] === this.numbers.get(o)) right++;
      else wrong++;
    }
    const bonus = own > 0 && right === this.order.length - 1 ? 5 : 0;
    const found = this.order.filter((o) => o !== id && this.sheets.get(o)![id] === this.numbers.get(id)).length;
    const bought = this.bought.get(id) ?? 0;
    return { own, right, wrong, bonus, found, bought, total: own + right - wrong + bonus - found - bought };
  }

  standings(): Row[] {
    const rows = this.order.map((id) => ({
      id,
      number: this.numbers.get(id)!,
      sheet: { ...this.sheets.get(id)! },
      bought: this.bought.get(id) ?? 0,
      score: this.score(id),
      place: 0,
    }));
    rows.sort((a, b) => b.score.total - a.score.total || this.order.indexOf(a.id) - this.order.indexOf(b.id));
    for (const r of rows) r.place = 1 + rows.filter((x) => x.score.total > r.score.total).length;
    return rows;
  }
}
