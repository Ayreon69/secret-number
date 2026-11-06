// Les mots de la table : noms, tickets, résultats, durées.
import { resultText, type ContactResult, type Duration, type RoomView, type Ticket } from '../../../shared/protocol';

export function nameOf(view: RoomView, id: string | undefined | null): string {
  if (!id) return '?';
  if (id === view.me) return 'toi';
  return view.players.find((p) => p.id === id)?.name ?? '?';
}

export function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** « de Rome », mais « d'Opéra » : l'élision devant une voyelle ou un h. */
export function deName(name: string): string {
  return /^[aeiouyhàâäéèêëîïôöùûüœæ]/i.test(name) ? `d'${name}` : `de ${name}`;
}

/** « Léa, Zino et Sam ». */
export function listing(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}`;
}

/** « 1re », « 2e ». */
export function placeLabel(n: number): string {
  return n === 1 ? '1re' : `${n}e`;
}

export function signed(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0';
}

export const TICKET_NAME: Record<Ticket, string> = { plus: 'Plus', fois: 'Fois', divise: 'Divisé', zero: 'Zéro' };
export const TICKET_SIGN: Record<Ticket, string> = { plus: '+', fois: '×', divise: '÷', zero: '0' };

/** Ce que dit chaque ticket, en une ligne. */
export const TICKET_RULE: Record<Ticket, string> = {
  plus: 'la somme des deux numéros',
  fois: 'le dernier chiffre de leur produit',
  divise: 'le grand divisé par le petit, sans la virgule',
  zero: 'combien de 0 on écrit entre les deux',
};

/** Le résultat d'un contact en phrase, du point de vue de celui qui le lit. */
export function resultSentence(r: ContactResult, partner: string): string {
  const v = resultText(r);
  switch (r.type) {
    case 'plus':
      return r.range ? `Ton numéro + celui ${deName(partner)} : ${v}.` : `Ton numéro + celui ${deName(partner)} = ${v}.`;
    case 'fois':
      return `Ton numéro × celui ${deName(partner)} finit par ${v}.`;
    case 'divise':
      return `Le plus grand des deux divisé par le plus petit : ${v} (sans la virgule).`;
    case 'zero':
      return `Entre vos deux numéros, on écrit ${v} zéro${r.value > 1 ? 's' : ''}.`;
  }
}

/** La ligne qu'on ajoute à ses notes. */
export function noteLine(r: ContactResult, partner: string): string {
  return `${TICKET_NAME[r.type]} avec ${partner} : ${resultText(r)}`;
}

export function durationLabel(m: Duration): string {
  return m ? `${m} min` : 'Sans limite';
}

/** « 14:05 ». */
export function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
