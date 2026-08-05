// One KV key per spoon ("spoon:<id>"), so concurrent adds from different devices
// never clobber each other — each is an independent write, no read-modify-write of
// a shared document. Reads list + get all keys. Writes require the WRITE_TOKEN
// secret (a doorstop against random writes, not a secrecy measure).
//
//   GET    /spoons        -> array of spoons        (open)
//   POST   /spoons        -> add one                 (token)
//   PUT    /spoons/:id    -> correct one             (token)
//   DELETE /spoons/:id    -> expunge one             (token)

const PREFIX = "spoon:";

function cors(env, origin) {
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const allow = allowed.includes(origin) ? origin : allowed[0] || "*";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Vary": "Origin"
  };
}
const json = (data, status, headers) =>
  new Response(JSON.stringify(data), { status: status || 200, headers: { "Content-Type": "application/json", ...(headers || {}) } });

function authed(request, env) {
  const h = request.headers.get("Authorization") || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  return Boolean(env.WRITE_TOKEN) && token === env.WRITE_TOKEN;
}
const newId = () => Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);

async function listAll(env) {
  const out = [];
  let cursor;
  do {
    const res = await env.SPOONDATABASE.list({ prefix: PREFIX, cursor });
    const vals = await Promise.all(res.keys.map((k) => env.SPOONDATABASE.get(k.name)));
    for (const v of vals) { if (v) { try { out.push(JSON.parse(v)); } catch { /* skip */ } } }
    cursor = res.list_complete ? null : res.cursor;
  } while (cursor);
  out.sort((a, b) => String(a.addedAt || "").localeCompare(String(b.addedAt || "")));
  return out;
}

export default {
  async fetch(request, env) {
   try {
    const url = new URL(request.url);
    const headers = cors(env, request.headers.get("Origin") || "");
    if (request.method === "OPTIONS") return new Response(null, { headers });

    const parts = url.pathname.split("/").filter(Boolean); // ["spoons"] | ["spoons", id]
    if (parts[0] !== "spoons") return json({ error: "not found" }, 404, headers);
    const id = parts[1];

    if (request.method === "GET" && !id) return json(await listAll(env), 200, headers);

    if (["POST", "PUT", "DELETE"].includes(request.method) && !authed(request, env)) {
      return json({ error: "unauthorized" }, 401, headers);
    }

    if (request.method === "POST" && !id) {
      const b = await request.json().catch(() => ({}));
      const spoon = {
        id: newId(),
        name: b.name || "",
        country: b.country || "",
        countryName: b.countryName || "",
        city: b.city || "",
        lat: typeof b.lat === "number" ? b.lat : null,
        lng: typeof b.lng === "number" ? b.lng : null,
        note: b.note || "",
        addedAt: new Date().toISOString()
      };
      await env.SPOONDATABASE.put(PREFIX + spoon.id, JSON.stringify(spoon));
      return json(spoon, 201, headers);
    }

    if (request.method === "PUT" && id) {
      const raw = await env.SPOONDATABASE.get(PREFIX + id);
      if (!raw) return json({ error: "not found" }, 404, headers);
      const b = await request.json().catch(() => ({}));
      const updated = { ...JSON.parse(raw), ...b, id, editedAt: new Date().toISOString() };
      await env.SPOONDATABASE.put(PREFIX + id, JSON.stringify(updated));
      return json(updated, 200, headers);
    }

    if (request.method === "DELETE" && id) {
      await env.SPOONDATABASE.delete(PREFIX + id);
      return json({ ok: true }, 200, headers);
    }

    return json({ error: "method not allowed" }, 405, headers);
   } catch (e) {
    return new Response(JSON.stringify({ error: String((e && e.message) || e) }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
   }
  }
};
