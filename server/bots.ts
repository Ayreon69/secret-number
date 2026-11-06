// Les bots de Secret Number. Un bot ne sait que ce qu'un joueur saurait : les résultats de ses propres contacts.
// Il en tire, pour chaque numéro possible, la chance que ce soit le sien (et celui de chaque partenaire),
// puis choisit le contact qui lui en apprendra le plus. Il calcule, lui : c'est son droit, pas celui de l'interface.
import crypto from 'node:crypto';
import { HIGH, LOW, TICKETS, contact, type Range, type Ticket } from '../shared/protocol';

const SPAN = HIGH + 1;

/** Le code d'un résultat : la valeur, ou -1 et -2 pour les fourchettes de la somme. */
export function codeOf(r: { value: number; range: Range }): number {
  return r.range === 'low' ? -1 : r.range === 'high' ? -2 : r.value;
}

/** Tous les résultats possibles, calculés une fois : TABLE[t][x * 101 + y]. */
const TABLE = Object.fromEntries(
  TICKETS.map((t) => {
    const arr = new Int16Array(SPAN * SPAN);
    for (let x = LOW; x <= HIGH; x++) for (let y = LOW; y <= HIGH; y++) if (x !== y) arr[x * SPAN + y] = codeOf(contact(t, x, y));
    return [t, arr];
  }),
) as Record<Ticket, Int16Array>;

export interface Skill {
  name: 'novice' | 'habile' | 'expert';
  /** La chance d'oublier un résultat. */
  forget: number;
  /** Combien de carnets il veut bien acheter. */
  maxBuy: number;
  /** Le délai entre deux initiatives, en millisecondes. */
  pace: [number, number];
  /** À partir de quelle certitude il écrit le numéro d'un autre sur sa fiche. */
  dare: number;
  /** La chance d'accepter un contact qui ne lui apprend rien. */
  kindness: number;
}

export const SKILLS: Skill[] = [
  { name: 'novice', forget: 0.15, maxBuy: 1, pace: [16_000, 40_000], dare: 0.4, kindness: 0.7 },
  { name: 'habile', forget: 0.05, maxBuy: 2, pace: [12_000, 30_000], dare: 0.55, kindness: 0.45 },
  { name: 'expert', forget: 0, maxBuy: 3, pace: [9_000, 24_000], dare: 0.6, kindness: 0.25 },
];

/** Le pilote automatique d'un absent : il ne fait que remplir son propre numéro, sans rien oublier. */
export const AUTOPILOT: Skill = { name: 'expert', forget: 0, maxBuy: 0, pace: [60_000, 60_000], dare: 2, kindness: 0 };

export function randomSkill(): Skill {
  return SKILLS[crypto.randomInt(SKILLS.length)];
}

/** Le numéro le plus probable ; à égalité, un au hasard (sinon on pencherait toujours vers les petits numéros). */
function argmax(p: Float64Array): number {
  let best = -1;
  let ties: number[] = [];
  for (let x = LOW; x <= HIGH; x++) {
    if (p[x] > best + 1e-12) {
      best = p[x];
      ties = [x];
    } else if (Math.abs(p[x] - best) <= 1e-12) ties.push(x);
  }
  return ties[Math.floor(Math.random() * ties.length)] ?? LOW;
}

function entropy(p: Float64Array, total: number): number {
  if (total <= 0) return 0;
  let h = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[i] / total;
    if (q > 0) h -= q * Math.log2(q);
  }
  return h;
}

interface Obs {
  type: Ticket;
  code: number;
}

export interface Posterior {
  /** La chance de chaque numéro pour soi (indices 1 à 100). */
  px: Float64Array;
  /** Pour chaque partenaire déjà contacté : les couples (x, y) compatibles, et leur nombre pour chaque x. */
  ok: Map<string, Uint8Array>;
  count: Map<string, Float64Array>;
}

export class Brain {
  readonly self: string;
  readonly obs = new Map<string, Obs[]>();
  /**
   * Ceux qui ont refusé récemment, et jusqu'à quand on les laisse tranquilles : « id » pour le joueur entier,
   * « id|ticket » pour un ticket (un refus veut souvent dire qu'il ne l'a plus).
   */
  readonly snub = new Map<string, number>();
  private cache: Posterior | null = null;

  constructor(self: string) {
    this.self = self;
  }

  learn(partner: string, type: Ticket, code: number, skill: Skill): void {
    if (skill.forget > 0 && Math.random() < skill.forget) return;
    const list = this.obs.get(partner) ?? [];
    list.push({ type, code });
    this.obs.set(partner, list);
    this.cache = null;
  }

  posterior(): Posterior {
    if (this.cache) return this.cache;
    const px = new Float64Array(SPAN);
    for (let x = LOW; x <= HIGH; x++) px[x] = 1;
    const ok = new Map<string, Uint8Array>();
    const count = new Map<string, Float64Array>();
    for (const [p, list] of this.obs) {
      const m = new Uint8Array(SPAN * SPAN);
      const c = new Float64Array(SPAN);
      for (let x = LOW; x <= HIGH; x++) {
        let n = 0;
        for (let y = LOW; y <= HIGH; y++) {
          if (x === y) continue;
          let good = true;
          for (const o of list) {
            if (TABLE[o.type][x * SPAN + y] !== o.code) {
              good = false;
              break;
            }
          }
          if (good) {
            m[x * SPAN + y] = 1;
            n++;
          }
        }
        c[x] = n;
        px[x] *= n / (HIGH - LOW);
      }
      ok.set(p, m);
      count.set(p, c);
    }
    let total = 0;
    for (let x = LOW; x <= HIGH; x++) total += px[x];
    if (total <= 0) for (let x = LOW; x <= HIGH; x++) px[x] = 1 / (HIGH - LOW + 1);
    else for (let x = LOW; x <= HIGH; x++) px[x] /= total;
    this.cache = { px, ok, count };
    return this.cache;
  }

  /** Le numéro le plus probable pour soi, et sa chance. */
  guess(): { n: number; p: number } {
    const { px } = this.posterior();
    const n = argmax(px);
    return { n, p: px[n] };
  }

  /** La chance de chaque numéro pour un partenaire. */
  partner(p: string): Float64Array {
    const post = this.posterior();
    const q = new Float64Array(SPAN);
    const m = post.ok.get(p);
    const c = post.count.get(p);
    for (let x = LOW; x <= HIGH; x++) {
      const w = post.px[x];
      if (w <= 0) continue;
      if (!m || !c) {
        for (let y = LOW; y <= HIGH; y++) if (y !== x) q[y] += w / (HIGH - LOW);
        continue;
      }
      if (c[x] <= 0) continue;
      for (let y = LOW; y <= HIGH; y++) if (m[x * SPAN + y]) q[y] += w / c[x];
    }
    return q;
  }

  /** Ce qu'un contact avec ce partenaire et ce ticket apprendrait, en bits : sur soi d'abord, sur lui un peu. */
  gain(p: string, type: Ticket): number {
    const post = this.posterior();
    const m = post.ok.get(p);
    const c = post.count.get(p);
    const table = TABLE[type];
    // Une case par résultat possible (de -2 à 199) : la répartition de x, et celle de y, sachant ce résultat.
    const jx = new Map<number, Float64Array>();
    const jy = new Map<number, Float64Array>();
    const mass = new Map<number, number>();
    for (let x = LOW; x <= HIGH; x++) {
      const w = post.px[x];
      if (w <= 0) continue;
      const n = c ? c[x] : HIGH - LOW;
      if (n <= 0) continue;
      const share = w / n;
      for (let y = LOW; y <= HIGH; y++) {
        if (y === x || (m && !m[x * SPAN + y])) continue;
        const v = table[x * SPAN + y];
        let ax = jx.get(v);
        if (!ax) {
          ax = new Float64Array(SPAN);
          jx.set(v, ax);
          jy.set(v, new Float64Array(SPAN));
        }
        ax[x] += share;
        jy.get(v)![y] += share;
        mass.set(v, (mass.get(v) ?? 0) + share);
      }
    }
    const before = entropy(post.px, 1);
    const qy = this.partner(p);
    const beforeY = entropy(qy, 1);
    let afterX = 0;
    let afterY = 0;
    for (const [v, pv] of mass) {
      afterX += pv * entropy(jx.get(v)!, pv);
      afterY += pv * entropy(jy.get(v)!, pv);
    }
    return Math.max(0, before - afterX) + 0.25 * Math.max(0, beforeY - afterY);
  }

  /** Le meilleur contact à proposer parmi ceux possibles. */
  bestAsk(options: { to: string; types: Ticket[] }[], now: number): { to: string; type: Ticket; gain: number } | null {
    let best: { to: string; type: Ticket; gain: number } | null = null;
    for (const o of options) {
      if ((this.snub.get(o.to) ?? 0) > now) continue;
      for (const type of o.types) {
        if ((this.snub.get(`${o.to}|${type}`) ?? 0) > now) continue;
        // Un peu de hasard : deux bots de même niveau ne jouent pas exactement pareil.
        const g = this.gain(o.to, type) * (0.9 + Math.random() * 0.2);
        if (!best || g > best.gain) best = { to: o.to, type, gain: g };
      }
    }
    return best;
  }

  /** Accepter une demande ? Oui si elle lui apprend quelque chose ; sinon par gentillesse, parfois. */
  wantsContact(from: string, type: Ticket, skill: Skill): boolean {
    if (this.gain(from, type) > 0.08) return true;
    return Math.random() < skill.kindness;
  }

  /** Sa fiche : son propre numéro toujours (une case vide compte faux), ceux des autres quand il en est assez sûr. */
  sheet(order: string[], skill: Skill): Record<string, number | null> {
    const out: Record<string, number | null> = {};
    for (const id of order) {
      if (id === this.self) {
        out[id] = this.guess().n;
        continue;
      }
      if (!this.obs.has(id)) {
        out[id] = null;
        continue;
      }
      const q = this.partner(id);
      const n = argmax(q);
      out[id] = q[n] >= skill.dare ? n : null;
    }
    return out;
  }
}
