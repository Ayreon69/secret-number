// Le plan du réseau : les joueurs sont des stations sur une ligne circulaire. Quand deux joueurs entrent en contact,
// une ligne s'allume un instant entre eux, chez tout le monde. Ses propres demandes en attente se dessinent en pointillés,
// à la couleur du ticket ; au centre, son propre numéro, qui reste « ?? » jusqu'à la fin.
import { AnimatePresence, motion } from 'framer-motion';
import { Bot, Check, WifiOff } from 'lucide-react';
import { useMemo } from 'react';
import type { PlayerView, RoomView, Ticket } from '../../../shared/protocol';
import { cls } from '../lib/util';
import type { Emote } from '../store';
import { Avatar, Flaps, SeatBadge } from './Ui';

interface Point {
  x: number;
  y: number;
}

/** Les places sur le cercle : soi en bas, puis les autres dans le sens des aiguilles d'une montre. */
function layout(order: string[], me: string): Map<string, Point> {
  const start = Math.max(0, order.indexOf(me));
  const ring = [...order.slice(start), ...order.slice(0, start)];
  const pos = new Map<string, Point>();
  ring.forEach((id, i) => {
    const a = Math.PI / 2 + (i / ring.length) * Math.PI * 2;
    pos.set(id, { x: 50 + 37 * Math.cos(a), y: 50 + 37 * Math.sin(a) });
  });
  return pos;
}

/** Rayon gardé libre autour du centre : la case « Ton numéro » ne doit cacher aucune ligne. */
const HUB_R = 18;

/** Une ligne entre deux stations, courbée vers le centre comme sur un plan, mais qui contourne la case du milieu. */
function curve(a: Point, b: Point): string {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  // Le sommet de la courbe (son point à mi-chemin) ; la courbe passe par lui, la poignée est au double.
  let px = mx + (50 - mx) * 0.275;
  let py = my + (50 - my) * 0.275;
  const d = Math.hypot(px - 50, py - 50);
  if (d < HUB_R) {
    // Deux stations face à face : on passe à côté du centre, du côté du milieu de la corde, sinon d'un côté fixe.
    let nx = mx - 50;
    let ny = my - 50;
    let n = Math.hypot(nx, ny);
    if (n < 1) {
      nx = -(b.y - a.y);
      ny = b.x - a.x;
      if (nx < 0 || (nx === 0 && ny < 0)) {
        nx = -nx;
        ny = -ny;
      }
      n = Math.hypot(nx, ny);
    }
    px = 50 + (nx / n) * HUB_R;
    py = 50 + (ny / n) * HUB_R;
  }
  const cx = 2 * px - mx;
  const cy = 2 * py - my;
  return `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`;
}

export interface Pending {
  with: string;
  type: Ticket;
  dir: 'out' | 'in';
}

export function Network({
  view,
  emotes,
  onPick,
  selected,
  pending,
  cordTypes,
  canAsk,
  centre,
}: {
  view: RoomView;
  emotes: Emote[];
  onPick: (id: string) => void;
  selected: string | null;
  pending: Pending[];
  /** La couleur des lignes qui me concernent : je sais, moi, quel ticket on a donné. */
  cordTypes: Map<number, Ticket>;
  canAsk: boolean;
  centre: React.ReactNode;
}) {
  const g = view.game!;
  const pos = useMemo(() => layout(g.order, view.me), [g.order, view.me]);
  const players = g.order.map((id) => view.players.find((p) => p.id === id)).filter((p): p is PlayerView => !!p);
  const active = new Set(g.cords.flatMap((c) => [c.a, c.b]));
  const n = players.length;

  return (
    <div className={cls('network', `has-${n}`, g.stage !== 'open' && 'is-closed')}>
      <svg className="net-lines" viewBox="0 0 100 100" aria-hidden>
        <circle className="net-ring" cx="50" cy="50" r="37" />
        {pending.map((p) => {
          const a = pos.get(view.me);
          const b = pos.get(p.with);
          if (!a || !b) return null;
          return <path key={`${p.dir}${p.with}${p.type}`} className={cls('net-pending', `is-${p.type}`, `is-${p.dir}`)} d={p.dir === 'out' ? curve(a, b) : curve(b, a)} />;
        })}
        <AnimatePresence>
          {g.cords.map((c) => {
            const a = pos.get(c.a);
            const b = pos.get(c.b);
            if (!a || !b) return null;
            const type = cordTypes.get(c.id);
            return (
              <motion.path
                key={c.id}
                className={cls('net-cord', type && `is-${type}`)}
                d={curve(a, b)}
                initial={{ pathLength: 0, opacity: 1 }}
                animate={{ pathLength: 1, opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.6 } }}
                transition={{ duration: 0.7, ease: 'easeOut' }}
              />
            );
          })}
        </AnimatePresence>
      </svg>

      <div className="net-centre">{centre}</div>

      {players.map((p) => {
        const at = pos.get(p.id)!;
        const me = p.id === view.me;
        const bubble = emotes.filter((e) => e.playerId === p.id).slice(-1)[0];
        const away = p.autopilot || !p.connected;
        return (
          <div key={p.id} className={cls('station-slot', me && 'is-me')} style={{ left: `${at.x}%`, top: `${at.y}%` }}>
            <button
              type="button"
              className={cls('station', me && 'is-me', selected === p.id && 'is-selected', active.has(p.id) && 'is-live', !p.connected && 'is-off', canAsk && !me && 'is-askable')}
              onClick={() => onPick(p.id)}
              aria-label={me ? 'Toi : ouvrir ta fiche' : `${p.name} : proposer un contact`}
            >
              <Avatar avatar={p.avatar} className="station-avatar" />
              <SeatBadge seat={p.seat} className="station-seat" />
              {p.done && !away && (
                <span className="station-done" aria-label="Fiche rendue">
                  <Check size={11} strokeWidth={3.5} />
                </span>
              )}
              {away && (
                <span className="station-state" aria-label={p.autopilot ? 'Pilote automatique' : 'Absent'}>
                  {p.autopilot ? <Bot size={11} /> : <WifiOff size={11} />}
                </span>
              )}
            </button>
            <span className="station-name">{me ? 'Toi' : p.name}</span>
            <AnimatePresence>
              {bubble && (
                <motion.span key={bubble.id} className={cls('bubble', bubble.emoji.length > 3 && 'is-text')} initial={{ scale: 0.4, y: 6, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ opacity: 0, y: -6 }}>
                  {bubble.emoji}
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

/** Le centre du plan : son propre numéro, qui reste caché. */
export function SecretHub({ label = 'Ton numéro', text = '??' }: { label?: string; text?: string }) {
  return (
    <div className="hub">
      <span className="hub-label">{label}</span>
      <Flaps text={text} size="lg" spin={false} />
    </div>
  );
}
