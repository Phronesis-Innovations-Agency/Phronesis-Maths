const path = require('path');
const express = require('express');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, '..', 'public');

app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

app.get('/healthz', (req, res) => res.json({ ok: true }));

app.use('/api', require('./routes/learner'));
app.use('/api', require('./routes/teacher'));
app.use('/api', require('./routes/admin'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// The service worker must never be cached by the browser, or app updates get stuck.
app.get('/sw.js', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(PUBLIC, 'sw.js'));
});
app.get('/teacher', (req, res) => res.sendFile(path.join(PUBLIC, 'teacher.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC, 'admin.html')));
app.use(express.static(PUBLIC, { maxAge: '1h' }));

// Errors from async routes
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server. Try again.' });
});

db.init()
  .then(() => app.listen(PORT, () => console.log(`Phronesis Maths running on http://localhost:${PORT}`)))
  .catch((e) => {
    console.error('Failed to start:', e);
    process.exit(1);
  });
