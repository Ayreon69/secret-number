// Test de bout en bout sur le serveur compilé, en mode accéléré (SN_FAST=1 : une minute de partie dure une seconde).
// Partie 1 : 4 humains (socket.io) + 2 bots, 10 minutes, messages écrits. Une spectatrice arrive en route, Bob se
//   déconnecte puis reprend sa place, Chloé quitte la table (pilote automatique), Dan ne fait rien du tout.
// Partie 2 : revanche à 10 (la table pleine), sans limite de temps, à voix haute : elle finit quand chaque humain a rendu sa fiche.
// Les humains jouent au hasard : demandes, réponses, achats, dons, fiche, notes, messages.
// À chaque état reçu, on vérifie qu'aucune information cachée ne fuit, ni par son contenu ni par son seul envoi ;
// à la fin, que chaque résultat et chaque score découlent des numéros dévoilés. Usage : npm run build && npm run e2e
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { io } from 'socket.io-client';

const PORT = 3900 + Math.floor(Math.random() * 90);
const URL = `http://localhost:${PORT}`;
const server = spawn(process.execPath, ['dist/server/index.mjs'], {
  env: { ...process.env, PORT: String(PORT), SN_FAST: '1' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  server.kill();
  process.exit(1);
};
setTimeout(() => fail('délai dépassé (3 min)'), 180_000).unref();
await new Promise((resolve) => server.stdout.on('data', (d) => String(d).includes('prêt') && resolve()));

// ───────────── Recopié des règles, pour ne pas dépendre du code testé ─────────────
const TICKETS = ['plus', 'fois', 'divise', 'zero'];
function zeros(a, b) {
  let n = 0;
  for (let k = Math.min(a, b) + 1; k < Math.max(a, b); k++) n += [...String(k)].filter((ch) => ch === '0').length;
  return n;
}
function rule(type, a, b) {
  if (type === 'plus') {
    const s = a + b;
    return s <= 20 ? { value: 0, range: 'low' } : s >= 180 ? { value: 0, range: 'high' } : { value: s, range: null };
  }
  if (type === 'fois') return { value: (a * b) % 10, range: null };
  if (type === 'divise') return { value: Math.floor(Math.max(a, b) / Math.min(a, b)), range: null };
  return { value: zeros(a, b), range: null };
}

const PLAYER_KEYS = 'autopilot,avatar,connected,done,id,isBot,isHost,name,seat,status,wins';
const GAME_KEYS = 'cords,endsAt,me,order,stage';
const ME_KEYS = 'bought,gifts,inbox,incoming,notes,notices,outgoing,results,sheet,tickets';
const stats = { states: 0, gestures: 0, refused: new Map(), contacts: 0, expired: 0, gifts: 0, whispers: 0 };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const keys = (o) => Object.keys(o).sort().join(',');
const num = () => 1 + Math.floor(Math.random() * 100);

function client(name, { avatar = 'valise', mode = 'actif' } = {}) {
  const socket = io(URL, { transports: ['websocket'], forceNew: true });
  const c = { name, socket, avatar, mode, view: null, session: null, inFlight: 0, actedAt: 0, busy: false, hold: false };
  c.reset = () => {
    c.results = [];
    c.resultIds = new Set();
    c.gifts = [];
    c.incomingSeen = new Map();
    c.buys = 0;
    c.lastSheet = null;
    c.finishAt = 0;
  };
  c.reset();
  socket.on('state', (v) => {
    const prev = c.view;
    c.view = v;
    audit(c, prev, v);
    void play(c);
  });
  socket.on('disconnect', () => (c.view = null));
  c.call = (event, payload = {}) => {
    c.inFlight++;
    c.actedAt = performance.now();
    stats.gestures++;
    return new Promise((res) =>
      socket.emit(event, payload, (r) => {
        c.inFlight--;
        c.actedAt = performance.now();
        if (!r.ok) stats.refused.set(r.error, (stats.refused.get(r.error) ?? 0) + 1);
        if (r.error === 'Erreur inattendue du serveur.') fail(`${event} : erreur du serveur`);
        res(r);
      }),
    );
  };
  c.timer = setInterval(() => void play(c), 90);
  return c;
}

const connected = (c) => new Promise((r) => (c.socket.connected ? r() : c.socket.once('connect', r)));
async function waitFor(what, test, ms = 4000) {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    if (test()) return;
    await pause(15);
  }
  fail(`attente trop longue : ${what}`);
}

/** Ce que voit le client, sans l'heure du serveur. */
const shown = (v) => JSON.stringify({ ...v, serverNow: 0 });

function audit(c, prev, v) {
  stats.states++;
  const json = JSON.stringify(v);
  for (const word of ['"token"', '"numbers"', '"number"', '"skill', '"brain', '"snub', '"until"', '"botNext"']) {
    if (word === '"number"' && v.final) continue;
    if (json.includes(word)) fail(`la vue de ${c.name} contient ${word}`);
  }
  // En partie, un état qui n'apporte rien de neuf trahit un geste caché : il n'arrive qu'à celui qui vient d'agir.
  if (prev?.phase === 'playing' && v.phase === 'playing' && shown(prev) === shown(v) && c.inFlight === 0 && performance.now() - c.actedAt > 40) {
    fail(`${c.name} reçoit un état sans rien de neuf (${v.phase}${v.game ? `, ${v.game.stage}` : ''})`);
  }
  for (const p of v.players) if (keys(p) !== PLAYER_KEYS) fail(`un joueur vu avec ${keys(p)}`);
  if (v.phase !== 'finished' && v.final) fail('un tableau final avant la fin');
  if (v.phase !== 'playing') {
    if (v.game) fail('une partie visible hors jeu');
    if (v.players.some((p) => p.seat !== null || p.done)) fail('un siège ou une fiche rendue hors jeu');
    return;
  }
  const g = v.game;
  if (!g || keys(g) !== GAME_KEYS) fail(`partie illisible pour ${c.name}`);
  const seated = g.order.includes(v.me);
  if (!!g.me !== seated) fail(`${c.name} : « me » ne suit pas le siège`);
  for (const p of v.players) {
    const i = g.order.indexOf(p.id);
    if (i >= 0 ? p.seat !== i + 1 || p.status !== 'playing' : p.seat !== null || p.done || p.status !== 'spectator') fail(`siège faux pour ${p.name}`);
  }
  for (const cord of g.cords) if (keys(cord) !== 'a,b,id' || !g.order.includes(cord.a) || !g.order.includes(cord.b)) fail('une ligne illisible');
  const me = g.me;
  if (!me) return;
  if (keys(me) !== ME_KEYS) fail(`« me » contient ${keys(me)}`);
  for (const t of TICKETS) if (!Number.isInteger(me.tickets[t]) || me.tickets[t] < 0) fail(`${c.name} a ${me.tickets[t]} tickets ${t}`);
  if (me.outgoing && (me.outgoing.from !== v.me || me.outgoing.to === v.me)) fail(`${c.name} voit la demande d'un autre`);
  for (const r of me.incoming) {
    if (r.to !== v.me || r.from === v.me || !g.order.includes(r.from)) fail(`${c.name} voit une demande qui ne lui est pas adressée`);
    if (!c.incomingSeen.has(r.id)) c.incomingSeen.set(r.id, r);
  }
  for (const r of me.results) {
    if (r.with === v.me || !g.order.includes(r.with)) fail(`${c.name} voit le résultat d'un autre`);
    if (r.range && r.value !== 0) fail('une fourchette laisse passer la vraie somme');
    if (!c.resultIds.has(r.id)) {
      c.resultIds.add(r.id);
      c.results.push({ ...r });
    }
  }
  for (const x of me.gifts) if (x.from === v.me) fail(`${c.name} se fait un don`);
  for (const x of me.gifts) if (!c.gifts.some((y) => y.id === x.id)) c.gifts.push({ ...x });
  if (keys(me.sheet) !== [...g.order].sort().join(',')) fail(`${c.name} : la fiche ne suit pas la table`);
  for (const n of Object.values(me.sheet)) if (n !== null && (!Number.isInteger(n) || n < 1 || n > 100)) fail(`fiche : ${n}`);
  if (v.settings.talk === 'voix' && me.inbox.length) fail('des messages écrits à une table à voix haute');
  for (const w of me.inbox) if (w.from !== v.me && w.to !== v.me && w.to !== null) fail(`${c.name} lit un message qui ne lui est pas adressé`);
  if (g.stage !== 'closing') c.lastSheet = { ...me.sheet };
}

/** Un humain au hasard : il répond, demande, achète, donne, écrit sa fiche, ses notes et des messages. */
async function play(c) {
  if (c.busy || c.hold || c.mode !== 'actif') return;
  const v = c.view;
  const g = v?.game;
  if (!v || v.phase !== 'playing' || !g?.me || g.stage === 'closing') return;
  c.busy = true;
  try {
    await pause(Math.random() * 30);
    if (c.view === v || c.view?.game?.me) await decide(c, c.view, c.view.game, c.view.game.me);
  } finally {
    c.busy = false;
  }
}

async function decide(c, v, g, me) {
  const others = g.order.filter((id) => id !== v.me);
  const myself = v.players.find((p) => p.id === v.me);
  // En fin de partie : son propre numéro, puis la fiche rendue.
  if (g.stage === 'last' || (c.finishAt && performance.now() > c.finishAt)) {
    if (me.sheet[v.me] === null) return c.call('sheet', { target: v.me, value: num() });
    if (c.finishAt && !myself.done) return c.call('done', { done: true });
    return;
  }
  if (me.incoming.length) return c.call('contact:answer', { id: me.incoming[0].id, accept: Math.random() < 0.75 });
  if (me.results.length && Math.random() < 0.6) return c.call('seen', { kind: 'result', id: me.results[0].id });
  if (me.gifts.length) return c.call('seen', { kind: 'gift', id: me.gifts[0].id });
  if (me.notices.length) return c.call('seen', { kind: 'notice', id: me.notices[0].id });
  const roll = Math.random();
  if (!me.outgoing && roll < 0.45) {
    const types = TICKETS.filter((t) => me.tickets[t] > 0);
    if (types.length) return c.call('contact:ask', { to: pick(others), type: pick(types) });
    if (c.buys < 2) {
      const res = await c.call('ticket:buy');
      if (res.ok) c.buys++;
      return;
    }
  }
  if (me.outgoing && roll < 0.06) return c.call('contact:cancel');
  if (roll < 0.5) {
    const free = TICKETS.filter((t) => me.tickets[t] - (me.outgoing?.type === t ? 1 : 0) > 0);
    if (free.length) {
      const res = await c.call('ticket:give', { to: pick(others), type: pick(free) });
      if (res.ok) stats.gifts++;
      return;
    }
  }
  if (roll < 0.65) return c.call('sheet', { target: pick(others), value: Math.random() < 0.15 ? null : num() });
  if (roll < 0.72) return c.call('notes', { text: `${me.notes}\n${pick(TICKETS)} : ${num()}`.slice(-400) });
  if (roll < 0.76 && v.settings.talk === 'ecrit') {
    const res = await c.call('whisper', { to: Math.random() < 0.5 ? pick(others) : null, text: `Alliance ? ${num()}` });
    if (res.ok) stats.whispers++;
  }
}

/** Le tableau dévoilé : les résultats suivent les numéros, les scores et le classement aussi. */
function checkFinal(final, n, humans) {
  if (!final || final.players.length !== n) fail(`${final?.players.length} joueurs au tableau final, ${n} attendus`);
  const P = new Map(final.players.map((p) => [p.id, p]));
  const numbers = final.players.map((p) => p.number);
  if (new Set(numbers).size !== n || numbers.some((x) => !Number.isInteger(x) || x < 1 || x > 100)) fail(`numéros invalides : ${numbers}`);
  const seats = final.players.map((p) => p.seat).sort((a, b) => a - b);
  if (seats.join(',') !== Array.from({ length: n }, (_, i) => i + 1).join(',')) fail('sièges du tableau final faux');
  for (const k of final.contacts) {
    const a = P.get(k.a);
    const b = P.get(k.b);
    if (!a || !b || a === b || !TICKETS.includes(k.type)) fail(`contact illisible : ${JSON.stringify(k)}`);
    const want = rule(k.type, a.number, b.number);
    if (want.value !== k.value || want.range !== k.range) fail(`contact ${k.type} ${a.number}/${b.number} : ${k.value} au lieu de ${want.value}`);
  }
  stats.contacts += final.contacts.length;
  // Chaque résultat reçu par un humain est un contact du tableau, et il a reçu tous les siens.
  for (const c of humans) {
    if (!c.stayed) continue;
    const mine = final.contacts.filter((k) => k.a === c.session.playerId || k.b === c.session.playerId);
    if (mine.length !== c.results.length) fail(`${c.name} a reçu ${c.results.length} résultats pour ${mine.length} contacts`);
    for (const r of c.results) {
      const k = mine.find((x) => x.type === r.type && (x.a === r.with || x.b === r.with) && x.value === r.value && x.range === r.range);
      if (!k) fail(`${c.name} a reçu un résultat absent du tableau : ${JSON.stringify(r)}`);
      mine.splice(mine.indexOf(k), 1);
    }
  }
  // Les scores, recalculés.
  for (const p of final.players) {
    const own = p.sheet[p.id] === p.number ? 5 : -5;
    let right = 0;
    let wrong = 0;
    for (const o of final.players) {
      if (o.id === p.id || p.sheet[o.id] === null) continue;
      if (p.sheet[o.id] === o.number) right++;
      else wrong++;
    }
    const bonus = own > 0 && right === n - 1 ? 5 : 0;
    const found = final.players.filter((o) => o.id !== p.id && o.sheet[p.id] === p.number).length;
    const s = p.score;
    if (s.own !== own || s.right !== right || s.wrong !== wrong || s.bonus !== bonus || s.found !== found) fail(`score faux pour ${p.name} : ${JSON.stringify(s)}`);
    if (s.total !== own + right - wrong + bonus - found - s.bought) fail(`total faux pour ${p.name}`);
    const place = 1 + final.players.filter((o) => o.score.total > s.total).length;
    if (p.place !== place || p.winner !== (place === 1)) fail(`place fausse pour ${p.name}`);
  }
  // La fiche dévoilée est celle que chacun avait remplie ; le pilote automatique écrit le numéro d'un absent.
  for (const c of humans) {
    const p = P.get(c.session.playerId);
    if (!p || !c.lastSheet) fail(`${c.name} absent du tableau final`);
    if (p.score.bought !== c.buys) fail(`${c.name} a acheté ${c.buys} carnets, ${p.score.bought} comptés`);
    for (const [id, x] of Object.entries(c.lastSheet)) {
      if (c.left && id === p.id) continue;
      if (p.sheet[id] !== x) fail(`la fiche de ${c.name} a changé au ramassage`);
    }
    if (c.left && p.sheet[p.id] === null) fail(`le pilote automatique n'a pas écrit le numéro de ${c.name}`);
  }
  const ranked = [...final.players].sort((a, b) => a.place - b.place);
  return { winner: ranked[0], winners: ranked.filter((p) => p.winner).length };
}

// ───────────── Partie 1 : 4 humains + 2 bots, 10 minutes, messages écrits ─────────────
const ana = client('Ana', { avatar: 'renard' });
await connected(ana);
if ((await ana.call('contact:ask', { to: 'x', type: 'plus' })).ok) fail('un geste accepté sans table');
const created = await ana.call('room:create', { name: 'Ana', avatar: 'renard' });
if (!created.ok) fail(`création : ${created.error}`);
ana.session = created.data;
const code = created.data.code;
if ((await ana.call('game:start')).ok) fail('une partie lancée seule');
const bob = client('Bob', { avatar: 'chat' });
const chloe = client('Chloé', { avatar: 'hibou' });
const dan = client('Dan', { avatar: 'velo', mode: 'passif' });
for (const c of [bob, chloe, dan]) {
  await connected(c);
  const res = await c.call('room:join', { code, name: c.name, avatar: c.avatar });
  if (!res.ok) fail(`arrivée de ${c.name} : ${res.error}`);
  c.session = res.data;
}
if ((await bob.call('contact:ask', { to: ana.session.playerId, type: 'plus' })).ok) fail('une demande acceptée dans le salon');
if ((await bob.call('room:settings', { minutes: 30 })).ok) fail('un invité a changé les réglages');
if ((await bob.call('game:start')).ok) fail('un invité a lancé la partie');
await ana.call('room:settings', { minutes: 7, talk: 'morse' });
await pause(80);
if (ana.view.settings.minutes !== 15 || ana.view.settings.talk !== 'voix') fail('des réglages inconnus ont été acceptés');
if (!(await ana.call('room:settings', { minutes: 10, talk: 'ecrit' })).ok) fail('réglages refusés');
for (let i = 0; i < 2; i++) if (!(await ana.call('room:addBot')).ok) fail('ajout de bot refusé');
await waitFor('les réglages', () => ana.view?.settings.minutes === 10 && ana.view.settings.talk === 'ecrit' && ana.view.players.length === 6);
const heard = new Promise((r) => bob.socket.once('emote', r));
ana.socket.emit('emote', { emoji: '🤫' });
if ((await heard).emoji !== '🤫') fail('réaction perdue');
if (!(await ana.call('game:start')).ok) fail('lancement refusé');
await waitFor('la partie', () => [ana, bob, chloe, dan].every((c) => c.view?.phase === 'playing'));
const t0 = performance.now();
if (ana.view.game.order.length !== 6) fail('6 joueurs attendus');

// Une spectatrice arrive : elle voit le plan, sans siège ni fiche, et ne peut rien faire.
await pause(250);
const eve = client('Ève', { avatar: 'cafe', mode: 'passif' });
await connected(eve);
const joined = await eve.call('room:join', { code, name: 'Ève', avatar: 'cafe' });
if (!joined.ok) fail(`spectatrice : ${joined.error}`);
eve.session = joined.data;
await waitFor('la vue de la spectatrice', () => eve.view?.game && eve.view.game.me === null);
if ((await eve.call('contact:ask', { to: ana.session.playerId, type: 'plus' })).ok) fail('la spectatrice a demandé un contact');
if ((await eve.call('whisper', { to: null, text: 'coucou' })).ok) fail('la spectatrice a écrit à la table');

// Un don et un message secret : seuls les deux concernés le savent.
ana.hold = bob.hold = true;
await waitFor('le calme', () => !ana.busy && !bob.busy && ana.inFlight === 0 && bob.inFlight === 0);
const gift = await ana.call('ticket:give', { to: bob.session.playerId, type: TICKETS.find((t) => ana.view.game.me.tickets[t] - (ana.view.game.me.outgoing?.type === t ? 1 : 0) > 0) ?? 'zero' });
if (gift.ok) await waitFor('le don', () => bob.gifts.some((x) => x.from === ana.session.playerId));
if (gift.ok) stats.gifts++;
if (!(await ana.call('whisper', { to: bob.session.playerId, text: 'rien que pour toi' })).ok) fail('message secret refusé');
await waitFor('le message secret', () => bob.view.game.me.inbox.some((w) => w.text === 'rien que pour toi'));
await pause(80);
if (dan.view.game.me.inbox.some((w) => w.text === 'rien que pour toi')) fail('Dan lit un message secret');

// Bob note quelque chose, se déconnecte, puis reprend sa place : fiche et notes sont toujours là.
const someone = bob.view.game.order.find((id) => id !== bob.session.playerId);
if (!(await bob.call('sheet', { target: someone, value: 42 })).ok) fail('fiche refusée');
if (!(await bob.call('notes', { text: 'Plus avec Ana : 87' })).ok) fail('notes refusées');
if ((await bob.call('sheet', { target: someone, value: 101 })).ok) fail('un numéro hors de 1 à 100 accepté');
ana.hold = false;
bob.socket.disconnect();
await waitFor('Bob absent', () => ana.view.players.find((p) => p.name === 'Bob')?.connected === false);
await pause(300);
bob.socket.connect();
await connected(bob);
const back = await bob.call('room:join', { code, playerId: bob.session.playerId, token: bob.session.token, resumeOnly: true });
if (!back.ok) fail(`retour de Bob : ${back.error}`);
await waitFor('la vue de Bob', () => bob.view?.game?.me);
if (bob.view.game.me.sheet[someone] !== 42) fail('la fiche de Bob a été perdue');
if (!bob.view.game.me.notes.startsWith('Plus avec Ana')) fail('les notes de Bob ont été perdues');
const intruder = await chloe.call('room:join', { code, playerId: bob.session.playerId, token: 'faux', resumeOnly: true });
if (intruder.ok) fail('une session volée a été acceptée');
bob.hold = false;

// Chloé quitte la table : le pilote automatique tient sa place et refuse ce qu'on lui demande.
await pause(400);
chloe.hold = true;
await waitFor('le calme de Chloé', () => !chloe.busy && chloe.inFlight === 0);
chloe.left = true;
await chloe.call('room:leave');
clearInterval(chloe.timer);
await waitFor('le pilote automatique', () => ana.view.players.find((p) => p.name === 'Chloé')?.autopilot === true);
ana.hold = true;
await waitFor('le calme d’Ana', () => !ana.busy && ana.inFlight === 0);
// Un bot peut encore accepter la demande d'Ana au même instant : on recommence avec l'état à jour.
let asked = false;
for (let k = 0; k < 4 && !asked; k++) {
  await pause(60);
  if (ana.view.game.me.outgoing) await ana.call('contact:cancel');
  if (!TICKETS.some((t) => ana.view.game.me.tickets[t] > 0) && (await ana.call('ticket:buy')).ok) ana.buys++;
  await pause(60);
  const type = TICKETS.find((t) => ana.view.game.me.tickets[t] > 0);
  asked = !!type && (await ana.call('contact:ask', { to: chloe.session.playerId, type })).ok;
}
if (!asked) fail('demande à Chloé refusée');
await waitFor('le refus du pilote automatique', () => ana.view.game.me.notices.some((x) => /Chloé est absent/.test(x.text)));
ana.hold = false;

await waitFor('la fin de la partie 1', () => ana.view?.phase === 'finished', 20_000);
const secs1 = ((performance.now() - t0) / 1000).toFixed(1);
for (const c of [ana, bob, dan]) c.stayed = true;
const r1 = checkFinal(ana.view.final, 6, [ana, bob, chloe, dan]);
// Dan ne répond jamais : les demandes qu'il a reçues sont tombées d'elles-mêmes, sans contact.
if (dan.results.length) fail('Dan a un résultat sans avoir rien accepté ni demandé');
stats.expired = dan.incomingSeen.size;
await waitFor('le même tableau partout', () => [bob, dan, eve].every((c) => JSON.stringify(c.view?.final) === JSON.stringify(ana.view.final)));
if (!ana.view.players.some((p) => p.wins === 1)) fail('la victoire n’est pas comptée');

// ───────────── Partie 2 : revanche à 10, sans limite, à voix haute ─────────────
if ((await bob.call('game:restart')).ok) fail('un invité a relancé la partie');
if (!(await ana.call('game:restart')).ok) fail('revanche refusée');
await waitFor('le salon', () => ana.view.phase === 'lobby' && !ana.view.final);
if (ana.view.players.some((p) => p.name === 'Chloé')) fail('Chloé, partie, est encore à la table');
for (const c of [ana, bob, dan, eve]) c.reset();
dan.mode = eve.mode = 'actif';
for (let i = 0; i < 4; i++) if (!(await ana.call('room:addBot')).ok) fail('ajout de bot refusé');
await waitFor('10 joueurs au salon', () => ana.view.players.filter((p) => p.status !== 'spectator').length === 10);
if ((await ana.call('room:addBot')).ok) fail('un onzième joueur a été accepté');
if (!(await ana.call('room:settings', { minutes: 0, talk: 'voix' })).ok) fail('réglages de la revanche refusés');
await waitFor('les réglages de la revanche', () => ana.view.settings.minutes === 0 && ana.view.settings.talk === 'voix');
if (!(await ana.call('game:start')).ok) fail('lancement de la revanche refusé');
await waitFor('la revanche', () => [ana, bob, dan, eve].every((c) => c.view?.phase === 'playing' && c.view.game.me));
const t1 = performance.now();
if (ana.view.game.endsAt !== 0) fail('une partie sans limite a une heure de fin');
if ((await bob.call('whisper', { to: null, text: 'psst' })).ok) fail('un message écrit à une table à voix haute');
if ((await bob.call('game:close')).ok) fail('un invité a fermé le standard');
// Au bout de 3 secondes, chacun écrit son numéro et rend sa fiche : la partie se termine sans attendre l'heure.
for (const c of [ana, bob, dan, eve]) c.finishAt = performance.now() + 2500 + Math.random() * 1000;
await waitFor('la fin de la revanche', () => ana.view?.phase === 'finished', 20_000);
const secs2 = ((performance.now() - t1) / 1000).toFixed(1);
for (const c of [ana, bob, dan, eve]) c.stayed = true;
const r2 = checkFinal(ana.view.final, 10, [ana, bob, dan, eve]);

// L'hôte s'en va : la table passe à un autre humain.
await ana.call('room:leave');
await waitFor('le nouvel hôte', () => bob.view.hostId !== ana.session.playerId && [bob, dan, eve].some((c) => c.session.playerId === bob.view.hostId));

const line = (r, n, secs) => `${n} joueurs, ${secs} s ; ${r.winners > 1 ? `${r.winners} ex æquo` : `${r.winner.name} gagne`} avec ${r.winner.score.total} points`;
console.log(`✓ partie 1 : ${line(r1, 6, secs1)}.`);
console.log(`✓ partie 2 : ${line(r2, 10, secs2)}.`);
const refusals = [...stats.refused].map(([k, n]) => `${n} × « ${k} »`).join(' ; ');
console.log(`  ${stats.contacts} contacts vérifiés, ${stats.gifts} dons, ${stats.whispers} messages, ${stats.expired} demandes laissées sans réponse par Dan ;`);
console.log(`  ${stats.gestures} gestes, ${stats.states} états vérifiés.`);
console.log(`  Refus attendus : ${refusals || 'aucun'}.`);
for (const c of [ana, bob, chloe, dan, eve]) {
  clearInterval(c.timer);
  c.socket.close();
}
server.kill();
process.exit(0);
