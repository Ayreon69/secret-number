// Serveur temps réel : HTTP (santé + client compilé) et Socket.IO pour les tables.
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server, type Socket } from 'socket.io';
import { AVATARS, EMOTES, MAX_PLAYERS, TAUNTS, type Ack } from '../shared/protocol';
import { RoomManager } from './manager';
import type { Outcome, Room } from './room';

const PORT = Number(process.env.PORT) || 3260;
const startedAt = Date.now();

const app = express();
app.disable('x-powered-by');
app.get('/health', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, rooms: manager.size, uptime: Math.round((Date.now() - startedAt) / 1000) });
});

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.resolve(here, '../client');
if (fs.existsSync(path.join(clientDir, 'index.html'))) {
  app.use('/assets', express.static(path.join(clientDir, 'assets'), { maxAge: '30d', immutable: true }));
  app.use(express.static(clientDir, { maxAge: '1h', index: false }));
  app.get('*', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(clientDir, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => res.type('text').send('Serveur Secret Number en ligne.'));
}

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingInterval: 20_000,
  pingTimeout: 25_000,
});

const pending = new Set<Room>();
function broadcast(room: Room): void {
  if (pending.has(room)) return;
  pending.add(room);
  queueMicrotask(() => {
    pending.delete(room);
    const sockets = io.sockets.adapter.rooms.get(room.code);
    if (!sockets) return;
    for (const sid of sockets) {
      const s = io.sockets.sockets.get(sid);
      const pid = s?.data.playerId as string | undefined;
      if (s && pid) s.emit('state', room.viewFor(pid));
    }
  });
}

/** Sa vue à un seul joueur, sur chacun de ses appareils. */
function sendTo(room: Room, playerId: string): void {
  const p = room.get(playerId);
  if (!p) return;
  for (const sid of p.sockets) io.sockets.sockets.get(sid)?.emit('state', room.viewFor(playerId));
}

const manager = new RoomManager((room) => {
  room.onChange = () => broadcast(room);
  room.onPrivate = (playerId) => sendTo(room, playerId);
  room.onEmote = (playerId, emoji) => io.to(room.code).emit('emote', { playerId, emoji });
});

function cleanName(input: unknown): string {
  const raw = typeof input === 'string' ? input : '';
  const name = raw.replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  return name || `Joueur ${Math.floor(Math.random() * 90 + 10)}`;
}

function cleanAvatar(input: unknown): string {
  return typeof input === 'string' && (AVATARS as readonly string[]).includes(input)
    ? input
    : AVATARS[Math.floor(Math.random() * AVATARS.length)];
}

io.on('connection', (socket: Socket) => {
  let lastEmote = 0;

  const bind = (room: Room, playerId: string) => {
    const previous = socket.data.code as string | undefined;
    if (previous && previous !== room.code) {
      const old = manager.get(previous);
      old?.disconnect(socket.data.playerId, socket.id);
      socket.leave(previous);
      old?.commit();
    }
    socket.data.code = room.code;
    socket.data.playerId = playerId;
    socket.join(room.code);
    const p = room.get(playerId);
    if (p) room.connect(p, socket.id);
    room.touch();
    room.commit();
  };

  const context = (): { room: Room; playerId: string } | null => {
    const room = manager.get(socket.data.code);
    const playerId = socket.data.playerId as string | undefined;
    if (!room || !playerId || !room.get(playerId)) return null;
    return { room, playerId };
  };

  const on = (event: string, handler: (room: Room, playerId: string, payload: Record<string, unknown>) => string | undefined | void) => {
    socket.on(event, (payload: unknown, ack?: Ack) => {
      const reply: Ack = typeof ack === 'function' ? ack : () => {};
      const ctx = context();
      if (!ctx) return reply({ ok: false, error: "Tu n'es plus à cette table." });
      try {
        const err = handler(ctx.room, ctx.playerId, (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>);
        ctx.room.touch();
        // Un refus ne change rien : inutile de réveiller toute la table pour rien.
        ctx.room.commit(err ? [ctx.playerId] : null);
        reply(err ? { ok: false, error: err } : { ok: true });
      } catch (e) {
        console.error(`[${event}]`, e);
        reply({ ok: false, error: 'Erreur inattendue du serveur.' });
      }
    });
  };

  socket.on('room:create', (payload: Record<string, unknown> | undefined, ack?: Ack) => {
    const reply: Ack = typeof ack === 'function' ? ack : () => {};
    const room = manager.create();
    const player = room.addHuman(cleanName(payload?.name), cleanAvatar(payload?.avatar));
    if (typeof player === 'string') return reply({ ok: false, error: player });
    room.hostId = player.id;
    const bots = Math.max(0, Math.min(MAX_PLAYERS - 1, Number(payload?.bots) || 0));
    for (let i = 0; i < bots; i++) room.addBot(player.id);
    if (payload?.autostart === true && bots > 0) room.start(player.id);
    bind(room, player.id);
    reply({ ok: true, data: { code: room.code, playerId: player.id, token: player.token } });
  });

  socket.on('room:join', (payload: Record<string, unknown> | undefined, ack?: Ack) => {
    const reply: Ack = typeof ack === 'function' ? ack : () => {};
    const room = manager.get(payload?.code);
    if (!room) return reply({ ok: false, error: 'Table introuvable : vérifie le code (elle a peut-être expiré).' });
    let player = room.findByToken(payload?.playerId, payload?.token);
    if (!player) {
      if (payload?.resumeOnly === true) return reply({ ok: false, error: 'Session expirée.' });
      const created = room.addHuman(cleanName(payload?.name), cleanAvatar(payload?.avatar));
      if (typeof created === 'string') return reply({ ok: false, error: created });
      player = created;
    }
    bind(room, player.id);
    reply({ ok: true, data: { code: room.code, playerId: player.id, token: player.token } });
  });

  on('room:leave', (room, playerId) => {
    room.leave(playerId);
    socket.leave(room.code);
    socket.data.code = undefined;
    socket.data.playerId = undefined;
  });

  on('room:settings', (room, playerId, payload) => room.updateSettings(playerId, payload));
  on('room:addBot', (room, playerId) => room.addBot(playerId));
  on('room:kick', (room, playerId, payload) => {
    const res = room.kick(playerId, String(payload.playerId ?? ''));
    if (typeof res === 'string') return res;
    for (const sid of res.sockets) {
      const s = io.sockets.sockets.get(sid);
      if (!s) continue;
      s.emit('kicked');
      s.leave(room.code);
      s.data.code = undefined;
      s.data.playerId = undefined;
    }
    return undefined;
  });
  on('game:start', (room, playerId) => room.start(playerId));
  on('game:restart', (room, playerId) => room.restart(playerId));
  on('game:end', (room, playerId) => room.endEarly(playerId));

  // Les gestes de la partie : chacun dit qui doit recevoir sa nouvelle vue (un geste privé ne réveille pas toute la table).
  const act = (event: string, handler: (room: Room, playerId: string, payload: Record<string, unknown>) => Outcome) => {
    socket.on(event, (payload: unknown, ack?: Ack) => {
      const reply: Ack = typeof ack === 'function' ? ack : () => {};
      const ctx = context();
      if (!ctx) return reply({ ok: false, error: "Tu n'es plus à cette table." });
      try {
        const body = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
        const res = handler(ctx.room, ctx.playerId, body);
        ctx.room.touch();
        ctx.room.commit(res.error ? [ctx.playerId] : res.scope === undefined ? null : res.scope);
        reply(res.error ? { ok: false, error: res.error } : { ok: true });
      } catch (e) {
        console.error(`[${event}]`, e);
        reply({ ok: false, error: 'Erreur inattendue du serveur.' });
      }
    });
  };

  act('contact:ask', (room, playerId, payload) => room.ask(playerId, payload));
  act('contact:answer', (room, playerId, payload) => room.answer(playerId, payload));
  act('contact:cancel', (room, playerId) => room.cancel(playerId));
  act('ticket:buy', (room, playerId) => room.buy(playerId));
  act('ticket:give', (room, playerId, payload) => room.give(playerId, payload));
  act('seen', (room, playerId, payload) => room.seen(playerId, payload));
  act('sheet', (room, playerId, payload) => room.sheet(playerId, payload));
  act('notes', (room, playerId, payload) => room.notes(playerId, payload));
  act('done', (room, playerId, payload) => room.done(playerId, payload));
  act('whisper', (room, playerId, payload) => room.whisper(playerId, payload));
  act('game:close', (room, playerId) => room.closeBoard(playerId));

  socket.on('emote', (payload: Record<string, unknown> | undefined) => {
    const ctx = context();
    const emoji = payload?.emoji;
    const allowed = [...EMOTES, ...TAUNTS] as readonly string[];
    if (!ctx || typeof emoji !== 'string' || !allowed.includes(emoji)) return;
    const now = Date.now();
    if (now - lastEmote < 1000) return;
    lastEmote = now;
    io.to(ctx.room.code).emit('emote', { playerId: ctx.playerId, emoji });
  });

  socket.on('disconnect', () => {
    const ctx = context();
    if (!ctx) return;
    ctx.room.disconnect(ctx.playerId, socket.id);
    ctx.room.commit();
  });
});

server.listen(PORT, () => {
  console.log(`Secret Number : serveur prêt sur le port ${PORT}`);
});
