// Fin de partie : le tableau des arrivées dévoile les numéros un par un, à côté de ce que tu avais écrit ;
// puis le tampon du gagnant, le classement détaillé et tous les contacts de la partie. Victoires de la soirée et revanche.
import confetti from 'canvas-confetti';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, FastForward, LogOut, Minus, RotateCcw, Trophy, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { resultText, type FinalPlayer, type RoomView } from '../../../shared/protocol';
import { Avatar, Backdrop, Button, Flaps, Logo, SeatBadge, TicketStub } from '../components/Ui';
import { sfx } from '../lib/sound';
import { durationLabel, listing, placeLabel, signed } from '../lib/text';
import { cls, reducedMotion } from '../lib/util';
import { leaveRoom, send } from '../net';

const STEP_MS = 650;

function Breakdown({ p }: { p: FinalPlayer }) {
  const s = p.score;
  const parts: { label: string; value: number }[] = [
    { label: 'son numéro', value: s.own },
    ...(s.right ? [{ label: `${s.right} juste${s.right > 1 ? 's' : ''}`, value: s.right }] : []),
    ...(s.wrong ? [{ label: `${s.wrong} faux`, value: -s.wrong }] : []),
    ...(s.bonus ? [{ label: 'tout juste', value: s.bonus }] : []),
    ...(s.found ? [{ label: `trouvé par ${s.found}`, value: -s.found }] : []),
    ...(s.bought ? [{ label: `${s.bought} carnet${s.bought > 1 ? 's' : ''}`, value: -s.bought }] : []),
  ];
  return (
    <span className="breakdown">
      {parts.map((x) => (
        <span key={x.label} className={cls('bd', x.value > 0 ? 'is-good' : 'is-bad')}>
          {x.label} <b>{signed(x.value)}</b>
        </span>
      ))}
    </span>
  );
}

export function Final({ view }: { view: RoomView }) {
  const final = view.final!;
  const isHost = view.hostId === view.me;
  const mine = final.players.find((p) => p.id === view.me);
  const winners = final.players.filter((p) => p.winner);
  const good = !!mine?.winner;
  const bySeat = [...final.players].sort((a, b) => a.seat - b.seat);
  const byId = new Map(final.players.map((p) => [p.id, p]));
  const still = reducedMotion();
  const [step, setStep] = useState(still ? bySeat.length : 0);
  const revealed = step >= bySeat.length;
  const once = useRef(false);

  // Une palette après l'autre, au rythme d'un tableau d'arrivées.
  useEffect(() => {
    if (revealed) return;
    const t = window.setTimeout(() => {
      setStep((s) => s + 1);
      sfx.board(4);
    }, step === 0 ? 900 : STEP_MS);
    return () => window.clearTimeout(t);
  }, [step, revealed]);

  useEffect(() => {
    if (!revealed || once.current) return;
    once.current = true;
    sfx.fanfare(good);
    if (still || !good) return;
    const t = window.setTimeout(() => {
      void confetti({ particleCount: 170, spread: 100, origin: { y: 0.3 }, colors: ['#e5432e', '#2f6fdb', '#12a37a', '#f3b51b', '#16181d'], shapes: ['square'], scalar: 0.9, disableForReducedMotion: true });
    }, 300);
    return () => window.clearTimeout(t);
  }, [revealed, good, still]);

  const who = (p: FinalPlayer | undefined) => (!p ? '?' : p.id === view.me ? 'Toi' : p.name);
  let title: string;
  if (winners.length > 1) title = winners.some((w) => w.id === view.me) ? 'Victoire partagée !' : winners.length > 3 ? `${winners.length} ex æquo` : `Égalité : ${listing(winners.map((w) => w.name))}`;
  else if (good) title = 'Tu gagnes !';
  else title = `${winners[0]?.name ?? '?'} gagne`;
  const top = winners[0];
  const ownLine = mine ? (mine.score.own > 0 ? `Tu as trouvé ton numéro : ${mine.number}.` : `Ton numéro était ${mine.number}${mine.sheet[mine.id] !== null ? `, pas ${mine.sheet[mine.id]}` : ''}.`) : '';

  return (
    <Backdrop quiet>
      <div className="final">
        <header className="final-top">
          <Logo size="sm" />
          <Button variant="ghost" icon={<LogOut size={18} />} onClick={() => void leaveRoom()}>
            Quitter
          </Button>
        </header>

        <section className="arrivals" aria-label="Les numéros secrets">
          <div className="arrivals-head">
            <span>Les numéros</span>
            {mine && <span className="arr-mine-h">ta fiche</span>}
          </div>
          <ol className="arrivals-list">
            {bySeat.map((p, i) => {
              const shown = i < step;
              const guess = mine ? mine.sheet[p.id] : null;
              const right = guess !== null && guess === p.number;
              return (
                <li key={p.id} className={cls('arr-row', p.id === view.me && 'is-me', shown && 'is-shown')}>
                  <SeatBadge seat={p.seat} />
                  <Avatar avatar={p.avatar} className="arr-avatar" />
                  <span className="arr-name">{who(p)}</span>
                  <Flaps text={shown ? String(p.number).padStart(3, ' ') : '  ?'} size="md" stagger={70} label={shown ? `${who(p)} : ${p.number}` : 'caché'} />
                  {mine && (
                    <span className={cls('arr-guess', shown && (guess === null ? 'is-blank' : right ? 'is-right' : 'is-wrong'))}>
                      {guess === null ? <Minus size={14} aria-label="vide" /> : guess}
                      {shown && guess !== null && (right ? <Check size={14} strokeWidth={3} aria-label="juste" /> : <X size={14} strokeWidth={3} aria-label="faux" />)}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
          {!revealed && (
            <Button variant="ghost" className="arr-skip" icon={<FastForward size={16} />} onClick={() => setStep(bySeat.length)}>
              Tout dévoiler
            </Button>
          )}
        </section>

        <AnimatePresence>
          {revealed && (
            <motion.div key="after" className="final-after" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <motion.section className={cls('final-hero', good && 'is-good')} initial={{ y: 18, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.45 }}>
                <motion.div className="stamp" initial={{ scale: 1.6, rotate: -14, opacity: 0 }} animate={{ scale: 1, rotate: -5, opacity: 1 }} transition={{ type: 'spring', stiffness: 360, damping: 16, delay: 0.1 }}>
                  <b>{title}</b>
                  <small>
                    {top ? `${signed(top.score.total)} point${Math.abs(top.score.total) > 1 ? 's' : ''}${winners.length > 1 ? ' chacun' : ''}` : ''}
                  </small>
                </motion.div>
                {ownLine && <p className="final-reason">{ownLine}</p>}
              </motion.section>

              <section className="panel final-table">
                <h3>Le classement</h3>
                <ol className="final-list">
                  {final.players.map((p, i) => (
                    <motion.li key={p.id} className={cls('final-row', p.winner && 'is-winner', p.id === view.me && 'is-me')} initial={{ x: -14, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.2 + i * 0.06 }}>
                      <span className="final-place">{placeLabel(p.place)}</span>
                      <span className="final-who">
                        <b>
                          <span className="final-name">
                            <Avatar avatar={p.avatar} /> {who(p)}
                          </span>
                          {p.wins > 0 && (
                            <span className="final-wins" title="Parties gagnées à cette table, ce soir">
                              <Trophy size={12} aria-hidden /> {p.wins}
                            </span>
                          )}
                        </b>
                        <Breakdown p={p} />
                      </span>
                      <span className={cls('final-total', p.score.total < 0 && 'is-neg')}>{signed(p.score.total)}</span>
                    </motion.li>
                  ))}
                </ol>
                <p className="muted small">Le trophée compte les parties gagnées à cette table ce soir.</p>
              </section>

              {final.contacts.length > 0 && (
                <details className="panel contacts">
                  <summary>
                    <span>
                      Tous les contacts de la partie <span className="muted">({final.contacts.length})</span>
                    </span>
                    <ChevronDown size={18} aria-hidden />
                  </summary>
                  <ol className="contact-list">
                    {final.contacts.map((c, i) => (
                      <li key={i} className="contact-row">
                        <TicketStub type={c.type} size="sm" />
                        <span className="contact-who">
                          {who(byId.get(c.a))} <i>et</i> {who(byId.get(c.b))}
                        </span>
                        <b>{resultText(c)}</b>
                      </li>
                    ))}
                  </ol>
                </details>
              )}

              <p className="muted small final-meta">Partie {final.minutes ? `de ${durationLabel(final.minutes)}` : 'sans limite de temps'}.</p>

              <div className="lobby-cta">
                {isHost ? (
                  <Button variant="primary" className="btn-lg btn-wide" icon={<RotateCcw size={20} />} onClick={() => void send('game:restart')}>
                    Rejouer
                  </Button>
                ) : (
                  <div className="waiting" role="status">
                    <span className="spinner" /> En attente de la revanche…
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Backdrop>
  );
}
