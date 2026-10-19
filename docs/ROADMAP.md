# Feuille de route

Légende : ✅ fonctionnel et testé · 🟡 partiel ou simplifié · ⬜ à faire

## Phase 1 — socle jouable

| | Fonctionnalité | Notes |
|---|---|---|
| ✅ | Application web, build, tests, lint | `npm run dev`, `npm run build`, `npm test`, `npm run lint` |
| ✅ | Globe 3D réel : zoom continu monde → pays → régions → villes | Natural Earth : 241 pays, 7 340 villes, régions admin-1 (couverture partielle de Natural Earth 50m) |
| ✅ | Salons privés (code) et publics, capacité configurable | |
| 🟡 | Identité joueur | Supabase Auth (e-mail et mot de passe) ou invité signé en dev. Le mode Supabase n'a **pas** été testé contre un vrai projet. |
| ✅ | Choix d'une ville libre (verrou serveur et contrainte SQL) | Testé sous concurrence (mémoire et PostgreSQL) |
| ✅ | Ville vide, construction libre en 3D, grille facultative | 13 bâtiments, 2 types de route, rotation, démolition |
| ✅ | Argent, coûts, revenus, entretien | |
| ✅ | Simulation serveur à cadence fixe, synchronisation entre clients | Vérifiée en navigateur avec plusieurs joueurs |
| ✅ | Sauvegarde, reprise après reconnexion ou redémarrage | Fichier local ou PostgreSQL, rattrapage déterministe plafonné |
| ✅ | Autorité unique pendant les déploiements | Verrou consultatif PostgreSQL |

## Phase 2 — simulation urbaine

| | Fonctionnalité | Notes |
|---|---|---|
| ✅ | Logement, emploi, chômage, population agrégée, migrations | |
| ✅ | Budget : impôts par secteur, entretien, dette et emprunts | |
| 🟡 | Production et consommation | Biens génériques, électricité, eau. Pas de ressources naturelles ni de chaînes de production. |
| ✅ | Réseau routier et trafic | Graphe découpé aux carrefours, itinéraires domicile-travail, achats et fret (plus court chemin en temps), charge par tronçon, voitures animées qui ralentissent dans les bouchons |
| ✅ | Routes courbes et ronds-points | Tracés multi-tronçons atomiques, jonctions arrondies |
| ✅ | Transports en commun : bus, tram, métro | Part modale des logements desservis, capacité, recettes, lignes et véhicules en 3D |
| ✅ | Tutoriel guidé, conseillers chiffrés, statistiques historiques | Conseils à règles fixes (aucune IA), courbes sur 15 jours de jeu |
| ✅ | Services publics : santé, éducation, sécurité, loisirs | Capacité, portée, couverture par bâtiment, inégalités |
| ✅ | Couches 3D : raccordement, trafic, couverture des services, pollution | |
| ✅ | Rendu 3D : bâtiments procéduraux, ciel, cycle jour/nuit, eau, ombres, arbres, lampadaires | Mode « graphismes économiques » pour les machines modestes |
| ⬜ | Quartiers nommés, zonage, terrain réel, sons | |

## Phase 3 — monde multijoueur

| | Fonctionnalité | Notes |
|---|---|---|
| ✅ | Chat de salon et messages privés | |
| ✅ | Marché commun dynamique (offre/demande entre joueurs) | Prix borné entre 8 et 30 cr |
| ✅ | Contrats d'approvisionnement entre joueurs | Livraisons prioritaires, taux de livraison réel, échéance |
| ✅ | Diplomatie : alliance, accord de défense, non-agression (préavis), accord commercial, partage d'informations, paix | |
| ✅ | Visibilité conditionnée : détail des villes (alliance ou partage d'informations), armées vues dans un rayon de 500 km | |
| ✅ | Expansion : annexion de villes neutres proches, cession de ville contre paiement, conquête | Plusieurs villes par joueur (12 au maximum) |
| ✅ | Armées : recrutement (caserne, 5 % de la population), déplacement sur le globe, ravitaillement, solde, combat, siège, prise de ville | Résolution déterministe et agrégée |
| ✅ | Routes commerciales sur le globe, coût de transport, ports et gares, droits de douane nationaux | Libre-échange par accord commercial ou union commerciale |
| ✅ | Batailles en rase campagne, retraite, lignes de front, flotte (de port à port), aviation, ravitaillement et déplacements par le rail | Seules les troupes au sol prennent une ville |
| ✅ | Organisations multinationales : alliances militaires et unions commerciales, invitations, exclusion, canal de discussion | |

## Phase 4 — politique nationale

| | Fonctionnalité | Notes |
|---|---|---|
| ✅ | Élection continue du dirigeant national à la majorité absolue des propriétaires de villes du pays | |
| ✅ | Mandat sans échéance, démission, destitution à la majorité absolue | |
| ✅ | Impôt national, budget commun, subventions aux villes | |
| ✅ | Lois communes (environnement, salaire minimum, santé publique, conscription) avec effets chiffrés | |
| ✅ | Grands projets (autoroutes, réseau électrique, universités, défense du territoire) | |
| ✅ | Guerre nationale et paix nationale | Engagent tous les joueurs des deux pays |
| ⬜ | Constitution configurable (seuils, veto, partage automatique des budgets) | |
| 🟡 | Équilibrage, tests de charge | Tests de performance unitaires seulement |

## Dette technique connue

- Le paquet client embarque la liste des villes (~0,9 Mo) et Three.js : à découper.
- Analyse d'agencement en O(bâtiments × routes) : à indexer spatialement avant les très grandes villes.
- Le client n'a pas de tests automatisés (parcours vérifiés manuellement avec Playwright).
- Les jetons Supabase expirent : une session WebSocket déjà authentifiée reste valide jusqu'à la déconnexion.
- Les ticks de rattrapage avant restauration simulent les villes isolément (sans marché ni armées) pour réaligner leurs horloges.
