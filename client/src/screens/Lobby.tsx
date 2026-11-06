// Salon : partage de la table, joueurs, durée de la partie et façon de se parler (choisies par l'hôte), lancement.
import { motion } from 'framer-motion';
import { BookOpen, Bot, Check, Copy, Crown, LogOut, Play, QrCode, Share2, Trophy, UserX } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useState } from 'react';
import { DURATIONS, MAX_PLAYERS, MIN_PLAYERS, type Duration, type PlayerView, type RoomView, type Talk } from '../../../shared/protocol';
import { Avatar, Backdrop, Button, Logo, Modal, Pill, Segmented } from '../components/Ui';
import { cls, shareUrl } from '../lib/util';
import { leaveRoom, send } from '../net';
import { useStore } from '../store';

function PlayerRow({ view, p, i, isHost }: { view: RoomView; p: PlayerView; i: number; isHost: boolean }) {
  return (
    <motion.li className={cls('player-row', p.id === view.me && 'is-me')} initial={{ x: -10, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: i * 0.03 }}>
      <span className="player-num">{String(i + 1).padStart(2, '0')}</span>
      <Avatar avatar={p.avatar} className="player-avatar" />
      <span className="player-name">
        {p.name}
        {p.id === view.me && <span className="muted"> (toi)</span>}
      </span>
      {p.wins > 0 && (
        <Pill tone="gold" className="wins-pill">
          <Trophy size={12} aria-hidden /> {p.wins}
        </Pill>
      )}
      {p.isHost && (
        <Pill tone="ink">
          <Crown size={12} aria-hidden /> Hôte
        </Pill>
      )}
      {p.isBot && <Pill tone="soft">Bot</Pill>}
      {!p.connected && <Pill>Hors ligne</Pill>}
      {isHost && p.id !== view.me && (
        <button type="button" className="icon-btn" aria-label={`Retirer ${p.name}`} onClick={() => void send('room:kick', { playerId: p.id })}>
          <UserX size={18} />
        </button>
      )}
    </motion.li>
  );
}

export function Lobby({ view }: { view: RoomView }) {
  const setRulesOpen = useStore((s) => s.setRulesOpen);
  const isHost = view.hostId === view.me;
  const seated = view.players.filter((p) => p.status !== 'spectator');
  const spectators = view.players.filter((p) => p.status === 'spectator');
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState(false);
  const url = shareUrl(view.code);
  const host = view.players.find((p) => p.id === view.hostId);
  const s = view.settings;
  const blocked = seated.length < MIN_PLAYERS ? `Il faut au moins ${MIN_PLAYERS} joueurs` : null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      useStore.getState().showToast(`Lien : ${url}`, 'info');
    }
  };
  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Secret Number', text: `Rejoins ma table de Secret Number (code ${view.code}) !`, url });
      } catch {
        /* partage annulé */
      }
    } else void copy();
  };

  return (
    <Backdrop quiet>
      <div className="lobby">
        <header className="lobby-top">
          <Logo size="sm" />
          <Button variant="ghost" icon={<LogOut size={18} />} onClick={() => void leaveRoom()}>
            Quitter
          </Button>
        </header>

        <motion.section className="code-panel" initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
          <span className="eyebrow">Code de la table</span>
          <div className="big-code" aria-label={`Code ${view.code.split('').join(' ')}`}>
            {view.code.split('').map((c, i) => (
              <motion.span key={i} initial={{ y: -18, rotate: -6 }} animate={{ y: 0, rotate: i % 2 ? 2 : -2 }} transition={{ delay: i * 0.06, type: 'spring', stiffness: 260, damping: 14 }}>
                {c}
              </motion.span>
            ))}
          </div>
          <div className="share-row">
            <Button variant="primary" icon={<Share2 size={18} />} onClick={share}>
              Inviter des amis
            </Button>
            <Button icon={copied ? <Check size={18} /> : <Copy size={18} />} onClick={copy}>
              {copied ? 'Lien copié !' : 'Copier le lien'}
            </Button>
            <Button icon={<QrCode size={18} />} onClick={() => setQr(true)} aria-label="Afficher le QR code">
              QR
            </Button>
          </div>
        </motion.section>

        <div className="lobby-grid">
          <section className="panel">
            <div className="panel-head">
              <h3>
                Joueurs <span className="muted">{seated.length}/{MAX_PLAYERS}</span>
              </h3>
              {isHost && (
                <Button variant="soft" icon={<Bot size={18} />} disabled={seated.length >= MAX_PLAYERS} onClick={() => void send('room:addBot')}>
                  Ajouter un bot
                </Button>
              )}
            </div>
            <ul className="player-list">
              {seated.map((p, i) => (
                <PlayerRow key={p.id} view={view} p={p} i={i} isHost={isHost} />
              ))}
              {Array.from({ length: Math.max(0, MIN_PLAYERS - seated.length) }, (_, i) => (
                <li key={`empty${i}`} className="player-row is-empty">
                  <span className="player-num">{String(seated.length + i + 1).padStart(2, '0')}</span>
                  <span className="player-ghost">?</span>
                  <span className="player-name muted">En attente d'un joueur…</span>
                </li>
              ))}
            </ul>
            {spectators.length > 0 && <p className="muted small">Spectateurs : {spectators.map((p) => p.name).join(', ')}</p>}
            <p className="muted small lobby-note">De 4 à 10 joueurs. Plus on est nombreux, plus il y a de numéros à trouver, et d'alliés possibles.</p>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h3>Réglages</h3>
              {!isHost && <span className="muted small">choisis par {host?.name ?? "l'hôte"}</span>}
            </div>
            <span className="field-label">Durée de la partie</span>
            <Segmented<Duration>
              label="Durée de la partie"
              className="seg-durations"
              value={s.minutes}
              disabled={!isHost}
              onChange={(minutes) => void send('room:settings', { minutes })}
              options={DURATIONS.map((m) => ({ value: m, label: m ? String(m) : '∞', sub: m ? 'min' : 'sans limite' }))}
            />
            <p className="muted small lobby-note">
              {s.minutes
                ? `Au bout de ${s.minutes} minutes, le standard ferme : une dernière minute pour finir sa fiche.`
                : 'Pas de chrono : la partie s’arrête quand tout le monde a rendu sa fiche (ou quand l’hôte ferme le standard).'}
            </p>
            <span className="field-label">Pour négocier</span>
            <Segmented<Talk>
              label="Pour négocier"
              value={s.talk}
              disabled={!isHost}
              onChange={(talk) => void send('room:settings', { talk })}
              options={[
                { value: 'voix', label: 'À voix haute', sub: 'autour de la table' },
                { value: 'ecrit', label: 'Messages écrits', sub: 'à distance' },
              ]}
            />
            <p className="muted small lobby-note">
              {s.talk === 'voix' ? 'On se parle en vrai (ou en appel). L’appli garde les numéros, les tickets et les résultats.' : 'En plus de la voix, chacun peut écrire à une personne, en secret, ou à tout le monde.'}
            </p>
          </section>
        </div>

        <div className="lobby-cta">
          {isHost ? (
            <Button variant="primary" className="btn-lg btn-wide" icon={<Play size={20} />} disabled={!!blocked} onClick={() => void send('game:start')}>
              {blocked ?? `Lancer la partie (${seated.length} joueurs)`}
            </Button>
          ) : (
            <div className="waiting" role="status">
              <span className="spinner" /> En attente que {host?.name ?? "l'hôte"} lance la partie…
            </div>
          )}
          <Button variant="ghost" icon={<BookOpen size={18} />} onClick={() => setRulesOpen(true)}>
            Nouveau ? Les règles en 2 minutes
          </Button>
        </div>

        <Modal open={qr} onClose={() => setQr(false)} title={`Table ${view.code}`}>
          <div className="qr-box">
            <QRCodeSVG value={url} size={220} bgColor="#fbf9f4" fgColor="#16181d" level="M" includeMargin />
            <p className="muted small">Scanne pour rejoindre la table directement.</p>
            <code className="url-code">{url}</code>
          </div>
        </Modal>
      </div>
    </Backdrop>
  );
}
