// Accueil : un tableau d'affichage qui montre les quatre tickets ; pseudo + avatar, créer / rejoindre une table, jouer contre des bots, règles.
import { motion } from 'framer-motion';
import { BookOpen, Bot, House, LogIn, MessageSquare, Minus, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { AVATARS, MAX_PLAYERS, MIN_PLAYERS, type Ticket } from '../../../shared/protocol';
import { AVATAR_EMOJI, AVATAR_LABELS, Backdrop, Button, Flaps, Logo, TicketStub } from '../components/Ui';
import { cls, reducedMotion } from '../lib/util';
import { codeFromUrl, createRoom, joinRoom } from '../net';
import { useStore } from '../store';

const BOTS_KEY = 'sn.bots';
const MAX_BOTS = MAX_PLAYERS - 1;
const MIN_BOTS = MIN_PLAYERS - 1;

function savedBots(): number {
  try {
    const n = Number(localStorage.getItem(BOTS_KEY));
    return n >= MIN_BOTS && n <= MAX_BOTS ? n : 5;
  } catch {
    return 5;
  }
}

/** Les exemples du tableau : deux voyageurs, leurs numéros (que le joueur, lui, ne verrait jamais) et ce qu'ils apprennent. */
const DEMO: { type: Ticket; a: string; b: string; calc: string; out: string }[] = [
  { type: 'plus', a: 'LÉA', b: 'SAM', calc: '33 + 22', out: '55' },
  { type: 'fois', a: 'ZINO', b: 'INÈS', calc: '33 × 22 = 726', out: '6' },
  { type: 'divise', a: 'SAM', b: 'NOÉ', calc: '89 ÷ 22 = 4,04', out: '4' },
  { type: 'zero', a: 'INÈS', b: 'LÉA', calc: '50, 60, 70, 80', out: '4' },
];

/** Le tableau de l'accueil : ton numéro, à jamais « ?? », et un contact qui change toutes les trois secondes. */
function HeroBoard() {
  const still = reducedMotion();
  const [i, setI] = useState(0);
  useEffect(() => {
    if (still) return;
    const t = window.setInterval(() => setI((x) => (x + 1) % DEMO.length), 3200);
    return () => window.clearInterval(t);
  }, [still]);
  const d = DEMO[i];
  return (
    <div className="hero-board" aria-hidden>
      <div className="hb-row is-mine">
        <span className="hb-label">Ton numéro</span>
        <Flaps text="??" size="lg" spin={false} />
      </div>
      <div className="hb-rule" />
      <div className="hb-row">
        <span className="hb-label">Contact</span>
        <motion.span key={`t${i}`} className="hb-ticket" initial={{ x: -14, opacity: 0 }} animate={{ x: 0, opacity: 1 }}>
          <TicketStub type={d.type} size="sm" />
        </motion.span>
      </div>
      <div className="hb-row is-who">
        <Flaps text={d.a.padEnd(4, ' ')} size="sm" />
        <span className="hb-and">et</span>
        <Flaps text={d.b.padEnd(4, ' ')} size="sm" />
        <span className="hb-arrow">→</span>
        <Flaps text={d.out.padStart(2, ' ')} size="md" className="hb-out" />
      </div>
      <p className="hb-calc">
        <span key={`c${i}`}>{d.calc}</span>
      </p>
    </div>
  );
}

export function Home() {
  const profile = useStore((s) => s.profile);
  const setProfile = useStore((s) => s.setProfile);
  const setRulesOpen = useStore((s) => s.setRulesOpen);
  const conn = useStore((s) => s.conn);
  const [invited, setInvited] = useState(codeFromUrl);
  const [code, setCode] = useState('');
  const [bots, setBots] = useState(savedBots);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    const sync = () => setInvited(codeFromUrl());
    window.addEventListener('sn:url', sync);
    return () => window.removeEventListener('sn:url', sync);
  }, []);
  const nameOk = profile.name.trim().length > 0;

  const run = async (key: string, fn: () => Promise<boolean>) => {
    if (busy) return;
    if (!nameOk) {
      useStore.getState().showToast('Choisis d’abord un pseudo.', 'info');
      document.getElementById('pseudo')?.focus();
      return;
    }
    setBusy(key);
    await fn();
    setBusy(null);
  };

  const changeBots = (d: number) => {
    const n = Math.max(MIN_BOTS, Math.min(MAX_BOTS, bots + d));
    setBots(n);
    try {
      localStorage.setItem(BOTS_KEY, String(n));
    } catch {
      /* stockage indisponible */
    }
  };

  const cleanCode = code.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 4);

  return (
    <Backdrop className="home">
      <div className="home-links">
        <a className="all-games" href="https://akhis-games.onrender.com">
          <House size={16} aria-hidden /> Tous les jeux
        </a>
        <a className="all-games" href="https://akhis-games.onrender.com/feedback.html?jeu=secret-number">
          <MessageSquare size={16} aria-hidden /> Feedback
        </a>
      </div>
      <header className="home-hero">
        <motion.div initial={{ y: -14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.5 }}>
          <Logo size="lg" />
        </motion.div>
        <p className="tagline">
          Ton numéro entre 1 et 100 est <b>secret, même pour toi</b>. Fais des <b>contacts à deux</b>, recoupe, négocie ou mens, et trouve-le avant la fin.
        </p>
        <HeroBoard />
      </header>

      <motion.section className="panel home-panel" initial={{ y: 26, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.15, duration: 0.45 }}>
        {invited && (
          <div className="invite-banner">
            Invitation à la table <b>{invited}</b> : choisis ton pseudo et entre !
          </div>
        )}
        <label className="field-label" htmlFor="pseudo">
          Ton pseudo
        </label>
        <input
          id="pseudo"
          className="input input-lg"
          placeholder="Ex. Bastille"
          value={profile.name}
          maxLength={16}
          autoComplete="nickname"
          onChange={(e) => setProfile({ name: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && invited) void run('join', () => joinRoom(invited));
          }}
        />
        <span className="field-label" id="avatar-label">
          Ton avatar
        </span>
        <div className="avatar-picker" role="radiogroup" aria-labelledby="avatar-label">
          {AVATARS.map((a) => (
            <button key={a} type="button" role="radio" aria-checked={profile.avatar === a} aria-label={AVATAR_LABELS[a]} className={cls('avatar-opt', profile.avatar === a && 'is-on')} onClick={() => setProfile({ avatar: a })}>
              {AVATAR_EMOJI[a]}
            </button>
          ))}
        </div>

        {invited ? (
          <div className="home-actions">
            <Button variant="primary" className="btn-lg" icon={<LogIn size={20} />} disabled={!!busy} onClick={() => run('join', () => joinRoom(invited))}>
              {busy === 'join' ? 'Connexion…' : `Rejoindre la table ${invited}`}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                window.history.replaceState(null, '', '/');
                setInvited(null);
              }}
            >
              Créer ma propre table à la place
            </Button>
          </div>
        ) : (
          <div className="home-actions">
            <Button variant="primary" className="btn-lg" icon={<Plus size={20} />} disabled={!!busy} onClick={() => run('create', () => createRoom())}>
              {busy === 'create' ? 'Création…' : 'Créer une table'}
            </Button>
            <div className="join-row">
              <input
                className="input code-input"
                placeholder="CODE"
                value={cleanCode}
                maxLength={4}
                aria-label="Code de la table"
                autoCapitalize="characters"
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && cleanCode.length === 4) void run('join', () => joinRoom(cleanCode));
                }}
              />
              <Button icon={<LogIn size={18} />} disabled={cleanCode.length !== 4 || !!busy} onClick={() => run('join', () => joinRoom(cleanCode))}>
                Rejoindre
              </Button>
            </div>
            <div className="bots-row">
              <Button className="bots-go" icon={<Bot size={18} />} disabled={!!busy} onClick={() => run('bots', () => createRoom({ bots, autostart: true }))}>
                {busy === 'bots' ? 'Préparation…' : `Jouer contre ${bots} bot${bots > 1 ? 's' : ''}`}
              </Button>
              <div className="stepper" role="group" aria-label="Nombre de bots">
                <button type="button" className="icon-btn" aria-label="Un bot de moins" disabled={bots <= MIN_BOTS} onClick={() => changeBots(-1)}>
                  <Minus size={16} />
                </button>
                <button type="button" className="icon-btn" aria-label="Un bot de plus" disabled={bots >= MAX_BOTS} onClick={() => changeBots(1)}>
                  <Plus size={16} />
                </button>
              </div>
            </div>
          </div>
        )}
        <Button variant="ghost" className="rules-link" icon={<BookOpen size={18} />} onClick={() => setRulesOpen(true)}>
          Les règles en 2 minutes
        </Button>
        {conn !== 'online' && (
          <p className="wake-note" role="status">
            <span className="spinner" /> Réveil du serveur… (jusqu'à une minute la première fois)
          </p>
        )}
      </motion.section>

      <footer className="home-foot">
        D'après l'épreuve <i>Secret Number</i> de <i>The Devil's Plan</i> (Netflix). Création de fans, non officielle.
      </footer>
    </Backdrop>
  );
}
