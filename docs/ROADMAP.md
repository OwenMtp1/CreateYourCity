# Feuille de route

Légende : ✅ fonctionnel et testé · 🟡 partiel ou simplifié · ⬜ à faire

## Phase 1 — socle jouable

| | Fonctionnalité | Notes |
|---|---|---|
| ✅ | Application web locale, build, tests, lint | `npm run dev`, `npm run build`, `npm test`, `npm run lint` |
| ✅ | Carte réelle simplifiée, zoom continu, sélection | Natural Earth : 241 pays, 7 340 villes, régions admin-1 (couverture partielle de Natural Earth 50m) |
| ✅ | Salons privés (code) et publics, capacité configurable | |
| ✅ | Identité joueur | Supabase Auth (e-mail et mot de passe) ou invité signé en dev. Le mode Supabase est implémenté mais **n'a pas été testé contre un vrai projet Supabase** (aucun identifiant disponible). |
| ✅ | Choix d'une ville libre, verrou serveur et contrainte SQL | Testé sous concurrence (mémoire et PostgreSQL) |
| ✅ | Ville vide, construction libre, grille facultative | 10 bâtiments, 2 types de route, rotation, démolition |
| ✅ | Argent, coûts, revenus, entretien | |
| ✅ | Simulation serveur à cadence fixe, synchronisation de deux clients | Vérifié en navigateur avec deux joueurs |
| ✅ | Sauvegarde et reprise après reconnexion ou redémarrage | Fichier local ou PostgreSQL, rattrapage déterministe plafonné |
| ✅ | Retour clair sur les constructions invalides | Aperçu vert ou rouge avec le motif, refus serveur affiché |
| ✅ | Autorité unique pendant les déploiements | Verrou consultatif PostgreSQL, testé avec deux instances |

## Phase 2 — simulation urbaine

| | Fonctionnalité | Notes |
|---|---|---|
| ✅ | Logement, emploi, chômage, population agrégée, migrations | |
| ✅ | Budget : impôts par secteur, entretien, dette et emprunts | |
| 🟡 | Production et consommation | Biens génériques, électricité et eau. Pas de ressources naturelles ni de chaînes de production. |
| 🟡 | Réseau routier et trafic | Raccordement réel et charge par tronçon d'accès. Pas d'itinéraires ni de transports publics. |
| 🟡 | Services publics | Santé, éducation, sécurité : capacité, portée, couverture par bâtiment, inégalités. Pas de budget par service ni de qualité différenciée. |
| ✅ | Couches : raccordement, trafic, couverture des services, pollution | |
| ⬜ | Quartiers nommés, zonage, densification | |
| ⬜ | Transports publics (bus, tram, métro, gares), logistique inter-villes | |
| ⬜ | Terrain issu de données réelles (altitude, littoral, cours d'eau) | Source et licence à choisir |
| ⬜ | Extension de l'espace constructible | Lié aux règles d'expansion |

## Phase 3 — monde multijoueur

| | Fonctionnalité |
|---|---|
| 🟡 | Chat de salon (fonctionnel). Chat privé et canaux diplomatiques à faire. |
| ⬜ | Commerce entre joueurs : marché dynamique, contrats, accords d'approvisionnement |
| ⬜ | Diplomatie : alliances, traités, pactes, accords territoriaux |
| ⬜ | Visibilité conditionnée par les relations (modèle configurable) |
| ⬜ | Expansion territoriale : parcelles, achat, cession, annexion |
| ⬜ | Unités militaires, déplacements, ravitaillement, résolution déterministe des combats |

## Phase 4 — politique nationale et profondeur

| | Fonctionnalité |
|---|---|
| ⬜ | Élection du dirigeant national par les propriétaires de villes du pays, démission et destitution |
| ⬜ | Pouvoirs nationaux : lois communes, fiscalité nationale, budget commun, défense, grands projets |
| ⬜ | Marché et transports améliorés, tests de charge, équilibrage |

## Dette technique connue

- Le paquet client embarque la liste des villes (~0,9 Mo) : à charger à la demande.
- Analyse d'agencement en O(bâtiments × routes) : à indexer spatialement avant les grandes villes.
- Pas de test automatisé du client (le parcours complet a été vérifié manuellement avec Playwright).
- Les jetons Supabase expirent : une session WebSocket déjà authentifiée reste valide jusqu'à la déconnexion.
