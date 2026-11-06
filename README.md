# Secret Number

Chacun a un numéro secret entre 1 et 100. Personne ne connaît le sien. Pour le trouver, il faut parler aux autres.

👉 **Jouer : https://secret-number-jboy.onrender.com** (la première ouverture peut prendre jusqu'à une minute, le temps que le serveur gratuit se réveille)

Jeu de déduction et de négociation multijoueur, à jouer entre amis depuis un navigateur, sur téléphone ou ordinateur, sans compte ni installation.
D'après *Secret Number*, l'épreuve principale du 3e jour de *The Devil's Plan* (saison 1, Netflix). Création de fans, non officielle, avec ses propres visuels.

## Règles en bref

- De 4 à 10 joueurs. Chacun reçoit **un numéro entre 1 et 100**, différent pour tout le monde, que **personne ne connaît, pas même lui**.
- **Un contact** : deux joueurs donnent **le même ticket**. Les deux apprennent le même résultat sur leurs deux numéros, et personne d'autre. Les autres voient seulement une ligne s'allumer entre eux sur le plan.
- **Les quatre tickets** :
  - **Plus** : la somme des deux numéros. Jusqu'à 20, on apprend seulement « entre 3 et 20 » ; à partir de 180, « entre 180 et 199 ».
  - **Fois** : le dernier chiffre du produit (33 × 22 = 726 → 6).
  - **Divisé** : le grand divisé par le petit, sans la virgule (89 ÷ 22 → 4).
  - **Zéro** : combien de 0 on écrit en comptant de l'un à l'autre (de 44 à 88 : 50, 60, 70, 80 → 4).
- On commence avec **un carnet** (un ticket de chaque). Un carnet de plus coûte **1 point**. On peut **donner un ticket** à quelqu'un.
- **Tout est permis** : raconter ses résultats, s'allier, mentir.
- **La fiche** : à la fin, chacun écrit le numéro de tout le monde, le sien compris.
  - Le sien juste : **+5**, faux ou vide : **−5**.
  - Celui d'un autre juste : **+1**, faux : **−1**, vide : 0.
  - Toute la fiche juste : **+5** de plus.
  - Chaque joueur qui a trouvé **ton** numéro : **−1**.
- Le plus de points gagne ; les ex æquo gagnent ensemble.

## Ce qui vient de l'émission, ce qui change

Repris de l'émission : les numéros de 1 à 100 inconnus de tous, le contact où les deux donnent le même ticket, les quatre tickets et leurs fourchettes, le carnet de départ et le carnet payant, le don de ticket, les contacts visibles de tous (qui avec qui, pas le ticket), et le barème de la fiche.

Adapté au téléphone :

- **De 4 à 10 joueurs**, et un carnet coûte **un point** (une pièce dans l'émission).
- **Une durée choisie par l'hôte** : 10, 15, 20 ou 30 minutes, ou sans limite (l'émission durait deux heures). Quand le temps est écoulé, le standard ferme : plus de contact, et **une dernière minute** pour finir sa fiche. La partie s'arrête aussi dès que chaque humain a rendu la sienne.
- **Le contact se demande** : on touche un joueur sur le plan, on choisit un ticket, il accepte ou refuse dans les 45 secondes. Si les deux se demandent le même ticket en même temps, le contact se fait tout seul.
- **Pour négocier**, l'hôte choisit : **à voix haute**, autour de la table (par défaut), ou **par messages écrits**, à une personne en secret ou à tout le monde, pour jouer à distance.
- **Aucune aide au calcul** : l'appli ne garde aucun historique de ses résultats et ne déduit rien. Chaque résultat s'affiche une fois ; on le note d'un geste dans **ses notes**, un carnet libre gardé par le serveur (une coupure ne l'efface pas). La fiche montre seulement ce qu'on y a écrit.

## Bots

Ils ne savent que ce qu'un joueur saurait : leurs propres contacts. Pour chaque numéro possible, ils tiennent la chance que ce soit le leur, puis demandent le contact qui leur en apprendra le plus (en gardant un œil sur ce qu'ils apprennent du numéro de l'autre). Ils achètent un carnet quand ils ne sont pas encore sûrs, rendent leur fiche quand ils le sont, et oublient un peu.

Trois niveaux, tirés au hasard : **novice** (il oublie davantage et n'achète qu'un carnet au plus), **habile** (deux) et **expert** (trois, et il n'oublie rien). Un bot refusé laisse ce joueur tranquille un moment, et un humain ne reçoit jamais plus d'une demande de bot à la fois.

Mesuré sur 100 parties entre bots, de 4 à 10 joueurs (`npx tsx test/sim.ts 100`), environ 23 contacts par partie :

| Niveau | Score moyen | Trouve son numéro | Victoires |
|---|---|---|---|
| Expert | +3,4 | 90 % | 40 % |
| Habile | +2,6 | 86 % | 27 % |
| Novice | +0,4 | 67 % | 26 % |
| Naïf (contacts au hasard, référence) | −2,3 | 34 % | 5 % |

## Fonctionnalités

- Créer une table et inviter avec un code à 4 lettres, un lien, le partage du téléphone ou un QR code ; ou jouer contre des bots en un clic
- Le plan du réseau : les joueurs sont des stations sur une ligne circulaire, chacune avec sa plaque émaillée ; une ligne s'allume un instant entre deux joueurs qui entrent en contact, et ses propres demandes en attente se dessinent en pointillés à la couleur du ticket
- Au centre, son propre numéro, qui reste « ?? » jusqu'à la fin
- Les tickets comme des tickets de métro, un carnet de plus en deux touches
- La fiche à palettes, remplie avec un pavé de 1 à 100 ; le bouton pour la rendre reste toujours à portée
- Ses notes, ses messages écrits (selon le réglage), réactions et petites phrases (« Menteur ! », « Alliance ? »)
- Fin de partie : le tableau des arrivées dévoile les numéros un par un, à côté de ce que tu avais écrit ; tampon du gagnant, classement détaillé, tous les contacts de la partie, victoires de la soirée, revanche en un clic
- Spectateurs, reprise automatique après une coupure, pilote automatique après 20 secondes d'absence (il refuse les contacts et écrit son numéro à la fin), l'hôte qui part passe la main
- Sons synthétisés et vibrations, `prefers-reduced-motion` respecté, pensé pour le téléphone et confortable sur ordinateur (le plan à gauche, la fiche à droite)

## Développement

```bash
npm install
npm run dev          # serveur (port 3260) + client Vite (port 5205)
npm test             # tickets, contacts, poignée de main, dons, carnets, fiche, barème, bots
npm run typecheck
npm run build        # client dans dist/client, serveur dans dist/server
npm start            # sert le tout sur le port 3260 (ou $PORT)
npm run e2e          # deux parties complètes avec de vrais clients Socket.IO (après build)
npx tsx test/sim.ts 100   # force des bots
```

`SN_FAST=1` fait durer une minute de partie une seconde et presse les bots (tests locaux uniquement).

## Architecture

- `shared/protocol.ts` : constantes, réglages, vues et calcul des tickets, communs au client et au serveur
- `server/` : Express + Socket.IO, moteur de partie (`game.ts`), bots (`bots.ts`), table, minuteries et vue de chacun (`room.ts`). Le serveur fait autorité, et chacun ne reçoit que sa vue : jamais un numéro (pas même le sien) avant la fin, ni les tickets, demandes, résultats, fiche ou notes d'un autre. Un geste privé (demande, refus, achat, don, fiche, notes, message) n'est envoyé qu'aux joueurs concernés : même l'arrivée d'un état chez les autres trahirait que quelqu'un a agi
- `client/` : React + Vite + Framer Motion. Le plan est dans `components/Network.tsx`, la fiche, le pavé, les notes et les messages dans `components/Desk.tsx`, les palettes et les tickets dans `components/Ui.tsx`
- `test/e2e.mjs` vérifie à chaque état reçu qu'aucune information cachée ne fuit, par son contenu ou par son seul envoi, puis recalcule chaque résultat et chaque score à partir des numéros dévoilés
