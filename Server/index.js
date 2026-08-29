import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

const app = new Hono();
app.use('/*', cors());

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO = "merchavido-cell/Server-ShareClass";
const FILE_PATH = "Server/all_class.json";
const FILES_DIR = "Server/files"; // תיקייה ב-GitHub בה יישמר תוכן הקבצים שמועלים

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

    const newClass = {
      id: Math.random().toString(36).substring(2, 9),
      name: name,
      code: Math.floor(1000 + Math.random() * 9000).toString(),
      membersCount: 1,
      files: [] // רשימת קבצים שייכת מעתה לאובייקט הכיתה עצמו
    };

    const { classes, sha } = await readClassesFromGitHub();
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
    const { code } = body;

    const { classes, sha } = await readClassesFromGitHub();
    const targetClass = classes.find((cls) => cls.code === code);

    if (!targetClass) {
      return c.json({ success: false, error: 'קוד כיתה שגוי או לא קיים' }, 400);
    }

    targetClass.membersCount += 1;
    await writeClassesToGitHub(classes, sha);

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

// GET /api/files/:id/download - הורדת קובץ (מאתר את הכיתה שמחזיקה את הקובץ, ואז מביא אותו מ-GitHub)
app.get('/api/files/:id/download', async (c) => {
  try {
    const fileId = c.req.param('id');
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

    return c.body(buffer, 200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${foundFile.name}"`
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
