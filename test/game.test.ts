// Tests du moteur : les quatre tickets, les demandes de contact, les dons, les fiches, le décompte et le raisonnement des bots.
import { describe, expect, it } from 'vitest';
import { contact, resultText, zerosBetween, type Ticket } from '../shared/protocol';
import { Brain, SKILLS, codeOf } from '../server/bots';
import { Game } from '../server/game';

const EXPERT = SKILLS.find((s) => s.name === 'expert')!;

function game(nums = [33, 22, 44, 88]) {
  return new Game(['a', 'b', 'c', 'd'], nums);
}

describe('les tickets', () => {
  it('Plus : la somme, ou seulement une fourchette aux extrêmes', () => {
    expect(contact('plus', 33, 22)).toEqual({ value: 55, range: null });
    expect(contact('plus', 1, 2)).toEqual({ value: 0, range: 'low' });
    expect(contact('plus', 9, 11)).toEqual({ value: 0, range: 'low' });
    expect(contact('plus', 11, 10)).toEqual({ value: 21, range: null });
    expect(contact('plus', 100, 80)).toEqual({ value: 0, range: 'high' });
    expect(contact('plus', 100, 79)).toEqual({ value: 179, range: null });
    expect(resultText(contact('plus', 2, 5))).toBe('entre 3 et 20');
    expect(resultText(contact('plus', 99, 100))).toBe('entre 180 et 199');
  });
  it('Fois : le dernier chiffre du produit (33 × 22 = 726 → 6)', () => {
    expect(contact('fois', 33, 22).value).toBe(6);
    expect(contact('fois', 10, 7).value).toBe(0);
  });
  it('Divisé : le grand divisé par le petit, sans la virgule', () => {
    expect(contact('divise', 22, 89).value).toBe(4);
    expect(contact('divise', 50, 51).value).toBe(1);
    expect(contact('divise', 100, 1).value).toBe(100);
  });
  it('Zéro : les 0 écrits dans les nombres strictement entre les deux (44 et 88 → 50, 60, 70, 80)', () => {
    expect(contact('zero', 44, 88).value).toBe(4);
    expect(zerosBetween(88, 44)).toBe(4);
    expect(zerosBetween(30, 40)).toBe(0);
    expect(zerosBetween(29, 31)).toBe(1);
    expect(zerosBetween(1, 100)).toBe(9);
  });
  it('le résultat est le même des deux côtés', () => {
    for (const t of ['plus', 'fois', 'divise', 'zero'] as Ticket[]) {
      for (let i = 0; i < 200; i++) {
        const a = 1 + Math.floor(Math.random() * 100);
        const b = 1 + Math.floor(Math.random() * 100);
        if (a !== b) expect(contact(t, a, b)).toEqual(contact(t, b, a));
      }
    }
  });
});

describe('la partie', () => {
  it('tire des numéros tous différents entre 1 et 100', () => {
    for (let i = 0; i < 50; i++) {
      const g = new Game(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']);
      const nums = [...g.numbers.values()];
      expect(new Set(nums).size).toBe(10);
      expect(nums.every((n) => n >= 1 && n <= 100)).toBe(true);
    }
  });

  it('un contact accepté dépense un ticket de chaque côté et donne le même résultat aux deux', () => {
    const g = game();
    const r = g.ask('a', 'b', 'fois', 1e12);
    expect(typeof r).toBe('object');
    const id = (r as { request: { id: number } }).request.id;
    expect(g.incomingOf('b').map((x) => x.id)).toEqual([id]);
    expect(g.ask('a', 'c', 'plus', 1e12)).toMatch(/déjà une demande/);
    const res = g.answer('b', id, true);
    expect(typeof res).toBe('object');
    expect(g.tickets.get('a')!.fois).toBe(0);
    expect(g.tickets.get('b')!.fois).toBe(0);
    expect(g.results.get('a')![0]).toMatchObject({ type: 'fois', with: 'b', value: 6 });
    expect(g.results.get('b')![0]).toMatchObject({ type: 'fois', with: 'a', value: 6 });
    expect(g.results.get('c')).toEqual([]);
    expect(g.ask('a', 'c', 'fois', 1e12)).toMatch(/plus de ticket Fois/);
  });

  it('seul le destinataire répond, et un refus ne coûte rien', () => {
    const g = game();
    const { request } = g.ask('a', 'b', 'plus', 1e12) as { request: { id: number } };
    expect(g.answer('c', request.id, true)).toMatch(/n’existe plus/);
    expect(typeof g.answer('b', request.id, false)).toBe('object');
    expect(g.tickets.get('a')!.plus).toBe(1);
    expect(g.tickets.get('b')!.plus).toBe(1);
    expect(g.results.get('a')).toEqual([]);
  });

  it('deux demandes croisées du même ticket se rejoignent', () => {
    const g = game();
    g.ask('a', 'b', 'zero', 1e12);
    const r = g.ask('b', 'a', 'zero', 1e12) as { contact?: unknown };
    expect(r.contact).toBeTruthy();
    expect(g.requests.size).toBe(0);
    expect(g.results.get('a')![0].value).toBe(contact('zero', 33, 22).value);
  });

  it('les demandes tombent à leur échéance', () => {
    const g = game();
    g.ask('a', 'b', 'plus', 100);
    g.ask('c', 'd', 'plus', 300);
    expect(g.expire(200).map((r) => r.from)).toEqual(['a']);
    expect(g.requests.size).toBe(1);
  });

  it('un carnet de plus donne un ticket de chaque', () => {
    const g = game();
    g.buy('a');
    expect(g.tickets.get('a')).toEqual({ plus: 2, fois: 2, divise: 2, zero: 2 });
    expect(g.bought.get('a')).toBe(1);
  });

  it('on peut donner un ticket, sauf celui réservé par sa demande en attente', () => {
    const g = game();
    g.ask('a', 'b', 'plus', 1e12);
    expect(g.give('a', 'c', 'plus')).toMatch(/réservé/);
    expect(g.give('a', 'c', 'fois')).toBeUndefined();
    expect(g.tickets.get('c')!.fois).toBe(2);
    expect(g.gifts.get('c')![0]).toMatchObject({ from: 'a', type: 'fois' });
    expect(g.give('a', 'c', 'fois')).toMatch(/plus de ticket/);
  });

  it('accepter avec son dernier ticket fait tomber sa propre demande du même ticket', () => {
    const g = game();
    g.ask('b', 'c', 'plus', 1e12);
    const { request } = g.ask('a', 'b', 'plus', 1e12) as { request: { id: number } };
    g.answer('b', request.id, true);
    expect(g.outgoingOf('b')).toBeUndefined();
    expect(g.notices.get('c')!.length).toBe(1);
  });

  it('le standard fermé n’accepte plus de contact, mais la fiche reste ouverte', () => {
    const g = game();
    g.ask('a', 'b', 'plus', 1e12);
    expect(g.close().length).toBe(1);
    expect(g.ask('c', 'd', 'plus', 1e12)).toMatch(/fermé/);
    expect(g.buy('a')).toMatch(/fermé/);
    expect(g.setAnswer('a', 'b', 22)).toBeUndefined();
    expect(g.setAnswer('a', 'b', 101)).toMatch(/entre 1 et 100/);
  });
});

describe('le décompte', () => {
  it('son numéro vaut ±5, ceux des autres ±1, et un tout-juste +5', () => {
    const g = game();
    // a trouve tout ; b se trompe sur lui-même ; c laisse tout vide ; d trouve a.
    for (const [t, n] of Object.entries({ a: 33, b: 22, c: 44, d: 88 })) g.setAnswer('a', t, n);
    g.setAnswer('b', 'b', 50);
    g.setAnswer('b', 'a', 34);
    g.setAnswer('d', 'd', 88);
    g.setAnswer('d', 'a', 33);
    g.buy('d');
    const s = (id: string) => g.score(id);
    // a : +5, trois justes, bonus +5, trouvé par d (−1).
    expect(s('a')).toEqual({ own: 5, right: 3, wrong: 0, bonus: 5, found: 1, bought: 0, total: 12 });
    // b : −5, une fausse, trouvé par a.
    expect(s('b')).toEqual({ own: -5, right: 0, wrong: 1, bonus: 0, found: 1, bought: 0, total: -7 });
    // c : vide = faux pour lui-même, rien pour les autres, trouvé par a.
    expect(s('c').total).toBe(-6);
    // d : +5, une juste, trouvé par a, un carnet acheté.
    expect(s('d')).toEqual({ own: 5, right: 1, wrong: 0, bonus: 0, found: 1, bought: 1, total: 4 });
    const rows = g.standings();
    expect(rows.map((r) => r.id)).toEqual(['a', 'd', 'c', 'b']);
    expect(rows.map((r) => r.place)).toEqual([1, 2, 3, 4]);
  });

  it('les ex æquo partagent la place', () => {
    const g = game();
    const rows = g.standings();
    expect(rows.every((r) => r.place === 1)).toBe(true);
  });
});

describe('les bots', () => {
  it('le vrai numéro reste toujours possible', () => {
    for (let k = 0; k < 30; k++) {
      const nums = new Game(['me', 'p', 'q']).numbers;
      const me = nums.get('me')!;
      const b = new Brain('me');
      for (const t of ['plus', 'divise', 'zero', 'fois'] as Ticket[]) {
        b.learn('p', t, codeOf(contact(t, me, nums.get('p')!)), EXPERT);
        b.learn('q', t, codeOf(contact(t, me, nums.get('q')!)), EXPERT);
      }
      expect(b.posterior().px[me]).toBeGreaterThan(0);
    }
  });

  it('deux carnets joués avec deux partenaires suffisent presque toujours à trouver son numéro', () => {
    let found = 0;
    const N = 60;
    for (let k = 0; k < N; k++) {
      const nums = new Game(['me', 'p', 'q']).numbers;
      const me = nums.get('me')!;
      const b = new Brain('me');
      for (const p of ['p', 'q']) for (const t of ['plus', 'divise', 'zero', 'fois'] as Ticket[]) b.learn(p, t, codeOf(contact(t, me, nums.get(p)!)), EXPERT);
      if (b.guess().n === me) found++;
    }
    expect(found / N).toBeGreaterThan(0.8);
  });

  it('un contact déjà fait n’apprend plus rien', () => {
    const b = new Brain('me');
    b.learn('p', 'plus', 87, EXPERT);
    expect(b.gain('p', 'plus')).toBeCloseTo(0, 5);
    expect(b.gain('p', 'divise')).toBeGreaterThan(0.1);
    expect(b.gain('q', 'plus')).toBeGreaterThan(0.1);
  });

  it('écrit toujours son numéro, et ceux des autres seulement quand il en est sûr', () => {
    const b = new Brain('me');
    const sheet = b.sheet(['me', 'p', 'q'], EXPERT);
    expect(sheet.me).toBeGreaterThanOrEqual(1);
    expect(sheet.p).toBeNull();
    expect(sheet.q).toBeNull();
  });
});
