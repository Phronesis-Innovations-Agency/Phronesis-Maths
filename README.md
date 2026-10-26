# Phronesis Maths

Offline-first Mathematics revision app for S1–S2 learners in under-resourced Ugandan secondary schools.
Built by Phronesis Innovationz Agency for the school pilot behind the Mastercard Foundation EdTech Fellowship application.

"Phronesis Maths" is a working name.

## What is in it

| Part | Who uses it | Address |
| --- | --- | --- |
| Learner app (installable, works offline) | Learners, on their own or a shared phone | `/` |
| Teacher dashboard | Teachers | `/teacher` |
| Admin | Phronesis (you) | `/admin` |

**Learner app**
- Join with a 6-character class code, pick your name, choose a 4-digit PIN. No email or phone number.
- Shared-phone mode: several learners on one phone; each is locked behind their own PIN.
- 10-question topic quizzes with instant feedback and a worked explanation for every question.
- Works fully offline after the first sign-in. Answers wait on the phone and send themselves when data returns.
- Read-aloud on every question and explanation, large text, high contrast.
- Starting test (baseline) on joining; end-of-term test (endline) when the teacher opens it. No feedback during tests.
- Progress: day streak, topics mastered, percent correct and last score per topic.

**Teacher dashboard**
- Create classes, add learners by first name, reset PINs.
- Topics ranked weakest first, assignments with due dates and completion counts.
- Starting vs end-of-term test averages; open/close the end-of-term test.
- Class report as PDF (for the head teacher) or CSV.

**Admin**
- Pilot numbers for the application: schools, enrolled, joined, weekly active, quizzes, answers, learning gain, activity per day, per school.
- Add schools (with a "signed letter on file" tick) and teachers (temporary password shown once).
- Question bank: see how often each question is answered and how many get it right, switch questions on/off, choose test questions, import from CSV.

**Question bank** — `data/questions.json`: 110 original questions with worked explanations across 11 topics
(7 S1, 4 S2), 2 per topic in the starting/end-of-term test. S1 classes see S1 topics; S2 classes see both.
Have a pilot teacher check the topic list and wording against what their class is covering.

## Run it on your computer

Needs Node.js 20 or newer.

```powershell
npm install
npm start
```

Open http://localhost:3000/admin (password `admin-dev`), add a school and a teacher, sign in at
http://localhost:3000/teacher with the temporary password, create a class, add names, then open
http://localhost:3000 on your phone or browser and join with the class code.

Locally it uses an embedded Postgres saved in `data/dev-db`, so you do not need to install a database.
Delete that folder to start fresh.

## Tests

```powershell
npm test
```

- `tests/verify-bank.js` — checks every question's structure and recalculates 91 of the answers independently; tests the answer checker (e.g. `23,000`, `23000 UGX` and `x = 8` are all accepted).
- `tests/api-test.js` — starts the server on a fresh database and walks through admin → teacher → learner → offline sync → reports (56 checks).

## Put it online (free): Neon + Render

1. **Database.** In [Neon](https://neon.tech), create a project and copy the connection string (`postgresql://…`).
2. **Code.** The code lives at `github.com/Phronesis-Innovations-Agency/Phronesis-Maths`.
3. **Web service.** In Render: New → Web Service → pick the repo.
   - Build command: `npm install`
   - Start command: `npm start`
   - Instance type: Free
4. **Environment variables** in Render:

   | Name | Value |
   | --- | --- |
   | `DATABASE_URL` | the Neon connection string |
   | `APP_SECRET` | a long random string (keep it secret; changing it signs everyone out) |
   | `ADMIN_PASSWORD` | your admin password |
   | `NODE_ENV` | `production` |
   | `APP_NAME` | optional, name printed on reports (default `Phronesis Maths`) |
   | `TIMEZONE` | optional, default `Africa/Kampala` |

The database tables and the question bank load automatically on start. Re-deploying updates question
wording by `ref` without touching learners' answers.

A `render.yaml` is included if you prefer Render Blueprints.

**Free-plan note.** Render's free web services sleep when nobody has used them for a while, so the first
visit can take about a minute. Learners are not affected once the app is on their phone, because it works
from the saved copy and syncs later. Teachers may notice the wait.

## Before the pilot

- [ ] Get a signed pilot letter from each school, including consent for learners' first names and answers to be stored. Tick "Signed letter on file" in admin.
- [ ] Ask one teacher per school to check the topics and a sample of questions.
- [ ] Test on the cheapest Android phone you can find, offline, including read-aloud (some phones have no offline voice).
- [ ] Learners join and take the starting test in the first lesson, while you are in the room.

## Changing things

- **Questions:** edit `data/questions.json` and re-deploy, or let teachers fill in the CSV template from admin → Question bank. Run `node tests/verify-bank.js` after editing the JSON.
- **Learner app files** (`public/index.html`, `public/js/check.js`, icons): change `VERSION` in `public/sw.js` (e.g. `pm-v2`) so phones pick up the new version.
- **Tests after changes:** do not change which questions are in the starting/end-of-term test once learners have taken it, or scores stop being comparable.

## Privacy

Only first names, class, PIN (hashed) and answers are stored. No photos, phone numbers, emails or locations for learners.
Teacher passwords and learner PINs are hashed with bcrypt. Uganda's Data Protection and Privacy Act, 2019 applies;
keep the school consent letters on file.

## Project layout

```
src/server.js          Express app and routes
src/db.js              Postgres (Neon) or embedded PGlite; loads schema + question bank
src/schema.sql         Tables
src/routes/            learner.js · teacher.js · admin.js
src/stats.js           Shared numbers for dashboard, reports, admin
src/reports.js         PDF and CSV class reports
public/index.html      Learner app (single file)
public/sw.js           Offline support (service worker)
public/js/check.js     Typed-answer marking (shared with tests)
public/teacher.html    Teacher dashboard
public/admin.html      Admin
data/questions.json    Question bank
```
