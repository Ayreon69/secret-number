// Simulation : des parties entières entre bots, sans horloge, pour juger leur niveau (npx tsx test/sim.ts 200 [joueurs]).
// Chaque tour, chaque bot prend une initiative comme sur le serveur : le contact qui lui apprend le plus, un carnet, ou sa fiche.
// Le joueur « naïf » sert de référence : contacts au hasard, il accepte tout, n'achète jamais et n'écrit que son numéro.
import { TICKETS, type Ticket } from '../shared/protocol';
import { Brain, SKILLS, codeOf, type Skill } from '../server/bots';
import { Game } from '../server/game';

const N = Number(process.argv[2] ?? 100);
const ONLY = process.argv[3] ? Number(process.argv[3]) : null;
/** Un tour : chacun prend une initiative. Une partie de 15 minutes en laisse une quarantaine aux bots les plus vifs. */
const TURNS = 30;

type Kind = Skill | 'naif';
const KINDS: Kind[] = [...SKILLS, 'naif'];
const label = (k: Kind) => (k === 'naif' ? 'naïf' : k.name);

interface Tally {
  games: number;
  total: number;
  own: number;
  wins: number;
  contacts: number;
  bought: number;
  right: number;
  wrong: number;
}
const tally = new Map<string, Tally>(KINDS.map((k) => [label(k), { games: 0, total: 0, own: 0, wins: 0, contacts: 0, bought: 0, right: 0, wrong: 0 }]));

const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)];

let totalContacts = 0;
for (let i = 0; i < N; i++) {
  const n = ONLY ?? 4 + Math.floor(Math.random() * 7);
  const order = Array.from({ length: n }, (_, k) => `p${k}`);
  const kinds = new Map(order.map((id) => [id, pick(KINDS)]));
  const g = new Game(order);
  const brains = new Map(order.map((id) => [id, new Brain(id)]));
  const done = new Set<string>();
  const skillOf = (id: string): Skill => {
    const k = kinds.get(id)!;
    return k === 'naif' ? { name: 'novice', forget: 0, maxBuy: 0, pace: [0, 0], dare: 2, kindness: 1 } : k;
  };
  const accept = (to: string, from: string, type: Ticket): boolean => {
    if (g.free(to, type) <= 0) return false;
    if (kinds.get(to) === 'naif') return true;
    return brains.get(to)!.wantsContact(from, type, skillOf(to));
  };
  let turn = 0;
  const meet = (from: string, to: string, type: Ticket) => {
    const r = g.ask(from, to, type, Infinity);
    if (typeof r === 'string' || !r.request) return;
    const res = g.answer(to, r.request.id, accept(to, from, type));
    if (typeof res === 'string') return;
    // Comme sur le serveur : après un refus, on ne redemande pas ce ticket à ce joueur avant un moment.
    if (!res.contact) {
      brains.get(from)!.snub.set(`${to}|${type}`, turn + 6);
      return;
    }
    const c = res.contact;
    brains.get(c.a)!.learn(c.b, c.type, codeOf(c), skillOf(c.a));
    brains.get(c.b)!.learn(c.a, c.type, codeOf(c), skillOf(c.b));
  };

  for (turn = 0; turn < TURNS; turn++) {
    for (const id of [...order].sort(() => Math.random() - 0.5)) {
      if (done.has(id)) continue;
      const types = TICKETS.filter((t) => g.free(id, t) > 0);
      const others = order.filter((o) => o !== id);
      if (kinds.get(id) === 'naif') {
        if (types.length) meet(id, pick(others), pick(types));
        else done.add(id);
        continue;
      }
      const brain = brains.get(id)!;
      const skill = skillOf(id);
      const best = types.length ? brain.bestAsk(others.map((to) => ({ to, types })), turn) : null;
      if (best && best.gain > 0.05 && brain.guess().p < 0.995) meet(id, best.to, best.type);
      else if (brain.guess().p < 0.9 && (g.bought.get(id) ?? 0) < skill.maxBuy && turn < TURNS - 4) g.buy(id);
      else done.add(id);
    }
  }

  for (const id of order) {
    const sheet = kinds.get(id) === 'naif' ? { ...g.sheets.get(id)!, [id]: brains.get(id)!.guess().n } : brains.get(id)!.sheet(order, skillOf(id));
    g.sheets.set(id, sheet);
  }
  totalContacts += g.contacts.length;
  for (const r of g.standings()) {
    const t = tally.get(label(kinds.get(r.id)!))!;
    t.games++;
    t.total += r.score.total;
    if (r.score.own > 0) t.own++;
    if (r.place === 1) t.wins++;
    t.contacts += g.contacts.filter((c) => c.a === r.id || c.b === r.id).length;
    t.bought += r.bought;
    t.right += r.score.right;
    t.wrong += r.score.wrong;
  }
}

console.log(`${N} parties${ONLY ? ` à ${ONLY}` : ' de 4 à 10 joueurs'}, ${(totalContacts / N).toFixed(1)} contacts par partie en moyenne.\n`);
console.log('niveau    score moyen  son numéro  victoires  contacts  carnets  autres justes/faux');
for (const [name, t] of tally) {
  if (!t.games) continue;
  const f = (x: number, d = 1) => (x / t.games).toFixed(d);
  console.log(
    `${name.padEnd(9)} ${f(t.total).padStart(11)}  ${`${((t.own / t.games) * 100).toFixed(0)} %`.padStart(10)}  ${`${((t.wins / t.games) * 100).toFixed(0)} %`.padStart(9)}  ${f(t.contacts).padStart(8)}  ${f(t.bought, 2).padStart(7)}  ${f(t.right)} / ${f(t.wrong)}`,
  );
}
