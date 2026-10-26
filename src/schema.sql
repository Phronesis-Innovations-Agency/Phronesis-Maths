-- Phronesis Maths schema (PostgreSQL)

CREATE TABLE IF NOT EXISTS schools (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  district      TEXT,
  contact_name  TEXT,
  contact_phone TEXT,
  consent_on_file BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS teachers (
  id            SERIAL PRIMARY KEY,
  school_id     INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS classes (
  id          SERIAL PRIMARY KEY,
  teacher_id  INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  level       TEXT NOT NULL CHECK (level IN ('S1','S2')),
  code        TEXT NOT NULL UNIQUE,
  endline_open BOOLEAN NOT NULL DEFAULT FALSE, -- teacher opens the end-of-pilot test when ready
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS learners (
  id          SERIAL PRIMARY KEY,
  class_id    INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  first_name  TEXT NOT NULL,
  pin_hash    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (class_id, first_name)
);

CREATE TABLE IF NOT EXISTS topics (
  id     TEXT PRIMARY KEY,
  name   TEXT NOT NULL,
  level  TEXT NOT NULL CHECK (level IN ('S1','S2')),
  sort   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS questions (
  id           SERIAL PRIMARY KEY,
  ref          TEXT UNIQUE,                 -- stable id from the question bank file / CSV
  topic_id     TEXT NOT NULL REFERENCES topics(id),
  type         TEXT NOT NULL CHECK (type IN ('mcq','short')),
  prompt       TEXT NOT NULL,
  options      JSONB,                       -- array of strings for mcq
  answer       TEXT NOT NULL,               -- mcq: index of correct option; short: accepted answers separated by |
  explanation  TEXT NOT NULL,
  assessment   BOOLEAN NOT NULL DEFAULT FALSE, -- part of the baseline / endline test
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS assignments (
  id          SERIAL PRIMARY KEY,
  class_id    INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  topic_id    TEXT NOT NULL REFERENCES topics(id),
  due_date    DATE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per finished quiz (practice, assignment, baseline or endline)
CREATE TABLE IF NOT EXISTS quiz_runs (
  id            UUID PRIMARY KEY,           -- generated on the phone, so re-sending never double-counts
  learner_id    INTEGER NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  mode          TEXT NOT NULL CHECK (mode IN ('practice','assignment','baseline','endline')),
  topic_id      TEXT,
  assignment_id INTEGER REFERENCES assignments(id) ON DELETE SET NULL,
  score         INTEGER NOT NULL,
  total         INTEGER NOT NULL,
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ NOT NULL,
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per answered question
CREATE TABLE IF NOT EXISTS attempts (
  id           UUID PRIMARY KEY,
  run_id       UUID,
  learner_id   INTEGER NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  question_id  INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  topic_id     TEXT NOT NULL,
  mode         TEXT NOT NULL,
  correct      BOOLEAN NOT NULL,
  answer       TEXT,
  answered_at  TIMESTAMPTZ NOT NULL,
  synced_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS attempts_learner_idx ON attempts(learner_id);
CREATE INDEX IF NOT EXISTS attempts_answered_idx ON attempts(answered_at);
CREATE INDEX IF NOT EXISTS runs_learner_idx ON quiz_runs(learner_id);
