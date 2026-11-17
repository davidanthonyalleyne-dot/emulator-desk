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

// Live Activity push-to-start for the Ke iPhone app. iOS won't let an app start a Live Activity from the
// background, so when a trip starts with the phone in a pocket the app asks here, and this sends Apple the
// start push with the app's own start token. Secrets: APNS_KEY (the .p8 text), APNS_KEY_ID.
const TEAM_ID = "M8GX2N7YR2", TOPIC = "ca.davidalleyne.ke.push-type.liveactivity";
let apnsJwt = null;   // [token, madeAt]
const b64url = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlText = t => b64url(new TextEncoder().encode(t));
async function apnsToken(env) {
  if (apnsJwt && Date.now() - apnsJwt[1] < 45 * 60000) return apnsJwt[0];
  const pem = String(env.APNS_KEY).replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const head = b64urlText(JSON.stringify({ alg: "ES256", kid: String(env.APNS_KEY_ID).trim() }));
  const claims = b64urlText(JSON.stringify({ iss: TEAM_ID, iat: Math.floor(Date.now() / 1000) }));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(head + "." + claims));
  apnsJwt = [head + "." + claims + "." + b64url(sig), Date.now()];
  return apnsJwt[0];
}
async function liveActivityStart(req, env) {
  if (req.headers.get("X-Ke-App") !== "ca.davidalleyne.ke") return fail(403, "Only the Ke app");
  if (!env.APNS_KEY || !env.APNS_KEY_ID) return fail(503, "APNs key isn't set on the Worker yet");
  if (tooMany(req)) return fail(429, "Too many requests");
  let b; try { b = await req.json(); } catch { return fail(400, "JSON body needed"); }
  const token = String(b.token || "");
  if (!/^[0-9a-f]{32,200}$/.test(token) || typeof b.attributes !== "object" || typeof b.state !== "object") return fail(400, "token, attributes and state are needed");
  const payload = { aps: {
    timestamp: Math.floor(Date.now() / 1000), event: "start",
    "attributes-type": "TripActivityAttributes", attributes: b.attributes, "content-state": b.state,
    alert: { title: "Trip started", body: "Kē is recording. It saves itself when you park." },
  } };
  const host = b.sandbox ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";
  const r = await fetch(`${host}/3/device/${token}`, { method: "POST", body: JSON.stringify(payload), headers: {
    authorization: "bearer " + await apnsToken(env), "apns-topic": TOPIC, "apns-push-type": "liveactivity", "apns-priority": "10", "content-type": "application/json" } });
  const text = r.status === 200 ? "" : await r.text();
  return new Response(JSON.stringify({ apns: r.status, reason: text.slice(0, 200) }), { status: r.status === 200 ? 200 : 502, headers: { "Content-Type": "application/json" } });
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { headers: cors(new Headers({ "Access-Control-Allow-Methods": "GET", "Access-Control-Max-Age": "86400" })) });
    if (req.method === "POST" && url.pathname === "/la/start") return liveActivityStart(req, env);
    if (req.method !== "GET") return fail(405, "GET only");
    if (url.pathname === "/") return new Response("Ke car pictures proxy", { headers: cors() });
    // Setup check without showing the key: is it there, does it look like a CarImages key, and does CarImages take it?
    if (url.pathname === "/health") {
      const k = (env.CI_KEY || "").trim(), shape = !k ? "missing" : /^ci_[0-9a-f]{20,}$/.test(k) ? "looks like a key" : k.startsWith("ci_") ? "starts with ci_ but has odd characters" : "not a ci_ key (secret pasted instead?)";
      let status = null; if (k) { const r = await fetch(`${CI}/image?make=Porsche&model=911&width=240&format=webp&key=${encodeURIComponent(k)}`, { headers: { Referer: ALLOWED_ORIGIN + "/" }, redirect: "manual" }); status = r.status; }
      return new Response(JSON.stringify({ key: shape, length: k.length, carimages: status, apns: env.APNS_KEY && env.APNS_KEY_ID ? "set" : "missing" }), { headers: cors(new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store" })) });
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
