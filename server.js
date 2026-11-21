// server.js — سيرفر بنك الأسئلة (Express + SQLite + Gemini)
// التشغيل: node server.js   ثم افتح http://localhost:3000/login.html

const express = require('express');
const multer = require('multer');
const path = require('path');
const { DatabaseSync } = require('node:sqlite'); // مدمجة في Node، مفيش حاجة تتسطب

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// ---------- قاعدة البيانات ----------
const db = new DatabaseSync(path.join(__dirname, 'question_bank.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS Students (
    id   INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS Subjects (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    name    TEXT NOT NULL,
    section TEXT NOT NULL,
    year    INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS Questions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    text       TEXT NOT NULL,
    options    TEXT NOT NULL,      -- JSON array
    answer     INTEGER NOT NULL,   -- رقم الاختيار الصحيح (يبدأ من 0)
    subject_id INTEGER NOT NULL REFERENCES Subjects(id)
  );
`);

// بيانات تجريبية (بتتضاف مرة واحدة بس لو الجداول فاضية)
function seed() {
  const hasStudents = db.prepare('SELECT COUNT(*) AS c FROM Students').get().c;
  if (hasStudents) return;

  db.prepare('INSERT INTO Students (id, name) VALUES (?, ?)').run(1001, 'Ali Ahmed');
  db.prepare('INSERT INTO Students (id, name) VALUES (?, ?)').run(1002, 'Mona Hassan');

  const addSubject = db.prepare('INSERT INTO Subjects (name, section, year) VALUES (?, ?, ?)');
  const s1 = Number(addSubject.run('برمجة الويب', 'هندسة البرمجيات', 2).lastInsertRowid);
  addSubject.run('قواعد البيانات', 'هندسة البرمجيات', 2);
  addSubject.run('هياكل البيانات', 'علوم الحاسب', 2);
  addSubject.run('مقدمة في البرمجة', 'هندسة البرمجيات', 1);

  const addQ = db.prepare('INSERT INTO Questions (text, options, answer, subject_id) VALUES (?, ?, ?, ?)');
  const sample = [
    ['إيه معنى HTML؟', ['HyperText Markup Language', 'High Tech Modern Language', 'Home Tool Markup Language', 'Hyper Transfer Mode Link'], 0],
    ['أي وسم يُستخدم لإنشاء رابط؟', ['<link>', '<a>', '<href>', '<url>'], 1],
    ['أي خاصية CSS تغيّر لون الخلفية؟', ['color', 'font-color', 'background-color', 'bgcolor-set'], 2],
    ['أي لغة بتشتغل داخل المتصفح؟', ['SQL', 'C++', 'JavaScript', 'Bash'], 2],
    ['إيه وظيفة fetch() في جافاسكريبت؟', ['رسم الصور', 'إرسال واستقبال طلبات HTTP', 'تنسيق الصفحة', 'حذف عناصر HTML'], 1],
    ['أي وسم يُستخدم لإنشاء أكبر عنوان؟', ['<h6>', '<head>', '<h1>', '<title>'], 2],
    ['أي أمر SQL بيجيب بيانات من جدول؟', ['INSERT', 'SELECT', 'UPDATE', 'DROP'], 1],
    ['ما هو Node.js؟', ['متصفح', 'بيئة تشغيل جافاسكريبت خارج المتصفح', 'قاعدة بيانات', 'محرر أكواد'], 1],
    ['أي خاصية CSS تجعل العناصر في صف مرن؟', ['display: flex', 'float: none', 'position: fixed', 'margin: auto'], 0],
    ['أي رمز يُستخدم للتعليق في جافاسكريبت؟', ['#', '//', '<!-- -->', '%'], 1],
    ['أي وسم يحتوي محتوى الصفحة الظاهر؟', ['<head>', '<meta>', '<body>', '<style>'], 2],
    ['إيه معنى CSS؟', ['Cascading Style Sheets', 'Computer Style Script', 'Creative Style System', 'Colorful Style Sheets'], 0]
  ];
  for (const [text, options, answer] of sample) {
    addQ.run(text, JSON.stringify(options), answer, s1);
  }
  console.log('تم إضافة بيانات تجريبية: طالبين (1001 / Ali Ahmed) وأربع مواد.');
}
seed();

// ---------- السيرفر ----------
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

// 1) تسجيل دخول الطالب
app.post('/api/login', (req, res) => {
  const id = Number(req.body.id);
  const name = String(req.body.name || '').trim();
  if (!Number.isInteger(id) || !name) {
    return res.status(400).json({ error: 'اكتب الرقم الجامعي والاسم.' });
  }
  const student = db.prepare('SELECT id, name FROM Students WHERE id = ?').get(id);
  if (!student || student.name.toLowerCase() !== name.toLowerCase()) {
    return res.status(401).json({ error: 'الرقم الجامعي أو الاسم غير صحيح.' });
  }
  res.json({ student });
});

// 2) المواد (حسب السنة والتخصص، أو كلها لو من غير باراميترات)
app.get('/api/subjects', (req, res) => {
  const { year, section } = req.query;
  let sql = 'SELECT id, name, section, year FROM Subjects';
  const where = [];
  const args = [];
  if (year) { where.push('year = ?'); args.push(Number(year)); }
  if (section) { where.push('section = ?'); args.push(String(section)); }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY name';
  res.json(db.prepare(sql).all(...args));
});

// 3) 10 أسئلة عشوائية للمادة
app.get('/api/questions', (req, res) => {
  const subjectId = Number(req.query.subject_id);
  if (!Number.isInteger(subjectId)) {
    return res.status(400).json({ error: 'رقم المادة غير صحيح.' });
  }
  const rows = db
    .prepare('SELECT id, text, options, answer FROM Questions WHERE subject_id = ? ORDER BY RANDOM() LIMIT 10')
    .all(subjectId);
  res.json(rows.map(r => ({ ...r, options: JSON.parse(r.options) })));
});

// 4) رفع صورة الأسئلة → Gemini → حفظ في جدول Questions
const PROMPT = `الصورة دي فيها أسئلة اختيار من متعدد من ورقة امتحان.
استخرج كل الأسئلة وارجعها كـ JSON فقط على شكل مصفوفة، وكل عنصر بالشكل ده:
{"text": "نص السؤال", "options": ["اختيار 1", "اختيار 2", "اختيار 3", "اختيار 4"], "answer": 0}
حيث answer هو رقم الإجابة الصحيحة في مصفوفة options ويبدأ من 0.
لو الإجابة الصحيحة مش موضحة في الصورة، اختار أنسب إجابة بناءً على فهمك للسؤال.
خلّي نص الأسئلة والاختيارات بنفس لغة الصورة. ماتكتبش أي شرح خارج الـ JSON.`;

async function extractQuestions(buffer, mimeType) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: PROMPT },
          { inline_data: { mime_type: mimeType, data: buffer.toString('base64') } }
        ]
      }],
      generationConfig: { responseMimeType: 'application/json' }
    })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || 'فشل الاتصال بـ Gemini.');
  }
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
  const parsed = JSON.parse(text.replace(/^```json\s*|```$/g, '').trim());
  if (!Array.isArray(parsed)) throw new Error('رد Gemini مش بالشكل المتوقع.');
  return parsed;
}

app.post('/api/upload', upload.single('image'), async (req, res) => {
  try {
    const subjectId = Number(req.body.subject_id);
    if (!Number.isInteger(subjectId) || !db.prepare('SELECT id FROM Subjects WHERE id = ?').get(subjectId)) {
      return res.status(400).json({ error: 'المادة غير موجودة.' });
    }
    if (!req.file) return res.status(400).json({ error: 'ارفع صورة الأسئلة.' });
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: 'مفتاح GEMINI_API_KEY مش متضبط على السيرفر.' });
    }

    const items = await extractQuestions(req.file.buffer, req.file.mimetype);
    const add = db.prepare('INSERT INTO Questions (text, options, answer, subject_id) VALUES (?, ?, ?, ?)');

    let count = 0;
    for (const q of items) {
      const valid =
        q && typeof q.text === 'string' && q.text.trim() &&
        Array.isArray(q.options) && q.options.length >= 2 &&
        Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length;
      if (!valid) continue;
      add.run(q.text.trim(), JSON.stringify(q.options.map(String)), q.answer, subjectId);
      count++;
    }
    if (!count) return res.status(422).json({ error: 'ماقدرتش أستخرج أسئلة واضحة من الصورة.' });
    res.json({ count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'حصل خطأ في السيرفر.' });
  }
});

app.listen(PORT, () => {
  console.log(`السيرفر شغال: http://localhost:${PORT}/login.html`);
});
