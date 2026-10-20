# Décisions provisoires

Ce document liste les choix faits là où le cahier des charges (les 97 questions de cadrage) ne tranchait pas.
**Aucun de ces choix n'a été validé par l'utilisateur.** Ils visent la simplicité et la sécurité, et doivent rester
faciles à changer. Les valeurs numériques sont centralisées dans `shared/src/constants.ts` et `shared/src/catalog.ts`.

| Sujet (n° de question) | Choix provisoire | Où le changer |
|---|---|---|
| Époque (Q3) | Aucune époque historique modélisée : contemporain générique, sans technologie datée. | — |
| Style visuel (Q6, Q24, Q96) | 3D temps réel (Three.js) : globe terrestre et ville en 3D stylisée (modèles procéduraux, ciel, cycle jour/nuit, ombres). Demandé par l'utilisateur après le premier prototype ; la direction artistique précise reste ouverte. | `client/src/globe/`, `client/src/city3d/` |
| Nom du jeu (Q40) | « CreateYourCity », nom du dépôt, utilisé comme nom de travail. | `client/index.html` |
| Langue (Q26) | Interface en français. Pas de système de traduction à ce stade. | — |
| Plateforme (Q23) | Client web pour ordinateur. La mise en page s'adapte aux écrans étroits sans être optimisée pour le mobile. | — |
| Démarrage économique (Q93, non répondue) | 500 000 cr de trésorerie, aucune dette, impôts à 10 %. Emprunt possible jusqu'à 1 000 000 cr à 6 %/an de jeu. | `STARTING_TREASURY`, `MAX_DEBT`, `LOAN_ANNUAL_RATE` |
| Échelle constructible (Q94, non répondue) | Carré de 2 km × 2 km par ville, sans extension pour l'instant. | `CITY_SIZE_M` |
| Ressources naturelles et environnement (Q95, non répondue) | Seulement électricité, eau et biens génériques, plus une pollution locale (usines, centrales). Pas de gisements. | `catalog.ts` |
| Présentation des informations (Q97, non répondue) | Barre d'état en haut, panneaux à onglets à droite, couches activables sur la carte de la ville. | `client/src/screens/GameScreen.tsx` |
| Terrain jouable | **Terrain généré de façon déterministe** depuis l'identifiant de la ville (rivière, lac, collines). Il ne reproduit pas le relief réel. L'eau est interdite aux bâtiments ; les routes la franchissent par un pont (×6 sur le coût). Les collines coûtent ×1,4 pour un bâtiment et ×1,6 pour une route. | `shared/src/terrain.ts` |
| Raccordement | Point d'accès régional au milieu du bord ouest. Un bâtiment fonctionne s'il est à moins de 12 m d'une route reliée à cet accès. | `REGIONAL_ACCESS`, `ROAD_ACCESS_DISTANCE` |
| Vitesse du monde (Q42, Q63) | 1 tick = 1 s réelle = 10 min de jeu, donc un jour de jeu dure 2 min 24 s. Le monde démarre à 8 h. Vitesse commune à tous les salons. | `TICK_MS`, `GAME_MINUTES_PER_TICK`, `GAME_START_HOUR` |
| Réseaux électriques et d'eau | Le déficit est importé automatiquement du réseau régional (8 cr/MWh, 0,8 cr/m³), payé par la ville. Une ville neuve n'est donc jamais bloquée, et la centrale et le château d'eau sont des optimisations. | `ECONOMY` |
| Salaires publics | Ils sont inclus dans l'entretien des services et réseaux. Les employés publics comptent dans l'emploi et paient l'impôt sur le revenu. | `catalog.ts` |
| Trésorerie négative | Autorisée seulement par le jeu de l'entretien. Elle bloque toute construction (coût > trésorerie) et réduit les services publics à 60 % d'efficacité. Pas de faillite automatique. | `ECONOMY.deficitServiceEfficiency` |
| Démolition | Gratuite, sans remboursement. Les habitants d'un logement démoli partent au tick suivant. | `commands.ts` |
| Population | Modèle agrégé. La population tend vers « logements × (30 % + 70 % × attractivité) » à raison de 50 %/jour à la hausse et 25 %/jour à la baisse. | `POPULATION`, `attractiveness()` |
| Trafic | Agrégé par tronçon : chaque bâtiment charge sa route d'accès. Il n'y a pas de calcul d'itinéraire ni de trafic de transit pour l'instant. | `TRAFFIC`, `sim/tick.ts` |
| Villes non revendiquées (Q43) | Neutres et inertes : aucune simulation, aucune décision. Elles restent disponibles. | — |
| Villes par joueur | Première ville gratuite (500 000 cr). Ensuite : annexion, achat ou conquête, jusqu'à 12 villes. Chaque ville a sa propre trésorerie ; transferts libres entre ses villes. Un joueur qui perd toutes ses villes peut reprendre une ville libre. | `EXPANSION` |
| Salons | Code d'invitation de 6 caractères (sans 0/O/1/I). Un salon privé est accessible par code et un salon public est listé. Capacité de 2 à 500 joueurs, définie à la création. Un joueur peut créer au plus 5 salons. | `gameServer.ts` |
| Membres et capacité | Un joueur qui a rejoint un salon y reste membre et compte dans la capacité. Il n'existe pas encore de procédure pour quitter définitivement ou céder sa ville. | — |
| Visibilité (Q56, Q77) | Tous voient propriétaire, population arrondie à la centaine et nombre de constructions. Le détail (trésorerie, solde, chômage…) est visible avec une alliance ou un partage d'informations. Les armées étrangères sont visibles dans un rayon de 500 km autour de ses villes (effectif arrondi), en détail pour les alliés. | `world/view.ts` |
| Rattrapage après arrêt | Jusqu'à 24 h d'arrêt rejouées au redémarrage. Au-delà, le temps est sauté et signalé, sans prétendre que le monde a tourné. | `MAX_CATCHUP_HOURS` |
| Sauvegarde | Instantané transactionnel toutes les 15 s, après chaque commande (regroupée sur 250 ms) et à l'arrêt. Une commande acquittée peut être perdue si le processus plante dans la seconde qui suit. | `SNAPSHOT_INTERVAL_MS` |
| Authentification de développement | En l'absence de Supabase, identité invitée signée par le serveur (`AUTH_MODE=dev`). À ne pas utiliser pour un monde public. | `server/src/auth.ts` |
| Hébergement | Une instance Render unique avec verrou d'autorité PostgreSQL. Aucun plan payant n'est souscrit ni supposé : voir le README. | `render.yaml` |

## Phases 3 et 4 — règles provisoires

Toutes ces règles sont dans `shared/src/world/` (constantes dans `world/rules.ts`) et couvertes par `shared/test/world.test.ts`.

| Sujet | Règle provisoire |
|---|---|
| Marché commun | Chaque salon a un prix des biens (départ 14 cr). Les surplus des villes sont vendus au prix −10 %, les déficits achetés au prix +10 %. À chaque tick, le prix évolue de ±0,2 % × (demande − offre)/(demande + offre), borné entre 8 et 30 cr. Échantillon d'historique toutes les 4 h de jeu. |
| Contrats | Proposés par le vendeur ou l'acheteur (1–10 000 biens/jour, 0–100 cr/unité, 1–360 jours), acceptés par l'autre partie. Le vendeur livre en priorité sur sa production ; le taux réellement livré est appliqué à l'acheteur au tick suivant. Contrats annulés par une guerre ou un changement de propriétaire. |
| Traités | Alliance, accord de défense, non-agression, accord commercial, partage d'informations : proposés puis acceptés. Alliance et accord de défense permettent d'entrer dans les villes du partenaire et d'y défendre, et fournissent le ravitaillement. Une alliance, un accord de défense ou un pacte de non-agression empêchent de déclarer la guerre. Le pacte de non-agression se dénonce avec un jour de préavis, les autres immédiatement. |
| Guerre et paix | Déclaration unilatérale ; elle annule traités et contrats entre les deux joueurs. La paix exige l'accord des deux. |
| Cession de ville | Traité « cession » : ville, prix, ville payeuse ; exécuté à l'acceptation si le vendeur garde au moins une ville. |
| Expansion | Ville neutre à ≤ 500 km d'une de ses villes, coût 150 000 cr + 400 cr/km payé par la ville de départ ; la nouvelle ville démarre vide, sans fonds. |
| Unités | Infanterie (2 000 cr, att. 1, déf. 1,5, 20 km/h), blindés (9 000 cr, att. 4, déf. 2,5, 35 km/h), artillerie (6 000 cr, att. 3, déf. 0,8, 15 km/h, siège ×3). Recrutement dans une ville dotée d'une caserne, limité à 5 % de sa population ; solde quotidienne payée par la ville d'origine. |
| Déplacements | Vers ses villes, celles d'un allié, d'un ennemi ou une ville neutre ; ≤ 2 500 km par ordre ; vitesse de l'unité la plus lente ; interpolation sur le grand cercle. |
| Ravitaillement | À ≤ 600 km d'une ville amie, sinon −3 %/jour et force ×0,6. Sans solde (trésorerie négative), −1 %/jour et force ×0,7. |
| Combat | Dans une ville, attaquants (en guerre avec le propriétaire) contre défenseurs (propriétaire et alliés présents). Pertes/jour = 0,5 × force adverse / force propre ; bonus défensif ×1,25. |
| Siège et prise | Sans défenseur, progression/jour = 0,5 × puissance de siège / fortification (20 + 20 par commissariat + 80 par caserne, ×1,5 avec le projet de défense nationale) ; attrition des assiégeants 2 %/jour ; à 100 % la ville change de propriétaire avec ses bâtiments et sa trésorerie. |
| Nation | Électeurs = joueurs possédant au moins une ville dans le pays (une voix chacun). Élu dès qu'un candidat obtient la majorité absolue ; mandat sans échéance ; destitution à la majorité absolue ; perte automatique si le dirigeant n'a plus de ville dans le pays. |
| Pouvoirs nationaux | Impôt national (0–10 % des salaires, s'ajoute à la pression fiscale perçue), budget commun, subventions aux villes du pays, 4 lois, 4 grands projets, guerre et paix nationales (tous les joueurs des deux pays). Les décisions s'appliquent aux villes situées dans le pays, sans transfert de propriété. |
| Lois | Normes environnementales (pollution −40 %, industrie −10 %) ; salaire minimum (salaires +15 %, attractivité +5 %) ; santé publique (capacité santé +25 %, entretien santé +10 %) ; conscription (recrutement −30 %, attractivité −5 %). |
| Grands projets | Autoroutes 1,5 M (capacité routière +30 %) ; réseau électrique 1 M (électricité importée −40 %) ; universités 0,8 M (éducation +30 %, bureaux +10 %) ; défense du territoire 1,2 M (fortifications +50 %). |
| Trafic | Chaque logement envoie ses actifs vers tous les emplois (au prorata des postes) et ses habitants vers les commerces, par le plus court chemin en temps (rue 30 km/h, avenue 50 km/h) ; les usines envoient du fret vers l'accès régional. Les répartitions sont recalculées à chaque modification du plan. |
| Transports en commun | Une ligne existe dès 2 stations d'un même mode. Part modale des logements desservis : bus 25 % (400 m), tram 35 % (500 m), métro 50 % (700 m), limitée par la capacité ; 1,5 cr par voyage pour la ville. |
| Douanes et transport | Droit de douane national 0–50 % (fixé par le dirigeant élu) sur les achats au marché et les contrats avec une ville d'un autre pays, sauf accord commercial ou union commerciale. Transport des contrats : 1 cr/bien/1 000 km, ÷2 si les deux villes ont un port ou une gare. Port : vente au marché +10 %, achat −5 % ; gare : +5 % / −3 %. |
| Guerre étendue | Deux armées ennemies en marche à < 30 km s'arrêtent et combattent sans bonus ; seule la retraite vers la ville de départ est possible (vitesse ÷2). Flotte (port requis) : de port à port. Aviation (base aérienne) : 1 500 km par ordre. Prise de ville réservée aux troupes au sol. Gares amies : ravitaillement à 1 000 km et vitesse ×3 pour les troupes au sol. |
| Organisations | Alliance militaire : membres alliés (passage, défense, ravitaillement, détail visible), guerre interdite entre membres. Union commerciale : libre-échange. 20 membres maximum, 5 organisations par joueur ; le fondateur invite et exclut. |
| Aucun automatisme politique | Aucune décision n'est prise pour un joueur absent : traités, guerres, votes et ordres militaires viennent toujours d'un humain. Les effets mécaniques (combats, sièges, marché) découlent de règles fixes. |

## Choix techniques

- **TypeScript partout, simulation partagée** : la même fonction de validation sert à l'aperçu client et à l'autorité
  serveur. La simulation ne tourne que sur le serveur.
- **État de ville en `jsonb`** plutôt que des tables normalisées par bâtiment : une ville se charge et se sauvegarde en
  une ligne, avec le schéma versionné. À revoir si les villes dépassent quelques milliers d'éléments ou si des requêtes
  transversales deviennent nécessaires (marché, statistiques).
- **Pas de PostgREST ni de Realtime Supabase pour le jeu** : le WebSocket du serveur de jeu porte tout le temps réel ;
  Supabase fournit l'authentification et PostgreSQL.
- **Stationnement agrégé** (`PARKING` dans `shared/src/constants.ts`) : la demande (places occupées en même temps) vaut
  0,12 × trajets en voiture des habitants ; l'offre vient des rues raccordées (0,08 place/m de rue, 0,05 d'avenue) et des
  parkings. Les automobilistes choisissent selon places × exp(−tarif / 6), puis se garent où il reste de la place. Un déficit
  coûte jusqu'à 12 % de fluidité ; un tarif moyen élevé coûte jusqu'à 5 points d'attractivité. Valeurs provisoires.
- **Paliers** (`shared/src/sim/milestones.ts`) : vérifiés à chaque tick et enregistrés dans l'état de la ville (attribués une
  seule fois). Le client notifie ceux qu'il n'a pas encore vus sur cet appareil ; la première visite sert de référence.
