// Le bureau du joueur : sa fiche (un numéro pour chacun, le sien compris), le pavé de 1 à 100, ses notes et ses messages.
// Rien n'est calculé pour lui : la fiche montre seulement ce qu'il a écrit, les notes ce qu'il a noté.
import { Check, Eraser, Send, Undo2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { HIGH, LOW, NOTES_MAX, WHISPER_MAX, type PlayerView, type RoomView } from '../../../shared/protocol';
import { deName } from '../lib/text';
import { cls } from '../lib/util';
import { send } from '../net';
import { useStore } from '../store';
import { Avatar, Button, Flaps, Modal, SeatBadge } from './Ui';

function seatedPlayers(view: RoomView): PlayerView[] {
  const g = view.game!;
  const list = g.order.map((id) => view.players.find((p) => p.id === id)).filter((p): p is PlayerView => !!p);
  // Soi d'abord : c'est la case qui vaut le plus.
  return [...list.filter((p) => p.id === view.me), ...list.filter((p) => p.id !== view.me)];
}

/** Le pavé : les cent numéros en dix rangées. Ceux déjà écrits ailleurs sur sa fiche portent l'initiale du joueur. */
function NumberPad({ view, target, onClose }: { view: RoomView; target: string | null; onClose: () => void }) {
  const me = view.game?.me;
  if (!me || !target) return null;
  const p = view.players.find((x) => x.id === target);
  const current = me.sheet[target] ?? null;
  const written = new Map<number, string>();
  for (const [id, n] of Object.entries(me.sheet)) {
    if (n === null || id === target) continue;
    written.set(n, id === view.me ? 'moi' : (view.players.find((x) => x.id === id)?.name ?? '?').slice(0, 3));
  }
  const pick = (value: number | null) => {
    void send('sheet', { target, value });
    onClose();
  };
  return (
    <Modal open onClose={onClose} sheet className="pad-modal" title={target === view.me ? 'Ton numéro' : `Le numéro ${deName(p?.name ?? '?')}`}>
      <div className="pad" role="grid" aria-label="Choisis un numéro">
        {Array.from({ length: HIGH - LOW + 1 }, (_, i) => LOW + i).map((n) => (
          <button key={n} type="button" className={cls('pad-n', current === n && 'is-on', written.has(n) && 'is-used')} onClick={() => pick(n)} aria-label={written.has(n) ? `${n}, déjà écrit pour ${written.get(n)}` : String(n)} data-autofocus={current === n ? true : undefined}>
            {n}
            {written.has(n) && <small aria-hidden>{written.get(n)}</small>}
          </button>
        ))}
      </div>
      <div className="pad-foot">
        <Button variant="ghost" icon={<Eraser size={18} />} disabled={current === null} onClick={() => pick(null)}>
          Laisser vide
        </Button>
      </div>
    </Modal>
  );
}

/** La fiche : un numéro pour chacun, et le bouton pour la rendre. */
export function SheetPanel({ view }: { view: RoomView }) {
  const g = view.game!;
  const me = g.me;
  const [target, setTarget] = useState<string | null>(null);
  if (!me) return null;
  const done = !!view.players.find((p) => p.id === view.me)?.done;
  const ownEmpty = me.sheet[view.me] === null;
  const closing = g.stage === 'closing';
  return (
    <div className={cls('sheet', done && 'is-done')}>
      <ol className="sheet-rows">
        {seatedPlayers(view).map((p) => {
          const n = me.sheet[p.id];
          const mine = p.id === view.me;
          return (
            <li key={p.id} className={cls('sheet-row', mine && 'is-me')}>
              <SeatBadge seat={p.seat} />
              <Avatar avatar={p.avatar} className="sheet-avatar" />
              <span className="sheet-name">
                <b>{mine ? 'Ton numéro' : p.name}</b>
                {mine && <small>+5 si juste, −5 sinon</small>}
              </span>
              <button type="button" className={cls('sheet-cell', n === null && 'is-empty', mine && n === null && 'is-needed')} disabled={done || closing} onClick={() => setTarget(p.id)} aria-label={`${mine ? 'Ton numéro' : p.name} : ${n ?? 'vide'}. Changer`}>
                <Flaps text={n === null ? ' --' : String(n).padStart(3, ' ')} size="sm" stagger={30} />
              </button>
            </li>
          );
        })}
      </ol>
      <p className="muted small sheet-rule">
        Les autres : +1 si juste, −1 si faux, 0 si vide. Toute la fiche juste : +5 de plus. Chaque joueur qui trouve ton numéro : −1.
      </p>
      <div className="sheet-actions">
        {ownEmpty && !done && <p className="sheet-warn">Ton numéro est vide : il compte faux (−5).</p>}
        {done ? (
          <>
            <p className="sheet-stamp" role="status">
              <Check size={18} strokeWidth={3} /> Fiche rendue
            </p>
            {!closing && (
              <Button variant="ghost" icon={<Undo2 size={18} />} onClick={() => void send('done', { done: false })}>
                La reprendre
              </Button>
            )}
          </>
        ) : (
          <Button variant="primary" className="btn-wide" icon={<Check size={20} />} disabled={closing} onClick={() => void send('done', { done: true })}>
            J'ai fini, je rends ma fiche
          </Button>
        )}
      </div>
      <NumberPad view={view} target={target} onClose={() => setTarget(null)} />
    </div>
  );
}

/** Ses notes : un carnet libre, gardé par le serveur (une coupure ne l'efface pas). */
export function NotesPanel({ view }: { view: RoomView }) {
  const server = view.game?.me?.notes ?? '';
  const [text, setText] = useState(server);
  const editing = useRef(false);
  const placed = useRef(false);
  const timer = useRef<number | null>(null);
  const latest = useRef(text);
  latest.current = text;

  // Tant qu'on écrit, on garde son texte ; sinon on reprend celui du serveur (après une reprise, par exemple).
  useEffect(() => {
    if (!editing.current && timer.current === null && server !== latest.current) setText(server);
  }, [server]);

  const push = (value: string) => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      void send('notes', { text: value });
    }, 450);
  };

  useEffect(
    () => () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        void send('notes', { text: latest.current });
      }
    },
    [],
  );

  return (
    <div className="notes">
      <textarea
        className="notes-area"
        value={text}
        maxLength={NOTES_MAX}
        placeholder={'Note ici ce que tu apprends :\nPlus avec Sam : 87\nLéa dit que Noé est petit…'}
        aria-label="Mes notes"
        spellCheck={false}
        onFocus={(e) => {
          editing.current = true;
          // La première fois, le curseur se place à la fin : on ajoute à ses notes, on ne les réécrit pas.
          const el = e.currentTarget;
          if (!placed.current && el.selectionStart === 0 && el.selectionEnd === 0 && el.value) {
            placed.current = true;
            requestAnimationFrame(() => el.setSelectionRange(el.value.length, el.value.length));
          }
        }}
        onBlur={() => (editing.current = false)}
        onChange={(e) => {
          setText(e.target.value);
          push(e.target.value);
        }}
      />
      <p className="muted small notes-foot">Tes notes ne sont qu'à toi. Rien d'autre n'est gardé : ce que tu ne notes pas, il faudra t'en souvenir.</p>
    </div>
  );
}

/** Les messages écrits : à une personne, en secret, ou à tout le monde. */
export function MessagesPanel({ view, to, setTo }: { view: RoomView; to: string; setTo: (id: string) => void }) {
  const g = view.game!;
  const inbox = g.me?.inbox ?? [];
  const [text, setText] = useState('');
  const list = useRef<HTMLOListElement>(null);
  const others = g.order.filter((id) => id !== view.me).map((id) => view.players.find((p) => p.id === id)).filter((p): p is PlayerView => !!p);
  const name = (id: string) => (id === view.me ? 'Toi' : (view.players.find((p) => p.id === id)?.name ?? '?'));
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [inbox.length]);
  const submit = async () => {
    const clean = text.trim();
    if (!clean) return;
    const ok = await send('whisper', { to: to || null, text: clean });
    if (ok) setText('');
  };
  return (
    <div className="messages">
      <ol className="msg-list" ref={list}>
        {inbox.length === 0 && <li className="muted small msg-empty">Aucun message pour l'instant.</li>}
        {inbox.map((w) => (
          <li key={w.id} className={cls('msg', w.from === view.me && 'is-mine', w.to === null && 'is-all')}>
            <span className="msg-who">
              {name(w.from)} → {w.to === null ? 'tout le monde' : w.to === view.me ? 'toi' : name(w.to)}
            </span>
            <span className="msg-text">{w.text}</span>
          </li>
        ))}
      </ol>
      <form
        className="msg-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <select className="input msg-to" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Destinataire">
          <option value="">À tout le monde</option>
          {others.map((p) => (
            <option key={p.id} value={p.id}>
              À {p.name} (en secret)
            </option>
          ))}
        </select>
        <div className="msg-row">
          <input className="input" value={text} maxLength={WHISPER_MAX} placeholder="Ton message…" aria-label="Ton message" onChange={(e) => setText(e.target.value)} />
          <button type="submit" className="icon-btn is-solid" aria-label="Envoyer" disabled={!text.trim()}>
            <Send size={18} />
          </button>
        </div>
      </form>
    </div>
  );
}
