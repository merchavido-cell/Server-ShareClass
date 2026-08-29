import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

const app = new Hono();
app.use('/*', cors());

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO = "merchavido-cell/Server-ShareClass"; // שם המאגר שלך
const FILE_PATH = "Server/all_class.json"; // הנתיב לקובץ במאגר

const classFiles = {};

// פונקציה לקריאת הנתונים מ-GitHub
async function readClassesFromGitHub() {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`, {
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'ShareClass-Server'
      }
    });
    if (!res.ok) return [];
    const data = await res.json();
    const content = Buffer.from(data.content, 'base64').toString('utf-8');
    return { classes: JSON.parse(content || '[]'), sha: data.sha };
  } catch (error) {
    return { classes: [], sha: null };
  }
}

// פונקציה לכתיבת הנתונים בחזרה ל-GitHub (יוצרת Commit אוטומטי)
async function writeClassesToGitHub(classes, sha) {
  const contentEncoded = Buffer.from(JSON.stringify(classes, null, 2)).toString('base64');
  await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`, {
    method: 'PUT',
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'ShareClass-Server',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: 'Update all_class.json automatically from server',
      content: contentEncoded,
      sha: sha
    })
  });
}

// GET /api/classes
app.get('/api/classes', async (c) => {
  const { classes } = await readClassesFromGitHub();
  return c.json(classes);
});

// POST /api/classes
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

    const { classes, sha } = await readClassesFromGitHub();
    classes.push(newClass);
    await writeClassesToGitHub(classes, sha);

    return c.json({ success: true, class: newClass });
  } catch (error) {
    return c.json({ success: false, error: 'Invalid request' }, 400);
  }
};

app.post('/api/classes', handleCreateClass);
app.post('/api/classes/create', handleCreateClass);

// POST /api/classes/join
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
    return c.json({ success: false, error: 'Invalid request' }, 400);
  }
});

// שאר נתיבי העלאת הקבצים נשארים לפי הצורך...

const port = process.env.PORT || 3000;
serve({ fetch: app.fetch, port: Number(port) });
