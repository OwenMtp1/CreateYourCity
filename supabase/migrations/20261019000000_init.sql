-- Schéma initial du monde persistant.
-- Le serveur de jeu (Render) se connecte directement à PostgreSQL et est le seul à écrire.
-- RLS est activé sans politique : les clés anon/authenticated de Supabase ne peuvent ni lire
-- ni modifier ces tables via l'API REST ; tout passe par le serveur qui valide les commandes.

create table if not exists players (
  id text primary key,               -- uid Supabase Auth (ou identifiant invité en mode dev)
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists lobbies (
  id uuid primary key,
  code text not null unique check (code ~ '^[A-Z0-9]{6}$'),
  name text not null,
  is_public boolean not null,
  max_players integer not null check (max_players between 2 and 500),
  owner_id text not null references players(id),
  created_at timestamptz not null default now(),
  -- Horloge du monde : dernier tick simulé et instant réel correspondant.
  tick bigint not null default 0,
  last_simulated_at timestamptz not null
);

create table if not exists lobby_members (
  lobby_id uuid not null references lobbies(id) on delete cascade,
  player_id text not null references players(id),
  joined_at timestamptz not null default now(),
  primary key (lobby_id, player_id)
);

-- Une ligne par ville possédée. Les contraintes garantissent : une ville = un propriétaire,
-- un joueur = une ville par salon, même en cas de requêtes concurrentes.
create table if not exists cities (
  lobby_id uuid not null references lobbies(id) on delete cascade,
  city_id text not null,
  owner_id text not null references players(id),
  country_id text not null,
  schema_version integer not null,
  tick bigint not null,
  state jsonb not null,
  claimed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (lobby_id, city_id),
  unique (lobby_id, owner_id)
);

create table if not exists action_log (
  id bigserial primary key,
  lobby_id uuid not null references lobbies(id) on delete cascade,
  player_id text not null,
  action text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists action_log_lobby_idx on action_log (lobby_id, created_at);

create table if not exists chat_messages (
  id uuid primary key,
  lobby_id uuid not null references lobbies(id) on delete cascade,
  player_id text not null,
  author text not null,
  text text not null check (char_length(text) <= 500),
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_lobby_idx on chat_messages (lobby_id, created_at desc);

alter table players enable row level security;
alter table lobbies enable row level security;
alter table lobby_members enable row level security;
alter table cities enable row level security;
alter table action_log enable row level security;
alter table chat_messages enable row level security;
