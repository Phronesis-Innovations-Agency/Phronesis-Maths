const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { parse } = require('csv-parse/sync');
const db = require('../db');
const auth = require('../auth');
const stats = require('../stats');

const router = express.Router();
const TZ = process.env.TIMEZONE || 'Africa/Kampala';
const ADMIN_PASSWORD =process.env.ADMIN_PASSWORD || (process.env.NODE_ENV === 'production' ? null : 'admin-dev');

router.post('/admin/login', (req, res) => {
  if (!ADMIN_PASSWORD) return res.status(503).json({ error: 'ADMIN_PASSWORD is not set on the server.' });
  if (auth.isLocked('admin')) return res.status(429).json({ error: 'Too many attempts. Wait 10 minutes.' });
  const given = Buffer.from(String(req.body?.password || ''));
  const real = Buffer.from(ADMIN_PASSWORD);
  if (given.length !== real.length || !crypto.timingSafeEqual(given, real)) {
    auth.recordFailure('admin');
    return res.status(401).json({ error: 'Wrong password.' });
  }
  auth.clearFailures('admin');
  res.json({ token: auth.sign({ role: 'admin' }) });
});

router.use('/admin', auth.requireRole('admin'));

// ---------- Metrics: the numbers for the fellowship application ----------
router.get('/admin/metrics', async (req, res) => {
  const { rows: [totals] } = await db.query(
    `SELECT (SELECT COUNT(*) FROM schools)::int AS schools,
            (SELECT COUNT(*) FROM schools WHERE consent_on_file)::int AS schools_with_consent,
            (SELECT COUNT(*) FROM teachers)::int AS teachers,
            (SELECT COUNT(*) FROM classes)::int AS classes,
            (SELECT COUNT(*) FROM learners)::int AS enrolled,
            (SELECT COUNT(*) FROM learners WHERE pin_hash IS NOT NULL)::int AS joined,
            (SELECT COUNT(DISTINCT learner_id) FROM attempts WHERE answered_at > NOW() - INTERVAL '7 days')::int AS weekly_active,
            (SELECT COUNT(*) FROM quiz_runs)::int AS quizzes,
            (SELECT COUNT(*) FROM attempts)::int AS answers,
            (SELECT COUNT(DISTINCT c.teacher_id) FROM assignments a JOIN classes c ON c.id = a.class_id
               WHERE a.created_at > NOW() - INTERVAL '7 days')::int AS teachers_assigning_this_week`
  );
  const scores = await stats.assessmentScores('TRUE', []);
  const { rows: schools } = await db.query(
    `SELECT s.id, s.name, s.district, s.consent_on_file,
            (SELECT COUNT(*) FROM learners l JOIN classes c ON c.id = l.class_id JOIN teachers t ON t.id = c.teacher_id WHERE t.school_id = s.id)::int AS enrolled,
            (SELECT COUNT(DISTINCT a.learner_id) FROM attempts a JOIN learners l ON l.id = a.learner_id JOIN classes c ON c.id = l.class_id
               JOIN teachers t ON t.id = c.teacher_id WHERE t.school_id = s.id AND a.answered_at > NOW() - INTERVAL '7 days')::int AS weekly_active,
            (SELECT COUNT(*) FROM quiz_runs r JOIN learners l ON l.id = r.learner_id JOIN classes c ON c.id = l.class_id
               JOIN teachers t ON t.id = c.teacher_id WHERE t.school_id = s.id)::int AS quizzes
       FROM schools s ORDER BY s.name`
  );
  for (const s of schools) Object.assign(s, await stats.assessmentScores('t.school_id = $1', [s.id]));
  const { rows: daily } = await db.query(
    `SELECT TO_CHAR(DATE_TRUNC('day', answered_at AT TIME ZONE $1), 'YYYY-MM-DD') AS day,
            COUNT(DISTINCT learner_id)::int AS learners, COUNT(*)::int AS answers
       FROM attempts WHERE answered_at > NOW() - INTERVAL '30 days'
      GROUP BY 1 ORDER BY 1`,
    [TZ]
  );
  const today = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
  res.json({ totals: { ...totals, ...scores }, schools, daily, today });
});

// ---------- Schools and teachers ----------
router.get('/admin/schools', async (req, res) => {
  const { rows } = await db.query(
    `SELECT s.*, COALESCE(JSON_AGG(JSON_BUILD_OBJECT('id', t.id, 'name', t.name, 'email', t.email)
              ORDER BY t.name) FILTER (WHERE t.id IS NOT NULL), '[]') AS teachers
       FROM schools s LEFT JOIN teachers t ON t.school_id = s.id GROUP BY s.id ORDER BY s.name`
  );
  res.json(rows);
});

router.post('/admin/schools', async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  if (!name) return res.status(400).json({ error: 'School name is required.' });
  const { rows: [s] } = await db.query(
    `INSERT INTO schools (name, district, contact_name, contact_phone, consent_on_file)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [name, b.district || null, b.contact_name || null, b.contact_phone || null, !!b.consent_on_file]
  );
  res.json(s);
});

router.patch('/admin/schools/:id', async (req, res) => {
  const { rows: [s] } = await db.query(
    'UPDATE schools SET consent_on_file = $1 WHERE id = $2 RETURNING *',
    [!!req.body?.consent_on_file, Number(req.params.id)]
  );
  if (!s) return res.status(404).json({ error: 'School not found.' });
  res.json(s);
});

// Creates a teacher account and returns a temporary password once, to hand to the teacher.
router.post('/admin/teachers', async (req, res) => {
  const b = req.body || {};
  const email = String(b.email || '').trim().toLowerCase();
  const name = String(b.name || '').trim();
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Name and a valid email are required.' });
  const tempPassword = crypto.randomBytes(6).toString('base64url');
  try {
    const { rows: [t] } = await db.query(
      'INSERT INTO teachers (school_id, name, email, password_hash) VALUES ($1,$2,$3,$4) RETURNING id, name, email',
      [Number(b.school_id), name, email, await bcrypt.hash(tempPassword, 10)]
    );
    res.json({ ...t, tempPassword });
  } catch (e) {
    if (String(e.message).includes('unique')) return res.status(409).json({ error: 'A teacher with that email already exists.' });
    if (String(e.message).includes('foreign')) return res.status(400).json({ error: 'Pick a school first.' });
    throw e;
  }
});

router.post('/admin/teachers/:id/reset-password', async (req, res) => {
  const tempPassword = crypto.randomBytes(6).toString('base64url');
  const { rows } = await db.query('UPDATE teachers SET password_hash = $1 WHERE id = $2 RETURNING id',
    [await bcrypt.hash(tempPassword, 10), Number(req.params.id)]);
  if (!rows.length) return res.status(404).json({ error: 'Teacher not found.' });
  res.json({ tempPassword });
});

// ---------- Question bank ----------
router.get('/admin/topics', async (req, res) => {
  const { rows } = await db.query(
    `SELECT t.*, COUNT(q.id) FILTER (WHERE q.active)::int AS active_questions,
            COUNT(q.id) FILTER (WHERE q.active AND q.assessment)::int AS assessment_questions
       FROM topics t LEFT JOIN questions q ON q.topic_id = t.id GROUP BY t.id ORDER BY t.sort`
  );
  res.json(rows);
});

router.get('/admin/questions', async (req, res) => {
  const params = [];
  let where = 'TRUE';
  if (req.query.topic) { params.push(req.query.topic); where = 'q.topic_id = $1'; }
  const { rows } = await db.query(
    `SELECT q.*,
            (SELECT COUNT(*) FROM attempts a WHERE a.question_id = q.id)::int AS answered,
            (SELECT ROUND(100.0 * AVG(CASE WHEN a.correct THEN 1 ELSE 0 END)) FROM attempts a WHERE a.question_id = q.id)::int AS pct_correct
       FROM questions q WHERE ${where} ORDER BY q.topic_id, q.id`,
    params
  );
  res.json(rows);
});

router.patch('/admin/questions/:id', async (req, res) => {
  const b = req.body || {};
  const sets = [];
  const params = [];
  for (const key of ['active', 'assessment']) {
    if (key in b) { params.push(!!b[key]); sets.push(`${key} = $${params.length}`); }
  }
  for (const key of ['prompt', 'answer', 'explanation']) {
    if (typeof b[key] === 'string' && b[key].trim()) { params.push(b[key].trim()); sets.push(`${key} = $${params.length}`); }
  }
  if (Array.isArray(b.options)) { params.push(JSON.stringify(b.options.map(String))); sets.push(`options = $${params.length}`); }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to change.' });
  params.push(Number(req.params.id));
  const { rows: [q] } = await db.query(
    `UPDATE questions SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length} RETURNING *`, params
  );
  if (!q) return res.status(404).json({ error: 'Question not found.' });
  res.json(q);
});

const CSV_HEADERS = ['ref', 'topic', 'type', 'prompt', 'option_a', 'option_b', 'option_c', 'option_d', 'answer', 'explanation', 'assessment', 'active'];

router.get('/admin/questions/template.csv', (req, res) => {
  const example = [
    CSV_HEADERS.join(','),
    'teacher-001,fractions,mcq,"What is 1/2 + 1/4?",1/4,2/6,3/4,1/8,C,"Change 1/2 to 2/4. Then 2/4 + 1/4 = 3/4.",no,yes',
    'teacher-002,integers,short,"Work out -7 + 12.",,,,,5,"Start at -7 and move 12 steps up the number line to 5.",no,yes',
  ].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="question-template.csv"');
  res.send(example + '\r\n');
});

// Import or update questions from CSV text. Validates every row first; imports nothing if any row is wrong.
router.post('/admin/questions/import', async (req, res) => {
  let records;
  try {
    records = parse(String(req.body?.csv || ''), { columns: (h) => h.map((x) => x.trim().toLowerCase()), skip_empty_lines: true, trim: true, bom: true });
  } catch (e) {
    return res.status(400).json({ error: 'Could not read the CSV: ' + e.message });
  }
  const { rows: topics } = await db.query('SELECT id FROM topics');
  const topicIds = new Set(topics.map((t) => t.id));
  const yes = (v, dflt) => (v === undefined || v === '' ? dflt : /^(y|yes|true|1)$/i.test(v));
  const errors = [];
  const questions = [];
  records.forEach((r, i) => {
    const line = i + 2;
    const type = (r.type || '').toLowerCase();
    if (!r.ref) errors.push(`Row ${line}: ref is empty (give every question a unique ref, e.g. teacher-001).`);
    if (!topicIds.has(r.topic)) errors.push(`Row ${line}: unknown topic "${r.topic}".`);
    if (!['mcq', 'short'].includes(type)) errors.push(`Row ${line}: type must be mcq or short.`);
    if (!r.prompt) errors.push(`Row ${line}: prompt is empty.`);
    if (!r.explanation) errors.push(`Row ${line}: explanation is empty — every question needs one.`);
    let answer = r.answer;
    let options = null;
    if (type === 'mcq') {
      options = ['option_a', 'option_b', 'option_c', 'option_d'].map((k) => r[k]).filter((v) => v !== undefined && v !== '');
      const idx = 'ABCD'.indexOf(String(r.answer || '').toUpperCase());
      if (options.length < 2) errors.push(`Row ${line}: mcq needs at least 2 options.`);
      if (idx < 0 || idx >= options.length) errors.push(`Row ${line}: answer must be the letter of a filled option (A–D).`);
      answer = String(idx);
    } else if (!answer) {
      errors.push(`Row ${line}: answer is empty.`);
    }
    questions.push({ ref: r.ref, topic: r.topic, type, prompt: r.prompt, options, answer, explanation: r.explanation,
      assessment: yes(r.assessment, false), active: yes(r.active, true) });
  });
  if (!records.length) errors.push('The CSV has no question rows.');
  if (errors.length) return res.status(400).json({ error: 'Nothing was imported. Fix these rows and try again.', details: errors.slice(0, 50) });
  await db.tx(async (t) => { for (const q of questions) await db.upsertQuestion(t, q); });
  res.json({ imported: questions.length });
});

module.exports = router;
