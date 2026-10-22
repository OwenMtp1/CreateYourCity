-- Amis et messages privés. Une relation est stockée une seule fois : player_a < player_b.
create table if not exists friendships (
  player_a text not null references players(id) on delete cascade,
  player_b text not null references players(id) on delete cascade,
  status text not null check (status in ('pending', 'accepted')),
  requested_by text not null,
  created_at timestamptz not null default now(),
  primary key (player_a, player_b),
  check (player_a < player_b),
  check (requested_by in (player_a, player_b))
);
create index if not exists friendships_b_idx on friendships (player_b);

create table if not exists direct_messages (
  id uuid primary key,
  from_id text not null references players(id) on delete cascade,
  to_id text not null references players(id) on delete cascade,
  text text not null check (char_length(text) <= 500),
  created_at timestamptz not null default now()
);
create index if not exists direct_messages_pair_idx on direct_messages (least(from_id, to_id), greatest(from_id, to_id), created_at desc);
