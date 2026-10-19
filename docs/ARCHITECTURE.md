# Architecture

```
┌──────────────────────────┐   WebSocket /ws (JSON)   ┌──────────────────────────────┐   SQL (pg)   ┌──────────────────┐
│ Client navigateur        │ ───────────────────────▶ │ Serveur de jeu (Render)      │ ───────────▶ │ PostgreSQL       │
│ React + Vite             │ ◀─────────────────────── │ Node + ws, tick fixe 1 s     │              │ (Supabase)       │
│ carte d3-geo / canvas    │   commandes ↔ états      │ autorité, simulation,        │              │ lobbies, cities, │
│ vue de ville canvas      │                          │ sauvegardes, verrou monde    │              │ action_log, chat │
└──────────┬───────────────┘                          └──────────────┬───────────────┘              └──────────────────┘
           │ Supabase Auth (e-mail / mot de passe) → JWT             │ vérifie le JWT (JWKS ou secret HS256)
           └─────────────────────────────────────────────────────────┘
```

## Paquets (workspaces npm)

| Paquet | Contenu |
|---|---|
| `shared/` | Code **partagé et déterministe** : catalogue des constructions, géométrie, terrain, validation et application des commandes, simulation (`sim/tick.ts`, `sim/layout.ts`), protocole (schémas zod), données géographiques (`data/`). |
| `server/` | Serveur de jeu : configuration, authentification, stockage (`memory`, `file`, `postgres`), monde par salon (`game/lobbyWorld.ts`), sessions et commandes (`game/gameServer.ts`), HTTP/WebSocket (`http.ts`), verrou d'autorité (`leader.ts`). |
| `client/` | Interface : connexion et reconnexion (`net/`), état global (`state.ts`), carte du monde (`map/WorldMap.tsx`), vue de construction (`city/CityView.tsx`), panneaux (`ui/`). |
| `supabase/migrations/` | Schéma SQL versionné, appliqué par `npm run db:migrate` ou au démarrage. |

Le code est en TypeScript partout. Le serveur s'exécute avec `tsx` (pas d'étape de compilation à maintenir). Le client est construit par Vite.

### Choix des bibliothèques

- **React 19 + Vite** : écosystème standard, rechargement rapide. L'interface reste indépendante du rendu cartographique.
- **d3-geo + d3-zoom + canvas 2D** pour la carte : projection Natural Earth, zoom continu et aucune dépendance à un fournisseur
  de tuiles (ni clé, ni API payante). Les contours sont convertis une fois en `Path2D`, puis le zoom ne change que la matrice
  de transformation. Les contours 110m s'affichent au niveau mondial, les contours 50m et les régions admin-1 au zoom.
- **Canvas 2D** pour la ville : placement libre en mètres, coût de rendu maîtrisé. Le style visuel final (2D, isométrique, 3D)
  n'est pas décidé (Q96), et la vue est isolée dans un seul composant pour pouvoir être remplacée.
- **ws** : WebSocket minimal et éprouvé côté Node.
- **zod** : validation stricte de chaque message client.
- **pg** : accès direct à PostgreSQL, avec transactions et verrous consultatifs.
- **jose** : vérification des JWT Supabase (JWKS ou HS256) et signature des jetons invités en mode dev.
- **Vitest + ESLint (typescript-eslint)** : tests et qualité.

## Simulation

- **Horloge** : chaque salon possède `tick` et `lastSimulatedAt`. Un tick vaut 1 seconde réelle et 10 minutes de jeu,
  soit 144 ticks par jour de jeu. La boucle serveur (toutes les 200 ms) exécute les ticks dus. La vitesse est la même pour
  tous et ne dépend d'aucun client.
- **`simulateTick(city)`** (`shared/src/sim/tick.ts`) : fonction pure et déterministe (pas d'aléa ni d'horloge). Elle calcule
  dans l'ordre :
  1. logements et emplois des bâtiments **en service** (raccordés au réseau routier relié à l'accès régional) ;
  2. actifs, emploi, chômage, taux de postes pourvus ;
  3. électricité et eau : production locale, le déficit étant importé au prix régional ;
  4. biens : demande des habitants, ventes plafonnées par la capacité des commerces, production des usines,
     importations et exportations ;
  5. trafic agrégé : déplacements de chaque bâtiment affectés à son tronçon d'accès, ratio charge/capacité,
     efficacité pondérée ;
  6. comptes des entreprises et impôts (revenu, bénéfices commerciaux et industriels) ;
  7. services publics : affectation gloutonne des capacités du plus proche au plus lointain, couverture par bâtiment
     résidentiel, inégalités (écart-type pondéré) ;
  8. budget municipal (entretien, importations, intérêts) ;
  9. migrations vers une population d'équilibre fonction de l'attractivité.
- **Analyse d'agencement** (`sim/layout.ts`) : raccordement des routes (union-find), desserte des bâtiments, portée des
  services, exposition à la pollution. Ce calcul géométrique n'est refait que lorsque `layoutVersion` change.
- **Commandes** (`shared/src/commands.ts`) : construire, tracer une route, démolir, fixer les impôts, emprunter, rembourser.
  Le serveur valide et applique. Le client réutilise les **mêmes** validations pour l'aperçu (vert ou rouge avec le motif),
  sans jamais être cru sur parole.

## Flux de données

1. Connexion WebSocket → `auth` (jeton Supabase ou jeton invité) → `authed`.
2. `createLobby` / `joinLobby(code)` → `lobbyJoined`, qui contient l'horloge, les résumés des villes, sa propre ville
   complète, les couches et le chat récent. C'est aussi le chemin de **reconnexion** : le client rejoue `auth`, puis
   `joinLobby` avec le dernier code mémorisé.
3. `claimCity` : verrou en mémoire contre les demandes simultanées, puis `INSERT` protégé par les contraintes
   `PRIMARY KEY (lobby_id, city_id)` et `UNIQUE (lobby_id, owner_id)`. L'action est journalisée dans `action_log`.
4. `command` → validation, application, réponse `result` (coût ou motif du refus) et nouvel état `city` envoyé au
   propriétaire. L'action est journalisée et une sauvegarde est demandée (regroupée sur 250 ms).
5. Chaque tick : `tick` à tous les membres, `cityStats` au propriétaire, `layers` tous les 5 ticks et `summaries`
   (informations générales des autres villes) tous les 30 ticks.
6. Le chat (`chat`) est un canal séparé des commandes qui modifient le monde.

Les autres joueurs ne reçoivent que des **résumés** (propriétaire, population arrondie à la centaine, nombre de
constructions). L'état détaillé n'est envoyé qu'au propriétaire.

## Persistance et reprise

- **Instantanés** : `saveSnapshot` enregistre l'horloge du salon et toutes ses villes dans **une transaction**, toutes
  les 15 s, après chaque commande et à l'arrêt (SIGTERM). Les instantanés d'un salon sont sérialisés et chacun est pris
  au moment où son écriture démarre.
- **Format** : l'état d'une ville est un `jsonb` portant `schemaVersion`. `migrateCityState` est le point d'entrée des
  migrations de format.
- **Reprise** (`LobbyWorld.restore`) : chaque ville est réalignée sur l'horloge du salon, puis le temps écoulé depuis
  `last_simulated_at` est rejoué tick par tick, dans la limite de `MAX_CATCHUP_HOURS`. Au-delà, le temps est sauté et
  l'interface affiche les ticks rattrapés et sautés.
- **Autorité unique** : en mode PostgreSQL, l'instance qui simule tient un verrou consultatif de session
  (`pg_try_advisory_lock`). Une seconde instance, par exemple pendant un déploiement Render, répond au contrôle de santé
  mais refuse les joueurs et attend le verrou. Si la connexion du verrou est perdue, l'instance s'arrête immédiatement.
- **Sécurité des données** : RLS est activé sur toutes les tables, sans politique. Les clés `anon` et `authenticated`
  ne peuvent ni lire ni écrire via l'API Supabase. Seul le serveur, par connexion directe, modifie le monde.

## Sécurité

- Validation zod de chaque message (taille maximale 16 Ko) ; identifiants, coûts et propriétaires calculés côté serveur.
- Limitation de débit par connexion : 10 commandes/s (rafale 30) et 1 message de chat/s (rafale 5).
- Jetons Supabase vérifiés par signature, émetteur et audience. Les jetons invités (mode dev) sont signés en HS256 avec
  `DEV_AUTH_SECRET`.
- Journal des actions critiques (`action_log`) et journalisation des erreurs serveur.
- `ALLOWED_ORIGINS` permet de restreindre les origines WebSocket.

## Tests

| Fichier | Couverture |
|---|---|
| `shared/test/commands.test.ts` | Ville vide, accès routier, chevauchements, coûts, dette, impôts, démolition |
| `shared/test/sim.test.ts` | Raccordement, croissance, emploi, services, départs, déterminisme, rattrapage, électricité, performance |
| `server/test/gameServer.test.ts` | Authentification, validation, salons privés et publics, revendications concurrentes, synchronisation de deux clients, chat, capacité, redémarrage avec rattrapage, plafond |
| `server/test/postgres.test.ts` | Contraintes d'unicité sous concurrence, instantanés, partie complète sur PostgreSQL (si `TEST_DATABASE_URL`) |
