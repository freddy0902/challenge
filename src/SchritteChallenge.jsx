import React, { useState, useMemo, useEffect } from "react";

/* ------------------------------------------------------------------
   Schritte-Challenge

   Holt alles in einem Aufruf von /api/daten – demselben Worker, der
   auch diese Seite ausliefert. Die Anmeldung erledigt Cloudflare
   Access davor, deshalb braucht das Frontend weder Schlüssel noch
   Login-Maske.

   Drei Zustände:
     live  – es gibt Einträge, die Wertung läuft
     leer  – der Worker antwortet, aber es wurde noch nichts gemeldet
     demo  – kein Worker erreichbar (lokales Entwickeln)
------------------------------------------------------------------- */

const SCHRITTE_PRO_KM = 1380;

const DEMO_FREUNDE = [
  { id: "fre", name: "Freddy", kurz: "FR", quelle: "iPhone", farbe: "#FFC14D", basis: 9800, streu: 3200 },
  { id: "jon", name: "Jonas", kurz: "JO", quelle: "Android", farbe: "#5FD3C4", basis: 11200, streu: 4600 },
  { id: "mar", name: "Marek", kurz: "MA", quelle: "Garmin", farbe: "#F2849E", basis: 8400, streu: 2400 },
  { id: "sve", name: "Svenja", kurz: "SV", quelle: "iPhone", farbe: "#A99BF5", basis: 12600, streu: 3800 },
  { id: "tim", name: "Timo", kurz: "TI", quelle: "Android", farbe: "#C2E06A", basis: 7200, streu: 5200 },
  { id: "nel", name: "Nele", kurz: "NE", quelle: "Fitbit", farbe: "#6FB6F2", basis: 10400, streu: 2900 },
];

const ETAPPEN = [
  { km: 0, ort: "Dietzenbach" },
  { km: 60, ort: "Gießen" },
  { km: 210, ort: "Kassel" },
  { km: 390, ort: "Bielefeld" },
  { km: 500, ort: "Hannover" },
  { km: 660, ort: "Hamburg" },
  { km: 990, ort: "Kopenhagen" },
];

/* ---------- Hilfsfunktionen ---------- */

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const schluessel = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const zuKm = (schritte) => Math.round((schritte / SCHRITTE_PRO_KM) * 10) / 10;
const zahl = (n) => Math.round(n).toLocaleString("de-DE");
const kmText = (n) => n.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function montagDieserWoche(d) {
  const m = new Date(d);
  const wt = (m.getDay() + 6) % 7;
  m.setDate(m.getDate() - wt);
  m.setHours(0, 0, 0, 0);
  return m;
}

const QUELLE_LABEL = {
  "google-health": "Google Health",
  manuell: "von Hand",
};

/* ---------- Demo-Daten ---------- */

function demoDatenErzeugen() {
  const rnd = mulberry32(20260911);
  const heute = new Date();
  heute.setHours(0, 0, 0, 0);
  const tage = [];
  for (let i = 34; i >= 0; i--) {
    const d = new Date(heute);
    d.setDate(d.getDate() - i);
    tage.push(d);
  }
  const eintraege = {};
  tage.forEach((d, idx) => {
    const k = schluessel(d);
    eintraege[k] = {};
    const wochenende = d.getDay() === 0 || d.getDay() === 6;
    DEMO_FREUNDE.forEach((f) => {
      let s = f.basis + (rnd() - 0.45) * f.streu * 2;
      if (wochenende) s *= 0.85 + rnd() * 0.7;
      if (rnd() > 0.94) s *= 1.6; // Wandertag
      if (rnd() > 0.97) s *= 0.35; // Krankheit / Schreibtischtag
      if (idx === tage.length - 1) s *= 0.62; // heute noch nicht vorbei
      s = Math.max(400, Math.round(s / 10) * 10);
      eintraege[k][f.id] = { schritte: s, km: zuKm(s), quelle: f.quelle };
    });
  });
  return { tage, eintraege, freunde: DEMO_FREUNDE };
}

/* ---------- Echte Daten vom Worker ---------- */

async function echteDatenLaden() {
  const antwort = await fetch("/api/daten", { headers: { Accept: "application/json" } });
  if (!antwort.ok) throw new Error(`Laden fehlgeschlagen: ${antwort.status}`);

  const { ich, teilnehmer, zeilen = [] } = await antwort.json();

  // Der Roster kommt vom Worker. Fällt er aus (ältere Fassung), leiten
  // wir die Teilnehmer wie früher aus den Einträgen ab.
  let freunde = (teilnehmer ?? []).map((t) => ({ ...t }));
  if (!freunde.length) {
    const gesehen = new Set();
    for (const z of zeilen) {
      if (gesehen.has(z.teilnehmer_id)) continue;
      gesehen.add(z.teilnehmer_id);
      freunde.push({ id: z.teilnehmer_id, name: z.name, kurz: z.kurz, farbe: z.farbe });
    }
  }

  const eintraege = {};
  const letzteQuelle = {};
  for (const z of zeilen) {
    (eintraege[z.datum] ??= {})[z.teilnehmer_id] = {
      schritte: z.schritte,
      km: Number(z.km ?? 0),
      quelle: z.quelle,
    };
    letzteQuelle[z.teilnehmer_id] = z.quelle;
  }
  freunde = freunde.map((f) => ({
    ...f,
    quelle: QUELLE_LABEL[letzteQuelle[f.id]] ?? (f.verbunden ? "Google Health" : null),
  }));

  // Lückenlose Tagesliste vom ersten Eintrag bis heute
  const heute = new Date();
  heute.setHours(0, 0, 0, 0);
  const erster = zeilen.length ? new Date(`${zeilen[0].datum}T00:00:00`) : new Date(heute);
  const tage = [];
  for (const d = new Date(erster); d <= heute; d.setDate(d.getDate() + 1)) {
    eintraege[schluessel(d)] ??= {};
    tage.push(new Date(d));
  }
  if (!tage.length) tage.push(new Date(heute));

  return { tage, eintraege, freunde, ich, leer: zeilen.length === 0 };
}

/* ---------- Auswertung ---------- */

function tagessieger(tagesEintrag) {
  const sortiert = Object.entries(tagesEintrag)
    .filter(([, e]) => e.schritte > 0)
    .sort((a, b) => b[1].schritte - a[1].schritte);
  return sortiert[0]?.[0];
}

function zeitraumFilter(tage, zeitraum) {
  const heute = tage[tage.length - 1];
  if (zeitraum === "heute") return [heute];
  if (zeitraum === "woche") {
    const mo = montagDieserWoche(heute);
    return tage.filter((d) => d >= mo);
  }
  if (zeitraum === "monat") {
    return tage.filter((d) => d.getMonth() === heute.getMonth() && d.getFullYear() === heute.getFullYear());
  }
  return tage;
}

function auswerten(tage, eintraege, zeitraum, freunde) {
  const relevant = zeitraumFilter(tage, zeitraum);
  const summe = {};
  freunde.forEach((f) => (summe[f.id] = { schritte: 0, km: 0, siege: 0, verlauf: [] }));
  relevant.forEach((d) => {
    const tag = eintraege[schluessel(d)];
    if (!tag) return;
    const sieger = tagessieger(tag);
    freunde.forEach((f) => {
      const e = tag[f.id] ?? { schritte: 0, km: 0 };
      summe[f.id].schritte += e.schritte;
      summe[f.id].km += e.km;
      summe[f.id].verlauf.push(e.schritte);
      if (sieger === f.id) summe[f.id].siege += 1;
    });
  });
  const zeilen = freunde
    .map((f) => ({ ...f, ...summe[f.id], km: Math.round(summe[f.id].km * 10) / 10 }))
    .sort((a, b) => b.schritte - a.schritte);
  zeilen.forEach((z, i) => (z.rang = i + 1));
  return { zeilen, anzahlTage: relevant.length };
}

/* ---------- Kleine Bausteine ---------- */

function Sparkline({ werte, farbe }) {
  if (werte.length < 2) return null;
  const max = Math.max(...werte);
  const min = Math.min(...werte);
  const spanne = max - min || 1;
  const punkte = werte
    .map((w, i) => `${(i / (werte.length - 1)) * 100},${28 - ((w - min) / spanne) * 24}`)
    .join(" ");
  return (
    <svg className="spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={punkte} fill="none" stroke={farbe} strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Kuerzel({ person, groesse = 34 }) {
  return (
    <span
      className="kuerzel"
      style={{ background: person.farbe, width: groesse, height: groesse, fontSize: groesse * 0.38 }}
      aria-hidden="true"
    >
      {person.kurz}
    </span>
  );
}

/* Zählt bis Mitternacht herunter, aktualisiert sich minütlich. */
function useRestDesTages() {
  const [jetzt, setJetzt] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setJetzt(new Date()), 30000);
    return () => clearInterval(t);
  }, []);
  return `${23 - jetzt.getHours()}:${String(59 - jetzt.getMinutes()).padStart(2, "0")} h`;
}

/* ---------- Hauptkomponente ---------- */

export default function SchritteChallenge() {
  const [demo] = useState(demoDatenErzeugen);
  const [tage, setTage] = useState(demo.tage);
  const [eintraege, setEintraege] = useState(demo.eintraege);
  const [freunde, setFreunde] = useState(demo.freunde);
  const [quelle, setQuelle] = useState("laden");
  const [ichProfil, setIchProfil] = useState(null);
  const [zeitraum, setZeitraum] = useState("woche");
  const [nachtragen, setNachtragen] = useState(false);
  const [entwurf, setEntwurf] = useState("");
  const [offen, setOffen] = useState(null);

  useEffect(() => {
    let abgebrochen = false;
    echteDatenLaden()
      .then((daten) => {
        if (abgebrochen || !daten) return;
        setIchProfil(daten.ich ?? null);
        setTage(daten.tage);
        setEintraege(daten.eintraege);
        setFreunde(daten.freunde);
        setQuelle(daten.leer ? "leer" : "live");
      })
      .catch(() => setQuelle("demo"));
    return () => {
      abgebrochen = true;
    };
  }, []);

  const rest = useRestDesTages();

  const heute = tage[tage.length - 1];
  const heuteKey = schluessel(heute);
  const ich = ichProfil ?? freunde[0] ?? null;

  const tagesRennen = useMemo(() => {
    const tag = eintraege[heuteKey] ?? {};
    return freunde
      .map((f) => ({ ...f, schritte: 0, km: 0, ...tag[f.id] }))
      .sort((a, b) => b.schritte - a.schritte);
  }, [eintraege, heuteKey, freunde]);

  const tabelle = useMemo(
    () => auswerten(tage, eintraege, zeitraum, freunde),
    [tage, eintraege, zeitraum, freunde],
  );

  const chronik = useMemo(
    () =>
      tage
        .slice(-12)
        .map((d) => {
          const sieger = tagessieger(eintraege[schluessel(d)] ?? {});
          return { datum: d, sieger: freunde.find((f) => f.id === sieger) };
        })
        .filter((c) => c.sieger),
    [tage, eintraege, freunde],
  );

  const routeKm = useMemo(() => {
    const monat = auswerten(tage, eintraege, "monat", freunde);
    return Math.round(monat.zeilen.reduce((s, z) => s + z.km, 0));
  }, [tage, eintraege, freunde]);

  const auszeichnungen = useMemo(() => {
    const gesamt = auswerten(tage, eintraege, "gesamt", freunde);
    const mitDaten = gesamt.zeilen.filter((z) => z.schritte > 0);
    if (mitDaten.length < 2) return [];
    const meisteSiege = [...mitDaten].sort((a, b) => b.siege - a.siege)[0];
    const abw = (z) => {
      const m = z.schritte / z.verlauf.length;
      return Math.sqrt(z.verlauf.reduce((s, v) => s + (v - m) ** 2, 0) / z.verlauf.length);
    };
    const konstant = [...mitDaten].sort((a, b) => abw(a) - abw(b))[0];
    const serie = [...mitDaten]
      .map((z) => {
        let best = 0,
          akt = 0;
        z.verlauf.forEach((v) => {
          akt = v >= 10000 ? akt + 1 : 0;
          if (akt > best) best = akt;
        });
        return { ...z, serie: best };
      })
      .sort((a, b) => b.serie - a.serie)[0];
    return [
      { titel: "Meiste Tagessiege", person: meisteSiege, wert: `${meisteSiege.siege}×` },
      { titel: "Längste Serie über 10.000", person: serie, wert: `${serie.serie} Tage` },
      { titel: "Konstantester Gang", person: konstant, wert: "geringste Streuung" },
    ];
  }, [tage, eintraege, freunde]);

  const liste = tabelle.zeilen;
  const maxHeute = tagesRennen[0]?.schritte || 0;

  const eintragen = async () => {
    const wert = parseInt(entwurf.replace(/\D/g, ""), 10);
    if (!wert || !ich) return;

    // Erst lokal anzeigen, damit die Eingabe sofort quittiert wird
    setEintraege((alt) => ({
      ...alt,
      [heuteKey]: { ...alt[heuteKey], [ich.id]: { schritte: wert, km: zuKm(wert), quelle: "manuell" } },
    }));
    setEntwurf("");
    setNachtragen(false);
    if (quelle === "leer") setQuelle("live");

    if (quelle === "demo") return; // ohne Worker nur lokal
    try {
      await fetch("/api/nachtragen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ datum: heuteKey, schritte: wert }),
      });
    } catch {
      /* beim nächsten Laden wird ohnehin der Serverstand gezogen */
    }
  };

  const monatsname = heute.toLocaleDateString("de-DE", { month: "long" });
  const zeitraumLabel = { heute: "Heute", woche: "Diese Woche", monat: monatsname, gesamt: "Gesamt" }[zeitraum];

  const stil = (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600&family=Barlow+Condensed:wght@500;600;700&display=swap');

      .wrap {
        --platz:#0F1319; --tafel:#171D26; --erhoben:#1E2632; --linie:#2A3441;
        --flut:#FFC14D; --bahn:#5FD3C4; --warn:#F2849E;
        --text:#E8EDF2; --gedimmt:#8A97A6; --leise:#5C6875;
        background:var(--platz); color:var(--text);
        font-family:'Barlow',system-ui,sans-serif;
        font-feature-settings:'tnum' 1;
        min-height:100%;
        padding:calc(18px + env(safe-area-inset-top)) calc(16px + env(safe-area-inset-right))
                calc(48px + env(safe-area-inset-bottom)) calc(16px + env(safe-area-inset-left));
        max-width:560px; margin:0 auto;
        overflow-x:hidden; overscroll-behavior-y:contain;
        -webkit-font-smoothing:antialiased;
        -webkit-tap-highlight-color:transparent;
      }
      .wrap *, .wrap *::before, .wrap *::after { box-sizing:border-box; }
      .wrap button, .wrap a, .wrap input, .wrap summary { touch-action:manipulation; }
      .wrap h1,.wrap h2,.wrap h3 { font-family:'Barlow Condensed',sans-serif; margin:0; font-weight:600; letter-spacing:.01em; }
      .num { font-family:'Barlow Condensed',sans-serif; font-weight:700; letter-spacing:-.01em; }

      /* Kopf */
      .kopf { display:flex; align-items:flex-end; justify-content:space-between; gap:12px; margin-bottom:20px; }
      .kopf h1 { font-size:30px; line-height:1; }
      .kopf p { margin:5px 0 0; color:var(--gedimmt); font-size:13.5px; }
      .frist { text-align:right; color:var(--leise); font-size:11.5px; line-height:1.45; flex-shrink:0; }
      .frist b { display:block; color:var(--flut); font-family:'Barlow Condensed',sans-serif; font-size:19px; font-weight:600; }

      .banner { display:flex; gap:9px; align-items:flex-start; border:1px solid var(--linie);
        border-left:3px solid var(--flut); background:var(--tafel); border-radius:8px;
        padding:10px 12px; margin-bottom:16px; font-size:12.5px; color:var(--gedimmt); line-height:1.5; }

      /* Karten */
      .tafel { background:var(--tafel); border:1px solid var(--linie); border-radius:12px; padding:16px; margin-bottom:14px; }
      .tafel > h2 { font-size:19px; margin-bottom:2px; }
      .unterzeile { color:var(--leise); font-size:12.5px; margin:0 0 14px; line-height:1.5; }

      .kuerzel { border-radius:50%; display:inline-flex; align-items:center; justify-content:center;
        font-family:'Barlow Condensed',sans-serif; font-weight:700; color:#0F1319; flex-shrink:0; }

      /* Tagesrennen: Name und Wert über dem Balken, Balken volle Breite */
      .lauf { padding:11px 0; border-top:1px solid var(--linie); }
      .lauf:first-of-type { border-top:none; padding-top:2px; }
      .laufKopf { display:flex; align-items:baseline; gap:8px; margin-bottom:7px; }
      .laufPlatz { font-family:'Barlow Condensed',sans-serif; font-size:14px; font-weight:600; color:var(--leise); width:16px; flex-shrink:0; }
      .laufName { font-size:14.5px; font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .laufDu { font-size:10px; color:var(--platz); background:var(--gedimmt); border-radius:3px; padding:1px 4px; margin-left:6px; vertical-align:2px; }
      .laufWert { margin-left:auto; font-family:'Barlow Condensed',sans-serif; font-weight:700; font-size:18px; white-space:nowrap; }
      .laufKm { font-family:'Barlow',sans-serif; font-weight:400; font-size:11px; color:var(--leise); margin-left:6px; }
      .bett { height:8px; background:#121822; border-radius:4px; overflow:hidden; }
      .balken { height:100%; background:#33404F; border-radius:4px; transition:width .5s cubic-bezier(.22,.8,.3,1); }
      .balken.fuehrend { background:linear-gradient(90deg,#C98A24,var(--flut)); }

      /* Schalter */
      .schalter { display:flex; gap:6px; margin-bottom:14px; }
      .schalter button { flex:1; min-height:38px; background:transparent; border:1px solid var(--linie); color:var(--gedimmt);
        font-family:'Barlow Condensed',sans-serif; font-size:15px; font-weight:600; padding:8px 4px; border-radius:8px; cursor:pointer; }
      .schalter button[aria-pressed="true"] { background:var(--erhoben); color:var(--text); border-color:#3B4757; }

      .sortZeile { display:flex; align-items:center; justify-content:space-between; gap:8px; margin:0 0 6px; }
      .sortZeile > span { font-size:12.5px; color:var(--leise); }
      .sortWahl { display:flex; gap:4px; flex-shrink:0; }
      .sortWahl button { background:transparent; border:none; color:var(--leise); font-size:12.5px; font-family:'Barlow',sans-serif;
        padding:6px 8px; border-radius:6px; cursor:pointer; }
      .sortWahl button[aria-pressed="true"] { background:var(--erhoben); color:var(--flut); }

      /* Rangliste: rechts zwei Zeilen statt zwei Spalten – das passt aufs Handy */
      .rang { width:100%; text-align:left; background:transparent; border:none; border-top:1px solid var(--linie);
        padding:12px 2px; min-height:56px; display:grid; grid-template-columns:22px 1fr auto; gap:11px;
        align-items:center; cursor:pointer; color:inherit; }
      .rang:first-of-type { border-top:none; }
      .rang.ichSelbst { background:linear-gradient(90deg,rgba(255,193,77,.07),transparent 65%); }
      .rangNr { font-family:'Barlow Condensed',sans-serif; font-size:20px; font-weight:700; color:var(--leise); text-align:center; }
      .rangNr.eins { color:var(--flut); }
      .rangText { min-width:0; }
      .rangName { font-size:14.5px; font-weight:500; display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .rangMeta { font-size:11px; color:var(--leise); display:block; margin-top:2px;
        overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .werte { text-align:right; }
      .wertHaupt { font-family:'Barlow Condensed',sans-serif; font-size:19px; font-weight:700; color:var(--flut); display:block; line-height:1.1; }
      .wertNeben { font-size:11px; color:var(--leise); display:block; margin-top:2px; white-space:nowrap; }
      .detail { border-top:1px solid var(--linie); padding:12px 2px 4px; display:flex; align-items:center; gap:14px; }
      .spark { width:100%; height:30px; flex:1; min-width:0; }
      .detailWert { font-size:12px; color:var(--gedimmt); white-space:nowrap; }

      /* Strecke */
      .route { position:relative; height:4px; background:#121822; border-radius:2px; margin:22px 0 10px; }
      .routeFuell { position:absolute; inset:0 auto 0 0; background:var(--bahn); border-radius:2px; }
      .routeMarke { position:absolute; top:-4px; width:12px; height:12px; border-radius:50%; background:var(--platz); border:2px solid var(--linie); transform:translateX(-50%); }
      .routeMarke.erreicht { border-color:var(--bahn); background:var(--bahn); }
      .routeOrte { display:flex; justify-content:space-between; font-size:10.5px; color:var(--leise); }

      /* Chronik */
      .chronik { display:flex; gap:5px; }
      .chronikTag { flex:1; min-width:0; text-align:center; }
      .chronikPunkt { width:100%; aspect-ratio:1; border-radius:6px; display:flex; align-items:center; justify-content:center;
        font-family:'Barlow Condensed',sans-serif; font-size:11px; font-weight:700; color:#0F1319; }
      .chronikDatum { font-size:9.5px; color:var(--leise); margin-top:4px; display:block; }

      /* Listen mit Person */
      .ehren { display:flex; flex-direction:column; gap:12px; }
      .ehre { display:flex; align-items:center; gap:11px; }
      .ehreText b { display:block; font-size:13.5px; font-weight:500; }
      .ehreText span { font-size:11.5px; color:var(--leise); }

      .crew { display:flex; flex-direction:column; }
      .crewZeile { display:flex; align-items:center; gap:11px; padding:10px 0; border-top:1px solid var(--linie); }
      .crewZeile:first-child { border-top:none; padding-top:2px; }
      .crewName { font-size:14px; font-weight:500; }
      .crewStatus { font-size:11.5px; color:var(--leise); display:block; margin-top:1px; }
      .crewStatus.ok { color:var(--bahn); }
      .crewAbstand { margin-left:auto; font-size:11px; color:var(--leise); }

      /* Aktionen */
      .aktion { width:100%; min-height:46px; background:var(--flut); color:#1A1204; border:none; border-radius:9px;
        font-family:'Barlow Condensed',sans-serif; font-size:17px; font-weight:700; padding:12px; cursor:pointer;
        display:flex; align-items:center; justify-content:center; text-decoration:none; }
      .aktion.leise { background:transparent; color:var(--gedimmt); border:1px solid var(--linie); }
      .feldZeile { display:flex; gap:8px; }
      .feldZeile input { flex:1; min-width:0; background:#121822; border:1px solid var(--linie); border-radius:9px; color:var(--text);
        font-family:'Barlow Condensed',sans-serif; font-size:20px; font-weight:700; padding:10px 12px; }
      .feldZeile .aktion { width:auto; padding:12px 20px; }
      .hinweis { font-size:11.5px; color:var(--leise); margin:10px 0 0; line-height:1.55; }
      .regeln { font-size:12.5px; color:var(--gedimmt); line-height:1.8; margin:0; }
      .fehler { color:var(--warn); }

      .wrap details > summary { list-style:none; cursor:pointer; font-family:'Barlow Condensed',sans-serif;
        font-size:19px; font-weight:600; display:flex; align-items:center; justify-content:space-between; }
      .wrap details > summary::-webkit-details-marker { display:none; }
      .wrap details > summary::after { content:'+'; color:var(--leise); font-size:20px; }
      .wrap details[open] > summary::after { content:'–'; }
      .wrap details[open] > summary { margin-bottom:12px; }

      .wrap :focus-visible { outline:2px solid var(--flut); outline-offset:2px; border-radius:4px; }
      @media (prefers-reduced-motion:reduce) { .wrap * { transition:none !important; } }
    `}</style>
  );

  /* ---------- Kopf, überall gleich ---------- */

  const kopf = (
    <header className="kopf">
      <div>
        <h1>Schritte-Challenge</h1>
        <p>
          {heute.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" })}
          {freunde.length > 0 && ` · ${freunde.length} ${freunde.length === 1 ? "Teilnehmer" : "Teilnehmer"}`}
        </p>
      </div>
      <div className="frist">
        Tag endet in
        <b>{rest}</b>
      </div>
    </header>
  );

  /* ---------- Karte: eigener Stand eintragen ---------- */

  const notnagel = (titel, unterzeile) => (
    <section className="tafel">
      <h2>{titel}</h2>
      <p className="unterzeile">{unterzeile}</p>
      {nachtragen ? (
        <>
          <div className="feldZeile">
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={entwurf}
              onChange={(e) => setEntwurf(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && eintragen()}
              placeholder="Schritte"
              aria-label="Schritte heute"
            />
            <button className="aktion" onClick={eintragen}>
              Speichern
            </button>
          </div>
          <p className="hinweis">
            Kilometer werden aus den Schritten berechnet. Nachtragen geht 48 Stunden rückwirkend.
          </p>
        </>
      ) : (
        <button className="aktion" onClick={() => setNachtragen(true)}>
          Wert für heute eintragen
        </button>
      )}
    </section>
  );

  /* ---------- Karte: Datenquelle ---------- */

  const datenquelle = (
    <section className="tafel">
      <h2>Deine Datenquelle</h2>
      <p className="unterzeile">
        {ichProfil?.verbunden
          ? `Google Health · synchronisiert um 23:50 und 06:10 Uhr${
              ichProfil.letzterSync
                ? ` · zuletzt ${new Date(ichProfil.letzterSync).toLocaleString("de-DE", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}`
                : ""
            }`
          : "Noch nicht verbunden – bis dahin trägst du deinen Tageswert von Hand ein."}
      </p>
      {ichProfil?.verbunden ? (
        <p className="regeln">
          Schritte und Kilometer kommen automatisch. Nichts einzutragen.
          {ichProfil.syncFehler && (
            <>
              <br />
              <span className="fehler">Letzter Sync mit Fehler: {ichProfil.syncFehler}</span>
            </>
          )}
        </p>
      ) : (
        <a className="aktion" href="/auth/start">
          Google Health verbinden
        </a>
      )}
    </section>
  );

  /* ---------- Karte: Spielregeln ---------- */

  const spielregeln = (
    <section className="tafel">
      <details>
        <summary>Spielregeln</summary>
        <p className="regeln">
          Gewertet wird die Summe der Schritte.
          <br />
          Der Tag endet um 23:59 Uhr deutscher Zeit.
          <br />
          Nachtragen ist 48 Stunden rückwirkend möglich.
          <br />
          Die Woche beginnt am Montag.
        </p>
      </details>
    </section>
  );

  /* ---------- Zustand: lädt ---------- */

  if (quelle === "laden") {
    return (
      <div className="wrap">
        {stil}
        {kopf}
        <section className="tafel">
          <p className="unterzeile" style={{ margin: 0 }}>
            Lade Daten …
          </p>
        </section>
      </div>
    );
  }

  /* ---------- Zustand: leer ---------- */

  if (quelle === "leer") {
    return (
      <div className="wrap">
        {stil}
        {kopf}

        <section className="tafel">
          <h2>Noch keine Schritte gemeldet</h2>
          <p className="unterzeile">
            Die Wertung startet, sobald der erste Tag in der Datenbank liegt. Danach erscheinen hier
            Tagesrennen, Rangliste und Tagessieger automatisch.
          </p>
          {freunde.length > 0 && (
            <div className="crew">
              {freunde.map((f) => (
                <div className="crewZeile" key={f.id}>
                  <Kuerzel person={f} groesse={32} />
                  <span>
                    <span className="crewName">
                      {f.name}
                      {ich?.id === f.id && <span className="laufDu">du</span>}
                    </span>
                    <span className={`crewStatus${f.verbunden ? " ok" : ""}`}>
                      {f.verbunden ? "Google Health verbunden" : "noch nicht verbunden"}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {ich ? (
          notnagel("Jetzt anfangen", "Trag deinen heutigen Stand ein – dann läuft die Wertung ab sofort.")
        ) : (
          <section className="tafel">
            <h2>Du bist noch kein Teilnehmer</h2>
            <p className="unterzeile" style={{ margin: 0 }}>
              Du kommst zwar auf die Seite, hast aber noch keine Zeile in der Teilnehmerliste. Sag Freddy
              Bescheid, dann trägt er dich ein.
            </p>
          </section>
        )}

        {ich && datenquelle}
        {spielregeln}
      </div>
    );
  }

  /* ---------- Zustand: live oder demo ---------- */

  return (
    <div className="wrap">
      {stil}
      {kopf}

      {quelle === "demo" && (
        <div className="banner">
          <span>
            <b>Demo-Ansicht.</b> Der Server ist nicht erreichbar, deshalb zeigt die Seite erfundene Zahlen.
            Niemand aus dieser Liste existiert wirklich.
          </span>
        </div>
      )}

      <section className="tafel">
        <h2>Tagesrennen</h2>
        <p className="unterzeile">Stand jetzt, Reihenfolge nach Schritten</p>
        {maxHeute === 0 ? (
          <p className="regeln">Heute hat noch niemand etwas gemeldet.</p>
        ) : (
          tagesRennen.map((p, i) => (
            <div className="lauf" key={p.id}>
              <div className="laufKopf">
                <span className="laufPlatz">{i + 1}</span>
                <span className="laufName">
                  {p.name}
                  {ich?.id === p.id && <span className="laufDu">du</span>}
                </span>
                <span className="laufWert">
                  {zahl(p.schritte)}
                  <span className="laufKm">{kmText(p.km)} km</span>
                </span>
              </div>
              <div className="bett">
                <div
                  className={`balken${i === 0 && p.schritte > 0 ? " fuehrend" : ""}`}
                  style={{ width: `${maxHeute ? (p.schritte / maxHeute) * 100 : 0}%` }}
                />
              </div>
            </div>
          ))
        )}
      </section>

      <section className="tafel">
        <div className="schalter">
          {[
            ["heute", "Heute"],
            ["woche", "Woche"],
            ["monat", "Monat"],
            ["gesamt", "Gesamt"],
          ].map(([k, l]) => (
            <button
              key={k}
              aria-pressed={zeitraum === k}
              onClick={() => {
                setZeitraum(k);
                setOffen(null);
              }}
            >
              {l}
            </button>
          ))}
        </div>

        <div className="sortZeile">
          <span>
            {zeitraumLabel} · {tabelle.anzahlTage} {tabelle.anzahlTage === 1 ? "Tag" : "Tage"}
          </span>
          <span>nach Schritten</span>
        </div>

        {liste.map((z, i) => (
          <React.Fragment key={z.id}>
            <button
              className={`rang${ich?.id === z.id ? " ichSelbst" : ""}`}
              onClick={() => setOffen(offen === z.id ? null : z.id)}
              aria-expanded={offen === z.id}
            >
              <span className={`rangNr${i === 0 ? " eins" : ""}`}>{i + 1}</span>
              <span className="rangText">
                <span className="rangName">
                  {z.name}
                  {ich?.id === z.id && <span className="laufDu">du</span>}
                </span>
                <span className="rangMeta">
                  {z.siege > 0 ? `${z.siege} Tagessieg${z.siege === 1 ? "" : "e"}` : "kein Tagessieg"} ·{" "}
                  Ø {zahl(z.schritte / Math.max(1, z.verlauf.length))}/Tag
                </span>
              </span>
              <span className="werte">
                <span className="wertHaupt">{zahl(z.schritte)}</span>
                <span className="wertNeben">{kmText(z.km)} km</span>
              </span>
            </button>
            {offen === z.id && (
              <div className="detail">
                <Sparkline werte={z.verlauf} farbe={z.farbe} />
                <span className="detailWert">
                  {kmText(z.km)} km · Ø {zahl(z.schritte / Math.max(1, z.verlauf.length))}/Tag
                </span>
              </div>
            )}
          </React.Fragment>
        ))}
      </section>

      <section className="tafel">
        <h2>Gemeinsame Strecke</h2>
        <p className="unterzeile">
          Alle Kilometer im {monatsname} zusammen: {zahl(routeKm)} km ab Dietzenbach
        </p>
        <div className="route">
          <div
            className="routeFuell"
            style={{ width: `${Math.min(100, (routeKm / ETAPPEN[ETAPPEN.length - 1].km) * 100)}%` }}
          />
          {ETAPPEN.map((e) => (
            <span
              key={e.ort}
              className={`routeMarke${routeKm >= e.km ? " erreicht" : ""}`}
              style={{ left: `${(e.km / ETAPPEN[ETAPPEN.length - 1].km) * 100}%` }}
              title={e.ort}
            />
          ))}
        </div>
        <div className="routeOrte">
          <span>Dietzenbach</span>
          <span>Bielefeld</span>
          <span>Kopenhagen</span>
        </div>
      </section>

      {chronik.length > 0 && (
        <section className="tafel">
          <h2>Tagessieger</h2>
          <p className="unterzeile">Die letzten zwölf Tage</p>
          <div className="chronik">
            {chronik.map(({ datum, sieger }) => (
              <div className="chronikTag" key={schluessel(datum)}>
                <div className="chronikPunkt" style={{ background: sieger.farbe }} title={sieger.name}>
                  {sieger.kurz}
                </div>
                <span className="chronikDatum">{datum.getDate()}.</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {auszeichnungen.length > 0 && (
        <section className="tafel">
          <h2>Auszeichnungen</h2>
          <p className="unterzeile">Über die gesamte Challenge</p>
          <div className="ehren">
            {auszeichnungen.map((a) => (
              <div className="ehre" key={a.titel}>
                <Kuerzel person={a.person} />
                <span className="ehreText">
                  <b>
                    {a.titel}: {a.person.name}
                  </b>
                  <span>{a.wert}</span>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {ich && datenquelle}
      {ich && notnagel("Notnagel", `Falls der Sync einmal ausfällt, für ${ich.name}`)}
      {spielregeln}
    </div>
  );
}
