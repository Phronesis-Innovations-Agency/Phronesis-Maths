// Class progress reports for head teachers: CSV and PDF.
const PDFDocument = require('pdfkit');
const stats = require('./stats');

const APP_NAME = process.env.APP_NAME || 'Phronesis Maths';

function fileName(c) {
  return `${c.name}-progress-${day(new Date())}`.replace(/[^A-Za-z0-9-]+/g, '-');
}

const TZ = process.env.TIMEZONE || 'Africa/Kampala';
const pct = (v) => (v === null || v === undefined ? '' : `${v}%`);
const day = (d) => (d ? new Date(d).toLocaleDateString('en-CA', { timeZone: TZ }) : ''); // YYYY-MM-DD, Kampala time

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function classCsv(c) {
  const [summary, heatmap, learners] = await Promise.all([
    stats.classSummary(c.id), stats.topicHeatmap(c.id), stats.learnerTable(c.id),
  ]);
  const lines = [];
  const row = (...cells) => lines.push(cells.map(csvCell).join(','));
  row(`${APP_NAME} class report`);
  row('School', c.school);
  row('Class', `${c.name} (${c.level})`);
  row('Report date', day(new Date()));
  row('Learners enrolled', summary.enrolled);
  row('Learners who have joined', summary.joined);
  row('Active in last 7 days', summary.weekly_active);
  row('Quizzes completed', summary.quizzes);
  row('Questions answered', summary.answers);
  row('Baseline average', pct(summary.baseline_avg), `${summary.baseline_takers} learners`);
  row('Endline average', pct(summary.endline_avg), `${summary.endline_takers} learners`);
  row('Learners with both tests', summary.paired_learners,
    `baseline ${pct(summary.paired_baseline_avg)} -> endline ${pct(summary.paired_endline_avg)}`);
  row();
  row('Topic', 'Level', 'Questions answered', 'Percent correct', 'Learners practising');
  for (const t of heatmap) row(t.name, t.level, t.answers, pct(t.pct), t.learners);
  row();
  row('Learner', 'Joined', 'Quizzes', 'Questions answered', 'Percent correct', 'Baseline', 'Endline', 'Last active');
  for (const l of learners) {
    row(l.first_name, l.joined ? 'Yes' : 'No', l.quizzes, l.answers, pct(l.pct), pct(l.baseline), pct(l.endline), day(l.last_active));
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}

async function classPdf(c, out) {
  const [summary, heatmap, learners] = await Promise.all([
    stats.classSummary(c.id), stats.topicHeatmap(c.id), stats.learnerTable(c.id),
  ]);
  const doc = new PDFDocument({ size: 'A4', margin: 48 });
  doc.pipe(out);
  const ink = '#1b2b24';
  const muted = '#5b6b63';
  const brand = '#0f6b4f';
  const W = doc.page.width - 96;

  doc.fillColor(brand).fontSize(10).text(APP_NAME.toUpperCase(), { characterSpacing: 1 });
  doc.moveDown(0.3).fillColor(ink).fontSize(20).text(`${c.name} (${c.level}) — progress report`);
  doc.fillColor(muted).fontSize(11).text(`${c.school} · ${day(new Date())}`);
  doc.moveDown(1);

  // Key numbers
  const tiles = [
    ['Enrolled', summary.enrolled],
    ['Joined', summary.joined],
    ['Active (7 days)', summary.weekly_active],
    ['Quizzes done', summary.quizzes],
  ];
  const tileW = W / tiles.length;
  const y0 = doc.y;
  tiles.forEach(([label, value], i) => {
    const x = 48 + i * tileW;
    doc.fillColor(ink).fontSize(22).text(String(value), x, y0, { width: tileW - 8 });
    doc.fillColor(muted).fontSize(9).text(label, x, y0 + 28, { width: tileW - 8 });
  });
  doc.x = 48;
  doc.y = y0 + 52;

  doc.fillColor(ink).fontSize(13).text('Starting test and end-of-term test', 48);
  doc.moveDown(0.3).fontSize(10).fillColor(ink);
  if (summary.paired_learners) {
    const gain = summary.paired_endline_avg - summary.paired_baseline_avg;
    doc.text(
      `${summary.paired_learners} ${summary.paired_learners === 1 ? 'learner' : 'learners'} took both tests. Their average moved from ${summary.paired_baseline_avg}% to ` +
      `${summary.paired_endline_avg}% (${gain >= 0 ? '+' : ''}${gain} points).`
    );
  } else {
    doc.text(
      `Starting test: ${summary.baseline_takers} learners, average ${pct(summary.baseline_avg) || 'not yet taken'}. ` +
      `End-of-term test: ${summary.endline_takers} learners, average ${pct(summary.endline_avg) || 'not yet taken'}.`
    );
  }
  doc.moveDown(1);

  // Tables
  function table(title, headers, widths, rows) {
    doc.fillColor(ink).fontSize(13).text(title, 48);
    doc.moveDown(0.4);
    const drawRow = (cells, bold) => {
      if (doc.y > doc.page.height - 72) doc.addPage();
      const y = doc.y;
      let x = 48;
      doc.fontSize(9).fillColor(bold ? muted : ink);
      cells.forEach((cell, i) => {
        doc.text(String(cell ?? ''), x, y, { width: widths[i] - 6, lineBreak: false, ellipsis: true });
        x += widths[i];
      });
      doc.moveTo(48, y + 14).lineTo(48 + W, y + 14).strokeColor('#e3e8e5').lineWidth(0.5).stroke();
      doc.y = y + 18;
    };
    drawRow(headers, true);
    rows.forEach((r) => drawRow(r, false));
    doc.x = 48;
    doc.moveDown(1);
  }

  const weakFirst = [...heatmap].sort((a, b) => (a.pct ?? 101) - (b.pct ?? 101));
  table('Topics, weakest first', ['Topic', 'Level', 'Answers', '% correct', 'Learners'],
    [W * 0.46, W * 0.1, W * 0.15, W * 0.15, W * 0.14],
    weakFirst.map((t) => [t.name, t.level, t.answers, t.pct === null ? '—' : `${t.pct}%`, t.learners]));

  table('Learners', ['Name', 'Quizzes', '% correct', 'Start test', 'End test', 'Last active'],
    [W * 0.28, W * 0.12, W * 0.14, W * 0.14, W * 0.14, W * 0.18],
    learners.map((l) => [l.first_name + (l.joined ? '' : ' (not joined)'), l.quizzes, pct(l.pct) || '—',
      pct(l.baseline) || '—', pct(l.endline) || '—', day(l.last_active) || '—']));

  doc.fillColor(muted).fontSize(8).text(`Generated by ${APP_NAME}. Only first names are stored.`, 48);
  doc.end();
}

module.exports = { classCsv, classPdf, fileName };
