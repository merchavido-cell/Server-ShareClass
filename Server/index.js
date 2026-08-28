import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

const app = new Hono();

// הפעלת CORS לכל הבקשות
app.use('/*', cors());

// שמירת הנתונים בזיכרון (חלופי ל-Durable Objects עבור Render)
let classes = [];

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
      code: Math.floor(1000 + Math.random() * 9000).toString(), // קוד ספרתי אקראי
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

// התאמה ל-Render: שימוש בפורט הדינמי שהוגדר בסביבת העבודה או ברירת מחדל 3000
const port = process.env.PORT || 3000;
console.log(`Server is running on port ${port}`);

serve({
  fetch: app.fetch,
  port: Number(port)
});
