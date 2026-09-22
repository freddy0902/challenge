// ============================================================
//  Worker – liefert das Frontend aus, bedient die API,
//  wickelt den Google-OAuth-Flow ab und fährt den Cron-Sync.
//
//  Nur /api/* und /auth/* landen hier (siehe run_worker_first
//  in wrangler.toml), alles andere kommt direkt aus dem
//  Asset-Speicher.
// ============================================================

import { jwtVerify, createRemoteJWKSet } from "jose";
import { alleSynchronisieren, TAGESCAP } from "./sync.js";

const SCOPE = "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly";

let jwks; // JWKS wird pro Isolat einmal geholt und danach zwischengespeichert

/**
 * Access blockt unerlaubte Anfragen schon vor dem Worker. Wir prüfen
 * das Token trotzdem – einerseits als zweite Verteidigungslinie,
 * andererseits brauchen wir die E-Mail ohnehin, um zu wissen, wer da ist.
 */
async function eingeloggteMail(request, env) {
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) return null;

  const team = `https://${env.ACCESS_TEAM}.cloudflareaccess.com`;
  jwks ??= createRemoteJWKSet(new URL(`${team}/cdn-cgi/access/certs`));

  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: team,
      audience: env.ACCESS_AUD,
    });
    return typeof payload.email === "string" ? payload.email.toLowerCase() : null;
  } catch (e) {
    console.warn("Access-Token ungültig:", e.message);
    return null;
  }
}

const json = (daten, status = 200) =>
  new Response(JSON.stringify(daten), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

// ---------- state signieren (Schutz gegen untergeschobene Rückläufer) ----------

async function hmac(wert, geheim) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(geheim),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(wert));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function statePruefen(state, mail, geheim) {
  if (!state) return false;
  const erwartet = await hmac(mail, geheim);
  if (state.length !== erwartet.length) return false;
  let diff = 0;
  for (let i = 0; i < state.length; i++) diff |= state.charCodeAt(i) ^ erwartet.charCodeAt(i);
  return diff === 0;
}

// ---------- Routen ----------

async function teilnehmerZuMail(mail, env) {
  return env.DB.prepare("select * from teilnehmer where email = ?1").bind(mail).first();
}

/** Alles, was das Frontend beim Start braucht – in einem Aufruf. */
async function daten(mail, env) {
  const ich = await teilnehmerZuMail(mail, env);

  const seit = new Date();
  seit.setUTCDate(seit.getUTCDate() - 120);
  const grenze = seit.toISOString().slice(0, 10);

  const { results } = await env.DB.prepare(
    `select t.id as teilnehmer_id, t.name, t.kurz, t.farbe,
            e.datum, e.schritte, e.km, e.quelle
       from eintraege e
       join teilnehmer t on t.id = e.teilnehmer_id
      where e.datum >= ?1
      order by e.datum asc`,
  ).bind(grenze).all();

  return {
    ich: ich
      ? {
          id: ich.id,
          name: ich.name,
          kurz: ich.kurz,
          farbe: ich.farbe,
          verbunden: ich.refresh_token != null,
          letzterSync: ich.letzter_sync,
          syncFehler: ich.sync_fehler,
        }
      : null,
    email: mail,
    tagescap: TAGESCAP,
    zeilen: results ?? [],
  };
}

/** Notnagel: eigenen Tageswert von Hand setzen, falls der Sync ausfällt. */
async function nachtragen(request, mail, env) {
  const ich = await teilnehmerZuMail(mail, env);
  if (!ich) return json({ fehler: "Du bist noch nicht als Teilnehmer angelegt." }, 403);

  const { datum, schritte } = await request.json().catch(() => ({}));
  const wert = Number(schritte);
  if (!datum || !/^\d{4}-\d{2}-\d{2}$/.test(datum) || !Number.isFinite(wert) || wert < 0) {
    return json({ fehler: "datum oder schritte fehlerhaft" }, 400);
  }

  // Nachtragefrist: 48 Stunden
  const alter = (Date.now() - Date.parse(`${datum}T00:00:00Z`)) / 86400000;
  if (alter > 2 || alter < -1) return json({ fehler: "Nur 48 Stunden rückwirkend." }, 400);

  const gekappt = Math.min(Math.round(wert), TAGESCAP);
  await env.DB.prepare(
    `insert into eintraege (teilnehmer_id, datum, schritte, km, quelle, aktualisiert_am)
     values (?1, ?2, ?3, ?4, 'manuell', ?5)
     on conflict (teilnehmer_id, datum) do update set
       schritte = excluded.schritte, km = excluded.km,
       quelle = excluded.quelle, aktualisiert_am = excluded.aktualisiert_am`,
  ).bind(ich.id, datum, gekappt, Math.round((gekappt / 1380) * 10) / 10, new Date().toISOString())
   .run();

  return json({ ok: true, schritte: gekappt });
}

/** Schritt 1 des OAuth-Flows. */
async function authStart(mail, env) {
  const ich = await teilnehmerZuMail(mail, env);
  if (!ich) return new Response("Du bist noch nicht als Teilnehmer angelegt.", { status: 403 });

  const ziel = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  ziel.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  ziel.searchParams.set("redirect_uri", env.GOOGLE_REDIRECT_URI);
  ziel.searchParams.set("response_type", "code");
  ziel.searchParams.set("scope", SCOPE);
  ziel.searchParams.set("state", await hmac(mail, env.STATE_SECRET));
  // Ohne diese beiden gibt es keinen refresh_token:
  ziel.searchParams.set("access_type", "offline");
  ziel.searchParams.set("prompt", "consent");

  return Response.redirect(ziel.toString(), 302);
}

/** Schritt 2: Rückkehr von Google. Läuft ebenfalls hinter Access. */
async function authCallback(url, mail, env) {
  if (url.searchParams.get("error")) {
    return new Response(`Einwilligung abgebrochen: ${url.searchParams.get("error")}`, { status: 400 });
  }

  const code = url.searchParams.get("code");
  if (!code) return new Response("code fehlt", { status: 400 });
  if (!(await statePruefen(url.searchParams.get("state"), mail, env.STATE_SECRET))) {
    return new Response("state ungültig", { status: 400 });
  }

  const tokenAntwort = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: env.GOOGLE_REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenAntwort.ok) {
    return new Response(`Token-Tausch fehlgeschlagen: ${await tokenAntwort.text()}`, { status: 502 });
  }

  const token = await tokenAntwort.json();
  if (!token.refresh_token) {
    // Passiert, wenn die App schon einmal freigegeben war.
    return new Response(
      "Kein refresh_token erhalten. Zugriff unter myaccount.google.com/permissions " +
      "entfernen und erneut verbinden.",
      { status: 400 },
    );
  }

  // Die Token-Antwort enthält keine Nutzer-ID – die holen wir separat.
  const identitaet = await fetch("https://health.googleapis.com/v4/users/me/identity", {
    headers: { Authorization: `Bearer ${token.access_token}`, Accept: "application/json" },
  });
  const ident = identitaet.ok ? await identitaet.json() : {};

  await env.DB.prepare(
    `update teilnehmer set refresh_token = ?1, health_user_id = ?2, legacy_user_id = ?3,
            verbunden_am = ?4, sync_fehler = null
       where email = ?5`,
  ).bind(
    token.refresh_token,
    ident.healthUserId ?? null,
    ident.legacyUserId ?? null,
    new Date().toISOString(),
    mail,
  ).run();

  return Response.redirect(`${url.origin}/?verbunden=1`, 302);
}

// ---------- Einstiegspunkte ----------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const mail = await eingeloggteMail(request, env);
    if (!mail) return new Response("Nicht angemeldet", { status: 403 });

    if (url.pathname === "/api/daten" && request.method === "GET") {
      return json(await daten(mail, env));
    }
    if (url.pathname === "/api/nachtragen" && request.method === "POST") {
      return nachtragen(request, mail, env);
    }
    if (url.pathname === "/auth/start") return authStart(mail, env);
    if (url.pathname === "/auth/callback") return authCallback(url, mail, env);

    // Sollte durch run_worker_first nicht vorkommen, schadet aber nicht
    return env.ASSETS.fetch(request);
  },

  // Cron-Trigger. Erreicht den fetch-Handler nicht und läuft
  // damit auch nicht durch Access – das ist so gewollt.
  async scheduled(event, env, ctx) {
    // Der Abendlauf holt zwei Tage, der Morgenlauf vier.
    // Mehrere Tage rückwirkend, damit verpasste Läufe sich selbst heilen.
    const tage = event.cron.startsWith("50 21") ? 2 : 4;
    ctx.waitUntil(
      alleSynchronisieren(tage, env).then((bericht) =>
        console.log("Sync:", JSON.stringify(bericht)),
      ),
    );
  },
};
