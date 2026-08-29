import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

const app = new Hono();
app.use('/*', cors());

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO = "merchavido-cell/Server-ShareClass";
const FILE_PATH = "Server/all_class.json";
const FILES_DIR = "Server/files"; // תיקייה ב-GitHub בה יישמר תוכן הקבצים שמועלים

// ---------- זיהוי MIME type לפי סיומת, כדי לאפשר פתיחה בדפדפן (לא רק הורדה) ----------

const MIME_TYPES = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
  html: 'text/html',
  htm: 'text/html',
  json: 'application/json',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip',
};

function getMimeType(fileName) {
  const ext = (fileName.split('.').pop() || '').toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

// יצירת קוד כיתה: 4 ספרות + 4 אותיות אנגליות גדולות, מעורבבים (סה"כ 8 תווים)
function generateClassCode() {
  const digits = '0123456789';
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  const chars = [];
  for (let i = 0; i < 4; i++) chars.push(digits[Math.floor(Math.random() * digits.length)]);
  for (let i = 0; i < 4; i++) chars.push(letters[Math.floor(Math.random() * letters.length)]);

  // ערבוב (Fisher-Yates) כדי שהספרות והאותיות לא יהיו בבלוקים נפרדים
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join('');
}

// כותרות HTTP חייבות להיות ASCII — שם קובץ עם עברית/תווים לא-ASCII חייב קידוד לפי RFC 5987.
// נותנים גם fallback ASCII (filename=) וגם את השם המקורי המקודד (filename*=UTF-8''...)
function buildContentDisposition(disposition, fileName) {
  const asciiFallback = fileName.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'");
  const encoded = encodeURIComponent(fileName);
  return `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

// קבצים מסוגים אלו הדפדפן יודע להציג inline (לא רק להוריד)
const INLINE_VIEWABLE = new Set([
  'application/pdf', 'text/plain', 'text/csv', 'text/html', 'application/json',
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp',
  'video/mp4', 'video/webm', 'video/quicktime', 'audio/mpeg', 'audio/wav'
]);

// ---------- עזרי GitHub: קריאה/כתיבה גנריים לכל path ----------

async function githubGetFile(path) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'ShareClass-Server'
    }
  });
  if (!res.ok) {
    if (res.status !== 404) {
      console.error(`GitHub read failed (${path}):`, res.status, await res.text());
    }
    return null; // לא קיים / נכשל
  }
  return res.json();
}

async function githubPutFile(path, base64Content, sha, message) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'ShareClass-Server',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: message || `Update ${path}`,
      content: base64Content,
      ...(sha ? { sha } : {})
    })
  });

  if (!res.ok) {
    const errBody = await res.text();
    console.error(`GitHub write failed (${path}):`, res.status, errBody);
    throw new Error(`GitHub write failed (${res.status}): ${errBody}`);
  }
  return res.json();
}

// ---------- ניהול all_class.json ----------

async function readClassesFromGitHub() {
  const data = await githubGetFile(FILE_PATH);
  if (!data) return { classes: [], sha: null };
  const content = Buffer.from(data.content, 'base64').toString('utf-8');
  try {
    return { classes: JSON.parse(content || '[]'), sha: data.sha };
  } catch (e) {
    console.error('Failed to parse all_class.json:', e);
    return { classes: [], sha: data.sha };
  }
}

async function writeClassesToGitHub(classes, sha) {
  const contentEncoded = Buffer.from(JSON.stringify(classes, null, 2)).toString('base64');
  return githubPutFile(FILE_PATH, contentEncoded, sha, 'Update all_class.json automatically from server');
}

// GET /api/debug/github - בדיקת חיבור וטוקן ל-GitHub (זמני, אפשר להסיר בהמשך)
app.get('/api/debug/github', async (c) => {
  const hasToken = !!GITHUB_TOKEN;
  const tokenLength = GITHUB_TOKEN ? GITHUB_TOKEN.length : 0;

  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`, {
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'ShareClass-Server'
      }
    });

    return c.json({
      hasToken,
      tokenLength,
      githubStatus: res.status,
      githubStatusText: res.statusText
    });
  } catch (error) {
    return c.json({ hasToken, tokenLength, error: error.message }, 500);
  }
});

// GET /api/classes - שליפת רשימת הכיתות
app.get('/api/classes', async (c) => {
  const { classes } = await readClassesFromGitHub();
  return c.json(classes);
});

// POST /api/classes או /api/classes/create - יצירת כיתה חדשה
const handleCreateClass = async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const name = body.name || 'כיתה ללא שם';
    const userId = body.userId || null;

    const { classes, sha } = await readClassesFromGitHub();

    // ודא שהקוד ייחודי מול הכיתות הקיימות (סיכוי התנגשות זניח, אבל בכל זאת)
    let code;
    do {
      code = generateClassCode();
    } while (classes.some(cls => cls.code === code));

    const newClass = {
      id: Math.random().toString(36).substring(2, 9),
      name: name,
      code: code,
      membersCount: 1,
      members: userId ? [userId] : [], // רשימת מזהי משתמשים שכבר חברים בכיתה
      files: [] // רשימת קבצים שייכת מעתה לאובייקט הכיתה עצמו
    };

    classes.push(newClass);
    await writeClassesToGitHub(classes, sha);

    return c.json({ success: true, class: newClass });
  } catch (error) {
    console.error('Create class error:', error);
    return c.json({ success: false, error: 'Failed to save class' }, 500);
  }
};

app.post('/api/classes', handleCreateClass);
app.post('/api/classes/create', handleCreateClass);

// POST /api/classes/join - הצטרפות לכיתה לפי קוד
app.post('/api/classes/join', async (c) => {
  try {
    const body = await c.req.json();
    const { code, userId } = body;

    const { classes, sha } = await readClassesFromGitHub();
    const targetClass = classes.find((cls) => cls.code === code);

    if (!targetClass) {
      return c.json({ success: false, error: 'קוד כיתה שגוי או לא קיים' }, 400);
    }

    if (!targetClass.members) targetClass.members = [];

    // אם יש לנו מזהה משתמש (למשל אימייל) והוא כבר ברשימת החברים - לא מוסיפים שוב ולא מגדילים ספירה
    const alreadyMember = userId && targetClass.members.includes(userId);

    if (!alreadyMember) {
      if (userId) targetClass.members.push(userId);
      targetClass.membersCount = (targetClass.membersCount || 0) + 1;
      await writeClassesToGitHub(classes, sha);
    }

    return c.json({ success: true, class: targetClass });
  } catch (error) {
    console.error('Join class error:', error);
    return c.json({ success: false, error: 'Failed to join class' }, 500);
  }
});

// POST /api/classes/:id/files - העלאת קובץ לכיתה (נשמר בפועל ב-GitHub, מקושר לנתוני הכיתה)
app.post('/api/classes/:id/files', async (c) => {
  try {
    const classId = c.req.param('id');
    const body = await c.req.parseBody();
    const file = body['file'];
    const uploader = body['uploader'] || 'Member';

    if (!file || typeof file === 'string') {
      return c.json({ success: false, error: 'No file uploaded' }, 400);
    }

    const { classes, sha } = await readClassesFromGitHub();
    const targetClass = classes.find((cls) => cls.id === classId);

    if (!targetClass) {
      return c.json({ success: false, error: 'Class not found' }, 404);
    }

    const fileId = Math.random().toString(36).substring(2, 9);
    const arrayBuffer = await file.arrayBuffer();
    const base64Content = Buffer.from(arrayBuffer).toString('base64');
    const storagePath = `${FILES_DIR}/${classId}/${fileId}_${file.name}`;

    // שמירת תוכן הקובץ עצמו כ-blob ב-GitHub
    await githubPutFile(storagePath, base64Content, null, `Upload file ${file.name} to class ${classId}`);

    // עדכון מטא-דאטה של הקובץ בתוך אובייקט הכיתה, ושמירה חזרה ל-all_class.json
    if (!targetClass.files) targetClass.files = [];
    const newFileMeta = { id: fileId, name: file.name, uploader, path: storagePath };
    targetClass.files.push(newFileMeta);
    await writeClassesToGitHub(classes, sha);

    return c.json({ success: true, file: { id: newFileMeta.id, name: newFileMeta.name, uploader: newFileMeta.uploader } });
  } catch (error) {
    console.error('File upload error:', error);
    return c.json({ success: false, error: 'Failed to upload file' }, 500);
  }
});

// GET /api/classes/:id/files - שליפת רשימת קבצים לכיתה (מתוך נתוני הכיתה עצמם)
app.get('/api/classes/:id/files', async (c) => {
  const classId = c.req.param('id');
  const { classes } = await readClassesFromGitHub();
  const targetClass = classes.find((cls) => cls.id === classId);

  if (!targetClass) {
    return c.json([], 404);
  }

  const files = (targetClass.files || []).map(f => ({
    id: f.id,
    name: f.name,
    uploader: f.uploader
  }));
  return c.json(files);
});

// GET /api/files/:id/download - הבאת קובץ. ?view=1 → פתיחה inline בדפדפן (אם הסוג נתמך); בלי הפרמטר → הורדה תמיד
app.get('/api/files/:id/download', async (c) => {
  try {
    const fileId = c.req.param('id');
    const wantsView = c.req.query('view') === '1';
    const { classes } = await readClassesFromGitHub();

    let foundFile = null;
    for (const cls of classes) {
      const match = (cls.files || []).find(f => f.id === fileId);
      if (match) {
        foundFile = match;
        break;
      }
    }

    if (!foundFile) {
      return c.text('File not found', 404);
    }

    const data = await githubGetFile(foundFile.path);
    if (!data) {
      return c.text('File content not found', 404);
    }

    const buffer = Buffer.from(data.content, 'base64');
    const mimeType = getMimeType(foundFile.name);

    // פתיחה inline רק אם ביקשו זאת וגם הדפדפן יודע להציג את הסוג הזה; אחרת תמיד הורדה
    const useInline = wantsView && INLINE_VIEWABLE.has(mimeType);

    return c.body(buffer, 200, {
      'Content-Type': mimeType,
      'Content-Disposition': buildContentDisposition(useInline ? 'inline' : 'attachment', foundFile.name)
    });
  } catch (error) {
    console.error('File download error:', error);
    return c.text('Failed to download file', 500);
  }
});

// הפעלת השרת
const port = process.env.PORT || 3000;
console.log(`Server is running on port ${port}`);

serve({
  fetch: app.fetch,
  port: Number(port)
});
