# Décisions provisoires

Ce document liste les choix faits là où le cahier des charges (les 97 questions de cadrage) ne tranchait pas.
**Aucun de ces choix n'a été validé par l'utilisateur.** Ils visent la simplicité et la sécurité, et doivent rester
faciles à changer. Les valeurs numériques sont centralisées dans `shared/src/constants.ts` et `shared/src/catalog.ts`.

| Sujet (n° de question) | Choix provisoire | Où le changer |
|---|---|---|
| Époque (Q3) | Aucune époque historique modélisée : contemporain générique, sans technologie datée. | — |
| Style visuel (Q6, Q24, Q96) | Vue de dessus 2D sur canvas, palette sombre fonctionnelle. Ce n'est pas un choix de direction artistique. | `client/src/city/CityView.tsx` |
| Nom du jeu (Q40) | « CreateYourCity », nom du dépôt, utilisé comme nom de travail. | `client/index.html` |
| Langue (Q26) | Interface en français. Pas de système de traduction à ce stade. | — |
| Plateforme (Q23) | Client web pour ordinateur. La mise en page s'adapte aux écrans étroits sans être optimisée pour le mobile. | — |
| Démarrage économique (Q93, non répondue) | 500 000 cr de trésorerie, aucune dette, impôts à 10 %. Emprunt possible jusqu'à 1 000 000 cr à 6 %/an de jeu. | `STARTING_TREASURY`, `MAX_DEBT`, `LOAN_ANNUAL_RATE` |
| Échelle constructible (Q94, non répondue) | Carré de 2 km × 2 km par ville, sans extension pour l'instant. | `CITY_SIZE_M` |
| Ressources naturelles et environnement (Q95, non répondue) | Seulement électricité, eau et biens génériques, plus une pollution locale (usines, centrales). Pas de gisements. | `catalog.ts` |
| Présentation des informations (Q97, non répondue) | Barre d'état en haut, panneaux à onglets à droite, couches activables sur la carte de la ville. | `client/src/screens/GameScreen.tsx` |
| Terrain jouable | **Terrain généré de façon déterministe** depuis l'identifiant de la ville (rivière, lac, collines). Il ne reproduit pas le relief réel. L'eau est interdite aux bâtiments ; les routes la franchissent par un pont (×6 sur le coût). Les collines coûtent ×1,4 pour un bâtiment et ×1,6 pour une route. | `shared/src/terrain.ts` |
| Raccordement | Point d'accès régional au milieu du bord ouest. Un bâtiment fonctionne s'il est à moins de 12 m d'une route reliée à cet accès. | `REGIONAL_ACCESS`, `ROAD_ACCESS_DISTANCE` |
| Vitesse du monde (Q42, Q63) | 1 tick = 1 s réelle = 10 min de jeu, donc un jour de jeu dure 2 min 24 s. Vitesse commune à tous les salons. | `TICK_MS`, `GAME_MINUTES_PER_TICK` |
| Réseaux électriques et d'eau | Le déficit est importé automatiquement du réseau régional (8 cr/MWh, 0,8 cr/m³), payé par la ville. Une ville neuve n'est donc jamais bloquée, et la centrale et le château d'eau sont des optimisations. | `ECONOMY` |
| Salaires publics | Ils sont inclus dans l'entretien des services et réseaux. Les employés publics comptent dans l'emploi et paient l'impôt sur le revenu. | `catalog.ts` |
| Trésorerie négative | Autorisée seulement par le jeu de l'entretien. Elle bloque toute construction (coût > trésorerie) et réduit les services publics à 60 % d'efficacité. Pas de faillite automatique. | `ECONOMY.deficitServiceEfficiency` |
| Démolition | Gratuite, sans remboursement. Les habitants d'un logement démoli partent au tick suivant. | `commands.ts` |
| Population | Modèle agrégé. La population tend vers « logements × (30 % + 70 % × attractivité) » à raison de 50 %/jour à la hausse et 25 %/jour à la baisse. | `POPULATION`, `attractiveness()` |
| Trafic | Agrégé par tronçon : chaque bâtiment charge sa route d'accès. Il n'y a pas de calcul d'itinéraire ni de trafic de transit pour l'instant. | `TRAFFIC`, `sim/tick.ts` |
| Villes non revendiquées (Q43) | Neutres et inertes : aucune simulation, aucune décision. Elles restent disponibles. | — |
| Une ville par joueur et par salon | Un joueur dirige une seule ville par salon. L'acquisition de villes supplémentaires viendra avec l'expansion (phase 3). | Contrainte SQL `unique (lobby_id, owner_id)` |
| Salons | Code d'invitation de 6 caractères (sans 0/O/1/I). Un salon privé est accessible par code et un salon public est listé. Capacité de 2 à 500 joueurs, définie à la création. Un joueur peut créer au plus 5 salons. | `gameServer.ts` |
| Membres et capacité | Un joueur qui a rejoint un salon y reste membre et compte dans la capacité. Il n'existe pas encore de procédure pour quitter définitivement ou céder sa ville. | — |
| Visibilité (Q56, Q77) | Les autres joueurs voient le propriétaire, la population arrondie à la centaine et le nombre de constructions. Le détail est réservé au propriétaire en attendant la diplomatie. | `summarizeCity()` |
| Rattrapage après arrêt | Jusqu'à 24 h d'arrêt rejouées au redémarrage. Au-delà, le temps est sauté et signalé, sans prétendre que le monde a tourné. | `MAX_CATCHUP_HOURS` |
| Sauvegarde | Instantané transactionnel toutes les 15 s, après chaque commande (regroupée sur 250 ms) et à l'arrêt. Une commande acquittée peut être perdue si le processus plante dans la seconde qui suit. | `SNAPSHOT_INTERVAL_MS` |
| Authentification de développement | En l'absence de Supabase, identité invitée signée par le serveur (`AUTH_MODE=dev`). À ne pas utiliser pour un monde public. | `server/src/auth.ts` |
| Hébergement | Une instance Render unique avec verrou d'autorité PostgreSQL. Aucun plan payant n'est souscrit ni supposé : voir le README. | `render.yaml` |

## Choix techniques

- **TypeScript partout, simulation partagée** : la même fonction de validation sert à l'aperçu client et à l'autorité
  serveur. La simulation ne tourne que sur le serveur.
- **État de ville en `jsonb`** plutôt que des tables normalisées par bâtiment : une ville se charge et se sauvegarde en
  une ligne, avec le schéma versionné. À revoir si les villes dépassent quelques milliers d'éléments ou si des requêtes
  transversales deviennent nécessaires (marché, statistiques).
- **Pas de PostgREST ni de Realtime Supabase pour le jeu** : le WebSocket du serveur de jeu porte tout le temps réel ;
  Supabase fournit l'authentification et PostgreSQL.
