import { useEffect, useState } from 'react';
import { serverNow } from '../store';

export function cls(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${Math.abs(n) > 1 ? 's' : ''}`;
}

/** Force un rendu régulier (comptes à rebours, effacement des indices). */
export function useTick(ms = 250): number {
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export function secondsLeft(endsAt: number, now: number): number {
  return Math.max(0, Math.ceil((endsAt - now) / 1000));
}

export function shareUrl(code: string): string {
  return `${window.location.origin}/t/${code}`;
}

export function vibrate(pattern: number | number[]): void {
  try {
    // Le navigateur refuse de vibrer tant que le joueur n'a rien touché dans la page.
    if (navigator.userActivation?.hasBeenActive === false) return;
    navigator.vibrate?.(pattern);
  } catch {
    /* non supporté */
  }
}

/** L'utilisateur a demandé moins d'animations. */
export function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
