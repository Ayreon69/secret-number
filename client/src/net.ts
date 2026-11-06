// Connexion temps réel : socket unique, reprise de session après coupure, actions de jeu.
import { io } from 'socket.io-client';
import type { RoomView } from '../../shared/protocol';
import { useStore, type Session } from './store';

const serverUrl = (import.meta.env.VITE_SERVER_URL as string | undefined) || undefined;
export const socket = io(serverUrl ?? '', { transports: ['websocket', 'polling'], reconnectionDelayMax: 4000 });

type Res<T> = { ok: boolean; error?: string; data?: T };

export function call<T = unknown>(event: string, payload: Record<string, unknown> = {}): Promise<Res<T>> {
  return new Promise((resolve) => {
    if (!socket.connected) {
      resolve({ ok: false, error: 'Connexion au serveur en cours… réessaie dans un instant.' });
      return;
    }
    socket.timeout(10_000).emit(event, payload, (err: Error | null, res: Res<T>) => {
      if (err) resolve({ ok: false, error: 'Le serveur ne répond pas.' });
      else resolve(res ?? { ok: false, error: 'Réponse vide.' });
    });
  });
}

/** Envoie une action et affiche l'erreur éventuelle. */
export async function send(event: string, payload: Record<string, unknown> = {}): Promise<boolean> {
  const res = await call(event, payload);
  if (!res.ok && res.error) useStore.getState().showToast(res.error);
  return res.ok;
}

function setUrl(code: string | null): void {
  const target = code ? `/t/${code}` : '/';
  if (window.location.pathname === target) return;
  window.history.replaceState(null, '', target);
  window.dispatchEvent(new Event('sn:url'));
}

export function codeFromUrl(): string | null {
  const m = window.location.pathname.match(/^\/t\/([A-Za-z]{4})\/?$/);
  return m ? m[1].toUpperCase() : null;
}

function adopt(data: Session | undefined): void {
  if (!data) return;
  useStore.getState().setSession({ code: data.code, playerId: data.playerId, token: data.token });
  setUrl(data.code);
}

export async function createRoom(opts: { bots?: number; autostart?: boolean } = {}): Promise<boolean> {
  const { profile } = useStore.getState();
  const res = await call<Session>('room:create', { name: profile.name, avatar: profile.avatar, ...opts });
  if (!res.ok) {
    useStore.getState().showToast(res.error ?? 'Impossible de créer la table.');
    return false;
  }
  adopt(res.data);
  return true;
}

export async function joinRoom(code: string): Promise<boolean> {
  const { profile, session } = useStore.getState();
  const same = session && session.code === code.toUpperCase() ? session : null;
  const res = await call<Session>('room:join', {
    code,
    name: profile.name,
    avatar: profile.avatar,
    playerId: same?.playerId,
    token: same?.token,
  });
  if (!res.ok) {
    useStore.getState().showToast(res.error ?? 'Impossible de rejoindre.');
    return false;
  }
  adopt(res.data);
  return true;
}

export async function leaveRoom(): Promise<void> {
  await call('room:leave');
  const st = useStore.getState();
  st.setSession(null);
  st.setView(null);
  setUrl(null);
}

let resuming = false;
async function resume(): Promise<void> {
  const { session } = useStore.getState();
  if (!session || resuming) return;
  const urlCode = codeFromUrl();
  if (urlCode && urlCode !== session.code) {
    // Lien d'invitation vers une autre table : on oublie l'ancienne session.
    useStore.getState().setSession(null);
    return;
  }
  resuming = true;
  const res = await call<Session>('room:join', { ...session, resumeOnly: true });
  resuming = false;
  if (!res.ok) {
    const st = useStore.getState();
    st.setSession(null);
    st.setView(null);
    if (codeFromUrl() === session.code) setUrl(null);
    st.showToast(`La table ${session.code} n'existe plus (serveur redémarré ou partie expirée). Crée-en une nouvelle !`, 'info');
  } else adopt(res.data);
}

socket.on('connect', () => {
  useStore.getState().setConn('online');
  void resume();
});
socket.on('disconnect', () => useStore.getState().setConn('offline'));
socket.io.on('reconnect_attempt', () => {
  if (useStore.getState().conn !== 'online') useStore.getState().setConn(useStore.getState().everConnected ? 'offline' : 'connecting');
});

socket.on('state', (view: RoomView) => useStore.getState().setView(view));
socket.on('emote', (e: { playerId: string; emoji: string }) => useStore.getState().pushEmote(e));
socket.on('kicked', () => {
  const st = useStore.getState();
  st.setSession(null);
  st.setView(null);
  setUrl(null);
  st.showToast("L'hôte t'a retiré de la table.", 'info');
});

// Garde le serveur éveillé pendant une partie (hébergement gratuit qui s'endort sans trafic).
setInterval(() => {
  if (useStore.getState().view) void fetch('/health', { cache: 'no-store' }).catch(() => undefined);
}, 4 * 60_000);
