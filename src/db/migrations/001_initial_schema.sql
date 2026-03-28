-- 001_initial_schema.sql
-- Initial database schema for the Accessible Gaming Platform
-- Requires PostgreSQL 15+ with pgvector extension

-- Enable pgvector extension for research paper embeddings
CREATE EXTENSION IF NOT EXISTS vector;
-- Enable uuid generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-----------------------------------------------------------
-- Players
-----------------------------------------------------------
CREATE TABLE players (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at    BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
  preferred_language           TEXT NOT NULL DEFAULT 'en',
  preferred_communication_channel TEXT NOT NULL DEFAULT 'text',
  CONSTRAINT chk_language CHECK (preferred_language IN ('en','es','fr','de','ja')),
  CONSTRAINT chk_comm_channel CHECK (preferred_communication_channel IN ('speech','text','audio_cue'))
);

-----------------------------------------------------------
-- Accessibility Profiles (1:1 with Player)
-----------------------------------------------------------
CREATE TABLE accessibility_profiles (
  player_id     UUID PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  version       INTEGER NOT NULL DEFAULT 1,
  last_updated  BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
  profile_data  JSONB NOT NULL DEFAULT '{}'::JSONB
);

COMMENT ON COLUMN accessibility_profiles.profile_data IS
  'Full AccessibilityProfile fields (inputMethods, visual/audio/motor capabilities, learned preferences, manual overrides) stored as JSONB';

-----------------------------------------------------------
-- Consent State (1:1 with Player)
-----------------------------------------------------------
CREATE TABLE consent_states (
  player_id     UUID PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  consents      JSONB NOT NULL DEFAULT '{}'::JSONB,
  last_updated  BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
);

-----------------------------------------------------------
-- Game Specs
-----------------------------------------------------------
CREATE TABLE game_specs (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  genre               TEXT NOT NULL,
  title               TEXT NOT NULL,
  description         TEXT NOT NULL DEFAULT '',
  player_description  TEXT NOT NULL DEFAULT '',
  created_at          BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
  spec_data           JSONB NOT NULL DEFAULT '{}'::JSONB,
  estimated_play_time_minutes INTEGER,
  difficulty_level    TEXT NOT NULL DEFAULT 'adaptive',
  CONSTRAINT chk_genre CHECK (genre IN ('puzzle','adventure','strategy','simulation','narrative')),
  CONSTRAINT chk_difficulty CHECK (difficulty_level IN ('easy','medium','hard','adaptive'))
);

COMMENT ON COLUMN game_specs.spec_data IS
  'Rules, winConditions, mechanics, interactionMappings, assets, accessibilityAdaptations stored as JSONB';

-----------------------------------------------------------
-- Game Sessions
-----------------------------------------------------------
CREATE TABLE game_sessions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  player_id     UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  game_spec_id  UUID NOT NULL REFERENCES game_specs(id) ON DELETE CASCADE,
  started_at    BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
  ended_at      BIGINT,
  status        TEXT NOT NULL DEFAULT 'active',
  session_data  JSONB NOT NULL DEFAULT '{}'::JSONB,
  CONSTRAINT chk_session_status CHECK (status IN ('active','paused','completed','abandoned'))
);

CREATE INDEX idx_game_sessions_player ON game_sessions(player_id);
CREATE INDEX idx_game_sessions_game_spec ON game_sessions(game_spec_id);
CREATE INDEX idx_game_sessions_status ON game_sessions(status);

-----------------------------------------------------------
-- Research Papers (with pgvector embeddings)
-----------------------------------------------------------
CREATE TABLE papers (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title               TEXT NOT NULL,
  authors             JSONB NOT NULL DEFAULT '[]'::JSONB,
  abstract            TEXT NOT NULL DEFAULT '',
  publication_date    TEXT,
  journal             TEXT,
  doi                 TEXT UNIQUE,
  references          JSONB NOT NULL DEFAULT '[]'::JSONB,
  summary             JSONB NOT NULL DEFAULT '{}'::JSONB,
  full_text_embedding VECTOR(1536),
  indexed_at          BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
  status              TEXT NOT NULL DEFAULT 'indexed',
  failed_fields       JSONB NOT NULL DEFAULT '[]'::JSONB,
  CONSTRAINT chk_paper_status CHECK (status IN ('indexed','partial','failed'))
);

CREATE INDEX idx_papers_doi ON papers(doi);
CREATE INDEX idx_papers_title ON papers USING gin(to_tsvector('english', title));
CREATE INDEX idx_papers_embedding ON papers USING ivfflat (full_text_embedding vector_cosine_ops) WITH (lists = 100);

-----------------------------------------------------------
-- Paper Chunk Embeddings (for per-section retrieval)
-----------------------------------------------------------
CREATE TABLE paper_chunks (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  paper_id        UUID NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  section_title   TEXT NOT NULL DEFAULT '',
  text            TEXT NOT NULL,
  embedding       VECTOR(1536),
  start_offset    INTEGER NOT NULL DEFAULT 0,
  end_offset      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_paper_chunks_paper ON paper_chunks(paper_id);
CREATE INDEX idx_paper_chunks_embedding ON paper_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-----------------------------------------------------------
-- Barrier Events
-----------------------------------------------------------
CREATE TABLE barrier_events (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id            UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  player_id             UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  timestamp             BIGINT NOT NULL,
  type                  TEXT NOT NULL,
  severity              TEXT NOT NULL,
  detected_element      JSONB NOT NULL DEFAULT '{}'::JSONB,
  detected_value        JSONB,
  threshold_value       JSONB,
  adaptation            JSONB,
  adaptation_applied_at BIGINT,
  adaptation_undone     BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT chk_barrier_type CHECK (type IN ('unreachable_element','missed_audio_cue','small_text','low_contrast','timing_barrier','complex_input')),
  CONSTRAINT chk_barrier_severity CHECK (severity IN ('low','medium','high','critical'))
);

CREATE INDEX idx_barrier_events_session ON barrier_events(session_id);
CREATE INDEX idx_barrier_events_player ON barrier_events(player_id);
CREATE INDEX idx_barrier_events_type ON barrier_events(type);

-----------------------------------------------------------
-- Emotion State Logs
-----------------------------------------------------------
CREATE TABLE emotion_state_logs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id  UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  player_id   UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  entries     JSONB NOT NULL DEFAULT '[]'::JSONB
);

CREATE INDEX idx_emotion_logs_session ON emotion_state_logs(session_id);
CREATE INDEX idx_emotion_logs_player ON emotion_state_logs(player_id);

-----------------------------------------------------------
-- Adaptation History
-----------------------------------------------------------
CREATE TABLE adaptation_history (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  player_id       UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  barrier_type    TEXT NOT NULL,
  adaptation_type TEXT NOT NULL,
  session_id      UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  timestamp       BIGINT NOT NULL,
  accepted        BOOLEAN NOT NULL
);

CREATE INDEX idx_adaptation_history_player ON adaptation_history(player_id);
CREATE INDEX idx_adaptation_history_session ON adaptation_history(session_id);
CREATE INDEX idx_adaptation_history_types ON adaptation_history(player_id, barrier_type, adaptation_type);

-----------------------------------------------------------
-- Companion Player Models (1:1 with Player)
-----------------------------------------------------------
CREATE TABLE companion_player_models (
  player_id                       UUID PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  mechanic_performance            JSONB NOT NULL DEFAULT '[]'::JSONB,
  last_synced_with_profile_learner BIGINT NOT NULL DEFAULT 0
);
