const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const auth = require('../auth');

const router = express.Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODES = ['practice', 'assignment', 'baseline', 'endline'];

// Step 1 of joining: a learner types the class code and sees the names in the class.
router.get('/class/:code', async (req, res) => {
  const code = String(req.params.code || '').toUpperCase().trim();
  const { rows: [cls] } = await db.query(
    `SELECT c.id, c.name, c.level, s.name AS school
       FROM classes c JOIN teachers t ON t.id = c.teacher_id JOIN schools s ON s.id = t.school_id
      WHERE c.code = $1`,
    [code]
  );
  if (!cls) return res.status(404).json({ error: 'No class has that code. Check it with your teacher.' });
  const { rows: learners } = await db.query(
    'SELECT id, first_name, (pin_hash IS NOT NULL) AS has_pin FROM learners WHERE class_id = $1 ORDER BY first_name',
    [cls.id]
  );
  res.json({ class: { name: cls.name, level: cls.level, school: cls.school, code }, learners });
});

// Step 2: pick your name and enter your PIN. The first time, the PIN you type becomes your PIN.
router.post('/learner/login', async (req, res) => {
  const { code, learnerId, pin } = req.body || {};
  if (!/^\d{4}$/.test(String(pin || ''))) return res.status(400).json({ error: 'Your PIN must be 4 digits.' });
  const { rows: [l] } = await db.query(
    `SELECT l.id, l.first_name, l.pin_hash, c.id AS class_id, c.name AS class_name, c.level, c.code
       FROM learners l JOIN classes c ON c.id = l.class_id
      WHERE l.id = $1 AND c.code = $2`,
    [Number(learnerId), String(code || '').toUpperCase()]
  );
  if (!l) return res.status(404).json({ error: 'Learner not found in this class.' });
  const key = 'learner:' + l.id;
  if (auth.isLocked(key)) return res.status(429).json({ error: 'Too many wrong PINs. Wait 10 minutes or ask your teacher to reset it.' });

  let firstTime = false;
  if (!l.pin_hash) {
    await db.query('UPDATE learners SET pin_hash = $1 WHERE id = $2', [await bcrypt.hash(String(pin), 8), l.id]);
    firstTime = true;
  } else if (!(await bcrypt.compare(String(pin), l.pin_hash))) {
    auth.recordFailure(key);
    return res.status(401).json({ error: 'Wrong PIN. Try again.' });
  }
  auth.clearFailures(key);
  const token = auth.sign({ role: 'learner', id: l.id, classId: l.class_id });
  res.json({
    token,
    firstTime,
    learner: { id: l.id, firstName: l.first_name, className: l.class_name, level: l.level, code: l.code },
  });
});

// Everything the phone needs to work offline: topics, questions, assignments and the learner's progress so far.
router.get('/learner/bundle', auth.requireRole('learner'), async (req, res) => {
  const { id, classId } = req.user;
  const { rows: [cls] } = await db.query('SELECT level, endline_open FROM classes WHERE id = $1', [classId]);
  if (!cls) return res.status(401).json({ error: 'Your class no longer exists. Ask your teacher.' });

  const { rows: topics } = await db.query('SELECT id, name, level FROM topics WHERE level <= $1 ORDER BY sort', [cls.level]);
  const topicIds = topics.map((t) => t.id);
  const { rows: questions } = await db.query(
    `SELECT id, topic_id AS topic, type, prompt, options, answer, explanation, assessment
       FROM questions WHERE active AND topic_id = ANY($1) ORDER BY id`,
    [topicIds]
  );
  const { rows: assignments } = await db.query(
    `SELECT a.id, a.topic_id AS topic, a.due_date,
            EXISTS (SELECT 1 FROM quiz_runs r WHERE r.assignment_id = a.id AND r.learner_id = $2) AS done
       FROM assignments a WHERE a.class_id = $1 ORDER BY a.created_at DESC`,
    [classId, id]
  );
  const { rows: progress } = await db.query(
    `SELECT topic_id AS topic, COUNT(*)::int AS answers, SUM(CASE WHEN correct THEN 1 ELSE 0 END)::int AS correct
       FROM attempts WHERE learner_id = $1 GROUP BY topic_id`,
    [id]
  );
  const { rows: runs } = await db.query(
    `SELECT id, mode, topic_id AS topic, score, total, completed_at FROM quiz_runs
      WHERE learner_id = $1 ORDER BY completed_at DESC LIMIT 200`,
    [id]
  );
  // Per-question history, so practice can serve unseen and previously-wrong questions first.
  const { rows: seenRows } = await db.query(
    `SELECT question_id, COUNT(*)::int AS n,
            (ARRAY_AGG(correct ORDER BY answered_at DESC))[1] AS last_correct
       FROM attempts WHERE learner_id = $1 GROUP BY question_id`,
    [id]
  );
  const seen = {};
  for (const r of seenRows) seen[r.question_id] = { n: r.n, lastCorrect: r.last_correct };
  res.json({
    level: cls.level, endlineOpen: cls.endline_open, topics, questions, assignments, progress, runs, seen,
    serverTime: new Date().toISOString(),
  });
});

// Answers and finished quizzes recorded offline arrive here. IDs are made on the phone,
// so sending the same batch twice is safe.
router.post('/learner/sync', auth.requireRole('learner'), async (req, res) => {
  const learnerId = req.user.id;
  const runs = Array.isArray(req.body?.runs) ? req.body.runs.slice(0, 500) : [];
  const attempts = Array.isArray(req.body?.attempts) ? req.body.attempts.slice(0, 5000) : [];
  const accepted = { runs: [], attempts: [] };
  const now = Date.now();
  const toDate = (v) => {
    const d = new Date(v);
    return isNaN(d) || d.getTime() > now + 5 * 60 * 1000 ? new Date() : d;
  };

  await db.tx(async (t) => {
    for (const r of runs) {
      if (!UUID.test(r.id) || !MODES.includes(r.mode)) continue;
      const total = Math.max(0, Math.min(500, Number(r.total) || 0));
      const score = Math.max(0, Math.min(total, Number(r.score) || 0));
      // Baseline and endline count once per learner.
      if (r.mode === 'baseline' || r.mode === 'endline') {
        const { rows } = await t.query('SELECT id FROM quiz_runs WHERE learner_id = $1 AND mode = $2 AND id <> $3', [learnerId, r.mode, r.id]);
        if (rows.length) { accepted.runs.push(r.id); continue; }
      }
      let assignmentId = null;
      if (r.mode === 'assignment' && r.assignmentId) {
        const { rows } = await t.query('SELECT id FROM assignments WHERE id = $1 AND class_id = $2', [Number(r.assignmentId), req.user.classId]);
        assignmentId = rows[0]?.id || null;
      }
      await t.query(
        `INSERT INTO quiz_runs (id, learner_id, mode, topic_id, assignment_id, score, total, started_at, completed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
        [r.id, learnerId, r.mode, r.topic || null, assignmentId, score, total, r.startedAt ? toDate(r.startedAt) : null, toDate(r.completedAt)]
      );
      accepted.runs.push(r.id);
    }
    for (const a of attempts) {
      if (!UUID.test(a.id) || !MODES.includes(a.mode)) continue;
      const { rows: [q] } = await t.query('SELECT id, topic_id FROM questions WHERE id = $1', [Number(a.questionId)]);
      if (!q) { accepted.attempts.push(a.id); continue; }
      await t.query(
        `INSERT INTO attempts (id, run_id, learner_id, question_id, topic_id, mode, correct, answer, answered_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
        [a.id, UUID.test(a.runId || '') ? a.runId : null, learnerId, q.id, q.topic_id, a.mode, !!a.correct,
         String(a.answer ?? '').slice(0, 200), toDate(a.answeredAt)]
      );
      accepted.attempts.push(a.id);
    }
  });
  res.json({ accepted });
});

module.exports = router;
