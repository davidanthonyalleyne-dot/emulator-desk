// Ke car pictures proxy: a Cloudflare Worker that keeps the CarImages key off the public site.
// The Ke app and Emulator Desk ask this Worker for pictures and 3D models by make, model and year.
// The Worker adds the key (a Worker secret, CI_KEY), fetches from carimagesapi.com, and keeps each
// result in Cloudflare's cache so a picture is only fetched from CarImages once.
//
// Only pages on ALLOWED_ORIGIN may use it. Secrets: CI_KEY (wrangler secret put CI_KEY).

const ALLOWED_ORIGIN = "https://davidanthonyalleyne-dot.github.io";
const CI = "https://carimagesapi.com";
const VIEWS = new Set(["", "front", "side", "rear34", "rear", "front34-r", "rear34-r", "side-r"]);
const COLORS = new Set(["", "silver", "black", "grey", "blue", "red", "white"]);
const WIDTHS = [240, 360, 480, 800, 900, 1200];
const PER_MINUTE = 60;              // per visitor, before the cache; CarImages' own free limit is 60 a minute
const seen = new Map();             // ip -> [windowStart, count], per Worker instance

function cors(h = new Headers()) {
  h.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  h.set("Vary", "Origin");
  return h;
}
function fail(status, msg) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: cors(new Headers({ "Content-Type": "application/json" })) });
}
function fromOurSite(req) {
  const o = req.headers.get("Origin"), r = req.headers.get("Referer") || "";
  // the native Ke iPhone app has no web origin, so it names itself
  if (req.headers.get("X-Ke-App") === "ca.davidalleyne.ke") return true;
  return o === ALLOWED_ORIGIN || r === ALLOWED_ORIGIN || r.startsWith(ALLOWED_ORIGIN + "/");
}
function tooMany(req) {
  const ip = req.headers.get("CF-Connecting-IP") || "?", now = Date.now();
  const w = seen.get(ip);
  if (!w || now - w[0] > 60000) { seen.set(ip, [now, 1]); if (seen.size > 5000) seen.clear(); return false; }
  return ++w[1] > PER_MINUTE;
}
const clean = s => String(s || "").trim().slice(0, 40);

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { headers: cors(new Headers({ "Access-Control-Allow-Methods": "GET", "Access-Control-Max-Age": "86400" })) });
    if (req.method !== "GET") return fail(405, "GET only");
    if (url.pathname === "/") return new Response("Ke car pictures proxy", { headers: cors() });
    // Setup check without showing the key: is it there, does it look like a CarImages key, and does CarImages take it?
    if (url.pathname === "/health") {
      const k = (env.CI_KEY || "").trim(), shape = !k ? "missing" : /^ci_[0-9a-f]{20,}$/.test(k) ? "looks like a key" : k.startsWith("ci_") ? "starts with ci_ but has odd characters" : "not a ci_ key (secret pasted instead?)";
      let status = null; if (k) { const r = await fetch(`${CI}/image?make=Porsche&model=911&width=240&format=webp&key=${encodeURIComponent(k)}`, { headers: { Referer: ALLOWED_ORIGIN + "/" }, redirect: "manual" }); status = r.status; }
      return new Response(JSON.stringify({ key: shape, length: k.length, carimages: status }), { headers: cors(new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store" })) });
    }
    if (!fromOurSite(req)) return fail(403, "Only the Ke app and Emulator Desk can use this");
    if (!env.CI_KEY) return fail(503, "CarImages key isn't set on the Worker yet");

    const make = clean(url.searchParams.get("make")), model = clean(url.searchParams.get("model"));
    const year = (url.searchParams.get("year") || "").replace(/\D/g, "").slice(0, 4);
    if (!make || !model) return fail(400, "make and model are needed");

    // One cache entry per request shape, without the key in it
    const key = new URL(url.origin + url.pathname);
    let upstream;
    if (url.pathname === "/image") {
      const view = url.searchParams.get("view") || "", color = url.searchParams.get("color") || "";
      if (!VIEWS.has(view) || !COLORS.has(color)) return fail(400, "unknown view or paint");
      const want = +url.searchParams.get("width") || 800, width = WIDTHS.find(w => w >= want) || 1200;
      const q = new URLSearchParams({ make, model, width: String(width), format: "webp" });
      if (year) q.set("year", year); if (view) q.set("view", view); if (color) q.set("color", color);
      key.search = q.toString();
      q.set("key", env.CI_KEY.trim());
      upstream = () => fetch(`${CI}/image?${q}`, { headers: { Referer: ALLOWED_ORIGIN + "/" } });
    } else if (url.pathname === "/model") {
      const q = new URLSearchParams({ make, model }); if (year) q.set("year", year);
      key.search = q.toString();
      upstream = async () => {
        const s = await fetch(`${CI}/api/v1/signed-model-urls?api_key=${encodeURIComponent(env.CI_KEY.trim())}`, {
          method: "POST", headers: { "Content-Type": "text/plain;charset=UTF-8", Origin: ALLOWED_ORIGIN, Referer: ALLOWED_ORIGIN + "/" },
          body: JSON.stringify({ models: [{ make, model, year }] })
        });
        if (!s.ok) return s;
        const u = ((await s.json()).urls || [])[0];
        if (!u) return new Response("no model", { status: 404 });
        return fetch(u, { headers: { Referer: ALLOWED_ORIGIN + "/" } });
      };
    } else return fail(404, "unknown path");

    const cache = caches.default;
    const hit = await cache.match(key.toString());
    if (hit) { const r = new Response(hit.body, hit); cors(r.headers); r.headers.set("X-Ke-Cache", "hit"); return r; }

    if (tooMany(req)) return fail(429, "Too many pictures at once, try again in a minute");
    const r = await upstream();
    if (r.status === 401 || r.status === 403) return fail(502, "CarImages refused the Worker's key");
    if (r.status === 429) return fail(429, "This month's CarImages pictures are used up");
    if (!r.ok) return fail(r.status === 404 ? 404 : 502, "No picture for this car");
    const type = r.headers.get("Content-Type") || "";
    if (url.pathname === "/image" && !type.startsWith("image/")) return fail(502, "CarImages didn't send a picture");

    const h = cors(new Headers({ "Content-Type": type || "application/octet-stream", "Cache-Control": "public, max-age=2592000" }));
    const color = r.headers.get("X-CI-Color"); if (color) h.set("X-CI-Color", color);
    const out = new Response(r.body, { status: 200, headers: h });
    ctx.waitUntil(cache.put(key.toString(), out.clone()));
    return out;
  }
};
