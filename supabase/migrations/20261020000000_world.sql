-- Phases 3 et 4 : état global du monde (diplomatie, commerce, armées, nations) et
-- possession de plusieurs villes par joueur (expansion, cession, conquête).
alter table lobbies add column if not exists world jsonb not null default '{}'::jsonb;
alter table cities drop constraint if exists cities_lobby_id_owner_id_key;
create index if not exists cities_owner_idx on cities (lobby_id, owner_id);
