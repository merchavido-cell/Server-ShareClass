import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

const app = new Hono();

// הפעלת CORS לכל הבקשות
app.use('/*', cors());

// שמירת הנתונים בזיכרון
let classes = [];
const classFiles = {};

// GET /api/classes - שליפת רשימת הכיתות
app.get('/api/classes', (c) => {
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
      membersCount: 1
    };

    classes.push(newClass);
    return c.json({ success: true, class: newClass });
  } catch (error) {
    return c.json({ success: false, error: 'Invalid request' }, 400);
  }
};

app.post('/api/classes', handleCreateClass);
app.post('/api/classes/create', handleCreateClass);

// POST /api/classes/join - הצטרפות לכיתה לפי קוד
app.post('/api/classes/join', async (c) => {
  try {
    const body = await c.req.json();
    const { code } = body;

    const targetClass = classes.find((cls) => cls.code === code);

    if (!targetClass) {
      return c.json({ success: false, error: 'קוד כיתה שגוי או לא קיים' }, 400);
    }

    targetClass.membersCount += 1;
    return c.json({ success: true, class: targetClass });
  } catch (error) {
    return c.json({ success: false, error: 'Invalid request' }, 400);
  }
});

// POST /api/classes/:id/files - העלאת קובץ לכיתה
app.post('/api/classes/:id/files', async (c) => {
  try {
    const classId = c.req.param('id');
    const body = await c.req.parseBody();
    const file = body['file'];
    const uploader = body['uploader'] || 'Member';

    if (!file || typeof file === 'string') {
      return c.json({ success: false, error: 'No file uploaded' }, 400);
    }

    if (!classFiles[classId]) {
      classFiles[classId] = [];
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const newFile = {
      id: Math.random().toString(36).substring(2, 9),
      name: file.name,
      uploader: uploader,
      buffer: buffer
    };

    classFiles[classId].push(newFile);
    return c.json({ success: true, file: { id: newFile.id, name: newFile.name, uploader: newFile.uploader } });
  } catch (error) {
    console.error('File upload error:', error);
    return c.json({ success: false, error: 'Failed to upload file' }, 500);
  }
});

// GET /api/classes/:id/files - שליפת רשימת קבצים לכיתה
app.get('/api/classes/:id/files', (c) => {
  const classId = c.req.param('id');
  const files = (classFiles[classId] || []).map(f => ({
    id: f.id,
    name: f.name,
    uploader: f.uploader
  }));
  return c.json(files);
});

// GET /api/files/:id/download - הורדת קובץ
app.get('/api/files/:id/download', (c) => {
  const fileId = c.req.param('id');
  let foundFile = null;

  for (let cid in classFiles) {
    const file = classFiles[cid].find(f => f.id === fileId);
    if (file) {
      foundFile = file;
      break;
    }
  }

  if (!foundFile) {
    return c.text('File not found', 404);
  }

  return c.body(foundFile.buffer, 200, {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${foundFile.name}"`
  });
});

// הפעלת השרת
const port = process.env.PORT || 3000;
console.log(`Server is running on port ${port}`);

serve({
  fetch: app.fetch,
  port: Number(port)
});
