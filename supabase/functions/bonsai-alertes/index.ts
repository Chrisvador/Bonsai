// Alertes météo des bonsaïs : appelée toutes les 3 h par pg_cron (en-tête x-cron-secret),
// ou par l'app avec le jeton de l'utilisateur pour envoyer une notification de test.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import * as webpush from "jsr:@negrel/webpush@0.5.0";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const TZ = "Europe/Paris";
const jourParis = (ms: number) => new Date(ms).toLocaleDateString("sv-SE", { timeZone: TZ });
const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
function quand(sec: number) {
  const ms = sec * 1000, j = jourParis(ms), now = Date.now();
  const lib = j === jourParis(now) ? "aujourd'hui" : j === jourParis(now + 864e5) ? "demain" : JOURS[new Date(j + "T12:00:00Z").getUTCDay()];
  const h = new Date(ms).toLocaleTimeString("fr-FR", { timeZone: TZ, hour: "2-digit", hour12: false });
  return `${lib} vers ${parseInt(h)} h`;
}
const deg = (v: number) => String(Math.round(v)).replace("-", "−") + " °C";

type Seuils = { gelSensibles: number; gelPots: number; vent: number };
type Arbre = { nom: string; abri_hiver: boolean; culture: string | null };

const meteoCache = new Map<string, any>();
async function meteo(lat: number, lon: number) {
  const k = lat.toFixed(2) + "," + lon.toFixed(2);
  if (!meteoCache.has(k)) {
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&timezone=${encodeURIComponent(TZ)}&timeformat=unixtime&forecast_days=3&wind_speed_unit=kmh&hourly=temperature_2m,wind_gusts_10m`;
    const r = await fetch(u); if (!r.ok) throw new Error("Open-Meteo " + r.status);
    meteoCache.set(k, await r.json());
  }
  return meteoCache.get(k);
}
function risques(m: any) {
  const h = m.hourly, now = Date.now() / 1000;
  let tMin: { v: number; t: number } | null = null, gMax: { v: number; t: number } | null = null;
  h.time.forEach((t: number, i: number) => {
    if (t < now - 3600 || t > now + 48 * 3600) return;
    if (!tMin || h.temperature_2m[i] < tMin.v) tMin = { v: h.temperature_2m[i], t };
    if (!gMax || h.wind_gusts_10m[i] > gMax.v) gMax = { v: h.wind_gusts_10m[i], t };
  });
  return { tMin, gMax } as { tMin: { v: number; t: number } | null; gMax: { v: number; t: number } | null };
}
function analyse(arbres: Arbre[], m: any, s: Seuils) {
  const { tMin, gMax } = risques(m);
  const gel: string[] = [], vent: string[] = [];
  for (const b of arbres) {
    const enPot = b.culture !== "pleine_terre";
    if (tMin && ((b.abri_hiver && tMin.v <= s.gelSensibles) || (enPot && tMin.v <= s.gelPots))) gel.push(b.nom);
    if (gMax && enPot && gMax.v >= s.vent) vent.push(b.nom);
  }
  const noms = [...new Set([...gel, ...vent])];
  const parts: string[] = [];
  if (gel.length && tMin) parts.push(`Gel ${deg(tMin.v)} ${quand(tMin.t)}`);
  if (vent.length && gMax) parts.push(`rafales ${Math.round(gMax.v)} km/h ${quand(gMax.t)}`);
  const liste = noms.length <= 3 ? noms.join(", ") : noms.slice(0, 3).join(", ") + ` et ${noms.length - 3} autres`;
  const cle = noms.length ? [noms.length, gel.length && tMin ? Math.round(tMin.v) + "@" + jourParis(tMin.t * 1000) : "", vent.length && gMax ? Math.round(gMax.v / 10) + "@" + jourParis(gMax.t * 1000) : ""].join("|") : "";
  return { n: noms.length, cle, titre: `⚠ Alerte météo · ${noms.length} bonsaï${noms.length > 1 ? "s" : ""}`, corps: `${parts.join(", ")} : ${liste}.` };
}

let serveur: webpush.ApplicationServer | null = null;
async function appServer() {
  if (serveur) return serveur;
  const { data, error } = await db.from("bonsai_config").select("v").eq("k", "vapid").single();
  if (error) throw error;
  const vapidKeys = await webpush.importVapidKeys(JSON.parse(data.v));
  serveur = await webpush.ApplicationServer.new({ contactInformation: "https://chrisvador.github.io/Bonsai/", vapidKeys });
  return serveur;
}
async function envoyer(sub: any, payload: unknown) {
  const s = (await appServer()).subscribe({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } });
  try { await s.pushTextMessage(JSON.stringify(payload), { urgency: webpush.Urgency.High, ttl: 6 * 3600 }); return "ok"; }
  catch (e) {
    if (e instanceof webpush.PushMessageError && (e.isGone() || e.response.status === 404)) { await db.from("bonsai_push").delete().eq("id", sub.id); return "supprimé"; }
    const detail = e instanceof webpush.PushMessageError ? `${e.response.status} ${await e.response.text().catch(() => "")}` : String(e);
    console.error("push", sub.endpoint.slice(0, 40), detail);
    return "échec " + detail;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const { data: cfg } = await db.from("bonsai_config").select("v").eq("k", "cron_secret").single();
    const cron = req.headers.get("x-cron-secret");
    let owner: string | null = null, test = false;
    if (cron) { if (!cfg || cron !== cfg.v) return json({ erreur: "secret invalide" }, 401);
      const body = await req.json().catch(() => ({})); if (body && body.test) test = true; }
    else {
      const jwt = (req.headers.get("authorization") || "").replace(/^Bearer /i, "");
      const { data: u, error } = await db.auth.getUser(jwt);
      if (error || !u.user) return json({ erreur: "non authentifié" }, 401);
      owner = u.user.id; test = true;
    }
    let q = db.from("bonsai_push").select("*"); if (owner) q = q.eq("owner_id", owner);
    const { data: subs, error } = await q; if (error) throw error;
    const arbresParOwner = new Map<string, Arbre[]>();
    const rapport: unknown[] = [];
    for (const sub of subs ?? []) {
      if (!arbresParOwner.has(sub.owner_id)) {
        const { data } = await db.from("bonsais").select("nom,abri_hiver,culture").eq("owner_id", sub.owner_id);
        arbresParOwner.set(sub.owner_id, data ?? []);
      }
      const a = analyse(arbresParOwner.get(sub.owner_id)!, await meteo(sub.lat, sub.lon), { gelSensibles: 0, gelPots: -5, vent: 60, ...sub.seuils });
      if (test) {
        const r = await envoyer(sub, a.n ? { title: a.titre, body: a.corps, badge: a.n, url: "./#alerte" }
          : { title: "Mes bonsaïs", body: `Notifications actives. Pas d'alerte gel ou vent sur 48 h à ${sub.lieu}.`, badge: 0, url: "./" });
        rapport.push({ id: sub.id, test: r }); continue;
      }
      if (a.n && a.cle !== sub.derniere_cle) {
        const r = await envoyer(sub, { title: a.titre, body: a.corps, badge: a.n, url: "./#alerte" });
        await db.from("bonsai_push").update({ derniere_cle: a.cle, dernier_envoi: new Date().toISOString() }).eq("id", sub.id);
        rapport.push({ id: sub.id, envoi: r, n: a.n });
      } else if (!a.n && sub.derniere_cle) {
        await db.from("bonsai_push").update({ derniere_cle: null }).eq("id", sub.id);
        rapport.push({ id: sub.id, fin: true });
      } else rapport.push({ id: sub.id, rien: true, n: a.n });
    }
    return json({ ok: true, abonnements: subs?.length ?? 0, rapport });
  } catch (e) { console.error(e); return json({ erreur: String(e) }, 500); }
});
