// Database layer: real PostgreSQL (Neon) when DATABASE_URL is set,
// otherwise an embedded Postgres (PGlite) stored in ./data/dev-db for local development.
const fs = require('fs');
const path = require('path');

let impl;

async function init() {
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Neon uses publicly trusted certificates, so verify them.
      ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: true },
      max: 5,
    });
    impl = {
      query: (text, params) => pool.query(text, params),
      exec: (text) => pool.query(text),
      async tx(fn) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await fn({ query: (t, p) => client.query(t, p) });
          await client.query('COMMIT');
          return result;
        } catch (e) {
          await client.query('ROLLBACK');
          throw e;
        } finally {
          client.release();
        }
      },
    };
    console.log('Database: PostgreSQL (DATABASE_URL)');
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    const dir = process.env.PGLITE_DIR || path.join(__dirname, '..', 'data', 'dev-db');
    fs.mkdirSync(dir, { recursive: true });
    const db = new PGlite(dir);
    await db.waitReady;
    impl = {
      query: (text, params) => db.query(text, params),
      exec: (text) => db.exec(text),
      tx: (fn) => db.transaction((t) => fn({ query: (q, p) => t.query(q, p) })),
    };
    console.log('Database: embedded PGlite at ' + dir + ' (set DATABASE_URL for production)');
  }

  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await impl.exec(schema);
  await seedQuestionBank();
}

// Loads data/questions.json into the database. Questions are matched by their `ref`,
// so re-running updates wording and answers without touching learners' history.
async function seedQuestionBank() {
  const file = path.join(__dirname, '..', 'data', 'questions.json');
  if (!fs.existsSync(file)) return;
  const bank = JSON.parse(fs.readFileSync(file, 'utf8'));
  await impl.tx(async (t) => {
    for (const [i, topic] of bank.topics.entries()) {
      await t.query(
        `INSERT INTO topics (id, name, level, sort) VALUES ($1,$2,$3,$4)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, level = EXCLUDED.level, sort = EXCLUDED.sort`,
        [topic.id, topic.name, topic.level, i]
      );
    }
    for (const q of bank.questions) {
      await upsertQuestion(t, q);
    }
  });
  console.log(`Question bank: ${bank.topics.length} topics, ${bank.questions.length} questions loaded`);
}

async function upsertQuestion(t, q) {
  const options = q.type === 'mcq' ? JSON.stringify(q.options) : null;
  await t.query(
    `INSERT INTO questions (ref, topic_id, type, prompt, options, answer, explanation, assessment, active, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
     ON CONFLICT (ref) DO UPDATE SET topic_id = EXCLUDED.topic_id, type = EXCLUDED.type, prompt = EXCLUDED.prompt,
       options = EXCLUDED.options, answer = EXCLUDED.answer, explanation = EXCLUDED.explanation,
       assessment = EXCLUDED.assessment, active = EXCLUDED.active, updated_at = NOW()`,
    [q.ref, q.topic, q.type, q.prompt, options, String(q.answer), q.explanation, !!q.assessment, q.active !== false]
  );
}

module.exports = {
  init,
  upsertQuestion,
  query: (text, params) => impl.query(text, params),
  tx: (fn) => impl.tx(fn),
};
