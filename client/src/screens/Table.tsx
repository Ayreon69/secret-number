// La table : le plan du réseau (les joueurs en stations), ses tickets, ses demandes de contact, ses résultats,
// et son bureau (fiche, notes, messages). Sur ordinateur, le bureau reste ouvert à côté du plan.
import { AnimatePresence, motion } from 'framer-motion';
import { BookOpen, ClipboardList, DoorClosed, Flag, Handshake, LogOut, MessageSquareText, MoreHorizontal, NotebookPen, Smile, TicketPlus, Volume2, VolumeX, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { EMOTES, REQUEST_MS, TAUNTS, TICKETS, resultText, type ContactResult, type PlayerView, type Request, type RoomView, type Ticket } from '../../../shared/protocol';
import { MessagesPanel, NotesPanel, SheetPanel } from '../components/Desk';
import { Network, SecretHub, type Pending } from '../components/Network';
import { Avatar, Button, Flaps, Logo, Modal, SeatBadge, Segmented, TicketStub } from '../components/Ui';
import { sfx } from '../lib/sound';
import { TICKET_NAME, TICKET_RULE, clock, deName, noteLine, resultSentence } from '../lib/text';
import { cls, useTick, vibrate } from '../lib/util';
import { leaveRoom, send, socket } from '../net';
import { serverNow, useStore } from '../store';

type Panel = 'fiche' | 'notes' | 'messages';

function useWide(): boolean {
  const query = '(min-width: 1100px)';
  const [wide, setWide] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const m = window.matchMedia?.(query);
    if (!m) return;
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

function ReactionTray({ onClose }: { onClose: () => void }) {
  const emit = (emoji: string) => {
    socket.emit('emote', { emoji });
    onClose();
  };
  return (
    <motion.div className="reactions" role="menu" aria-label="Réactions" initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
      <div className="reaction-emojis">
        {EMOTES.map((e) => (
          <button key={e} type="button" role="menuitem" onClick={() => emit(e)} aria-label={`Réaction ${e}`}>
            {e}
          </button>
        ))}
      </div>
      <div className="reaction-taunts">
        {TAUNTS.map((t) => (
          <button key={t} type="button" role="menuitem" onClick={() => emit(t)}>
            {t}
          </button>
        ))}
      </div>
    </motion.div>
  );
}

/** Le temps qui reste avant la fermeture du standard, sur le tableau d'affichage. */
function Clock({ view }: { view: RoomView }) {
  const now = useTick(250);
  const g = view.game!;
  const left = g.endsAt ? g.endsAt - now : null;
  const label = g.stage === 'last' ? 'Dernier appel' : g.stage === 'closing' ? 'Ramassage' : left === null ? 'Sans limite' : 'Fermeture';
  return (
    <span className={cls('clock', g.stage === 'last' && 'is-last', left !== null && left < 60_000 && 'is-short')} role="timer" aria-label={left === null ? label : `${label} dans ${clock(left)}`}>
      <small>{label}</small>
      <Flaps text={left === null ? '--:--' : clock(left)} size="sm" stagger={20} />
    </span>
  );
}

/** Une barre qui se vide jusqu'à l'échéance d'une demande. */
function Fuse({ endsAt }: { endsAt: number }) {
  const offset = useStore((s) => s.clockOffset);
  const left = Math.max(0, endsAt - (Date.now() + offset));
  return (
    <span className="fuse" aria-hidden>
      <span key={endsAt} style={{ ['--d' as string]: `${left}ms`, animationDuration: `${left}ms`, width: `${Math.min(100, (left / REQUEST_MS) * 100)}%` }} />
    </span>
  );
}

function IncomingCard({ view, r, more }: { view: RoomView; r: Request; more: number }) {
  const me = view.game!.me!;
  const from = view.players.find((p) => p.id === r.from);
  const has = me.tickets[r.type] > 0;
  const [busy, setBusy] = useState(false);
  const answer = async (accept: boolean) => {
    if (busy) return;
    setBusy(true);
    await send('contact:answer', { id: r.id, accept });
    setBusy(false);
  };
  return (
    <motion.div className="req-card is-in" layout initial={{ y: 14, opacity: 0, scale: 0.97 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} role="alert">
      <div className="req-head">
        <Avatar avatar={from?.avatar ?? 'valise'} className="req-avatar" />
        <p>
          <b>{from?.name ?? '?'}</b> te propose un contact
          {more > 0 && <span className="req-more"> · encore {more} en attente</span>}
        </p>
        <TicketStub type={r.type} size="sm" />
      </div>
      <Fuse endsAt={r.endsAt} />
      {!has && <p className="req-note">Tu n'as plus de ticket {TICKET_NAME[r.type]}.</p>}
      <div className="req-actions">
        <Button variant="ghost" icon={<X size={18} />} disabled={busy} onClick={() => void answer(false)}>
          Refuser
        </Button>
        {has ? (
          <Button variant="primary" icon={<Handshake size={18} />} disabled={busy} onClick={() => void answer(true)}>
            Accepter
          </Button>
        ) : (
          <Button variant="soft" icon={<TicketPlus size={18} />} disabled={busy} onClick={() => void send('ticket:buy')}>
            Un carnet (−1 pt)
          </Button>
        )}
      </div>
    </motion.div>
  );
}

function OutgoingCard({ view, r }: { view: RoomView; r: Request }) {
  const to = view.players.find((p) => p.id === r.to);
  return (
    <motion.div className="req-card is-out" layout initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ opacity: 0 }} role="status">
      <div className="req-head">
        <span className="spinner" aria-hidden />
        <p>
          On attend la réponse de <b>{to?.name ?? '?'}</b>
        </p>
        <TicketStub type={r.type} size="sm" />
      </div>
      <Fuse endsAt={r.endsAt} />
      <div className="req-actions">
        <Button variant="ghost" icon={<X size={18} />} onClick={() => void send('contact:cancel')}>
          Annuler la demande
        </Button>
      </div>
    </motion.div>
  );
}

/** Ce qu'on peut faire avec un joueur : lui proposer un contact, lui donner un ticket, lui écrire. */
function PlayerSheet({ view, target, onClose, onWrite }: { view: RoomView; target: PlayerView; onClose: () => void; onWrite: (id: string) => void }) {
  const g = view.game!;
  const me = g.me!;
  const [mode, setMode] = useState<'ask' | 'give'>('ask');
  const out = me.outgoing;
  const open = g.stage === 'open';
  const free = (t: Ticket) => me.tickets[t] - (out && out.type === t ? 1 : 0);
  const act = async (t: Ticket) => {
    if (mode === 'ask') {
      sfx.sent();
      const ok = await send('contact:ask', { to: target.id, type: t });
      if (ok) onClose();
    } else {
      const ok = await send('ticket:give', { to: target.id, type: t });
      if (ok) {
        sfx.punch();
        useStore.getState().showToast(`Ticket ${TICKET_NAME[t]} donné à ${target.name}.`, 'info');
        onClose();
      }
    }
  };
  return (
    <Modal
      open
      sheet
      onClose={onClose}
      className="player-sheet"
      title={
        <span className="ps-title">
          <SeatBadge seat={target.seat} />
          <Avatar avatar={target.avatar} />
          {target.name}
        </span>
      }
    >
      {!open ? (
        <p className="muted">Le standard est fermé : plus de contact ni de don. Finis ta fiche !</p>
      ) : (
        <>
          <Segmented<'ask' | 'give'>
            label="Que faire ?"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'ask', label: 'Proposer un contact' },
              { value: 'give', label: 'Donner un ticket' },
            ]}
          />
          {mode === 'ask' && out ? (
            <div className="ps-busy">
              <p>Tu attends déjà la réponse {deName(view.players.find((p) => p.id === out.to)?.name ?? '?')}.</p>
              <Button variant="ghost" icon={<X size={18} />} onClick={() => void send('contact:cancel')}>
                Annuler cette demande
              </Button>
            </div>
          ) : (
            <>
              <p className="ps-hint">{mode === 'ask' ? `Choisis le ticket : si ${target.name} accepte, vous donnez chacun le même, et vous apprenez tous les deux le résultat.` : `Choisis le ticket à donner : ${target.name} le garde, tu ne l'as plus.`}</p>
              <div className="ps-tickets">
                {TICKETS.map((t) => (
                  <TicketStub key={t} type={t} count={me.tickets[t]} onClick={() => void act(t)} disabled={free(t) <= 0} hint={mode === 'ask' ? TICKET_RULE[t] : undefined} />
                ))}
              </div>
            </>
          )}
        </>
      )}
      {view.settings.talk === 'ecrit' && g.stage !== 'closing' && (
        <Button variant="ghost" className="ps-write" icon={<MessageSquareText size={18} />} onClick={() => onWrite(target.id)}>
          Écrire à {target.name}
        </Button>
      )}
    </Modal>
  );
}

/** Le résultat d'un contact, sur le tableau : on le lit, on le note si on veut, puis il disparaît. */
function ResultCard({ view, r }: { view: RoomView; r: ContactResult }) {
  const partner = view.players.find((p) => p.id === r.with);
  const name = partner?.name ?? '?';
  const final = resultText(r);
  // Le tableau part vide, puis ses palettes tournent jusqu'au résultat.
  const [shown, setShown] = useState(() => ' '.repeat(final.length));
  useEffect(() => {
    const t = window.setTimeout(() => setShown(final), 250);
    return () => window.clearTimeout(t);
  }, [final]);
  const close = () => void send('seen', { kind: 'result', id: r.id });
  const note = () => {
    const cur = (view.game?.me?.notes ?? '').trimEnd();
    void send('notes', { text: (cur ? `${cur}\n` : '') + noteLine(r, name) });
    useStore.getState().showToast('Noté dans tes notes.', 'info');
    close();
  };
  return (
    <Modal open onClose={close} className="result-modal" title="Résultat du contact">
      <div className={cls('result', `is-${r.type}`)}>
        <div className="result-board">
          <TicketStub type={r.type} />
          <span className="result-with">
            avec <b>{name}</b>
          </span>
          {r.range ? <span className="result-range">{resultText(r)}</span> : <Flaps text={shown} size="xl" onTurn={sfx.flap} label={resultText(r)} />}
        </div>
        <p className="result-say">{resultSentence(r, name)}</p>
        <p className="muted small">Rien n'est gardé pour toi : note-le, ou retiens-le.</p>
        <div className="result-actions">
          <Button variant="primary" icon={<NotebookPen size={18} />} onClick={note} data-autofocus>
            Noter
          </Button>
          <Button variant="ghost" onClick={close}>
            Fermer
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Acheter un carnet : deux appuis, un point ne se perd pas par mégarde. */
function BuyButton({ disabled }: { disabled: boolean }) {
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!confirm) return;
    const t = window.setTimeout(() => setConfirm(false), 3500);
    return () => window.clearTimeout(t);
  }, [confirm]);
  return (
    <button
      type="button"
      className={cls('buy', confirm && 'is-confirm')}
      disabled={disabled}
      onClick={async () => {
        if (!confirm) {
          setConfirm(true);
          return;
        }
        setConfirm(false);
        if (await send('ticket:buy')) {
          sfx.punch();
          useStore.getState().showToast('Un carnet de plus : un ticket de chaque, pour 1 point.', 'info');
        }
      }}
    >
      <TicketPlus size={18} aria-hidden />
      <span>{confirm ? 'Confirmer : −1 point' : 'Un carnet de plus'}</span>
      {!confirm && <small>−1 point</small>}
    </button>
  );
}

// ───────────────────────────── L'écran ─────────────────────────────

export function Table({ view }: { view: RoomView }) {
  const prefs = useStore((s) => s.prefs);
  const setPrefs = useStore((s) => s.setPrefs);
  const setRulesOpen = useStore((s) => s.setRulesOpen);
  const emotes = useStore((s) => s.emotes);
  const showToast = useStore((s) => s.showToast);
  const wide = useWide();
  const g = view.game!;
  const me = g.me;
  const seated = !!me;
  const isHost = view.hostId === view.me;
  const [menu, setMenu] = useState(false);
  const [confirmStop, setConfirmStop] = useState<'' | 'close' | 'stop'>('');
  const [react, setReact] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [tab, setTab] = useState<Panel>('fiche');
  const [writeTo, setWriteTo] = useState('');
  const [readMsgs, setReadMsgs] = useState(0);
  const written = view.settings.talk === 'ecrit';

  // ── Les sons et les messages qui suivent l'état ──
  const seen = useRef({ cords: new Set<number>(), results: new Set<number>(), incoming: new Set<number>(), notices: new Set<number>(), gifts: new Set<number>(), stage: g.stage, bell: false, tick: -1 });
  const cordTypes = useRef(new Map<number, Ticket>());
  useEffect(() => {
    sfx.start();
  }, []);
  useEffect(() => {
    const s = seen.current;
    for (const c of g.cords) {
      if (s.cords.has(c.id)) continue;
      s.cords.add(c.id);
      if (c.a === view.me || c.b === view.me) {
        const other = c.a === view.me ? c.b : c.a;
        const r = [...(me?.results ?? [])].reverse().find((x) => x.with === other);
        if (r) cordTypes.current.set(c.id, r.type);
      } else sfx.distant();
    }
    for (const r of me?.results ?? []) {
      if (s.results.has(r.id)) continue;
      s.results.add(r.id);
      sfx.contact();
      vibrate([20, 40, 20]);
    }
    for (const r of me?.incoming ?? []) {
      if (s.incoming.has(r.id)) continue;
      s.incoming.add(r.id);
      sfx.ask();
      vibrate([30, 60, 30]);
    }
    for (const n of me?.notices ?? []) {
      if (s.notices.has(n.id)) continue;
      s.notices.add(n.id);
      showToast(n.text, 'info');
      sfx.no();
      void send('seen', { kind: 'notice', id: n.id });
    }
    for (const x of me?.gifts ?? []) {
      if (s.gifts.has(x.id)) continue;
      s.gifts.add(x.id);
      const from = view.players.find((p) => p.id === x.from)?.name ?? 'Quelqu’un';
      showToast(`${from} t'a donné un ticket ${TICKET_NAME[x.type]}.`, 'info');
      sfx.punch();
      void send('seen', { kind: 'gift', id: x.id });
    }
    if (g.stage !== s.stage) {
      if (g.stage === 'last') {
        sfx.bell();
        vibrate([60, 80, 60]);
        setPicked(null);
        if (seated && !wide) setPanel('fiche');
        if (wide) setTab('fiche');
      }
      if (g.stage === 'closing') sfx.stamp();
      s.stage = g.stage;
    }
  }, [view, g, me, seated, wide, showToast]);

  // La cloche une minute avant la fermeture, et le tic des dix dernières secondes.
  const now = useTick(500);
  useEffect(() => {
    if (!g.endsAt) return;
    const left = g.endsAt - serverNow();
    const s = seen.current;
    if (g.stage === 'open' && left < 60_000 && left > 0 && !s.bell) {
      s.bell = true;
      sfx.bell();
    }
    const sec = Math.ceil(left / 1000);
    if (left > 0 && sec <= 10 && sec !== s.tick && g.stage !== 'closing') {
      s.tick = sec;
      sfx.tick();
    }
  }, [now, g.endsAt, g.stage]);

  const players = g.order.map((id) => view.players.find((p) => p.id === id)).filter((p): p is PlayerView => !!p);
  const target = picked ? players.find((p) => p.id === picked) : undefined;
  const result = me?.results[0];
  const incoming = me?.incoming ?? [];
  const out = me?.outgoing ?? null;
  const freeTickets = me ? TICKETS.some((t) => me.tickets[t] - (out?.type === t ? 1 : 0) > 0) : false;
  const canAsk = !!me && g.stage === 'open' && !out && freeTickets;
  const myDone = !!players.find((p) => p.id === view.me)?.done;
  const ownEmpty = !!me && me.sheet[view.me] === null;
  const unread = Math.max(0, (me?.inbox.filter((w) => w.from !== view.me).length ?? 0) - readMsgs);
  const messagesOpen = (wide && tab === 'messages') || panel === 'messages';
  useEffect(() => {
    if (messagesOpen) setReadMsgs(me?.inbox.filter((w) => w.from !== view.me).length ?? 0);
  }, [messagesOpen, me?.inbox, view.me]);

  const pending: Pending[] = useMemo(() => {
    const list: Pending[] = [];
    if (out) list.push({ with: out.to, type: out.type, dir: 'out' });
    for (const r of incoming) list.push({ with: r.from, type: r.type, dir: 'in' });
    return list;
  }, [out, incoming]);

  const pick = (id: string) => {
    if (!seated) return;
    if (id === view.me) {
      if (wide) setTab('fiche');
      else setPanel('fiche');
      return;
    }
    sfx.tap();
    setPicked(id);
  };
  const write = (id: string) => {
    setPicked(null);
    setWriteTo(id);
    if (wide) setTab('messages');
    else setPanel('messages');
  };

  let status: string;
  if (!seated) status = 'Tu regardes la partie : tu joueras à la prochaine.';
  else if (g.stage === 'closing') status = 'Les fiches sont ramassées…';
  else if (g.stage === 'last') status = myDone ? 'Fiche rendue. On attend les autres…' : 'Le standard est fermé : finis ta fiche avant la fin du dernier appel.';
  else if (myDone) status = 'Fiche rendue. Tu peux encore accepter des contacts, ou la reprendre.';
  else if (out || incoming.length) status = '';
  else if (!freeTickets) status = 'Plus de ticket : achète un carnet, demande-en un, ou remplis ta fiche.';
  else status = 'Touche un joueur sur le plan pour lui proposer un contact.';

  const desk = (which: Panel) => (which === 'fiche' ? <SheetPanel view={view} /> : which === 'notes' ? <NotesPanel view={view} /> : <MessagesPanel view={view} to={writeTo} setTo={setWriteTo} />);
  const deskTitle: Record<Panel, string> = { fiche: 'Ma fiche', notes: 'Mes notes', messages: 'Messages' };

  return (
    <div className={cls('table-screen', `stage-${g.stage}`, wide && 'is-wide')}>
      <header className="table-top">
        <span className="table-logo">
          <Logo size="sm" />
        </span>
        <Clock view={view} />
        <div className="table-tools">
          <button type="button" className={cls('icon-btn', react && 'is-on')} aria-label="Réagir" aria-expanded={react} onClick={() => setReact((x) => !x)}>
            <Smile size={20} />
          </button>
          <button type="button" className="icon-btn" aria-label="Menu" onClick={() => setMenu(true)}>
            <MoreHorizontal size={20} />
          </button>
        </div>
        {react && <ReactionTray onClose={() => setReact(false)} />}
      </header>

      <div className="table-body">
        <main className="table-main">
          <Network
            view={view}
            emotes={emotes}
            onPick={pick}
            selected={picked}
            pending={pending}
            cordTypes={cordTypes.current}
            canAsk={canAsk}
            centre={seated ? <SecretHub /> : <SecretHub label="Spectateur" text="--" />}
          />

          <div className="table-status" aria-live="polite">
            <AnimatePresence mode="popLayout">
              {seated && incoming[0] && <IncomingCard key={`in${incoming[0].id}`} view={view} r={incoming[0]} more={incoming.length - 1} />}
              {seated && out && <OutgoingCard key={`out${out.id}`} view={view} r={out} />}
            </AnimatePresence>
            {status && <p className="status-line">{status}</p>}
            {seated && g.stage === 'last' && !wide && (
              <Button variant="primary" icon={<ClipboardList size={18} />} onClick={() => setPanel('fiche')}>
                Ouvrir ma fiche
              </Button>
            )}
          </div>

          {me && (
            <section className={cls('my-tickets', g.stage !== 'open' && 'is-off')} aria-label="Mes tickets">
              <div className="tickets-row">
                {TICKETS.map((t) => (
                  <TicketStub key={t} type={t} count={me.tickets[t]} />
                ))}
              </div>
              <BuyButton disabled={g.stage !== 'open'} />
              {me.bought > 0 && <p className="muted small bought-note">Carnets achetés : {me.bought} (−{me.bought} point{me.bought > 1 ? 's' : ''})</p>}
            </section>
          )}
        </main>

        {wide && seated && (
          <aside className="desk">
            <div className="desk-tabs" role="tablist">
              {(['fiche', 'notes', ...(written ? (['messages'] as const) : [])] as Panel[]).map((p) => (
                <button key={p} type="button" role="tab" aria-selected={tab === p} className={cls('desk-tab', tab === p && 'is-on')} onClick={() => setTab(p)}>
                  {p === 'fiche' ? <ClipboardList size={17} /> : p === 'notes' ? <NotebookPen size={17} /> : <MessageSquareText size={17} />}
                  {deskTitle[p]}
                  {p === 'fiche' && ownEmpty && <i className="dot" aria-label="Ton numéro est vide" />}
                  {p === 'messages' && unread > 0 && <i className="count">{unread}</i>}
                </button>
              ))}
            </div>
            <div className="desk-body">{desk(tab)}</div>
          </aside>
        )}
      </div>

      {!wide && seated && (
        <nav className="dock" aria-label="Mon bureau">
          <button type="button" className={cls('dock-btn', g.stage === 'last' && !myDone && 'is-urgent')} onClick={() => setPanel('fiche')}>
            <ClipboardList size={20} />
            <span>Ma fiche</span>
            {ownEmpty && <i className="dot" aria-label="Ton numéro est vide" />}
          </button>
          <button type="button" className="dock-btn" onClick={() => setPanel('notes')}>
            <NotebookPen size={20} />
            <span>Mes notes</span>
          </button>
          {written && (
            <button type="button" className="dock-btn" onClick={() => setPanel('messages')}>
              <MessageSquareText size={20} />
              <span>Messages</span>
              {unread > 0 && <i className="count">{unread}</i>}
            </button>
          )}
        </nav>
      )}

      {!wide && panel && (
        <Modal open sheet className={cls('desk-modal', `is-${panel}`)} onClose={() => setPanel(null)} title={deskTitle[panel]}>
          {desk(panel)}
        </Modal>
      )}

      {target && seated && <PlayerSheet view={view} target={target} onClose={() => setPicked(null)} onWrite={write} />}
      {result && <ResultCard key={result.id} view={view} r={result} />}

      <AnimatePresence>
        {g.stage === 'closing' && (
          <motion.div className="closing" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <motion.div className="stamp" initial={{ scale: 1.6, rotate: -14, opacity: 0 }} animate={{ scale: 1, rotate: -6, opacity: 1 }} transition={{ type: 'spring', stiffness: 360, damping: 16 }}>
              <b>Fiches ramassées</b>
              <small>on dévoile les numéros</small>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <Modal
        open={menu}
        onClose={() => {
          setMenu(false);
          setConfirmStop('');
        }}
        title="Menu"
      >
        <div className="menu-list">
          <Button icon={prefs.sound ? <Volume2 size={18} /> : <VolumeX size={18} />} onClick={() => setPrefs({ sound: !prefs.sound })}>
            Son : {prefs.sound ? 'activé' : 'coupé'}
          </Button>
          <Button
            icon={<BookOpen size={18} />}
            onClick={() => {
              setMenu(false);
              setRulesOpen(true);
            }}
          >
            Les règles
          </Button>
          {isHost && g.stage === 'open' && (
            <Button
              variant="soft"
              icon={<DoorClosed size={18} />}
              onClick={() => {
                if (confirmStop !== 'close') {
                  setConfirmStop('close');
                  return;
                }
                setConfirmStop('');
                setMenu(false);
                void send('game:close');
              }}
            >
              {confirmStop === 'close' ? 'Confirmer : plus de contacts pour personne' : 'Fermer le standard (dernier appel)'}
            </Button>
          )}
          {isHost && (
            <Button
              variant="danger"
              icon={<Flag size={18} />}
              onClick={() => {
                // Deux appuis : un geste malheureux ne doit pas couper la partie de toute la table.
                if (confirmStop !== 'stop') {
                  setConfirmStop('stop');
                  return;
                }
                setConfirmStop('');
                setMenu(false);
                void send('game:end');
              }}
            >
              {confirmStop === 'stop' ? 'Confirmer : arrêter pour tout le monde' : 'Arrêter la partie'}
            </Button>
          )}
          <Button variant="ghost" icon={<LogOut size={18} />} onClick={() => void leaveRoom()}>
            Quitter la table
          </Button>
        </div>
      </Modal>
    </div>
  );
}

