// Une table de Secret Number : salon, partie, demandes de contact, bots, pilote automatique, minuteries et vue de chacun.
// Tout ce qui est privé (demande, refus, achat, don, fiche, notes, message) n'est envoyé qu'aux joueurs concernés :
// un état reçu sans rien de neuf trahirait un geste caché.
import crypto from 'node:crypto';
import {
  AVATARS,
  CORD_MS,
  LAST_CALL_MS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  REQUEST_MS,
  TICKETS,
  isDuration,
  isTalk,
  isTicket,
  type FinalView,
  type GameView,
  type PlayerStatus,
  type Request,
  type RoomView,
  type Settings,
} from '../shared/protocol';
import { AUTOPILOT, Brain, codeOf, randomSkill, type Skill } from './bots';
import { Game, TICKET_NAME, shuffle, type Contact } from './game';

const BOT_NAMES = ['Bastille', 'Nation', 'Opéra', 'Odéon', 'Alma', 'Concorde', 'Pigalle', 'Europe', 'Italie', 'Liège', 'Rome', 'Jasmin', 'Voltaire', 'Cluny'];
const MAX_MEMBERS = 16;
/** Délai laissé à un joueur déconnecté avant que le pilote automatique ne prenne le relais. */
const GRACE_MS = 20_000;
/** Mode accéléré pour les tests locaux (SN_FAST=1) : une minute de partie dure une seconde, et les bots se pressent. */
const FAST = process.env.SN_FAST === '1';
const T = {
  minute: FAST ? 1_000 : 60_000,
  last: FAST ? 1_200 : LAST_CALL_MS,
  request: FAST ? 1_500 : REQUEST_MS,
  cord: FAST ? 250 : CORD_MS,
  closing: FAST ? 150 : 2_600,
  botFirst: FAST ? [10, 150] : [5_000, 16_000],
  botReply: FAST ? [5, 60] : [1_800, 5_500],
  paceScale: FAST ? 0.01 : 1,
  autoRefuse: FAST ? 60 : 2_500,
  snub: FAST ? 600 : 90_000,
} as const;

export interface Player {
  id: string;
  token: string;
  name: string;
  avatar: string;
  isBot: boolean;
  sockets: Set<string>;
  connected: boolean;
  disconnectedAt: number;
  left: boolean;
  status: PlayerStatus;
}

export type Outcome = { error?: string; scope?: string[] | null };

function uid(): string {
  return crypto.randomBytes(9).toString('base64url');
}

function between([a, b]: readonly [number, number] | readonly number[]): number {
  return a + crypto.randomInt(Math.max(1, b - a + 1));
}

export class Room {
  readonly code: string;
  hostId = '';
  phase: 'lobby' | 'playing' | 'finished' = 'lobby';
  settings: Settings = { minutes: 15, talk: 'voix' };
  players: Player[] = [];
  game: Game | null = null;
  final: FinalView | null = null;
  wins = new Map<string, number>();
  skills = new Map<string, Skill>();
  brains = new Map<string, Brain>();
  /** Fin de la phase en cours ; 0 : sans limite. */
  stageEndsAt = 0;
  /** Quand chaque bot prendra sa prochaine initiative. */
  private botNext = new Map<string, number>();
  /** Les réponses que les bots ont décidé de donner, et quand. */
  private botReplies = new Map<number, number>();
  /** Les demandes adressées à un absent : il ne répondra pas. */
  private autoRefuse = new Map<number, number>();
  lastActive = Date.now();
  onChange: () => void = () => {};
  onPrivate: (playerId: string) => void = () => {};
  onEmote: (playerId: string, text: string) => void = () => {};

  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Ceux qu'on a déjà annoncés en pilote automatique. */
  private autoSeen = new Set<string>();
  private dirtyAll = false;
  private dirty = new Set<string>();

  constructor(code: string) {
    this.code = code;
  }

  // ───────────────────────────── Membres ─────────────────────────────

  get(id: string | undefined | null): Player | undefined {
    return id ? this.players.find((p) => p.id === id) : undefined;
  }

  findByToken(playerId: unknown, token: unknown): Player | undefined {
    if (typeof playerId !== 'string' || typeof token !== 'string') return undefined;
    const p = this.get(playerId);
    return p && !p.isBot && p.token === token ? p : undefined;
  }

  get seated(): Player[] {
    return this.players.filter((p) => p.status !== 'spectator');
  }

  get humansOnline(): number {
    return this.players.filter((p) => !p.isBot && p.connected).length;
  }

  touch(): void {
    this.lastActive = Date.now();
  }

  private uniqueName(name: string): string {
    const taken = new Set(this.players.map((p) => p.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let i = 2; i < 99; i++) {
      const candidate = `${name.slice(0, 13)} ${i}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return name;
  }

  private makePlayer(name: string, avatar: string, isBot: boolean, status: PlayerStatus): Player {
    return {
      id: uid(),
      token: uid() + uid(),
      name: this.uniqueName(name),
      avatar,
      isBot,
      sockets: new Set(),
      connected: isBot,
      disconnectedAt: Date.now(),
      left: false,
      status,
    };
  }

  addHuman(name: string, avatar: string): Player | string {
    if (this.players.length >= MAX_MEMBERS) return 'Cette table est pleine.';
    if (this.phase === 'lobby' && this.seated.length >= MAX_PLAYERS) return `La table est complète (${MAX_PLAYERS} joueurs maximum).`;
    const p = this.makePlayer(name, avatar, false, this.phase === 'lobby' ? 'lobby' : 'spectator');
    this.players.push(p);
    if (!this.hostId) this.hostId = p.id;
    return p;
  }

  addBot(by: string): string | undefined {
    if (by !== this.hostId) return "Seul l'hôte peut ajouter des bots.";
    if (this.phase !== 'lobby') return 'On ajoute des bots dans le salon.';
    if (this.seated.length >= MAX_PLAYERS) return `La table est complète (${MAX_PLAYERS} joueurs maximum).`;
    const used = new Set(this.players.map((p) => p.name));
    const names = BOT_NAMES.filter((n) => !used.has(n));
    const name = names.length ? names[crypto.randomInt(names.length)] : `Bot ${this.players.length + 1}`;
    const usedAvatars = new Set(this.players.map((p) => p.avatar));
    const free = AVATARS.filter((a) => !usedAvatars.has(a));
    const pool = free.length ? free : AVATARS;
    this.players.push(this.makePlayer(name, pool[crypto.randomInt(pool.length)], true, 'lobby'));
    return undefined;
  }

  kick(by: string, target: string): { sockets: string[] } | string {
    if (by !== this.hostId) return "Seul l'hôte peut retirer un joueur.";
    if (this.phase !== 'lobby') return 'On ne peut retirer un joueur que dans le salon.';
    const p = this.get(target);
    if (!p || p.id === by) return 'Joueur introuvable.';
    this.players = this.players.filter((x) => x.id !== p.id);
    return { sockets: [...p.sockets] };
  }

  leave(id: string): void {
    const p = this.get(id);
    if (!p) return;
    p.sockets.clear();
    p.connected = false;
    p.disconnectedAt = Date.now();
    // En partie, sa place reste à la table : le pilote automatique la tient (il refuse les contacts et remplit son numéro).
    if (this.phase === 'lobby' || p.status === 'spectator') this.players = this.players.filter((x) => x.id !== id);
    else {
      p.left = true;
      // Le pilote automatique se voit dès ce départ : inutile de l'annoncer une seconde fois au prochain tic.
      if (this.phase === 'playing') this.autoSeen.add(id);
      const g = this.game;
      const out = g && this.phase === 'playing' ? g.outgoingOf(id) : undefined;
      if (g && out) {
        g.cancel(id);
        this.mark([out.to]);
      }
    }
    if (this.hostId === id) this.transferHost();
  }

  private transferHost(): void {
    const next = this.players.find((p) => !p.isBot && !p.left && p.connected) ?? this.players.find((p) => !p.isBot && !p.left);
    this.hostId = next?.id ?? '';
  }

  connect(p: Player, socketId: string): void {
    p.sockets.add(socketId);
    p.connected = true;
    p.left = false;
    this.autoSeen.delete(p.id);
    if (!this.hostId || !this.get(this.hostId) || this.get(this.hostId)?.left) this.hostId = p.id;
  }

  disconnect(id: string | undefined, socketId: string): void {
    const p = this.get(id);
    if (!p) return;
    p.sockets.delete(socketId);
    if (p.sockets.size === 0) {
      p.connected = false;
      p.disconnectedAt = Date.now();
    }
  }

  isAuto(p: Player): boolean {
    return p.isBot || p.left || (!p.connected && Date.now() - p.disconnectedAt >= GRACE_MS);
  }

  updateSettings(by: string, payload: Record<string, unknown>): string | undefined {
    if (by !== this.hostId) return "Seul l'hôte peut changer les réglages.";
    if (this.phase !== 'lobby') return 'Les réglages se changent dans le salon.';
    if (isDuration(payload.minutes)) this.settings.minutes = payload.minutes;
    if (isTalk(payload.talk)) this.settings.talk = payload.talk;
    return undefined;
  }

  // ───────────────────────────── Partie ─────────────────────────────

  start(by: string): string | undefined {
    if (by !== this.hostId) return "Seul l'hôte peut lancer la partie.";
    if (this.phase !== 'lobby') return 'La partie est déjà lancée.';
    const seated = this.seated;
    if (seated.length < MIN_PLAYERS) return `Il faut au moins ${MIN_PLAYERS} joueurs (ajoute des bots si besoin).`;
    for (const p of seated) p.status = 'playing';
    const order = shuffle(seated.map((p) => p.id));
    const spectators = this.players.filter((p) => p.status === 'spectator');
    this.players = [...order.map((id) => this.get(id)!), ...spectators];
    this.game = new Game(order);
    const now = Date.now();
    this.stageEndsAt = this.settings.minutes ? now + this.settings.minutes * T.minute : 0;
    this.skills.clear();
    this.brains.clear();
    this.botNext.clear();
    this.botReplies.clear();
    this.autoRefuse.clear();
    this.autoSeen.clear();
    for (const p of this.players) {
      if (!p.isBot || p.status !== 'playing') continue;
      this.skills.set(p.id, randomSkill());
      this.brains.set(p.id, new Brain(p.id));
      this.botNext.set(p.id, now + between(T.botFirst));
    }
    this.phase = 'playing';
    this.final = null;
    return undefined;
  }

  restart(by: string): string | undefined {
    if (by !== this.hostId) return "Seul l'hôte peut relancer une partie.";
    if (this.phase === 'lobby') return undefined;
    this.clearTimer();
    this.players = this.players.filter((p) => !p.left);
    let seats = 0;
    for (const p of this.players) {
      p.status = seats < MAX_PLAYERS ? 'lobby' : 'spectator';
      if (p.status === 'lobby') seats++;
    }
    this.phase = 'lobby';
    this.game = null;
    this.final = null;
    this.skills.clear();
    this.brains.clear();
    this.botNext.clear();
    this.botReplies.clear();
    this.autoRefuse.clear();
    return undefined;
  }

  endEarly(by: string): string | undefined {
    if (by !== this.hostId) return "Seul l'hôte peut arrêter la partie.";
    if (this.phase !== 'playing') return undefined;
    return this.restart(by);
  }

  private playing(by: string): Game | string {
    const g = this.game;
    if (this.phase !== 'playing' || !g) return "Aucune partie n'est en cours.";
    if (!g.has(by)) return 'Tu regardes la partie : tu joueras à la prochaine.';
    return g;
  }

  /** L'hôte ferme le standard avant l'heure : place au dernier appel. */
  closeBoard(by: string): Outcome {
    if (by !== this.hostId) return { error: "Seul l'hôte peut fermer le standard.", scope: [by] };
    const g = this.game;
    if (this.phase !== 'playing' || !g || g.stage !== 'open') return { scope: [by] };
    this.enterLast();
    return { scope: null };
  }

  ask(by: string, payload: Record<string, unknown>): Outcome {
    const g = this.playing(by);
    if (typeof g === 'string') return { error: g, scope: [by] };
    const to = String(payload.to ?? '');
    if (!isTicket(payload.type)) return { error: 'Ticket inconnu.', scope: [by] };
    const target = this.get(to);
    const res = g.ask(by, to, payload.type, Date.now() + T.request);
    if (typeof res === 'string') return { error: res, scope: [by] };
    if (res.contact) return { scope: this.afterContact(res.contact) };
    this.planReply(res.request!, target);
    return { scope: [by, to] };
  }

  answer(by: string, payload: Record<string, unknown>): Outcome {
    const g = this.playing(by);
    if (typeof g === 'string') return { error: g, scope: [by] };
    const res = g.answer(by, Number(payload.id), payload.accept === true);
    if (typeof res === 'string') return { error: res, scope: [by] };
    this.botReplies.delete(res.request.id);
    this.autoRefuse.delete(res.request.id);
    if (res.contact) return { scope: this.afterContact(res.contact) };
    if (payload.accept !== true) this.refused(res.request, by);
    return { scope: [by, res.request.from] };
  }

  cancel(by: string): Outcome {
    const g = this.playing(by);
    if (typeof g === 'string') return { error: g, scope: [by] };
    const r = g.cancel(by);
    if (typeof r === 'string') return { scope: [by] };
    this.botReplies.delete(r.id);
    this.autoRefuse.delete(r.id);
    return { scope: [by, r.to] };
  }

  buy(by: string): Outcome {
    const g = this.playing(by);
    if (typeof g === 'string') return { error: g, scope: [by] };
    const err = g.buy(by);
    return { error: err, scope: [by] };
  }

  give(by: string, payload: Record<string, unknown>): Outcome {
    const g = this.playing(by);
    if (typeof g === 'string') return { error: g, scope: [by] };
    if (!isTicket(payload.type)) return { error: 'Ticket inconnu.', scope: [by] };
    const to = String(payload.to ?? '');
    const err = g.give(by, to, payload.type);
    if (err) return { error: err, scope: [by] };
    // Un bot ne lit pas ses dons : on les range pour lui.
    if (this.get(to)?.isBot) g.gifts.get(to)!.length = 0;
    return { scope: [by, to] };
  }

  seen(by: string, payload: Record<string, unknown>): Outcome {
    const g = this.game;
    if (this.phase !== 'playing' || !g) return { scope: [by] };
    g.seen(by, payload.kind, payload.id);
    return { scope: [by] };
  }

  sheet(by: string, payload: Record<string, unknown>): Outcome {
    const g = this.playing(by);
    if (typeof g === 'string') return { error: g, scope: [by] };
    return { error: g.setAnswer(by, String(payload.target ?? ''), payload.value ?? null), scope: [by] };
  }

  notes(by: string, payload: Record<string, unknown>): Outcome {
    const g = this.playing(by);
    if (typeof g === 'string') return { error: g, scope: [by] };
    g.setNotes(by, payload.text);
    return { scope: [by] };
  }

  done(by: string, payload: Record<string, unknown>): Outcome {
    const g = this.playing(by);
    if (typeof g === 'string') return { error: g, scope: [by] };
    const err = g.setDone(by, payload.done === true);
    if (err) return { error: err, scope: [by] };
    this.maybeEnd();
    return { scope: null };
  }

  whisper(by: string, payload: Record<string, unknown>): Outcome {
    if (this.settings.talk !== 'ecrit') return { error: 'Les messages écrits sont coupés à cette table : on se parle à voix haute.', scope: [by] };
    const g = this.playing(by);
    if (typeof g === 'string') return { error: g, scope: [by] };
    const to = typeof payload.to === 'string' && payload.to ? payload.to : null;
    const err = g.whisper(by, to, payload.text, Date.now());
    if (err) return { error: err, scope: [by] };
    // Les spectateurs ne lisent pas les messages : rien ne change pour eux, ils ne reçoivent rien.
    return { scope: to ? [by, to] : [...g.order] };
  }

  /** Un contact a eu lieu : la ligne s'allume chez tout le monde, et les bots concernés retiennent le résultat. */
  private afterContact(c: Contact): null {
    const g = this.game!;
    const now = Date.now();
    g.addCord(c.a, c.b, now + T.cord);
    const code = codeOf(c);
    for (const [self, other] of [
      [c.a, c.b],
      [c.b, c.a],
    ]) {
      const brain = this.brains.get(self);
      if (!brain) continue;
      brain.learn(other, c.type, code, this.skills.get(self)!);
      // Un bot lit son résultat tout de suite : on ne garde rien pour lui.
      g.results.get(self)!.length = 0;
      g.notices.get(self)!.length = 0;
      // Il souffle un peu avant sa prochaine initiative.
      this.botNext.set(self, Math.max(this.botNext.get(self) ?? 0, now + between(T.botReply)));
    }
    if (!FAST && Math.random() < 0.18) {
      const bot = [c.a, c.b].find((id) => this.get(id)?.isBot);
      if (bot) setTimeout(() => this.onEmote(bot, pickOne(['🤫', '🫡', '🤔', '👀'])), 900 + crypto.randomInt(1200));
    }
    return null;
  }

  private refused(r: Request, by: string): void {
    const g = this.game!;
    const p = this.get(by);
    g.notify(r.from, `${p?.name ?? 'Ce joueur'} refuse le contact ${TICKET_NAME[r.type]}.`);
    const brain = this.brains.get(r.from);
    if (brain) {
      // Un refus veut souvent dire qu'il n'a plus ce ticket ; un humain qui refuse, on le laisse aussi souffler un moment.
      const now = Date.now();
      brain.snub.set(`${by}|${r.type}`, now + T.snub * 2);
      if (!p?.isBot) brain.snub.set(by, now + T.snub);
      g.notices.get(r.from)!.length = 0;
    }
  }

  /** Une demande vient d'arriver : un bot répondra bientôt, un absent ne répondra pas. */
  private planReply(r: Request, target: Player | undefined): void {
    if (!target) return;
    if (target.isBot) this.botReplies.set(r.id, Date.now() + between(T.botReply));
    else if (this.isAuto(target)) this.autoRefuse.set(r.id, Date.now() + T.autoRefuse);
  }

  /** Les humains présents ont tous rendu leur fiche (et au moins un est là) : on ramasse. */
  private maybeEnd(): void {
    const g = this.game;
    if (this.phase !== 'playing' || !g || g.stage === 'closing') return;
    const humans = g.order.map((id) => this.get(id)).filter((p): p is Player => !!p && !p.isBot);
    const present = humans.filter((p) => !this.isAuto(p));
    if (!present.length || present.some((p) => !g.done.has(p.id))) return;
    this.enterClosing();
  }

  private enterLast(): void {
    const g = this.game!;
    for (const r of g.close()) {
      this.botReplies.delete(r.id);
      this.autoRefuse.delete(r.id);
    }
    this.stageEndsAt = Date.now() + T.last;
    this.botNext.clear();
    this.mark(null);
    this.maybeEnd();
  }

  private enterClosing(): void {
    const g = this.game!;
    if (g.stage === 'open') g.close();
    g.stage = 'closing';
    this.stageEndsAt = Date.now() + T.closing;
    this.botNext.clear();
    this.botReplies.clear();
    this.autoRefuse.clear();
    this.mark(null);
  }

  /** Un bot prend une initiative : un contact qui lui apprendra quelque chose, un carnet de plus, ou il rend sa fiche. */
  private botAct(id: string, now: number): string[] | null | undefined {
    const g = this.game!;
    const brain = this.brains.get(id);
    const skill = this.skills.get(id);
    this.botNext.delete(id);
    if (!brain || !skill || !g.open || g.outgoingOf(id)) return undefined;
    const types = TICKETS.filter((t) => g.free(id, t) > 0);
    const busy = new Set<string>();
    for (const r of g.requests.values()) if (this.get(r.from)?.isBot) busy.add(r.to);
    const options = g.order
      .filter((o) => o !== id)
      .filter((o) => {
        const p = this.get(o);
        if (!p) return false;
        if (p.isBot) return true;
        // On ne harcèle pas un humain : une seule demande de bot à la fois, et jamais à un absent.
        return !this.isAuto(p) && !busy.has(o);
      })
      .map((o) => ({ to: o, types }));
    const sure = brain.guess().p;
    const best = types.length ? brain.bestAsk(options, now) : null;
    const pace = () => now + Math.round(between(skill.pace) * T.paceScale);
    if (best && best.gain > 0.05 && sure < 0.995) {
      const res = g.ask(id, best.to, best.type, now + T.request);
      this.botNext.set(id, pace());
      if (typeof res === 'string') return undefined;
      if (res.contact) return this.afterContact(res.contact);
      this.planReply(res.request!, this.get(best.to));
      return this.get(best.to)?.isBot ? undefined : [best.to];
    }
    const left = this.stageEndsAt ? this.stageEndsAt - now : Infinity;
    if (sure < 0.9 && (g.bought.get(id) ?? 0) < skill.maxBuy && left > 2 * T.minute) {
      g.buy(id);
      this.botNext.set(id, now + between(T.botReply));
      return undefined;
    }
    if (!g.done.has(id)) {
      g.setDone(id, true);
      return null;
    }
    return undefined;
  }

  /** La réponse d'un bot à une demande. */
  private botAnswer(requestId: number): string[] | null | undefined {
    const g = this.game!;
    const r = g.requests.get(requestId);
    if (!r) return undefined;
    const brain = this.brains.get(r.to);
    const skill = this.skills.get(r.to);
    const yes = !!brain && !!skill && g.free(r.to, r.type) > 0 && brain.wantsContact(r.from, r.type, skill);
    const res = g.answer(r.to, r.id, yes);
    if (typeof res === 'string') return undefined;
    if (res.contact) return this.afterContact(res.contact);
    this.refused(r, r.to);
    return this.get(r.from)?.isBot ? undefined : [r.from];
  }

  private finishGame(): void {
    const g = this.game;
    if (!g) return;
    // Les bots remplissent leur fiche ; un absent garde la sienne, et le pilote automatique écrit son numéro s'il manque.
    for (const id of g.order) {
      const p = this.get(id);
      if (!p) continue;
      const brain = this.brains.get(id);
      const skill = this.skills.get(id);
      if (p.isBot && brain && skill) {
        g.sheets.set(id, brain.sheet(g.order, skill));
        continue;
      }
      if (this.isAuto(p) && g.sheets.get(id)![id] === null) {
        const b = new Brain(id);
        for (const c of g.contacts) {
          if (c.a === id) b.learn(c.b, c.type, codeOf(c), AUTOPILOT);
          else if (c.b === id) b.learn(c.a, c.type, codeOf(c), AUTOPILOT);
        }
        g.sheets.get(id)![id] = b.guess().n;
      }
    }
    const rows = g.standings();
    for (const r of rows) if (r.place === 1) this.wins.set(r.id, (this.wins.get(r.id) ?? 0) + 1);
    this.final = {
      minutes: this.settings.minutes,
      contacts: g.contacts.map((c) => ({ ...c })),
      players: rows.map((r) => {
        const p = this.get(r.id);
        return {
          id: r.id,
          name: p?.name ?? '?',
          avatar: p?.avatar ?? AVATARS[0],
          seat: g.order.indexOf(r.id) + 1,
          number: r.number,
          sheet: r.sheet,
          score: r.score,
          place: r.place,
          wins: this.wins.get(r.id) ?? 0,
          winner: r.place === 1,
          left: !!p?.left,
        };
      }),
    };
    this.phase = 'finished';
    this.clearTimer();
  }

  // ───────────────────────────── Minuteries et diffusion ─────────────────────────────

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Note qui doit recevoir sa vue : null, tout le monde. */
  mark(scope: string[] | null): void {
    if (scope === null) this.dirtyAll = true;
    else for (const id of scope) this.dirty.add(id);
  }

  /** À appeler après chaque changement : planifie la prochaine échéance puis envoie l'état à ceux qui doivent le recevoir. */
  commit(scope: string[] | null = null): void {
    this.mark(scope);
    this.reschedule();
    const all = this.dirtyAll;
    const few = [...this.dirty];
    this.dirtyAll = false;
    this.dirty.clear();
    if (all) this.onChange();
    else for (const id of few) this.onPrivate(id);
  }

  private dueAt(): number {
    const g = this.game;
    if (this.phase !== 'playing' || !g) return Infinity;
    let due = this.stageEndsAt || Infinity;
    for (const r of g.requests.values()) due = Math.min(due, r.endsAt);
    for (const c of g.cords) due = Math.min(due, c.until);
    for (const at of this.botNext.values()) due = Math.min(due, at);
    for (const at of this.botReplies.values()) due = Math.min(due, at);
    for (const at of this.autoRefuse.values()) due = Math.min(due, at);
    // Un absent qui bascule en pilote automatique : tout le monde le voit, et il ne doit plus faire attendre la table.
    const now = Date.now();
    for (const id of g.order) {
      const p = this.get(id);
      if (p && !p.isBot && !p.left && !p.connected && p.disconnectedAt + GRACE_MS > now) due = Math.min(due, p.disconnectedAt + GRACE_MS);
    }
    return due;
  }

  private reschedule(): void {
    this.clearTimer();
    const due = this.dueAt();
    if (!Number.isFinite(due)) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      try {
        this.tick();
      } catch (e) {
        console.error(`[room ${this.code}]`, e);
      }
      this.commit([]);
    }, Math.max(0, Math.min(due - Date.now(), 2_147_000_000)));
  }

  /** Fait avancer la table et note qui doit l'apprendre. */
  tick(): void {
    const g = this.game;
    if (this.phase !== 'playing' || !g) return;
    const now = Date.now();
    if (g.dropCords(now)) this.mark(null);

    // Un joueur passe en pilote automatique : tout le monde voit l'icône ; ses demandes reçues seront refusées.
    for (const id of g.order) {
      const p = this.get(id);
      if (!p || p.isBot) continue;
      const auto = this.isAuto(p);
      if (auto !== this.autoSeen.has(id)) {
        if (auto) this.autoSeen.add(id);
        else this.autoSeen.delete(id);
        this.mark(null);
      }
      if (auto) for (const r of g.incomingOf(id)) if (!this.autoRefuse.has(r.id)) this.autoRefuse.set(r.id, now + T.autoRefuse);
    }

    for (const r of g.expire(now)) {
      this.botReplies.delete(r.id);
      this.autoRefuse.delete(r.id);
      const p = this.get(r.to);
      g.notify(r.from, `${p?.name ?? 'Ce joueur'} n’a pas répondu.`);
      if (this.brains.has(r.from)) {
        g.notices.get(r.from)!.length = 0;
        this.brains.get(r.from)!.snub.set(r.to, now + T.snub);
      }
      this.mark([r.from, r.to]);
    }

    for (const [id, at] of [...this.autoRefuse]) {
      if (at > now) continue;
      this.autoRefuse.delete(id);
      const r = g.requests.get(id);
      if (!r) continue;
      g.answer(r.to, id, false);
      const p = this.get(r.to);
      g.notify(r.from, `${p?.name ?? 'Ce joueur'} est absent : pas de réponse.`);
      if (this.brains.has(r.from)) {
        g.notices.get(r.from)!.length = 0;
        this.brains.get(r.from)!.snub.set(r.to, now + T.snub);
      }
      this.mark([r.from, r.to]);
    }

    if (g.open) {
      for (const [id, at] of [...this.botReplies]) {
        if (at > now) continue;
        this.botReplies.delete(id);
        const scope = this.botAnswer(id);
        if (scope !== undefined) this.mark(scope);
      }
      for (const [id, at] of [...this.botNext]) {
        if (at > now || !g.open) continue;
        const scope = this.botAct(id, now);
        if (scope !== undefined) this.mark(scope);
      }
    }

    if (this.stageEndsAt && now >= this.stageEndsAt) {
      if (g.stage === 'open') this.enterLast();
      else if (g.stage === 'last') this.enterClosing();
      else if (g.stage === 'closing') this.finishGame();
      this.mark(null);
    }
    this.maybeEnd();
  }

  dispose(): void {
    this.clearTimer();
  }

  // ───────────────────────────── Vue personnalisée ─────────────────────────────

  private gameView(g: Game, viewerId: string): GameView {
    const seated = g.has(viewerId);
    const out = seated ? g.outgoingOf(viewerId) : undefined;
    return {
      order: [...g.order],
      stage: g.stage,
      endsAt: this.stageEndsAt,
      cords: g.cords.map(({ id, a, b }) => ({ id, a, b })),
      me: seated
        ? {
            tickets: { ...g.tickets.get(viewerId)! },
            bought: g.bought.get(viewerId) ?? 0,
            outgoing: out ? { ...out } : null,
            incoming: g.incomingOf(viewerId).map((r) => ({ ...r })),
            results: g.results.get(viewerId)!.map((r) => ({ ...r })),
            gifts: g.gifts.get(viewerId)!.map((x) => ({ ...x })),
            notices: g.notices.get(viewerId)!.map((x) => ({ ...x })),
            sheet: { ...g.sheets.get(viewerId)! },
            notes: g.notes.get(viewerId) ?? '',
            inbox: this.settings.talk === 'ecrit' ? g.inbox.get(viewerId)!.map((w) => ({ ...w })) : [],
          }
        : null,
    };
  }

  viewFor(viewerId: string): RoomView {
    const g = this.phase === 'playing' ? this.game : null;
    return {
      code: this.code,
      phase: this.phase,
      me: viewerId,
      hostId: this.hostId,
      settings: { ...this.settings },
      players: this.players.map((p) => {
        const seat = g ? g.order.indexOf(p.id) : -1;
        return {
          id: p.id,
          name: p.name,
          avatar: p.avatar,
          isBot: p.isBot,
          isHost: p.id === this.hostId,
          connected: p.isBot || p.connected,
          autopilot: !p.isBot && p.status === 'playing' && this.isAuto(p),
          status: p.status,
          wins: this.wins.get(p.id) ?? 0,
          seat: seat >= 0 ? seat + 1 : null,
          done: !!g && g.done.has(p.id),
        };
      }),
      game: g ? this.gameView(g, viewerId) : null,
      final: this.final,
      serverNow: Date.now(),
    };
  }
}

function pickOne<T>(arr: T[]): T {
  return arr[crypto.randomInt(arr.length)];
}
