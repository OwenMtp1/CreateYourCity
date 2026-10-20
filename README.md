# CreateYourCity — prototype

Jeu web multijoueur persistant qui mêle construction urbaine en 3D et stratégie géopolitique sur un globe réel.
Chaque joueur choisit une ville réelle encore libre, en devient le dirigeant et la construit à partir de zéro, puis
commerce, négocie, s'étend, fait la guerre et participe à la vie politique de son pays face à d'autres humains.
Le monde tourne en temps réel continu, à vitesse fixe, sur un serveur autoritaire. Aucune IA ne joue ni ne génère de contenu.

> **État : phases 1 à 4 jouables dans une première version.** Ce qui fonctionne réellement et ce qui reste à faire est listé
> dans [`docs/ROADMAP.md`](docs/ROADMAP.md). Les choix provisoires sont dans [`docs/DECISIONS.md`](docs/DECISIONS.md),
> l'architecture dans [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Démarrage local

Prérequis : Node.js ≥ 22.12 et npm.

```bash
npm install
cp .env.example .env        # facultatif : valeurs par défaut adaptées au local
npm run dev                 # serveur de jeu (http://localhost:8787) + client Vite (http://localhost:5173)
```

Ouvrez <http://localhost:5173> dans deux navigateurs (ou une fenêtre privée) pour jouer à deux :

1. Saisissez un nom de dirigeant. Sans Supabase, le serveur crée une identité invitée signée.
2. Créez un salon (public ou privé). Le second joueur le rejoint avec le **code d'invitation** affiché dans la barre du haut.
3. Sur le **globe 3D**, tournez et zoomez (molette), cliquez sur une ville libre ou utilisez la recherche, puis **Prendre cette ville**.
4. Dans la **ville 3D** vide, tracez une **rue** depuis le portique jaune (accès régional, bord ouest), puis placez logements,
   commerces, bureaux, services, parcs… le long des routes. Glisser : déplacer la vue ; clic droit + glisser : pivoter ;
   `R` : tourner un bâtiment ; `G` : grille ; `Échap` : annuler. La ville vit au rythme du jour et de la nuit.
5. Barre latérale : **Économie, Population, Services** (ville active) ; **Territoire** (vos villes, annexions, transferts),
   **Commerce** (marché commun, contrats), **Diplomatie** (traités, guerre, paix, messages privés), **Armée** (caserne requise ;
   choisissez une destination sur le globe), **Nation** (élection, lois, grands projets, impôt national), **Salon** (chat, journal).
6. Un **tutoriel** guide les premiers pas ; les **conseillers** (🧭) signalent les problèmes chiffrés ; les **statistiques** (📈)
   retracent l'évolution de la ville. Routes droites, **courbes** ou **ronds-points** ; transports en commun ; voitures animées.
   **Circuit des biens** : les usines livrent par camion les commerces les plus proches (moins cher que d'importer),
   chaque commerce vend aux habitants à moins de 450 m, le surplus des usines est exporté ; la couche « Économie »
   montre le bénéfice de chaque entreprise, les livraisons, importations et exportations, et l'onglet Économie le
   schéma du circuit et les entreprises en perte. Bureaux +20 % près d'une école, logements +15 % d'impôt près d'un parc,
   entretien des services selon leur utilisation, **ponts** au-dessus de l'eau.
   **Sécession** (onglet Territoire, « ⚑ Indépendance ») : une ville devient une dictature indépendante, hors de son pays —
   ni impôt, ni lois, ni projets, ni subventions, ni vote ; aucune importation ni exportation, contrats annulés, pas de
   réseau régional d'électricité et d'eau (coupures si la ville ne produit pas tout elle-même). Les membres du pays sont
   prévenus et la ville est signalée en rouge (⚑) sur le globe ; réintégration possible après un jour de jeu.
   **Version mobile** automatique sur téléphone : barre d'onglets en bas, panneaux en feuille, construction au doigt
   avec confirmation, croix de déplacement en vue de rue ; installable sur l'écran d'accueil.
   **Parkings** (à ciel ouvert ou à étages) gratuits ou payants, tarif réglable dans l'inspecteur ; **paliers** (population,
   trésorerie, réussites) notifiés à l'écran et listés dans les statistiques. Vue **du dessus** par défaut, **vue de rue**
   en caméra libre (ZQSD/WASD, souris, Espace/C).
7. Ordinateur peu puissant : cochez « Graphismes économiques » dans l'onglet Construire.

Sans base de données, l'état est sauvegardé dans `./data/world.json` (`STORE=file`). Arrêtez le serveur avec Ctrl+C
(une sauvegarde finale est faite), puis relancez-le : le temps écoulé est rattrapé de façon déterministe.

### Mode production local

```bash
npm run build && npm start  # sert le client construit et le WebSocket sur http://localhost:8787
```

### Avec PostgreSQL / Supabase en local

```bash
DATABASE_URL=postgres://user:pass@localhost:5432/cyc DATABASE_SSL=disable npm run db:migrate
DATABASE_URL=postgres://user:pass@localhost:5432/cyc DATABASE_SSL=disable npm run dev
```

## Commandes

| Commande | Rôle |
|---|---|
| `npm run dev` | Serveur de jeu (rechargement auto) + client Vite avec proxy `/ws` et `/api` |
| `npm run build` | Construit le client (`client/dist`) et vérifie les types du serveur |
| `npm start` | Démarre le serveur de jeu, qui sert aussi le client construit |
| `npm test` | Tests (simulation, commandes, serveur, reprise après redémarrage) |
| `TEST_DATABASE_URL=postgres://… npm test` | Ajoute les tests d'intégration PostgreSQL. **La base indiquée est réinitialisée.** |
| `npm run typecheck` | Vérification TypeScript des trois paquets |
| `npm run lint` | ESLint |
| `npm run db:migrate` | Applique `supabase/migrations/*.sql` sur `DATABASE_URL` |
| `npm run geodata` | Régénère les données géographiques depuis Natural Earth (réseau requis ; sorties versionnées) |

## Déploiement Render + Supabase

Guide détaillé pas à pas : [`docs/SUPABASE.md`](docs/SUPABASE.md). Résumé ci-dessous.

### 1. Supabase

1. Créez un projet. Pour un monde actif en permanence, utilisez un plan **qui n'est pas mis en pause** (voir plus bas).
2. **Authentication → Providers** : activez *Email*. Si la confirmation d'e-mail est activée, les joueurs confirment
   leur adresse avant de se connecter.
3. **Project Settings → API** : notez `Project URL` (`SUPABASE_URL`) et la clé `anon` publique (`SUPABASE_ANON_KEY`).
   La clé `service_role` n'est **pas** nécessaire et ne doit jamais être exposée.
4. **Connect → Connection string** : copiez la chaîne du **Session pooler** (port 5432), compatible IPv4 et avec les
   verrous de session utilisés par le serveur. N'utilisez **pas** le *Transaction pooler* (port 6543).
5. Les migrations sont appliquées automatiquement au démarrage du serveur (`DB_AUTO_MIGRATE=true`). Vous pouvez aussi
   lancer `npm run db:migrate` depuis votre poste. RLS est activé sans politique : seul le serveur de jeu accède aux tables.

### 2. Render

1. **New → Blueprint** sur ce dépôt (fichier `render.yaml`), ou créez un *Web Service* Node avec :
   - région : la même que le projet Supabase (le blueprint choisit Francfort)
   - build : `npm ci --include=dev --no-audit --no-fund && npm run build`
   - start : `node --enable-source-maps --max-old-space-size=400 server/dist/index.js`
   - health check : `/health`
2. Renseignez `SUPABASE_URL`, `SUPABASE_ANON_KEY` et `DATABASE_URL`. `AUTH_MODE=supabase` est déjà défini.
3. Gardez **une seule instance** : le serveur de jeu porte l'état du monde. Lors d'un déploiement, la nouvelle instance
   attend le verrou d'autorité PostgreSQL et ne simule qu'après l'arrêt propre de l'ancienne (sauvegarde finale).

**Ce que fait le build de production**

- Client : Vite découpe le code (Three.js, React, données des villes et code du jeu dans des fichiers séparés, mis en
  cache un an), puis `scripts/compress-dist.mjs` précompresse tout en Brotli et gzip (~4,1 Mo → ~0,9 Mo). Le serveur
  envoie directement la variante acceptée par le navigateur et répond `304` aux fichiers déjà en cache.
- Serveur : esbuild produit `server/dist/index.js` (Node pur, sans transpilation au démarrage).
  `npm run start:dev -w server` lance encore les sources avec `tsx`.
- WebSocket : les messages de plus de 1 Ko sont compressés (environ −65 % de trafic, ~3 Ko/s par joueur connecté).
- Mémoire mesurée : ~125 Mo avec le monde de démonstration (8 villes dont une métropole), pour 512 Mo sur Starter.

### Hébergement et monde réellement persistant

- **Render gratuit** : le service s'endort après 15 minutes sans trafic entrant. La simulation **s'arrête** pendant la veille.
  Au réveil, le serveur rejoue le temps manqué à partir de `last_simulated_at`, jusqu'à `MAX_CATCHUP_HOURS` (24 h par défaut).
  Au-delà, le temps est sauté et signalé dans l'interface. Ce n'est **pas** une simulation active permanente : utile pour une
  démonstration, insuffisant pour un monde réellement 24 h/24.
- **Render payant** (instance *Starter* ou supérieure, sans mise en veille) : nécessaire pour une simulation continue.
- **Supabase gratuit** : un projet peut être mis en pause après une période d'inactivité (voir la documentation Supabase
  en vigueur). Pour un monde persistant en production, utilisez un plan payant sans mise en pause et activez les sauvegardes.
- Vérifiez les tarifs et conditions actuels de Render et Supabase avant de vous engager : ils évoluent.

## Données et crédits

- Pays, villes et régions : [Natural Earth](https://www.naturalearthdata.com/) (domaine public), via `world-atlas`
  pour les contours des pays.
- Aucun bâtiment réel n'est importé : chaque ville jouable commence vide.

## Limites connues

- Le terrain constructible (rivière, lac, collines) est **généré de façon déterministe** à partir de l'identifiant de la
  ville. Ce n'est pas le relief réel.
- Combats, sièges et batailles sont résolus de façon agrégée et déterministe (pas de micro-gestion tactique).
- Les véhicules animés illustrent le trafic calculé ; ils ne sont pas simulés individuellement.
- Les règles des phases 3 et 4 sont provisoires et listées dans `docs/DECISIONS.md`.
- Un seul serveur de jeu simule tous les salons. La montée en charge horizontale n'est pas prévue à ce stade.
- Le paquet JavaScript du client embarque Three.js et la liste des 7 340 villes. Le découpage est prévu.
- Le rendu 3D demande une carte graphique : sans accélération matérielle (rendu logiciel), il devient très lent.
