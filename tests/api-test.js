// End-to-end API test: starts the server on a fresh embedded database and walks through
// admin → teacher → learner → sync → reports. Run: node tests/api-test.js
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');

const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://localhost:${PORT}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-test-'));
let passed = 0;

async function call(method, url, body, token, raw) {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) return res;
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}
function ok(cond, msg) { assert.ok(cond, msg); passed++; console.log('  ✓ ' + msg); }

async function main() {
  const server = spawn(process.execPath, ['src/server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), PGLITE_DIR: dir, DATABASE_URL: '', ADMIN_PASSWORD: 'test-admin-pw', APP_SECRET: 'test-secret' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', (d) => (log += d));
  server.stderr.on('data', (d) => (log += d));
  try {
    for (let i = 0; i < 60 && !log.includes('running on'); i++) await new Promise((r) => setTimeout(r, 250));
    if (!log.includes('running on')) throw new Error('Server did not start:\n' + log);

    console.log('Admin');
    ok((await call('POST', '/api/admin/login', { password: 'wrong' })).status === 401, 'wrong admin password is refused');
    const admin = (await call('POST', '/api/admin/login', { password: 'test-admin-pw' })).data.token;
    ok(admin, 'admin signs in');
    const school = (await call('POST', '/api/admin/schools', { name: 'St. Mary\'s SS Kayunga', district: 'Kayunga', consent_on_file: true }, admin)).data;
    ok(school.id, 'school created');
    const t1 = (await call('POST', '/api/admin/teachers', { school_id: school.id, name: 'Mr. Okello', email: 'Okello@example.com' }, admin)).data;
    ok(t1.tempPassword && t1.email === 'okello@example.com', 'teacher created with temporary password, email lower-cased');
    const t2 = (await call('POST', '/api/admin/teachers', { school_id: school.id, name: 'Ms. Nakato', email: 'nakato@example.com' }, admin)).data;
    ok((await call('POST', '/api/admin/teachers', { school_id: school.id, name: 'X', email: 'nakato@example.com' }, admin)).status === 409, 'duplicate teacher email refused');

    console.log('Teacher');
    const teacher = (await call('POST', '/api/teacher/login', { email: 'okello@example.com', password: t1.tempPassword })).data.token;
    ok(teacher, 'teacher signs in with temporary password');
    ok((await call('POST', '/api/teacher/password', { current: t1.tempPassword, next: 'newpassword1' }, teacher)).status === 200, 'teacher changes password');
    ok((await call('POST', '/api/teacher/login', { email: 'okello@example.com', password: 'newpassword1' })).status === 200, 'new password works');
    const cls = (await call('POST', '/api/teacher/classes', { name: 'S1 East', level: 'S1' }, teacher)).data;
    ok(/^[A-Z2-9]{6}$/.test(cls.code), `class created with code ${cls.code}`);
    const add = (await call('POST', `/api/teacher/classes/${cls.id}/learners`, { names: 'Sarah\nBrian K.\nSarah\n\n  Aisha  ' }, teacher)).data;
    ok(add.added.length === 3 && add.skipped.length === 1, 'learners added, duplicate name skipped');

    const other = (await call('POST', '/api/teacher/login', { email: 'nakato@example.com', password: t2.tempPassword })).data.token;
    ok((await call('GET', `/api/teacher/classes/${cls.id}`, null, other)).status === 404, 'another teacher cannot see this class');

    console.log('Learner joins');
    ok((await call('GET', '/api/class/ZZZZZZ')).status === 404, 'wrong class code gives a clear 404');
    const roster = (await call('GET', `/api/class/${cls.code.toLowerCase()}`)).data;
    ok(roster.learners.length === 3 && roster.class.school.includes('Kayunga'), 'class code (any case) shows names and school');
    const sarah = roster.learners.find((l) => l.first_name === 'Sarah');
    ok(!sarah.has_pin, 'new learner has no PIN yet');
    ok((await call('POST', '/api/learner/login', { code: cls.code, learnerId: sarah.id, pin: '12' })).status === 400, 'PIN must be 4 digits');
    let r = await call('POST', '/api/learner/login', { code: cls.code, learnerId: sarah.id, pin: '4821' });
    ok(r.data.firstTime && r.data.token, 'first sign-in sets the PIN');
    ok((await call('POST', '/api/learner/login', { code: cls.code, learnerId: sarah.id, pin: '0000' })).status === 401, 'wrong PIN refused');
    r = await call('POST', '/api/learner/login', { code: cls.code, learnerId: sarah.id, pin: '4821' });
    const learner = r.data.token;
    ok(!r.data.firstTime && learner, 'correct PIN signs in');
    ok((await call('GET', `/api/teacher/classes/${cls.id}`, null, learner)).status === 401, 'learner token cannot open teacher routes');

    console.log('Bundle');
    let bundle = (await call('GET', '/api/learner/bundle', null, learner)).data;
    ok(bundle.topics.length === 7 && bundle.topics.every((t) => t.level === 'S1'), 'S1 class gets the 7 S1 topics only');
    ok(bundle.questions.length === 70, '70 S1 questions downloaded');
    const assess = bundle.questions.filter((q) => q.assessment);
    ok(assess.length === 14, '14 starting-test questions');
    ok(bundle.endlineOpen === false, 'end-of-term test starts closed');

    console.log('Sync');
    const iso = () => new Date().toISOString();
    const baseRun = crypto.randomUUID();
    const baseAttempts = assess.map((q, i) => ({ id: crypto.randomUUID(), runId: baseRun, questionId: q.id, topic: q.topic, mode: 'baseline', correct: i < 7, answer: 'x', answeredAt: iso() }));
    const payload = { runs: [{ id: baseRun, mode: 'baseline', score: 7, total: 14, startedAt: iso(), completedAt: iso() }], attempts: baseAttempts };
    r = await call('POST', '/api/learner/sync', payload, learner);
    ok(r.data.accepted.runs.length === 1 && r.data.accepted.attempts.length === 14, 'baseline run and 14 answers accepted');
    r = await call('POST', '/api/learner/sync', payload, learner);
    ok(r.data.accepted.attempts.length === 14, 're-sending the same batch is accepted…');
    let cv = (await call('GET', `/api/teacher/classes/${cls.id}`, null, teacher)).data;
    ok(cv.summary.answers === 14 && cv.summary.quizzes === 1, '…but nothing is double-counted');
    const secondBase = crypto.randomUUID();
    await call('POST', '/api/learner/sync', { runs: [{ id: secondBase, mode: 'baseline', score: 14, total: 14, completedAt: iso() }] }, learner);
    cv = (await call('GET', `/api/teacher/classes/${cls.id}`, null, teacher)).data;
    ok(cv.summary.quizzes === 1 && cv.summary.baseline_avg === 50, 'a second starting test is ignored (baseline stays 50%)');

    const asg = (await call('POST', `/api/teacher/classes/${cls.id}/assignments`, { topic: 'integers', due: '2026-11-07' }, teacher)).data;
    ok(asg.id, 'teacher assigns Working with Integers');
    ok((await call('POST', `/api/teacher/classes/${cls.id}/assignments`, { topic: 'sets' }, teacher)).status === 400, 'S2 topic cannot be assigned to an S1 class');
    bundle = (await call('GET', '/api/learner/bundle', null, learner)).data;
    ok(bundle.assignments.length === 1 && !bundle.assignments[0].done, 'learner sees the assignment');
    const intQs = bundle.questions.filter((q) => q.topic === 'integers');
    const aRun = crypto.randomUUID();
    await call('POST', '/api/learner/sync', {
      runs: [{ id: aRun, mode: 'assignment', topic: 'integers', assignmentId: asg.id, score: 8, total: 10, completedAt: iso() }],
      attempts: intQs.map((q, i) => ({ id: crypto.randomUUID(), runId: aRun, questionId: q.id, topic: q.topic, mode: 'assignment', correct: i < 8, answeredAt: iso() })),
    }, learner);
    bundle = (await call('GET', '/api/learner/bundle', null, learner)).data;
    ok(bundle.assignments[0].done, 'assignment shows as done after sync');
    const uniqueSeen = new Set([...assess, ...intQs].map((q) => q.id)).size;
    ok(Object.keys(bundle.seen).length === uniqueSeen, `per-question history returned (${uniqueSeen} different questions seen)`);
    const ints = bundle.progress.find((p) => p.topic === 'integers');
    ok(ints && ints.answers >= 10, 'topic progress returned');

    const bad = await call('POST', '/api/learner/sync', { runs: [{ id: 'not-a-uuid', mode: 'practice', score: 1, total: 1, completedAt: iso() }], attempts: [{ id: crypto.randomUUID(), questionId: 999999, mode: 'hack', correct: true }] }, learner);
    ok(bad.status === 200 && bad.data.accepted.runs.length === 0 && bad.data.accepted.attempts.length === 0, 'malformed records are rejected safely');

    console.log('End-of-term test and reports');
    await call('POST', `/api/teacher/classes/${cls.id}/endline`, { open: true }, teacher);
    bundle = (await call('GET', '/api/learner/bundle', null, learner)).data;
    ok(bundle.endlineOpen === true, 'teacher opens the end-of-term test');
    await call('POST', '/api/learner/sync', { runs: [{ id: crypto.randomUUID(), mode: 'endline', score: 11, total: 14, completedAt: iso() }] }, learner);
    cv = (await call('GET', `/api/teacher/classes/${cls.id}`, null, teacher)).data;
    ok(cv.summary.paired_learners === 1 && cv.summary.paired_baseline_avg === 50 && cv.summary.paired_endline_avg === 79, 'learning gain: 50% → 79%');
    ok(cv.heatmap.length === 7 && cv.heatmap.find((h) => h.id === 'integers').answers >= 10, 'topic heatmap filled');
    const sRow = cv.learners.find((l) => l.first_name === 'Sarah');
    ok(sRow.joined && sRow.baseline === 50 && sRow.endline === 79 && sRow.quizzes === 3, 'learner row shows tests and quizzes');

    const csv = await (await call('GET', `/api/teacher/classes/${cls.id}/report.csv`, null, teacher, true)).text();
    ok(csv.includes('Learners with both tests') && csv.includes('Sarah') && csv.includes('Working with Integers'), 'CSV report has summary, topics and learners');
    const pdfRes = await call('GET', `/api/teacher/classes/${cls.id}/report.pdf`, null, teacher, true);
    const pdf = Buffer.from(await pdfRes.arrayBuffer());
    fs.writeFileSync(path.join(dir, 'sample-report.pdf'), pdf);
    ok(pdfRes.headers.get('content-type') === 'application/pdf' && pdf.slice(0, 5).toString() === '%PDF-', `PDF report generated (${pdf.length} bytes)`);
    ok((await call('GET', `/api/teacher/classes/${cls.id}/report.pdf?token=${teacher}`, null, null, true)).status === 401, 'token in the URL is not accepted');

    console.log('PIN reset');
    await call('POST', `/api/teacher/learners/${sarah.id}/reset-pin`, null, teacher);
    r = await call('POST', '/api/learner/login', { code: cls.code, learnerId: sarah.id, pin: '9999' });
    ok(r.data.firstTime, 'after a reset the learner chooses a new PIN');

    console.log('Admin metrics and question import');
    const m = (await call('GET', '/api/admin/metrics', null, admin)).data;
    ok(m.totals.enrolled === 3 && m.totals.joined === 1 && m.totals.weekly_active === 1 && m.totals.schools_with_consent === 1, 'pilot totals correct');
    ok(m.schools[0].paired_learners === 1 && m.daily.length >= 1, 'per-school gain and daily activity');
    const goodCsv = 'ref,topic,type,prompt,option_a,option_b,option_c,option_d,answer,explanation,assessment,active\n' +
      't-001,integers,mcq,"What is -2 + 5?",3,-3,7,-7,A,"Start at -2, move 5 up.",no,yes\n' +
      't-002,algebra,short,"Solve x - 4 = 6",,,,,10,"Add 4 to both sides.",,\n';
    r = await call('POST', '/api/admin/questions/import', { csv: goodCsv }, admin);
    ok(r.data.imported === 2, 'valid CSV imports 2 questions');
    r = await call('POST', '/api/admin/questions/import', { csv: goodCsv.replace('integers', 'nope').replace(',A,', ',E,') }, admin);
    ok(r.status === 400 && r.data.details.length >= 2, 'invalid CSV is rejected with row-by-row reasons');
    const q = (await call('GET', '/api/admin/questions?topic=integers', null, admin)).data;
    ok(q.length === 11 && q.some((x) => x.ref === 't-001' && x.answer === '0'), 'imported mcq stored with answer index');
    const t001 = q.find((x) => x.ref === 't-001');
    await call('PATCH', `/api/admin/questions/${t001.id}`, { active: false }, admin);
    bundle = (await call('GET', '/api/learner/bundle', null, r.data && learner)).data;
    ok(!bundle.questions.some((x) => x.id === t001.id), 'deactivated question no longer sent to learners');

    console.log('Static files');
    for (const f of ['/', '/teacher', '/admin', '/sw.js', '/manifest.webmanifest', '/js/check.js', '/icon-192.png', '/css/staff.css']) {
      const res = await call('GET', f, null, null, true);
      ok(res.status === 200, `${f} served`);
    }

    console.log(`\nAll ${passed} checks passed. Sample PDF: ${path.join(dir, 'sample-report.pdf')}`);
  } finally {
    server.kill();
  }
}

main().catch((e) => { console.error('\n✗ FAILED:', e.message); process.exit(1); });
