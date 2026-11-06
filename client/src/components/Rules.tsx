// Les règles, lisibles en deux minutes et consultables à tout moment.
import { ClipboardList, Handshake, MessagesSquare, Ticket as TicketIcon, Trophy } from 'lucide-react';
import { TICKETS } from '../../../shared/protocol';
import { TICKET_NAME } from '../lib/text';
import { useStore } from '../store';
import { Flaps, Modal, TicketStub } from './Ui';

const EXAMPLES: Record<(typeof TICKETS)[number], { calc: string; out: string; note?: string }> = {
  plus: { calc: '33 + 22', out: '55', note: 'Jusqu’à 20, on apprend seulement « entre 3 et 20 » ; à partir de 180, « entre 180 et 199 ».' },
  fois: { calc: '33 × 22 = 726', out: '6', note: 'Seulement le dernier chiffre du produit.' },
  divise: { calc: '89 ÷ 22 = 4,04…', out: '4', note: 'Toujours le grand divisé par le petit, sans la virgule.' },
  zero: { calc: '44 → 88', out: '4', note: 'On écrit 45, 46… 87 : les 0 sont ceux de 50, 60, 70 et 80.' },
};

export function RulesModal() {
  const open = useStore((s) => s.rulesOpen);
  const setOpen = useStore((s) => s.setRulesOpen);
  return (
    <Modal open={open} onClose={() => setOpen(false)} title="Les règles" wide>
      <div className="rules">
        <section className="rule-hero">
          <p>
            Chacun reçoit un <b>numéro secret entre 1 et 100</b>, différent pour tout le monde. <b>Personne ne connaît le sien</b>, ni celui des autres. À la fin, on écrit sur sa fiche le numéro de chacun, le sien compris.
          </p>
        </section>

        <section>
          <h3>
            <Handshake size={18} aria-hidden /> Un contact
          </h3>
          <p>
            Deux joueurs donnent <b>le même ticket</b> : touche un joueur sur le plan, choisis un ticket, il accepte ou refuse. Les deux apprennent alors <b>le même résultat</b> sur leurs deux numéros, et personne d'autre. Les autres voient seulement la ligne s'allumer entre vous.
          </p>
        </section>

        <section>
          <h3>
            <TicketIcon size={18} aria-hidden /> Les quatre tickets
          </h3>
          <ul className="rule-tickets">
            {TICKETS.map((t) => (
              <li key={t}>
                <TicketStub type={t} size="sm" />
                <div>
                  <p className="rule-calc">
                    <span>{EXAMPLES[t].calc}</span> <Flaps text={EXAMPLES[t].out} size="xs" spin={false} label={`${TICKET_NAME[t]} : ${EXAMPLES[t].out}`} />
                  </p>
                  {EXAMPLES[t].note && <p className="muted small">{EXAMPLES[t].note}</p>}
                </div>
              </li>
            ))}
          </ul>
          <p>
            On commence avec <b>un carnet</b> : un ticket de chaque. Un carnet de plus coûte <b>1 point</b>. On peut aussi <b>donner un ticket</b> à quelqu'un.
          </p>
        </section>

        <section>
          <h3>
            <MessagesSquare size={18} aria-hidden /> Parler
          </h3>
          <p>
            Tout est permis : raconter ses résultats, s'allier, mentir, se taire. Un seul joueur ne voit que ses propres contacts ; à plusieurs, on recoupe. Rien n'est gardé pour toi : <b>note ce que tu apprends</b> dans tes notes.
          </p>
        </section>

        <section>
          <h3>
            <ClipboardList size={18} aria-hidden /> La fiche
          </h3>
          <ul className="rule-scores">
            <li>
              <b>Ton numéro</b> juste : <b className="good">+5</b>, faux ou vide : <b className="bad">−5</b>.
            </li>
            <li>
              Le numéro d'un autre juste : <b className="good">+1</b>, faux : <b className="bad">−1</b>, laissé vide : 0.
            </li>
            <li>
              Toute la fiche juste : <b className="good">+5</b> de plus.
            </li>
            <li>
              Chaque joueur qui a trouvé <b>ton</b> numéro : <b className="bad">−1</b>.
            </li>
          </ul>
          <p>
            La partie s'arrête à la fin du temps (on a alors une minute pour finir sa fiche), ou dès que tout le monde a rendu la sienne.
          </p>
        </section>

        <section className="rule-win">
          <h3>
            <Trophy size={18} aria-hidden /> Qui gagne ?
          </h3>
          <p>Le plus de points. Les ex æquo gagnent ensemble.</p>
        </section>
        <p className="muted small">D'après l'épreuve « Secret Number » de The Devil's Plan (Netflix). Création de fans, non officielle.</p>
      </div>
    </Modal>
  );
}
