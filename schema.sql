-- ============================================================
--  Schritte-Challenge – D1 (SQLite)
--
--  Anlegen:
--    wrangler d1 create schritte
--    wrangler d1 execute schritte --remote --file=schema.sql
-- ============================================================

-- Die E-Mail ist das Bindeglied zur Access-Einladungsliste.
-- Wer in Access eingeladen ist, aber hier keine Zeile hat,
-- kommt zwar auf die Seite, taucht aber in keiner Wertung auf.
create table if not exists teilnehmer (
  id              text primary key,
  email           text not null unique,
  name            text not null,
  kurz            text not null,
  farbe           text not null default '#5FD3C4',
  health_user_id  text,
  legacy_user_id  text,
  refresh_token   text,
  verbunden_am    text,
  letzter_sync    text,
  sync_fehler     text
);

create table if not exists eintraege (
  teilnehmer_id   text not null references teilnehmer(id) on delete cascade,
  datum           text not null,                         -- YYYY-MM-DD
  schritte        integer not null check (schritte >= 0 and schritte <= 100000),
  km              real,
  quelle          text not null default 'google-health',
  aktualisiert_am text not null,
  primary key (teilnehmer_id, datum)
);

create index if not exists eintraege_datum on eintraege (datum desc);

-- ------------------------------------------------------------
--  Teilnehmer anlegen. Die E-Mail muss exakt der entsprechen,
--  die in der Access-Richtlinie steht.
-- ------------------------------------------------------------
-- insert into teilnehmer (id, email, name, kurz, farbe) values
--   (lower(hex(randomblob(16))), 'freddy@example.com', 'Freddy', 'FR', '#FFC14D'),
--   (lower(hex(randomblob(16))), 'jonas@example.com',  'Jonas',  'JO', '#5FD3C4');
