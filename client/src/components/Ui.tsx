// Briques d'interface communes : boutons, fenêtres, pastilles, sélecteurs, logo, avatars, palettes du tableau d'affichage,
// tickets de métro et le décor du plan du réseau.
import { X } from 'lucide-react';
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Ticket } from '../../../shared/protocol';
import { TICKET_NAME, TICKET_SIGN } from '../lib/text';
import { cls, reducedMotion } from '../lib/util';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'ghost' | 'danger' | 'soft' | 'ink';
  icon?: ReactNode;
}

export function Button({ variant = 'default', icon, className, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} className={cls('btn', `btn-${variant}`, className)} {...rest}>
      {icon}
      {children && <span className="btn-label">{children}</span>}
    </button>
  );
}

// ───────────────────────────── Le tableau à palettes ─────────────────────────────

const SPIN = '0123456789ABCDEFGHIJKLMNOPRSTUVXYZ?';

/** Une palette : quand son caractère change, elle tourne et fait défiler quelques caractères avant de se poser. */
function Flap({ ch, delay, spin, onTurn }: { ch: string; delay: number; spin: boolean; onTurn?: () => void }) {
  const [shown, setShown] = useState(ch);
  const [turn, setTurn] = useState(0);
  const current = useRef(ch);
  const turnRef = useRef(onTurn);
  turnRef.current = onTurn;
  useEffect(() => {
    if (ch === current.current) return;
    if (!spin || reducedMotion()) {
      current.current = ch;
      setShown(ch);
      return;
    }
    const timers: number[] = [];
    const steps = 2 + Math.floor(Math.random() * 4);
    let n = 0;
    const step = () => {
      n++;
      const next = n >= steps ? ch : SPIN[Math.floor(Math.random() * SPIN.length)];
      current.current = next;
      setShown(next);
      setTurn((t) => t + 1);
      turnRef.current?.();
      if (n < steps) timers.push(window.setTimeout(step, 65));
    };
    timers.push(window.setTimeout(step, delay));
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      current.current = ch;
      setShown(ch);
    };
  }, [ch, delay, spin]);
  return (
    <span className={cls('flap', shown === ' ' && 'is-blank')}>
      <span key={turn} className={cls('flap-ch', turn > 0 && 'is-turning')}>
        {shown === ' ' ? ' ' : shown}
      </span>
    </span>
  );
}

/** Un mot ou un nombre sur le tableau d'affichage, une palette par caractère. */
export function Flaps({ text, size = 'md', className, spin = true, stagger = 45, label, onTurn }: { text: string; size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'; className?: string; spin?: boolean; stagger?: number; label?: string; onTurn?: () => void }) {
  return (
    <span className={cls('flaps', `flaps-${size}`, className)} role="text" aria-label={label ?? text}>
      {[...text].map((ch, i) => (
        <Flap key={i} ch={ch} delay={i * stagger} spin={spin} onTurn={i === 0 ? onTurn : undefined} />
      ))}
    </span>
  );
}

/** Le titre : deux lignes de palettes. Sur la table, seulement l'emblème : deux palettes qui cachent un numéro. */
export function Logo({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  if (size === 'sm') {
    return (
      <span className="logo logo-sm" role="img" aria-label="Secret Number">
        <span className="logo-tiles" aria-hidden>
          <span className="flap">
            <span className="flap-ch">?</span>
          </span>
          <span className="flap">
            <span className="flap-ch">?</span>
          </span>
        </span>
        <span className="logo-name" aria-hidden>
          Secret <b>Number</b>
        </span>
      </span>
    );
  }
  return (
    <div className={cls('logo', `logo-${size}`)} role="img" aria-label="Secret Number">
      <Flaps text="SECRET" size={size === 'lg' ? 'lg' : 'md'} spin={false} />
      <Flaps text="NUMBER" size={size === 'lg' ? 'lg' : 'md'} spin={false} className="logo-second" />
      <span className="logo-dot" aria-hidden />
    </div>
  );
}

/** Le décor : le papier du plan du réseau, son quadrillage et quelques lignes qui le traversent. */
export function Backdrop({ children, className, quiet = false }: { children: ReactNode; className?: string; quiet?: boolean }) {
  return (
    <div className={cls('backdrop', quiet && 'is-quiet', className)}>
      <svg className="map-lines" viewBox="0 0 400 800" preserveAspectRatio="xMidYMid slice" aria-hidden>
        <path className="ml is-plus" d="M-20 140 H120 Q150 140 170 160 L300 290 Q320 310 350 310 H430" />
        <path className="ml is-fois" d="M60 -20 V250 Q60 280 80 300 L220 440 Q240 460 240 490 V830" />
        <path className="ml is-divise" d="M-20 600 H90 Q120 600 140 580 L260 460 Q280 440 310 440 H430" />
        <path className="ml is-zero" d="M330 -20 V120 Q330 150 310 170 L180 300 Q160 320 160 350 V830" />
        {[
          [120, 140],
          [60, 250],
          [170, 160],
          [240, 490],
          [90, 600],
          [310, 440],
          [330, 120],
          [160, 350],
          [350, 310],
        ].map(([x, y]) => (
          <circle key={`${x}-${y}`} className="ml-stop" cx={x} cy={y} r="7" />
        ))}
      </svg>
      <div className="backdrop-body">{children}</div>
    </div>
  );
}

export function Pill({ tone, children, className }: { tone?: 'ink' | 'soft' | 'red' | 'gold'; children: ReactNode; className?: string }) {
  return <span className={cls('pill', tone && `pill-${tone}`, className)}>{children}</span>;
}

interface SegmentedOption<T> {
  value: T;
  label: string;
  sub?: string;
  disabled?: boolean;
}

export function Segmented<T extends string | number | boolean>({ options, value, onChange, disabled, label, className }: { options: SegmentedOption<T>[]; value: T; onChange: (v: T) => void; disabled?: boolean; label: string; className?: string }) {
  return (
    <div className={cls('segmented', className)} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          disabled={disabled || o.disabled}
          className={cls('seg', o.value === value && 'is-on')}
          onClick={() => onChange(o.value)}
        >
          <b>{o.label}</b>
          {o.sub && <small>{o.sub}</small>}
        </button>
      ))}
    </div>
  );
}

/**
 * Une fenêtre, rendue à la racine du document pour ne dépendre d'aucun parent.
 * « sheet » : sur téléphone, elle monte du bas de l'écran, à portée de pouce.
 */
export function Modal({ open, onClose, title, children, wide, sheet, footer, className }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean; sheet?: boolean; footer?: ReactNode; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current();
    };
    window.addEventListener('keydown', onKey);
    const t = window.setTimeout(() => box.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true }), 30);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(t);
      before?.focus?.({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className={cls('modal-back', sheet && 'is-sheet')} onClick={onClose}>
      <div ref={box} className={cls('modal', wide && 'is-wide', sheet && 'is-sheet', className)} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" aria-label="Fermer" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export const AVATAR_EMOJI: Record<string, string> = {
  valise: '🧳',
  parapluie: '☂️',
  lunettes: '🕶️',
  chapeau: '🎩',
  journal: '📰',
  cafe: '☕',
  casque: '🎧',
  echarpe: '🧣',
  renard: '🦊',
  chat: '🐈',
  hibou: '🦉',
  velo: '🚲',
};

export const AVATAR_LABELS: Record<string, string> = {
  valise: 'Valise',
  parapluie: 'Parapluie',
  lunettes: 'Lunettes noires',
  chapeau: 'Chapeau',
  journal: 'Journal',
  cafe: 'Café',
  casque: 'Casque',
  echarpe: 'Écharpe',
  renard: 'Renard',
  chat: 'Chat',
  hibou: 'Hibou',
  velo: 'Vélo',
};

export function Avatar({ avatar, className }: { avatar: string; className?: string }) {
  return (
    <span className={cls('avatar', className)} aria-hidden>
      {AVATAR_EMOJI[avatar] ?? '🧳'}
    </span>
  );
}

/** Le numéro de place, comme un numéro de ligne : un rond noir. */
export function SeatBadge({ seat, className }: { seat: number | null | undefined; className?: string }) {
  if (!seat) return null;
  return (
    <span className={cls('seat-badge', className)} aria-label={`Place ${seat}`}>
      {seat}
    </span>
  );
}

/** Un ticket de métro, à la couleur de sa ligne : son signe, son nom, et combien on en a. */
export function TicketStub({ type, count, className, size = 'md', onClick, disabled, selected, hint }: { type: Ticket; count?: number; className?: string; size?: 'sm' | 'md'; onClick?: () => void; disabled?: boolean; selected?: boolean; hint?: string }) {
  const body = (
    <>
      <span className="ticket-sign" aria-hidden>
        {TICKET_SIGN[type]}
      </span>
      <span className="ticket-name">{TICKET_NAME[type]}</span>
      {count !== undefined && <span className="ticket-count">×{count}</span>}
      {hint && <span className="ticket-hint">{hint}</span>}
      <span className="ticket-stripe" aria-hidden />
    </>
  );
  const classes = cls('ticket', `is-${type}`, `ticket-${size}`, count === 0 && 'is-empty', selected && 'is-selected', className);
  if (!onClick) return <span className={classes}>{body}</span>;
  return (
    <button type="button" className={classes} onClick={onClick} disabled={disabled} aria-pressed={selected}>
      {body}
    </button>
  );
}
