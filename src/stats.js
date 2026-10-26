// Shared queries for teacher dashboard, reports and admin metrics.
const db = require('./db');

async function classSummary(classId) {
  const { rows: [s] } = await db.query(
    `SELECT
       (SELECT COUNT(*) FROM learners WHERE class_id = $1)::int AS enrolled,
       (SELECT COUNT(*) FROM learners WHERE class_id = $1 AND pin_hash IS NOT NULL)::int AS joined,
       (SELECT COUNT(DISTINCT a.learner_id) FROM attempts a JOIN learners l ON l.id = a.learner_id
          WHERE l.class_id = $1 AND a.answered_at > NOW() - INTERVAL '7 days')::int AS weekly_active,
       (SELECT COUNT(*) FROM quiz_runs r JOIN learners l ON l.id = r.learner_id WHERE l.class_id = $1)::int AS quizzes,
       (SELECT COUNT(*) FROM attempts a JOIN learners l ON l.id = a.learner_id WHERE l.class_id = $1)::int AS answers`,
    [classId]
  );
  const scores = await assessmentScores('l.class_id = $1', [classId]);
  return { ...s, ...scores };
}

// Average baseline and endline score (percent) for a set of learners,
// plus the average gain for learners who took both.
async function assessmentScores(where, params) {
  const { rows } = await db.query(
    `SELECT r.learner_id, r.mode, MIN(r.completed_at) AS first_at,
            (ARRAY_AGG(r.score::float / NULLIF(r.total,0) ORDER BY r.completed_at))[1] AS pct
       FROM quiz_runs r JOIN learners l ON l.id = r.learner_id
       JOIN classes c ON c.id = l.class_id JOIN teachers t ON t.id = c.teacher_id
      WHERE r.mode IN ('baseline','endline') AND ${where}
      GROUP BY r.learner_id, r.mode`,
    params
  );
  const base = new Map();
  const end = new Map();
  for (const r of rows) (r.mode === 'baseline' ? base : end).set(r.learner_id, Number(r.pct));
  const avg = (arr) => (arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) : null);
  const paired = [...end.keys()].filter((id) => base.has(id));
  return {
    baseline_takers: base.size,
    baseline_avg: avg([...base.values()]),
    endline_takers: end.size,
    endline_avg: avg([...end.values()]),
    paired_learners: paired.length,
    paired_baseline_avg: avg(paired.map((id) => base.get(id))),
    paired_endline_avg: avg(paired.map((id) => end.get(id))),
  };
}

async function topicHeatmap(classId) {
  const { rows } = await db.query(
    `SELECT t.id, t.name, t.level,
            COUNT(a.id)::int AS answers,
            COALESCE(SUM(CASE WHEN a.correct THEN 1 ELSE 0 END),0)::int AS correct,
            COUNT(DISTINCT a.learner_id)::int AS learners
       FROM topics t
       JOIN classes c ON c.id = $1
       LEFT JOIN attempts a ON a.topic_id = t.id
            AND a.learner_id IN (SELECT id FROM learners WHERE class_id = $1)
      WHERE t.level <= c.level
      GROUP BY t.id, t.name, t.level, t.sort
      ORDER BY t.sort`,
    [classId]
  );
  return rows.map((r) => ({ ...r, pct: r.answers ? Math.round((r.correct / r.answers) * 100) : null }));
}

async function learnerTable(classId) {
  const { rows } = await db.query(
    `SELECT l.id, l.first_name, (l.pin_hash IS NOT NULL) AS joined,
            (SELECT COUNT(*) FROM quiz_runs r WHERE r.learner_id = l.id)::int AS quizzes,
            (SELECT COUNT(*) FROM attempts a WHERE a.learner_id = l.id)::int AS answers,
            (SELECT ROUND(100.0 * AVG(CASE WHEN a.correct THEN 1 ELSE 0 END)) FROM attempts a WHERE a.learner_id = l.id)::int AS pct,
            (SELECT MAX(a.answered_at) FROM attempts a WHERE a.learner_id = l.id) AS last_active,
            (SELECT ROUND(100.0 * r.score / NULLIF(r.total,0)) FROM quiz_runs r
               WHERE r.learner_id = l.id AND r.mode = 'baseline' ORDER BY r.completed_at LIMIT 1)::int AS baseline,
            (SELECT ROUND(100.0 * r.score / NULLIF(r.total,0)) FROM quiz_runs r
               WHERE r.learner_id = l.id AND r.mode = 'endline' ORDER BY r.completed_at LIMIT 1)::int AS endline
       FROM learners l WHERE l.class_id = $1 ORDER BY l.first_name`,
    [classId]
  );
  return rows;
}

module.exports = { classSummary, assessmentScores, topicHeatmap, learnerTable };
