// שמירת הקבצים בזיכרון עבור שרת Hono
const classFiles = {};

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

    // המרת הקובץ ל-Buffer לצורך שמירה בזיכרון
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
