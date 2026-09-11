import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

const app = new Hono();
app.use('/*', cors());

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO = "merchavido-cell/Server-ShareClass";
const FILE_PATH = "Server/all_class.json";
const FILES_DIR = "Server/files"; // תיקייה ב-GitHub בה יישמר תוכן הקבצים שמועלים

// ---------- הגבלת גודל קובץ ----------
// הקבצים נשמרים כ-base64 דרך GitHub Contents API. ל-API הזה יש תקרה קשיחה (100MB),
// וה-base64 מגדיל את הקובץ בערך פי 1.33 בזיכרון של השרת בזמן ההעלאה - על שרת קטן (כמו Render free/starter)
// קובץ גדול מדי יכול לגרום ל-crash מחוסר זיכרון או ל-timeout. 20MB הוא גבול בטוח שמכסה כמעט כל
// מסמך/תמונה/מצגת רגילים בלי לסכן את השרת.
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20MB
const MAX_FILE_SIZE_LABEL = '20MB';

// בדיקה מוקדמת לפי Content-Length, לפני שקוראים בכלל את גוף הבקשה לזיכרון (חוסכת עומס במקרה של קובץ ענק)
function requestTooLarge(c) {
  const contentLength = Number(c.req.header('content-length') || 0);
  // מוסיפים מרווח קטן לשדות הטופס הנוספים (userId, text וכו') כדי לא לדחות קבצים לגיטימיים בגבול העליון
  return contentLength > MAX_FILE_SIZE_BYTES + (256 * 1024);
}

function fileSizeExceeded(file) {
  return !!(file && typeof file !== 'string' && typeof file.size === 'number' && file.size > MAX_FILE_SIZE_BYTES);
}

function oversizedFileResponse(c) {
  return c.json({ success: false, error: `הקובץ גדול מדי. הגודל המרבי המותר הוא ${MAX_FILE_SIZE_LABEL}.` }, 413);
}

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

// מזהה את "מקים הכיתה" - במחלקות ישנות זה פשוט החבר הראשון ברשימה (כפי שהיה עד היום),
// ובמחלקות חדשות זה שדה ownerId מפורש שנשמר בזמן היצירה.
function getOwnerId(cls) {
  if (cls.ownerId) return cls.ownerId;
  if (Array.isArray(cls.members) && cls.members.length > 0) {
    const first = cls.members[0];
    return typeof first === 'string' ? first : ((first && (first.userId || first.id)) || null);
  }
  return null;
}

// שמירת קובץ שהועלה (מפוסט, ממטלה, או מהגשה) כ-blob ב-GitHub, מחזיר מטא-דאטה של הקובץ
async function storeClassFile(classId, file) {
  const fileId = Math.random().toString(36).substring(2, 9);
  const arrayBuffer = await file.arrayBuffer();
  const base64Content = Buffer.from(arrayBuffer).toString('base64');
  const storagePath = `${FILES_DIR}/${classId}/${fileId}_${file.name}`;
  await githubPutFile(storagePath, base64Content, null, `Upload file ${file.name} to class ${classId}`);
  return { id: fileId, name: file.name, path: storagePath };
}

// אוסף את כל הקבצים השייכים לכיתה ממקורות שונים (files ישנים, פוסטים, מטלות והגשות)
// לצורך חיפוש קובץ בודד לפי id בהורדה
function collectAllFiles(cls) {
  const all = [...(cls.files || [])];
  (cls.posts || []).forEach(p => { if (p.file) all.push(p.file); });
  (cls.assignments || []).forEach(a => {
    if (a.file) all.push(a.file);
    (a.submissions || []).forEach(s => { if (s.file) all.push(s.file); });
  });
  return all;
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

// GET /api/classes/:id - שליפת כיתה בודדת לפי id
app.get('/api/classes/:id', async (c) => {
  const classId = c.req.param('id');
  const { classes } = await readClassesFromGitHub();
  const targetClass = classes.find((cls) => cls.id === classId);
  if (!targetClass) return c.json({ error: 'Class not found' }, 404);
  return c.json(targetClass);
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
      ownerId: userId || null, // מקים הכיתה - הראשון שנכנס אליה; רק הוא יכול לשלוח מטלות
      files: [], // רשימת קבצים שייכת מעתה לאובייקט הכיתה עצמו (נשמר לצורך תאימות לאחור)
      posts: [], // פיד כללי של הכיתה - טקסטים וקבצים יחד
      assignments: [] // מטלות שהמורה/המקים שולח, כולל ההגשות של החברים
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
    if (requestTooLarge(c)) return oversizedFileResponse(c);

    const classId = c.req.param('id');
    const body = await c.req.parseBody();
    const file = body['file'];
    const uploader = body['uploader'] || 'Member';

    if (!file || typeof file === 'string') {
      return c.json({ success: false, error: 'No file uploaded' }, 400);
    }
    if (fileSizeExceeded(file)) return oversizedFileResponse(c);

    const { classes, sha } = await readClassesFromGitHub();
    const targetClass = classes.find((cls) => cls.id === classId);

    if (!targetClass) {
      return c.json({ success: false, error: 'Class not found' }, 404);
    }

    // שמירת תוכן הקובץ עצמו כ-blob ב-GitHub
    const stored = await storeClassFile(classId, file);

    // עדכון מטא-דאטה של הקובץ בתוך אובייקט הכיתה, ושמירה חזרה ל-all_class.json
    if (!targetClass.files) targetClass.files = [];
    const newFileMeta = { ...stored, uploader };
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

// ---------- פיד הכיתה: הודעות טקסט וקבצים יחד ----------

// POST /api/classes/:id/posts - יצירת פוסט חדש בכיתה (טקסט ו/או קובץ). כל חבר כיתה יכול לפרסם.
app.post('/api/classes/:id/posts', async (c) => {
  try {
    if (requestTooLarge(c)) return oversizedFileResponse(c);

    const classId = c.req.param('id');
    const body = await c.req.parseBody();
    const userId = body['userId'] || null;
    const authorName = body['name'] || 'Member';
    const text = (body['text'] || '').toString().trim();
    const file = body['file'];
    const hasFile = file && typeof file !== 'string';

    if (!text && !hasFile) {
      return c.json({ success: false, error: 'Post must include text or a file' }, 400);
    }
    if (hasFile && fileSizeExceeded(file)) return oversizedFileResponse(c);

    const { classes, sha } = await readClassesFromGitHub();
    const targetClass = classes.find((cls) => cls.id === classId);
    if (!targetClass) {
      return c.json({ success: false, error: 'Class not found' }, 404);
    }

    let fileMeta = null;
    if (hasFile) {
      fileMeta = await storeClassFile(classId, file);
    }

    if (!targetClass.posts) targetClass.posts = [];
    const newPost = {
      id: Math.random().toString(36).substring(2, 9),
      type: hasFile ? 'file' : 'text',
      authorId: userId,
      authorName,
      text,
      file: fileMeta,
      createdAt: new Date().toISOString()
    };

    targetClass.posts.push(newPost);
    await writeClassesToGitHub(classes, sha);

    return c.json({ success: true, post: newPost, class: targetClass });
  } catch (error) {
    console.error('Create post error:', error);
    return c.json({ success: false, error: 'Failed to create post' }, 500);
  }
});

// GET /api/classes/:id/posts - שליפת כל הפוסטים של הכיתה (טקסטים וקבצים), בסדר כרונולוגי
app.get('/api/classes/:id/posts', async (c) => {
  const classId = c.req.param('id');
  const { classes } = await readClassesFromGitHub();
  const targetClass = classes.find((cls) => cls.id === classId);
  if (!targetClass) return c.json([], 404);
  return c.json(targetClass.posts || []);
});

// ---------- מטלות: המקים שולח מטלה, וכל חבר יכול להגיש לו ----------

// POST /api/classes/:id/assignments - יצירת מטלה חדשה (רק מקים הכיתה רשאי)
app.post('/api/classes/:id/assignments', async (c) => {
  try {
    if (requestTooLarge(c)) return oversizedFileResponse(c);

    const classId = c.req.param('id');
    const body = await c.req.parseBody();
    const userId = body['userId'] || null;
    const authorName = body['name'] || 'Creator';
    const title = (body['title'] || '').toString().trim();
    const description = (body['description'] || '').toString().trim();
    const file = body['file'];
    const hasFile = file && typeof file !== 'string';

    if (!title) {
      return c.json({ success: false, error: 'Assignment title is required' }, 400);
    }
    if (hasFile && fileSizeExceeded(file)) return oversizedFileResponse(c);

    const { classes, sha } = await readClassesFromGitHub();
    const targetClass = classes.find((cls) => cls.id === classId);
    if (!targetClass) {
      return c.json({ success: false, error: 'Class not found' }, 404);
    }

    const ownerId = getOwnerId(targetClass);
    if (!userId || userId !== ownerId) {
      return c.json({ success: false, error: 'רק מקים הכיתה יכול לשלוח מטלות' }, 403);
    }

    let fileMeta = null;
    if (hasFile) {
      fileMeta = await storeClassFile(classId, file);
    }

    if (!targetClass.assignments) targetClass.assignments = [];
    const newAssignment = {
      id: Math.random().toString(36).substring(2, 9),
      title,
      description,
      authorId: userId,
      authorName,
      file: fileMeta,
      createdAt: new Date().toISOString(),
      submissions: []
    };

    targetClass.assignments.push(newAssignment);
    await writeClassesToGitHub(classes, sha);

    return c.json({ success: true, assignment: newAssignment, class: targetClass });
  } catch (error) {
    console.error('Create assignment error:', error);
    return c.json({ success: false, error: 'Failed to create assignment' }, 500);
  }
});

// GET /api/classes/:id/assignments?userId=... - שליפת מטלות הכיתה.
// מקים הכיתה רואה את כל ההגשות של כולם; חבר רגיל רואה רק את ההגשות שלו עצמו.
app.get('/api/classes/:id/assignments', async (c) => {
  const classId = c.req.param('id');
  const requesterId = c.req.query('userId') || null;
  const { classes } = await readClassesFromGitHub();
  const targetClass = classes.find((cls) => cls.id === classId);
  if (!targetClass) return c.json([], 404);

  const ownerId = getOwnerId(targetClass);
  const isOwner = !!requesterId && requesterId === ownerId;

  const assignments = (targetClass.assignments || []).map(a => ({
    ...a,
    submissions: isOwner
      ? (a.submissions || [])
      : (a.submissions || []).filter(s => s.studentId === requesterId)
  }));

  return c.json(assignments);
});

// POST /api/classes/:id/assignments/:assignmentId/submissions - הגשת מטלה ע"י חבר כיתה למקים הכיתה
app.post('/api/classes/:id/assignments/:assignmentId/submissions', async (c) => {
  try {
    if (requestTooLarge(c)) return oversizedFileResponse(c);

    const classId = c.req.param('id');
    const assignmentId = c.req.param('assignmentId');
    const body = await c.req.parseBody();
    const userId = body['userId'] || null;
    const studentName = body['name'] || 'Student';
    const text = (body['text'] || '').toString().trim();
    const file = body['file'];
    const hasFile = file && typeof file !== 'string';

    if (!text && !hasFile) {
      return c.json({ success: false, error: 'Submission must include text or a file' }, 400);
    }
    if (hasFile && fileSizeExceeded(file)) return oversizedFileResponse(c);

    const { classes, sha } = await readClassesFromGitHub();
    const targetClass = classes.find((cls) => cls.id === classId);
    if (!targetClass) {
      return c.json({ success: false, error: 'Class not found' }, 404);
    }

    const assignment = (targetClass.assignments || []).find(a => a.id === assignmentId);
    if (!assignment) {
      return c.json({ success: false, error: 'Assignment not found' }, 404);
    }

    let fileMeta = null;
    if (hasFile) {
      fileMeta = await storeClassFile(classId, file);
    }

    if (!assignment.submissions) assignment.submissions = [];
    const newSubmission = {
      id: Math.random().toString(36).substring(2, 9),
      studentId: userId,
      studentName,
      text,
      file: fileMeta,
      submittedAt: new Date().toISOString()
    };

    assignment.submissions.push(newSubmission);
    await writeClassesToGitHub(classes, sha);

    return c.json({
      success: true,
      submission: newSubmission,
      ownerId: getOwnerId(targetClass),
      class: targetClass
    });
  } catch (error) {
    console.error('Submit assignment error:', error);
    return c.json({ success: false, error: 'Failed to submit assignment' }, 500);
  }
});

// GET /api/files/:id/download - הבאת קובץ. ?view=1 → פתיחה inline בדפדפן (אם הסוג נתמך); בלי הפרמטר → הורדה תמיד
app.get('/api/files/:id/download', async (c) => {
  try {
    const fileId = c.req.param('id');
    const wantsView = c.req.query('view') === '1';
    const { classes } = await readClassesFromGitHub();

    let foundFile = null;
    for (const cls of classes) {
      const match = collectAllFiles(cls).find(f => f.id === fileId);
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
