const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db');
const auth = require('../auth');
const stats = require('../stats');
const reports = require('../reports');

const router = express.Router();
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

router.post('/teacher/login', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const key = 'teacher:' + email;
  if (auth.isLocked(key)) return res.status(429).json({ error: 'Too many attempts. Wait 10 minutes.' });
  const { rows: [t] } = await db.query('SELECT id, name, password_hash FROM teachers WHERE email = $1', [email]);
  if (!t || !(await bcrypt.compare(password, t.password_hash))) {
    auth.recordFailure(key);
    return res.status(401).json({ error: 'Email or password is wrong.' });
  }
  auth.clearFailures(key);
  res.json({ token: auth.sign({ role: 'teacher', id: t.id }), name: t.name });
});

router.use('/teacher', auth.requireRole('teacher'));

// Loads a class only if it belongs to the signed-in teacher.
async function ownClass(req, res) {
  const { rows: [c] } = await db.query(
    `SELECT c.*, s.name AS school FROM classes c JOIN teachers t ON t.id = c.teacher_id JOIN schools s ON s.id = t.school_id
      WHERE c.id = $1 AND c.teacher_id = $2`,
    [Number(req.params.id), req.user.id]
  );
  if (!c) res.status(404).json({ error: 'Class not found.' });
  return c;
}

router.get('/teacher/me', async (req, res) => {
  const { rows: [t] } = await db.query(
    'SELECT t.name, t.email, s.name AS school FROM teachers t JOIN schools s ON s.id = t.school_id WHERE t.id = $1',
    [req.user.id]
  );
  if (!t) return res.status(401).json({ error: 'Please sign in again.' });
  res.json(t);
});

router.post('/teacher/password', async (req, res) => {
  const { current, next } = req.body || {};
  if (!next || String(next).length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  const { rows: [t] } = await db.query('SELECT password_hash FROM teachers WHERE id = $1', [req.user.id]);
  if (!t || !(await bcrypt.compare(String(current || ''), t.password_hash))) return res.status(401).json({ error: 'Current password is wrong.' });
  await db.query('UPDATE teachers SET password_hash = $1 WHERE id = $2', [await bcrypt.hash(String(next), 10), req.user.id]);
  res.json({ ok: true });
});

router.get('/teacher/classes', async (req, res) => {
  const { rows } = await db.query(
    `SELECT c.id, c.name, c.level, c.code, (SELECT COUNT(*) FROM learners l WHERE l.class_id = c.id)::int AS learners
       FROM classes c WHERE c.teacher_id = $1 ORDER BY c.created_at`,
    [req.user.id]
  );
  res.json(rows);
});

router.post('/teacher/classes', async (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 60);
  const level = req.body?.level === 'S2' ? 'S2' : 'S1';
  if (!name) return res.status(400).json({ error: 'Give the class a name, for example "S1 East".' });
  for (let i = 0; i < 10; i++) {
    const code = Array.from(crypto.randomBytes(6), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
    try {
      const { rows: [c] } = await db.query(
        'INSERT INTO classes (teacher_id, name, level, code) VALUES ($1,$2,$3,$4) RETURNING id, name, level, code',
        [req.user.id, name, level, code]
      );
      return res.json(c);
    } catch (e) {
      if (!String(e.message).includes('unique')) throw e;
    }
  }
  res.status(500).json({ error: 'Could not make a class code. Try again.' });
});

router.get('/teacher/classes/:id', async (req, res) => {
  const c = await ownClass(req, res);
  if (!c) return;
  const [summary, heatmap, learners, assignments] = await Promise.all([
    stats.classSummary(c.id),
    stats.topicHeatmap(c.id),
    stats.learnerTable(c.id),
    db.query(
      `SELECT a.id, a.topic_id, t.name AS topic, a.due_date, a.created_at,
              (SELECT COUNT(DISTINCT r.learner_id) FROM quiz_runs r WHERE r.assignment_id = a.id)::int AS completed
         FROM assignments a JOIN topics t ON t.id = a.topic_id WHERE a.class_id = $1 ORDER BY a.created_at DESC`,
      [c.id]
    ).then((r) => r.rows),
  ]);
  res.json({
    class: { id: c.id, name: c.name, level: c.level, code: c.code, school: c.school, endlineOpen: c.endline_open },
    summary, heatmap, learners, assignments,
  });
});

// Add learners by first name, one per line.
router.post('/teacher/classes/:id/learners', async (req, res) => {
  const c = await ownClass(req, res);
  if (!c) return;
  const names = String(req.body?.names || '')
    .split(/[\n,]+/)
    .map((n) => n.trim().replace(/\s+/g, ' ').slice(0, 40))
    .filter(Boolean);
  const added = [];
  const skipped = [];
  for (const n of names) {
    const { rows } = await db.query(
      'INSERT INTO learners (class_id, first_name) VALUES ($1,$2) ON CONFLICT (class_id, first_name) DO NOTHING RETURNING id',
      [c.id, n]
    );
    (rows.length ? added : skipped).push(n);
  }
  res.json({ added, skipped });
});

router.post('/teacher/learners/:learnerId/reset-pin', async (req, res) => {
  const { rowCount, rows } = await db.query(
    `UPDATE learners SET pin_hash = NULL WHERE id = $1
       AND class_id IN (SELECT id FROM classes WHERE teacher_id = $2) RETURNING id`,
    [Number(req.params.learnerId), req.user.id]
  );
  if (!(rowCount || rows.length)) return res.status(404).json({ error: 'Learner not found.' });
  res.json({ ok: true });
});

router.delete('/teacher/learners/:learnerId', async (req, res) => {
  const { rows } = await db.query(
    `DELETE FROM learners WHERE id = $1 AND class_id IN (SELECT id FROM classes WHERE teacher_id = $2) RETURNING id`,
    [Number(req.params.learnerId), req.user.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Learner not found.' });
  res.json({ ok: true });
});

router.get('/teacher/topics', async (req, res) => {
  const { rows } = await db.query(
    `SELECT t.id, t.name, t.level, COUNT(q.id)::int AS questions
       FROM topics t LEFT JOIN questions q ON q.topic_id = t.id AND q.active
      GROUP BY t.id ORDER BY t.sort`
  );
  res.json(rows);
});

router.post('/teacher/classes/:id/assignments', async (req, res) => {
  const c = await ownClass(req, res);
  if (!c) return;
  const topic = String(req.body?.topic || '');
  const due = /^\d{4}-\d{2}-\d{2}$/.test(req.body?.due || '') ? req.body.due : null;
  const { rows: [t] } = await db.query('SELECT id FROM topics WHERE id = $1 AND level <= $2', [topic, c.level]);
  if (!t) return res.status(400).json({ error: 'Pick a topic for this class level.' });
  const { rows: [a] } = await db.query(
    'INSERT INTO assignments (class_id, topic_id, due_date) VALUES ($1,$2,$3) RETURNING id',
    [c.id, t.id, due]
  );
  res.json(a);
});

router.delete('/teacher/classes/:id/assignments/:aid', async (req, res) => {
  const c = await ownClass(req, res);
  if (!c) return;
  await db.query('DELETE FROM assignments WHERE id = $1 AND class_id = $2', [Number(req.params.aid), c.id]);
  res.json({ ok: true });
});

// Opens or closes the end-of-pilot (endline) test for a class.
router.post('/teacher/classes/:id/endline', async (req, res) => {
  const c = await ownClass(req, res);
  if (!c) return;
  await db.query('UPDATE classes SET endline_open = $1 WHERE id = $2', [!!req.body?.open, c.id]);
  res.json({ ok: true, open: !!req.body?.open });
});

router.get('/teacher/classes/:id/report.csv', async (req, res) => {
  const c = await ownClass(req, res);
  if (!c) return;
  const csv = await reports.classCsv(c);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${reports.fileName(c)}.csv"`);
  res.send(csv);
});

router.get('/teacher/classes/:id/report.pdf', async (req, res) => {
  const c = await ownClass(req, res);
  if (!c) return;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${reports.fileName(c)}.pdf"`);
  await reports.classPdf(c, res);
});

module.exports = router;
