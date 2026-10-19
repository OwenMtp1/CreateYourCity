# Brancher Supabase (et Render), étape par étape

Ce guide met en place les comptes joueurs (Supabase Auth) et la base de données persistante (PostgreSQL de Supabase),
puis le serveur de jeu sur Render. Comptez 20 à 30 minutes. Les écrans de Supabase évoluent : si un libellé diffère,
cherchez l'équivalent le plus proche.

## Ce que fait chaque service

| Service | Rôle dans le jeu |
|---|---|
| Supabase Auth | Comptes des joueurs (e-mail + mot de passe). Le navigateur obtient un jeton ; le serveur de jeu le vérifie. |
| Supabase PostgreSQL | Sauvegarde du monde : salons, villes, état du monde, journal d'actions, chat. Seul le serveur de jeu y écrit. |
| Render | Héberge le serveur de jeu (simulation continue + WebSocket) et sert le site. |

## 1. Créer le projet Supabase

1. Allez sur <https://supabase.com>, créez un compte puis **New project**.
2. Choisissez un nom, une **région proche de vos joueurs** (et de la région Render que vous choisirez), et un
   **mot de passe de base de données** fort. **Notez-le** : il servira dans la chaîne de connexion.
3. Attendez la fin de la création (une à deux minutes).

> Plan : le plan gratuit suffit pour tester, mais un projet gratuit peut être mis en pause après une période
> d'inactivité. Pour un monde persistant ouvert au public, passez sur un plan payant (et activez les sauvegardes).

## 2. Activer la connexion par e-mail

1. **Authentication → Sign In / Providers** (ou *Providers*) : vérifiez que **Email** est activé.
2. **Confirm email** :
   - activé (recommandé en production) : le joueur reçoit un e-mail de confirmation avant de pouvoir se connecter ;
   - désactivé (pratique pour les premiers tests) : connexion immédiate après l'inscription.
3. **Authentication → URL Configuration** : dans **Site URL**, mettez l'adresse publique du jeu (par exemple
   `https://createyourcity.onrender.com`, vous l'aurez à l'étape 6 ; en local : `http://localhost:5173`).
   Les liens des e-mails de confirmation y renvoient.

## 3. Récupérer les clés publiques de l'API

**Project Settings → API Keys** (ou *Settings → API*) :

- **Project URL** (`https://xxxx.supabase.co`) → variable `SUPABASE_URL` ;
- la **clé publique** : *publishable key* (`sb_publishable_…`) ou, sur les projets plus anciens, la clé **anon** →
  variable `SUPABASE_ANON_KEY`. Elle est faite pour être visible dans le navigateur.

**Ne copiez jamais** la clé *secret* / *service_role* : le jeu n'en a pas besoin.

## 4. Vérification des jetons (signing keys)

Le serveur vérifie la signature des jetons des joueurs :

- **Clés de signature asymétriques** (JWT Signing Keys, cas des projets récents) : rien à faire, le serveur lit
  automatiquement les clés publiques sur `https://xxxx.supabase.co/auth/v1/.well-known/jwks.json`.
- **Ancien secret JWT** (*Legacy JWT secret*, projets plus anciens) : ce point d'accès ne renvoie aucune clé. Copiez
  alors le secret dans **Project Settings → JWT Keys → Legacy JWT secret** et mettez-le dans `SUPABASE_JWT_SECRET`
  (variable **secrète**, uniquement côté serveur). Vous pouvez aussi migrer vers les clés asymétriques depuis cette page.

Pour savoir où vous en êtes, ouvrez l'URL `…/auth/v1/.well-known/jwks.json` : si la liste `keys` est vide, utilisez
`SUPABASE_JWT_SECRET`.

## 5. Récupérer la chaîne de connexion PostgreSQL

1. Cliquez sur **Connect** en haut du tableau de bord du projet.
2. Choisissez **Session pooler** (port **5432**). C'est le bon choix : il fonctionne en IPv4 sur tous les plans
   (Render n'atteint pas toujours les connexions directes en IPv6) et garde une session ouverte, ce dont le serveur a
   besoin pour son verrou d'autorité. **N'utilisez pas** le *Transaction pooler* (port 6543).
3. Copiez la chaîne telle quelle (forme `postgresql://postgres.<ref>:[YOUR-PASSWORD]@aws-…pooler.supabase.com:5432/postgres`),
   puis remplacez `[YOUR-PASSWORD]` par le mot de passe de l'étape 1. Si le mot de passe contient des caractères
   spéciaux (`@`, `#`, `?`, `&`, `/`, espace…), encodez-les (par exemple `@` → `%40`).
4. C'est la variable `DATABASE_URL` (secrète).

Le chiffrement : par défaut `DATABASE_SSL=no-verify` (connexion chiffrée, certificat non vérifié). Pour vérifier le
certificat, téléchargez le certificat CA depuis **Database settings → SSL configuration**, mettez son contenu dans
`DATABASE_CA_CERT` et passez `DATABASE_SSL=verify`.

## 6. Créer les tables

Aucune manipulation SQL n'est nécessaire : au démarrage, le serveur applique automatiquement les migrations du dossier
`supabase/migrations` (`DB_AUTO_MIGRATE=true`). Vous pouvez aussi les appliquer depuis votre ordinateur :

```bash
DATABASE_URL='postgresql://postgres.<ref>:<mot-de-passe>@aws-…pooler.supabase.com:5432/postgres' npm run db:migrate
```

Vérification : **Table Editor** doit montrer `players`, `lobbies`, `lobby_members`, `cities`, `action_log`,
`chat_messages` et `schema_migrations`. La sécurité au niveau des lignes (RLS) est activée sans politique : personne
ne peut lire ou écrire ces tables avec la clé publique ; seul le serveur de jeu y accède.

## 7. Tester en local avec Supabase (facultatif mais conseillé)

Créez un fichier `.env` à la racine (il n'est pas versionné) :

```bash
AUTH_MODE=supabase
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=sb_publishable_xxxxxxxx      # ou la clé anon
# SUPABASE_JWT_SECRET=...                      # seulement si l'étape 4 l'exige
DATABASE_URL=postgresql://postgres.<ref>:<mot-de-passe>@aws-…pooler.supabase.com:5432/postgres
DATABASE_SSL=no-verify
```

Puis `npm run dev` et ouvrez <http://localhost:5173> : l'écran d'accueil propose désormais **Connexion / Créer un
compte**. Créez un compte, confirmez l'e-mail si demandé, connectez-vous, créez un salon et une ville. Dans Supabase,
**Authentication → Users** montre le compte et **Table Editor → cities** la ville.

## 8. Déployer sur Render

1. Poussez le dépôt sur GitHub.
2. Sur <https://render.com> : **New → Blueprint**, choisissez le dépôt. Le fichier `render.yaml` crée un service web
   (build `npm ci --include=dev && npm run build`, démarrage `npm start`, contrôle de santé `/health`).
   Vous pouvez aussi créer un **Web Service** Node à la main avec ces mêmes commandes.
3. Renseignez les variables d'environnement :

   | Variable | Valeur |
   |---|---|
   | `AUTH_MODE` | `supabase` (déjà dans `render.yaml`) |
   | `SUPABASE_URL` | URL du projet (étape 3) |
   | `SUPABASE_ANON_KEY` | clé publique (étape 3) |
   | `DATABASE_URL` | chaîne du Session pooler (étape 5) |
   | `SUPABASE_JWT_SECRET` | seulement si nécessaire (étape 4) |
   | `ALLOWED_ORIGINS` | facultatif : `https://votre-service.onrender.com` |

4. Choisissez une instance **qui ne s'endort pas** (Starter ou plus) pour un monde actif 24 h/24 ; l'instance gratuite
   s'arrête après 15 minutes sans visite (le serveur rattrape alors le temps perdu au réveil, jusqu'à 24 h).
5. Gardez **une seule instance**. Pendant un déploiement, la nouvelle instance attend que l'ancienne ait sauvegardé et
   libéré le verrou avant de reprendre la simulation.
6. Une fois déployé, reportez l'adresse `https://….onrender.com` dans **Site URL** de Supabase (étape 2).

Vérification : `https://votre-service.onrender.com/health` doit répondre `{"ok":true,…,"store":"postgres","ready":true}`.

## Dépannage

| Symptôme | Cause probable |
|---|---|
| « Jeton invalide ou expiré » à la connexion | Projet avec ancien secret JWT : renseignez `SUPABASE_JWT_SECRET` (étape 4). |
| « Compte créé : confirmez votre adresse e-mail » | Confirmation d'e-mail activée : cliquez sur le lien reçu, puis connectez-vous. |
| Le lien de confirmation mène à `localhost` | Mettez l'adresse du jeu dans **Site URL** (étape 2). |
| `/health` indique `"ready": false` longtemps | Une autre instance tient le verrou, ou `DATABASE_URL` pointe vers le Transaction pooler (6543). |
| Erreur `ENOTFOUND` / `ETIMEDOUT` vers la base | Chaîne de connexion directe en IPv6 : utilisez le Session pooler. |
| Erreur d'authentification PostgreSQL | Mot de passe incorrect ou caractères spéciaux non encodés dans `DATABASE_URL`. |
| Le monde est figé après une longue absence | Projet Supabase mis en pause (plan gratuit) ou service Render endormi. |
