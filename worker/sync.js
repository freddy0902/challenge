// ============================================================
//  Abruf der Tageswerte aus der Google Health API.
//  Wird vom Cron-Trigger aufgerufen, nicht von außen erreichbar.
// ============================================================

const BASIS = "https://health.googleapis.com/v4/users/me/dataTypes";

// Kein Tagesdeckel: gewertet wird die volle Summe. Die Obergrenze hier ist
// keine Spielregel, sondern die Prüfbedingung der Tabelle (schritte <= 100000)
// und fängt nur offensichtlichen Unsinn ab.
const OBERGRENZE = 100000;
const SCHRITTE_PRO_KM = 1380;

/** Zivilzeit-Objekt, wie dailyRollUp es erwartet. */
const zivilzeit = (d, ende = false) => ({
  date: { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() },
  time: ende
    ? { hours: 23, minutes: 59, seconds: 59, nanos: 0 }
    : { hours: 0, minutes: 0, seconds: 0, nanos: 0 },
});

const datumsSchluessel = (zivil) =>
  `${zivil.date.year}-${String(zivil.date.month).padStart(2, "0")}-${String(zivil.date.day).padStart(2, "0")}`;

export async function zugriffstoken(refreshToken, env) {
  const antwort = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!antwort.ok) throw new Error(`Token-Erneuerung fehlgeschlagen: ${await antwort.text()}`);
  return (await antwort.json()).access_token;
}

/**
 * dailyRollUp löst Zeitzonen- und Sommerzeitwechsel selbst auf.
 * Tagessummen selbst zusammenzurechnen wäre fehleranfällig.
 * dataSourceFamily "all-sources" schließt Handy-Schritte mit ein –
 * genau das wollen wir, denn die meisten tragen keine Uhr.
 */
async function tagesRollup(token, datentyp, von, bis) {
  const antwort = await fetch(`${BASIS}/${datentyp}/dataPoints:dailyRollUp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      // Bestimmt die Entfernungseinheit der Antwort – sonst kommen Meilen
      "Accept-Language": "de-DE",
    },
    body: JSON.stringify({
      range: { start: zivilzeit(von), end: zivilzeit(bis, true) },
      windowSizeDays: 1,
      dataSourceFamily: "users/me/dataSourceFamilies/all-sources",
    }),
  });
  if (!antwort.ok) throw new Error(`${datentyp}: ${antwort.status} ${await antwort.text()}`);
  return (await antwort.json()).rollupDataPoints ?? [];
}

/**
 * Für steps ist countSum dokumentiert. Für distance steht der
 * Feldname in der Referenz noch nicht eindeutig fest, deshalb
 * greifen wir defensiv den ersten numerischen Wert ab. Einmal im
 * API Explorer gegenprüfen und dann festnageln.
 */
function summe(wert) {
  if (wert == null || typeof wert !== "object") return null;
  for (const v of Object.values(wert)) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** Verwirft, was physikalisch nicht sein kann. */
function plausibel(schritte, km) {
  if (schritte < 0 || schritte > OBERGRENZE) return false;
  if (km == null || km === 0 || schritte === 0) return true;
  const proKm = schritte / km;
  return proKm > 600 && proKm < 2500;
}

/** Holt für eine Person die letzten `tage` Tage und schreibt sie weg. */
export async function personSynchronisieren(person, tage, env) {
  const token = await zugriffstoken(person.refresh_token, env);

  const bis = new Date();
  const von = new Date();
  von.setUTCDate(von.getUTCDate() - (tage - 1));

  const [schrittPunkte, distanzPunkte] = await Promise.all([
    tagesRollup(token, "steps", von, bis),
    tagesRollup(token, "distance", von, bis).catch(() => []),
  ]);

  const kmNachTag = new Map();
  for (const p of distanzPunkte) {
    const km = summe(p.distance);
    if (km != null) kmNachTag.set(datumsSchluessel(p.civilStartTime), km);
  }

  const jetzt = new Date().toISOString();
  const anweisungen = [];

  for (const p of schrittPunkte) {
    const datum = datumsSchluessel(p.civilStartTime);
    const roh = Number(p.steps?.countSum ?? 0);
    const km = kmNachTag.get(datum) ?? null;

    if (!plausibel(roh, km)) {
      console.warn(`Unplausibel verworfen: ${person.name} ${datum} ${roh} Schritte / ${km} km`);
      continue;
    }

    anweisungen.push(
      env.DB.prepare(
        `insert into eintraege (teilnehmer_id, datum, schritte, km, quelle, aktualisiert_am)
         values (?1, ?2, ?3, ?4, 'google-health', ?5)
         on conflict (teilnehmer_id, datum) do update set
           schritte = excluded.schritte,
           km = excluded.km,
           quelle = excluded.quelle,
           aktualisiert_am = excluded.aktualisiert_am`,
      ).bind(
        person.id,
        datum,
        roh,
        km ?? Math.round((roh / SCHRITTE_PRO_KM) * 10) / 10,
        jetzt,
      ),
    );
  }

  if (anweisungen.length) await env.DB.batch(anweisungen);
  return anweisungen.length;
}

/** Läuft für alle verbundenen Teilnehmer. Ein Fehler stoppt die anderen nicht. */
export async function alleSynchronisieren(tage, env) {
  const { results } = await env.DB.prepare(
    "select id, name, refresh_token from teilnehmer where refresh_token is not null",
  ).all();

  const bericht = {};

  for (const person of results ?? []) {
    try {
      const anzahl = await personSynchronisieren(person, tage, env);
      await env.DB.prepare(
        "update teilnehmer set letzter_sync = ?1, sync_fehler = null where id = ?2",
      ).bind(new Date().toISOString(), person.id).run();
      bericht[person.name] = `${anzahl} Tage`;
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      console.error(`Sync fehlgeschlagen für ${person.name}: ${text}`);
      await env.DB.prepare("update teilnehmer set sync_fehler = ?1 where id = ?2")
        .bind(text.slice(0, 500), person.id).run();
      bericht[person.name] = `Fehler: ${text.slice(0, 120)}`;
    }
  }

  return bericht;
}
