# CreateYourCity — prototype

Jeu web multijoueur persistant qui mêle construction urbaine et stratégie géopolitique sur la géographie réelle.
Chaque joueur choisit un pays puis une ville réelle encore libre, en devient le dirigeant et la construit à partir de zéro.
Le monde tourne en temps réel continu, à vitesse fixe, sur un serveur autoritaire. Aucune IA ne joue ni ne génère de contenu.

> **État : phase 1 jouable, avec les débuts de la phase 2.** Ce qui fonctionne réellement et ce qui reste à faire est listé
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
3. Sur la carte, zoomez et cliquez sur un pays puis sur une ville libre, ou utilisez la recherche, et choisissez **Prendre cette ville**.
4. Dans la ville vide, tracez une **rue** depuis la flèche jaune, l'accès régional au bord ouest. Placez ensuite logements, commerces,
   bureaux et services le long de la route. La grille s'active et se désactive avec `G`, et `R` fait pivoter un bâtiment.
5. Suivez le budget, la population, l'emploi, les services et le trafic dans les onglets de droite.

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
   - build : `npm ci --include=dev && npm run build`
   - start : `npm start`
   - health check : `/health`
2. Renseignez `SUPABASE_URL`, `SUPABASE_ANON_KEY` et `DATABASE_URL`. `AUTH_MODE=supabase` est déjà défini.
3. Gardez **une seule instance** : le serveur de jeu porte l'état du monde. Lors d'un déploiement, la nouvelle instance
   attend le verrou d'autorité PostgreSQL et ne simule qu'après l'arrêt propre de l'ancienne (sauvegarde finale).

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
- Diplomatie, traités, commerce entre joueurs, armée, expansion territoriale et élections nationales **ne sont pas
  encore implémentés** (voir la feuille de route). L'interface ne propose aucun bouton factice pour ces systèmes.
- Le trafic est agrégé par tronçon d'accès, sans calcul d'itinéraire.
- Un seul serveur de jeu simule tous les salons. La montée en charge horizontale n'est pas prévue à ce stade.
- Le paquet JavaScript du client (~1,6 Mo, ~390 Ko compressé) embarque la liste des 7 340 villes. Le découpage est prévu.
