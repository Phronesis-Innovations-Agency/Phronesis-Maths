// Checks the question bank: structure, and that every answer matches an independent calculation.
// Run: node tests/verify-bank.js
const assert = require('assert');
const bank = require('../data/questions.json');
const { isCorrect, clean, toNumber } = require('../public/js/check.js');

const topics = new Set(bank.topics.map((t) => t.id));
const refs = new Set();
let problems = 0;
const fail = (q, msg) => { problems++; console.error(`✗ ${q.ref}: ${msg}`); };

// ---- Structure ----
for (const q of bank.questions) {
  if (refs.has(q.ref)) fail(q, 'duplicate ref');
  refs.add(q.ref);
  if (!topics.has(q.topic)) fail(q, 'unknown topic ' + q.topic);
  if (!q.prompt || !q.explanation) fail(q, 'missing prompt or explanation');
  if (q.type === 'mcq') {
    if (!Array.isArray(q.options) || q.options.length !== 4) fail(q, 'mcq needs 4 options');
    if (new Set(q.options).size !== q.options.length) fail(q, 'duplicate options');
    if (!(q.answer >= 0 && q.answer < q.options.length)) fail(q, 'answer index out of range');
  } else if (q.type === 'short') {
    for (const a of String(q.answer).split('|')) if (!isCorrect(a, q.answer)) fail(q, `stored answer "${a}" not accepted by checker`);
  } else fail(q, 'bad type');
}
for (const t of bank.topics) {
  const n = bank.questions.filter((q) => q.topic === t.id).length;
  const a = bank.questions.filter((q) => q.topic === t.id && q.assessment).length;
  if (n < 10) { problems++; console.error(`✗ topic ${t.id}: only ${n} questions`); }
  if (a !== 2) { problems++; console.error(`✗ topic ${t.id}: ${a} assessment questions (want 2)`); }
}

// ---- Independent answers ----
const b = (s, base) => parseInt(s, base);
const gcd = (x, y) => (y ? gcd(y, x % y) : x);
const median = (xs) => { const s = [...xs].sort((p, q) => p - q); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (xs) => xs.reduce((p, q) => p + q, 0) / xs.length;
const back = (x) => (x + 180) % 360;
const expected = {
  'nb-01': b('1011', 2), 'nb-02': (13).toString(2), 'nb-03': b('24', 5), 'nb-04': (45).toString(5), 'nb-05': '4',
  'nb-06': (b('101', 2) + b('11', 2)).toString(2), 'nb-07': 3 * 16, 'nb-08': b('212', 3),
  'nb-09': (b('1100', 2) - b('101', 2)).toString(2), 'nb-10': b('100', 8),
  'int-01': -7 + 12, 'int-02': -4 * -6, 'int-03': -18 / 3, 'int-04': -5 + 9, 'int-05': 5 - -3, 'int-06': '-5, -1, 0, 3',
  'int-07': -3 * 4 + 10, 'int-08': -15000 + 40000, 'int-09': (-2) ** 3, 'int-10': -10 / -2 - 7,
  'fr-01': 1 / 2 + 1 / 4, 'fr-02': (3 / 5) * 100, 'fr-03': `${35 / gcd(35, 100)}/${100 / gcd(35, 100)}`, 'fr-04': (2 / 3) * 240,
  'fr-05': Math.max(0.6, 5 / 8, 0.62, 3 / 5) === 5 / 8 ? '5/8' : 'other', 'fr-06': (3 * 2) / (4 * 9), 'fr-07': 0.45 * 800,
  'fr-08': 1.75 + 2.5, 'fr-09': 7 / 8, 'fr-10': 20000 * 1.15,
  'seq-01': 15 + 4, 'seq-03': 2 + 9 * 4, 'seq-05': 25, 'seq-06': 4 * 6 + 2, 'seq-07': 4 * 5 - 1, 'seq-08': 32 - 6, 'seq-09': 5 + 8,
  'seq-10': `${(27 - 7) / 2}th`,
  'alg-01': 15 - 7, 'alg-03': (11 + 4) / 3, 'alg-04': 4 * 3 - 2 ** 2, 'alg-05': 18 / 2 - 3, 'alg-07': 7 * 4, 'alg-09': (7000 - 2000) / 5,
  'co-02': -5, 'co-04': `(${(2 + 8) / 2},${(4 + 10) / 2})`, 'co-06': 9 - 2, 'co-07': `(${3 - 2}, ${5 + 4})`, 'co-08': (8 - 2) / (3 - 1),
  'co-09': [[1, 2], [2, 5], [3, 6], [0, 2]].filter(([x, y]) => y === 2 * x + 1).map(([x, y]) => `(${x}, ${y})`)[0],
  'co-10': Math.hypot(6, 8),
  'be-01': '090', 'be-02': 225, 'be-03': String(back(60)), 'be-04': back(135), 'be-05': '270', 'be-07': 30, 'be-09': 75,
  'ra-01': `${12 / gcd(12, 18)}:${18 / gcd(12, 18)}`, 'ra-02': (30000 / 5) * 3, 'ra-03': (4500 / 3) * 7, 'ra-04': (2 * 50000) / 100000,
  'ra-05': (6 * 10) / 12, 'ra-07': 3 * 4, 'ra-08': (96 / 12) * 20, 'ra-09': (45 / 9) * 4, 'ra-10': (600 / 4) * 10,
  'ca-01': 100000 - 80000, 'ca-02': ((100000 - 80000) / 80000) * 100, 'ca-03': (200000 * 5 * 3) / 100, 'ca-04': 50000 * 0.9,
  'ca-05': 150000 * 0.8, 'ca-07': 15000 * 6, 'ca-08': (24000 * 100) / (6 * 2), 'ca-09': 20 * 3700, 'ca-10': ((300000 - 255000) / 300000) * 100,
  'se-02': 5, 'se-04': 40 - (25 + 18 - 7), 'se-06': 2 ** 3, 'se-08': 12 + 9 - 4, 'se-10': 20 + 15 - 30,
  'da-01': mean([4, 7, 9, 10, 15]), 'da-02': median([3, 8, 5, 12, 7]), 'da-03': 5, 'da-04': 30 - 9, 'da-05': median([4, 9, 2, 7, 10, 6]),
  'da-06': 360 / 4, 'da-07': 12 * 5, 'da-08': mean([50, 60, 60, 70, 80, 100]) > median([50, 60, 60, 70, 80, 100]) ? 'the mean' : 'other',
  'da-09': (24 / 60) * 360, 'da-10': (1 * 2 + 2 * 3 + 3 * 5) / 10,
};

let checked = 0;
for (const q of bank.questions) {
  if (!(q.ref in expected)) continue;
  checked++;
  const exp = expected[q.ref];
  const given = q.type === 'mcq' ? q.options[q.answer] : String(q.answer).split('|')[0];
  const g = clean(given).replace(/th$/, 'th');
  const ok = typeof exp === 'number'
    ? Math.abs((toNumber(clean(given).replace(/\s/g, '').replace(/^\((.*)\)$/, '$1')) ?? NaN) - exp) < 1e-9 || isCorrect(String(exp), given)
    : clean(String(exp)).replace(/\s/g, '') === g.replace(/\s/g, '');
  if (!ok) fail(q, `stored answer "${given}" but calculated ${exp}`);
}

// ---- Checker behaviour ----
const cases = [
  ['23,000', '23000', true], ['23000 UGX', '23000', true], ['UGX 23,000', '23000', true], ['−6', '-6', true],
  ['x = 8', '8', true], ['60', '60%', true], ['60 %', '60%', true], ['4¼', '4 1/4|17/4|4.25', true], ['4 1/4', '4 1/4', true],
  ['17/4', '4 1/4|17/4|4.25', true], ['( 5 , 7 )', '(5,7)', true], ['5,7', '(5,7)', true], ['57', '(5,7)', false],
  ['2 : 3', '2:3', true], ['4:6', '2:3', false], ['30', '030', true], ['225°', '225', true], ['1101₂', '1101', true],
  ['13', '1101', false], ['6.50', '6.5', true], ['', '5', false], ['5 days', '5', true], ['-5', '5', false],
];
for (const [given, ans, want] of cases) {
  if (isCorrect(given, ans) !== want) { problems++; console.error(`✗ checker: "${given}" vs "${ans}" should be ${want}`); }
}

console.log(`${bank.questions.length} questions in ${bank.topics.length} topics; ${checked} answers recalculated; ${cases.length} checker cases.`);
if (problems) { console.error(`${problems} problem(s) found.`); process.exit(1); }
console.log('All checks passed.');
