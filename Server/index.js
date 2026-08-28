export class Room {
  constructor(state, env) {
    this.state = state;
    this.storage = state.storage;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const method = request.method;

    // שליפת רשימת הכיתות או יצירת כיתה חדשה
    if (url.pathname.endsWith("/api/classes")) {
      if (method === "GET") {
        let classes = await this.storage.get("classes") || [];
        return new Response(JSON.stringify({ success: true, classes }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      if (method === "POST") {
        const body = await request.json();
        let classes = await this.storage.get("classes") || [];
        
        const newClass = {
          id: "class_" + Math.random().toString(36).substring(2, 9),
          name: body.name,
          code: Math.random().toString(36).substring(2, 8).toUpperCase(),
          members: 1
        };

        classes.push(newClass);
        await this.storage.put("classes", classes);

        return new Response(JSON.stringify({ success: true, class: newClass }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    if (url.pathname.endsWith("/api/classes/create")) {
      const body = await request.json();
      let classes = await this.storage.get("classes") || [];
      
      const newClass = {
        id: "class_" + Math.random().toString(36).substring(2, 9),
        name: body.name,
        code: Math.random().toString(36).substring(2, 8).toUpperCase(),
        members: 1
      };

      classes.push(newClass);
      await this.storage.put("classes", classes);

      return new Response(JSON.stringify({ success: true, class: newClass }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    if (url.pathname.endsWith("/api/classes/join")) {
      const body = await request.json();
      let classes = await this.storage.get("classes") || [];
      
      const targetClass = classes.find(c => c.code === body.code);
      if (targetClass) {
        targetClass.members = (targetClass.members || 1) + 1;
        await this.storage.put("classes", classes);
        return new Response(JSON.stringify({ success: true, class: targetClass }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      } else {
        return new Response(JSON.stringify({ success: false, message: "Invalid class code" }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    return new Response("Not Found", { status: 404 });
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "*"
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response("OK", { status: 200, headers: corsHeaders });
    }

    try {
      // נשתמש ב-Durable Object גלובלי או מנוהל לפי מזהה קבוע לאחסון הנתונים המשותפים
      const id = env.ROOM.idFromName("global_shareclass_room");
      const room = env.ROOM.get(id);
      
      const response = await room.fetch(request);
      
      const newHeaders = new Headers(response.headers);
      for (const [key, value] of Object.entries(corsHeaders)) {
        newHeaders.set(key, value);
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders
      });
    } catch (error) {
      return new Response(
        JSON.stringify({ success: false, error: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  }
};