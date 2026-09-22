import React, { useState, useMemo, useEffect } from "react";

/* ------------------------------------------------------------------
   Schritte-Challenge

   Holt die Daten von /api/daten – demselben Worker, der auch diese
   Seite ausliefert. Die Anmeldung erledigt Cloudflare Access davor,
   deshalb braucht das Frontend weder Schlüssel noch Login-Maske.

   Schlägt der Abruf fehl (etwa beim lokalen Entwickeln ohne Worker),
   läuft die App mit Demo-Daten weiter.
------------------------------------------------------------------- */

const TAGESCAP = 30000;
const SCHRITTE_PRO_KM = 1380;
const PUNKTE = [3, 2, 1];

const FREUNDE = [
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
const zahl = (n) => n.toLocaleString("de-DE");

function montagDieserWoche(d) {
  const m = new Date(d);
  const wt = (m.getDay() + 6) % 7;
  m.setDate(m.getDate() - wt);
  m.setHours(0, 0, 0, 0);
  return m;
}

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
    FREUNDE.forEach((f) => {
      let s = f.basis + (rnd() - 0.45) * f.streu * 2;
      if (wochenende) s *= 0.85 + rnd() * 0.7;
      if (rnd() > 0.94) s *= 1.6; // Wandertag
      if (rnd() > 0.97) s *= 0.35; // Krankheit / Schreibtischtag
      if (idx === tage.length - 1) s *= 0.62; // heute noch nicht vorbei
      s = Math.max(400, Math.min(TAGESCAP, Math.round(s / 10) * 10));
      eintraege[k][f.id] = { schritte: s, km: zuKm(s), quelle: f.quelle };
    });
  });
  return { tage, eintraege };
}

/* ---------- Echte Daten vom Worker ---------- */

async function echteDatenLaden() {
  const antwort = await fetch("/api/daten", { headers: { Accept: "application/json" } });
  if (!antwort.ok) throw new Error(`Laden fehlgeschlagen: ${antwort.status}`);

  const { ich, zeilen } = await antwort.json();
  if (!zeilen?.length) return { leer: true, ich };

  // Teilnehmer aus den Zeilen ableiten, Reihenfolge stabil halten
  const freunde = [];
  const gesehen = new Set();
  for (const z of zeilen) {
    if (gesehen.has(z.teilnehmer_id)) continue;
    gesehen.add(z.teilnehmer_id);
    freunde.push({
      id: z.teilnehmer_id,
      name: z.name,
      kurz: z.kurz,
      farbe: z.farbe,
      quelle: z.quelle === "google-health" ? "Google Health" : z.quelle,
    });
  }

  const eintraege = {};
  for (const z of zeilen) {
    (eintraege[z.datum] ??= {})[z.teilnehmer_id] = {
      schritte: z.schritte,
      km: Number(z.km ?? 0),
      quelle: z.quelle,
    };
  }

  // Lückenlose Tagesliste vom ersten Eintrag bis heute
  const erster = new Date(`${zeilen[0].datum}T00:00:00`);
  const heute = new Date();
  heute.setHours(0, 0, 0, 0);
  const tage = [];
  for (const d = new Date(erster); d <= heute; d.setDate(d.getDate() + 1)) {
    const k = schluessel(d);
    eintraege[k] ??= {};
    tage.push(new Date(d));
  }

  return { tage, eintraege, freunde, ich };
}

/* ---------- Auswertung ---------- */

function tagesPunkte(tagesEintrag) {
  const sortiert = Object.entries(tagesEintrag).sort((a, b) => b[1].schritte - a[1].schritte);
  const punkte = {};
  sortiert.forEach(([id], i) => (punkte[id] = PUNKTE[i] ?? 0));
  return { punkte, sieger: sortiert[0]?.[0] };
}

function zeitraumFilter(tage, zeitraum) {
  const heute = tage[tage.length - 1];
  if (zeitraum === "heute") return [heute];
  if (zeitraum === "woche") {
    const mo = montagDieserWoche(heute);
    return tage.filter((d) => d >= mo);
  }
  if (zeitraum === "monat") return tage.filter((d) => d.getMonth() === heute.getMonth());
  return tage;
}

function auswerten(tage, eintraege, zeitraum, freunde) {
  const relevant = zeitraumFilter(tage, zeitraum);
  const summe = {};
  freunde.forEach((f) => (summe[f.id] = { schritte: 0, km: 0, punkte: 0, siege: 0, verlauf: [] }));
  relevant.forEach((d) => {
    const tag = eintraege[schluessel(d)];
    if (!tag) return;
    const { punkte, sieger } = tagesPunkte(tag);
    freunde.forEach((f) => {
      const e = tag[f.id] ?? { schritte: 0, km: 0 };
      summe[f.id].schritte += e.schritte;
      summe[f.id].km += e.km;
      summe[f.id].punkte += punkte[f.id] ?? 0;
      summe[f.id].verlauf.push(e.schritte);
      if (sieger === f.id) summe[f.id].siege += 1;
    });
  });
  const zeilen = freunde.map((f) => ({
    ...f,
    ...summe[f.id],
    km: Math.round(summe[f.id].km * 10) / 10,
  }));
  const nachSchritten = [...zeilen].sort((a, b) => b.schritte - a.schritte);
  const nachPunkten = [...zeilen].sort((a, b) => b.punkte - a.punkte || b.schritte - a.schritte);
  nachSchritten.forEach((z, i) => (z.rangSchritte = i + 1));
  nachPunkten.forEach((z, i) => (z.rangPunkte = i + 1));
  return { zeilen, nachSchritten, nachPunkten, anzahlTage: relevant.length };
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

/* ---------- Hauptkomponente ---------- */

export default function SchritteChallenge() {
  const [demo] = useState(demoDatenErzeugen);
  const [tage, setTage] = useState(demo.tage);
  const [eintraege, setEintraege] = useState(demo.eintraege);
  const [freunde, setFreunde] = useState(FREUNDE);
  const [quelle, setQuelle] = useState("demo");
  const [ichProfil, setIchProfil] = useState(null);
  const [zeitraum, setZeitraum] = useState("woche");
  const [sortierung, setSortierung] = useState("punkte");
  const [nachtragen, setNachtragen] = useState(false);
  const [entwurf, setEntwurf] = useState("");
  const [offen, setOffen] = useState(null);

  useEffect(() => {
    let abgebrochen = false;
    echteDatenLaden()
      .then((daten) => {
        if (abgebrochen || !daten) return;
        setIchProfil(daten.ich ?? null);
        if (daten.leer) { setQuelle("leer"); return; }
        setTage(daten.tage);
        setEintraege(daten.eintraege);
        setFreunde(daten.freunde);
        setQuelle("live");
      })
      .catch(() => setQuelle("demo"));
    return () => { abgebrochen = true; };
  }, []);

  const heute = tage[tage.length - 1];
  const heuteKey = schluessel(heute);
  const ich = ichProfil ?? freunde[0];

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

  const chronik = useMemo(() => {
    return tage.slice(-12).map((d) => {
      const { sieger } = tagesPunkte(eintraege[schluessel(d)] ?? {});
      return { datum: d, sieger: freunde.find((f) => f.id === sieger) };
    }).filter((c) => c.sieger);
  }, [tage, eintraege, freunde]);

  const routeKm = useMemo(() => {
    const monat = auswerten(tage, eintraege, "monat", freunde);
    return Math.round(monat.zeilen.reduce((s, z) => s + z.km, 0));
  }, [tage, eintraege, freunde]);

  const auszeichnungen = useMemo(() => {
    const gesamt = auswerten(tage, eintraege, "gesamt", freunde);
    const meisteSiege = [...gesamt.zeilen].sort((a, b) => b.siege - a.siege)[0];
    const konstant = [...gesamt.zeilen].sort((a, b) => {
      const abw = (z) => {
        const m = z.schritte / z.verlauf.length;
        return Math.sqrt(z.verlauf.reduce((s, v) => s + (v - m) ** 2, 0) / z.verlauf.length);
      };
      return abw(a) - abw(b);
    })[0];
    const serie = [...gesamt.zeilen]
      .map((z) => {
        let best = 0, akt = 0;
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

  const liste = sortierung === "punkte" ? tabelle.nachPunkten : tabelle.nachSchritten;
  const maxHeute = tagesRennen[0]?.schritte || 1;

  const jetzt = new Date();
  const restStunden = 23 - jetzt.getHours();
  const restMinuten = 59 - jetzt.getMinutes();

  const eintragen = async () => {
    const wert = parseInt(entwurf.replace(/\D/g, ""), 10);
    if (!wert) return;
    const gekappt = Math.min(wert, TAGESCAP);

    // Erst lokal anzeigen, damit die Eingabe sofort quittiert wird
    setEintraege((alt) => ({
      ...alt,
      [heuteKey]: { ...alt[heuteKey], [ich.id]: { schritte: gekappt, km: zuKm(gekappt), quelle: "manuell" } },
    }));
    setEntwurf("");
    setNachtragen(false);

    if (quelle === "demo") return; // ohne Worker nur lokal
    try {
      await fetch("/api/nachtragen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ datum: heuteKey, schritte: gekappt }),
      });
    } catch {
      /* beim nächsten Laden wird ohnehin der Serverstand gezogen */
    }
  };

  const zeitraumLabel = { heute: "Heute", woche: "Diese Woche", monat: "September", gesamt: "Gesamt" }[zeitraum];

  return (
    <div className="wrap">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600&family=Barlow+Condensed:wght@500;600;700&display=swap');

        .wrap {
          --platz:#0F1319; --tafel:#171D26; --erhoben:#1E2632; --linie:#2A3441;
          --flut:#FFC14D; --bahn:#5FD3C4;
          --text:#E8EDF2; --gedimmt:#8A97A6; --leise:#5C6875;
          background:var(--platz); color:var(--text);
          font-family:'Barlow',system-ui,sans-serif;
          font-feature-settings:'tnum' 1;
          min-height:100%; padding:20px 16px 56px;
          max-width:540px; margin:0 auto;
          -webkit-font-smoothing:antialiased;
        }
        .wrap *, .wrap *::before, .wrap *::after { box-sizing:border-box; }
        .wrap h1,.wrap h2,.wrap h3 { font-family:'Barlow Condensed',sans-serif; margin:0; font-weight:600; letter-spacing:.01em; }
        .num { font-family:'Barlow Condensed',sans-serif; font-weight:700; letter-spacing:-.01em; }

        .kopf { display:flex; align-items:flex-end; justify-content:space-between; gap:12px; margin-bottom:22px; }
        .kopf h1 { font-size:30px; line-height:1; }
        .kopf p { margin:5px 0 0; color:var(--gedimmt); font-size:13.5px; }
        .frist { text-align:right; color:var(--leise); font-size:12px; line-height:1.45; }
        .frist b { display:block; color:var(--flut); font-family:'Barlow Condensed',sans-serif; font-size:19px; font-weight:600; }

        .tafel { background:var(--tafel); border:1px solid var(--linie); border-radius:10px; padding:16px; margin-bottom:16px; }
        .tafel > h2 { font-size:19px; margin-bottom:2px; }
        .unterzeile { color:var(--leise); font-size:12.5px; margin:0 0 14px; }

        .bahnZeile { display:grid; grid-template-columns:26px 1fr auto; gap:10px; align-items:center; margin-bottom:9px; }
        .bahnZeile:last-child { margin-bottom:0; }
        .platz { font-family:'Barlow Condensed',sans-serif; font-size:15px; color:var(--leise); text-align:center; font-weight:600; }
        .balkenBett { position:relative; height:26px; background:#131924; border-radius:4px; overflow:hidden; }
        .balken { position:absolute; inset:0 auto 0 0; background:#33404F; border-radius:4px; transition:width .5s cubic-bezier(.22,.8,.3,1); }
        .balken.fuehrend { background:linear-gradient(90deg,#C98A24,var(--flut)); }
        .balkenName { position:absolute; left:9px; top:0; height:100%; display:flex; align-items:center; font-size:13.5px; font-weight:500; color:var(--text); }
        .fuehrend + .balkenName { color:#1A1204; font-weight:600; }
        .bahnWert { font-family:'Barlow Condensed',sans-serif; font-weight:700; font-size:17px; min-width:52px; text-align:right; }
        .bahnKm { display:block; font-family:'Barlow',sans-serif; font-weight:400; font-size:11px; color:var(--leise); }

        .schalter { display:flex; gap:6px; margin-bottom:14px; }
        .schalter button { flex:1; background:transparent; border:1px solid var(--linie); color:var(--gedimmt);
          font-family:'Barlow Condensed',sans-serif; font-size:15px; font-weight:600; padding:8px 4px; border-radius:7px; cursor:pointer; }
        .schalter button[aria-pressed="true"] { background:var(--erhoben); color:var(--text); border-color:#3B4757; }

        .sortZeile { display:flex; align-items:center; justify-content:space-between; margin:0 0 12px; }
        .sortZeile span { font-size:12.5px; color:var(--leise); }
        .sortWahl { display:flex; gap:4px; }
        .sortWahl button { background:transparent; border:none; color:var(--leise); font-size:12.5px; font-family:'Barlow',sans-serif;
          padding:4px 8px; border-radius:5px; cursor:pointer; }
        .sortWahl button[aria-pressed="true"] { background:var(--erhoben); color:var(--flut); }

        .rang { width:100%; text-align:left; background:transparent; border:none; border-top:1px solid var(--linie);
          padding:11px 2px; display:grid; grid-template-columns:24px 1fr auto auto; gap:10px; align-items:center; cursor:pointer; color:inherit; }
        .rang:first-of-type { border-top:none; }
        .rangNr { font-family:'Barlow Condensed',sans-serif; font-size:20px; font-weight:700; color:var(--leise); }
        .rangNr.eins { color:var(--flut); }
        .rangName { font-size:14.5px; font-weight:500; }
        .quelle { font-size:11px; color:var(--leise); }
        .metrik { text-align:right; min-width:64px; }
        .metrik .w { font-family:'Barlow Condensed',sans-serif; font-size:17px; font-weight:700; display:block; line-height:1.15; }
        .metrik .l { font-size:10.5px; color:var(--leise); }
        .metrik.aktiv .w { color:var(--flut); }
        .detail { border-top:1px solid var(--linie); padding:12px 2px 4px; display:flex; align-items:center; gap:14px; }
        .spark { width:100%; height:30px; flex:1; }
        .detailWert { font-size:12px; color:var(--gedimmt); white-space:nowrap; }

        .route { position:relative; height:4px; background:#131924; border-radius:2px; margin:20px 0 10px; }
        .routeFuell { position:absolute; inset:0 auto 0 0; background:var(--bahn); border-radius:2px; }
        .routeMarke { position:absolute; top:-4px; width:12px; height:12px; border-radius:50%; background:var(--platz); border:2px solid var(--linie); transform:translateX(-50%); }
        .routeMarke.erreicht { border-color:var(--bahn); background:var(--bahn); }
        .routeOrte { display:flex; justify-content:space-between; font-size:10.5px; color:var(--leise); }

        .chronik { display:flex; gap:5px; }
        .chronikTag { flex:1; text-align:center; }
        .chronikPunkt { width:100%; aspect-ratio:1; border-radius:5px; display:flex; align-items:center; justify-content:center;
          font-family:'Barlow Condensed',sans-serif; font-size:11px; font-weight:700; color:#0F1319; }
        .chronikDatum { font-size:9.5px; color:var(--leise); margin-top:4px; display:block; }

        .ehren { display:flex; flex-direction:column; gap:10px; }
        .ehre { display:flex; align-items:center; gap:11px; }
        .ehreKreis { width:34px; height:34px; border-radius:50%; display:flex; align-items:center; justify-content:center;
          font-family:'Barlow Condensed',sans-serif; font-weight:700; font-size:13px; color:#0F1319; flex-shrink:0; }
        .ehreText b { display:block; font-size:13.5px; font-weight:500; }
        .ehreText span { font-size:11.5px; color:var(--leise); }

        .aktion { width:100%; background:var(--flut); color:#1A1204; border:none; border-radius:8px;
          font-family:'Barlow Condensed',sans-serif; font-size:16px; font-weight:700; padding:12px; cursor:pointer; }
        .feldZeile { display:flex; gap:8px; }
        .feldZeile input { flex:1; background:#131924; border:1px solid var(--linie); border-radius:8px; color:var(--text);
          font-family:'Barlow Condensed',sans-serif; font-size:20px; font-weight:700; padding:10px 12px; min-width:0; }
        .feldZeile button { padding:0 18px; }
        .hinweis { font-size:11.5px; color:var(--leise); margin:10px 0 0; line-height:1.5; }
        .regeln { font-size:11.5px; color:var(--leise); line-height:1.7; margin:0; }

        .wrap :focus-visible { outline:2px solid var(--flut); outline-offset:2px; border-radius:4px; }
        @media (prefers-reduced-motion:reduce) { .wrap * { transition:none !important; } }
      `}</style>

      <header className="kopf">
        <div>
          <h1>Schritte-Challenge</h1>
          <p>
            {heute.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" })} ·{" "}
            {freunde.length} Teilnehmer
          </p>
        </div>
        <div className="frist">
          Wertung schließt in
          <b>
            {restStunden}:{String(restMinuten).padStart(2, "0")} h
          </b>
        </div>
      </header>

      <section className="tafel">
        <h2>Tagesrennen</h2>
        <p className="unterzeile">Stand jetzt, Reihenfolge nach Schritten</p>
        {tagesRennen.map((p, i) => (
          <div className="bahnZeile" key={p.id}>
            <span className="platz">{i + 1}</span>
            <div className="balkenBett">
              <div
                className={`balken${i === 0 ? " fuehrend" : ""}`}
                style={{ width: `${Math.max(18, (p.schritte / maxHeute) * 100)}%` }}
              />
              <span className="balkenName">{p.name}</span>
            </div>
            <div className="bahnWert">
              {zahl(p.schritte)}
              <span className="bahnKm">{p.km.toLocaleString("de-DE")} km</span>
            </div>
          </div>
        ))}
      </section>

      <section className="tafel">
        <div className="schalter">
          {[
            ["heute", "Heute"],
            ["woche", "Woche"],
            ["monat", "Monat"],
            ["gesamt", "Gesamt"],
          ].map(([k, l]) => (
            <button key={k} aria-pressed={zeitraum === k} onClick={() => { setZeitraum(k); setOffen(null); }}>
              {l}
            </button>
          ))}
        </div>

        <div className="sortZeile">
          <span>
            {zeitraumLabel} · {tabelle.anzahlTage} {tabelle.anzahlTage === 1 ? "Tag" : "Tage"}
          </span>
          <div className="sortWahl">
            <button aria-pressed={sortierung === "punkte"} onClick={() => setSortierung("punkte")}>
              nach Punkten
            </button>
            <button aria-pressed={sortierung === "schritte"} onClick={() => setSortierung("schritte")}>
              nach Summe
            </button>
          </div>
        </div>

        {liste.map((z, i) => (
          <React.Fragment key={z.id}>
            <button className="rang" onClick={() => setOffen(offen === z.id ? null : z.id)} aria-expanded={offen === z.id}>
              <span className={`rangNr${i === 0 ? " eins" : ""}`}>{i + 1}</span>
              <span>
                <span className="rangName">{z.name}</span>
                <br />
                <span className="quelle">
                  {z.quelle} · {z.siege} Tagessiege
                </span>
              </span>
              <span className={`metrik${sortierung === "schritte" ? " aktiv" : ""}`}>
                <span className="w">{zahl(z.schritte)}</span>
                <span className="l">Schritte · Platz {z.rangSchritte}</span>
              </span>
              <span className={`metrik${sortierung === "punkte" ? " aktiv" : ""}`}>
                <span className="w">{z.punkte}</span>
                <span className="l">Punkte · Platz {z.rangPunkte}</span>
              </span>
            </button>
            {offen === z.id && (
              <div className="detail">
                <Sparkline werte={z.verlauf} farbe={z.farbe} />
                <span className="detailWert">
                  {z.km.toLocaleString("de-DE")} km · Ø {zahl(Math.round(z.schritte / z.verlauf.length))}/Tag
                </span>
              </div>
            )}
          </React.Fragment>
        ))}
      </section>

      <section className="tafel">
        <h2>Gemeinsame Strecke</h2>
        <p className="unterzeile">
          Alle Kilometer im September zusammen: {zahl(routeKm)} km ab Dietzenbach
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

      <section className="tafel">
        <h2>Auszeichnungen</h2>
        <p className="unterzeile">Über die gesamte Challenge</p>
        <div className="ehren">
          {auszeichnungen.map((a) => (
            <div className="ehre" key={a.titel}>
              <span className="ehreKreis" style={{ background: a.person.farbe }}>
                {a.person.kurz}
              </span>
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

      <section className="tafel">
        <h2>Datenquelle</h2>
        <p className="unterzeile">
          {ichProfil?.verbunden
            ? "Google Health, synchronisiert um 23:50 und 06:10 Uhr"
            : quelle === "demo"
            ? "Demo-Daten – kein Worker erreichbar"
            : "Dein Konto ist noch nicht verbunden"}
        </p>
        {ichProfil?.verbunden ? (
          <p className="regeln">
            Schritte und Kilometer kommen automatisch aus der Google Health API.
            Nichts einzutragen.
            {ichProfil.syncFehler && (
              <>
                <br />
                <span style={{ color: "#F2849E" }}>Letzter Sync mit Fehler: {ichProfil.syncFehler}</span>
              </>
            )}
          </p>
        ) : (
          <a
            className="aktion"
            style={{ display: "block", textAlign: "center", textDecoration: "none" }}
            href="/auth/start"
          >
            Google Health verbinden
          </a>
        )}
      </section>

      <section className="tafel">
        <h2>Notnagel</h2>
        <p className="unterzeile">Falls der Sync einmal ausfällt, für {ich.name}</p>
        {nachtragen ? (
          <>
            <div className="feldZeile">
              <input
                type="text"
                inputMode="numeric"
                value={entwurf}
                onChange={(e) => setEntwurf(e.target.value)}
                placeholder="Schritte"
                aria-label="Schritte heute"
              />
              <button className="aktion" onClick={eintragen} style={{ width: "auto" }}>
                Speichern
              </button>
            </div>
            <p className="hinweis">
              Kilometer werden automatisch aus den Schritten berechnet. Werte über {zahl(TAGESCAP)} werden gekappt.
            </p>
          </>
        ) : (
          <button className="aktion" onClick={() => setNachtragen(true)}>
            Wert eintragen
          </button>
        )}
      </section>

      <section className="tafel">
        <h2>Spielregeln</h2>
        <p className="unterzeile">Vorab festgelegt, gilt für alle</p>
        <p className="regeln">
          Der Tag endet um 23:59 Uhr deutscher Zeit.<br />
          Tagessieg bringt 3 Punkte, Platz 2 zwei, Platz 3 einen.<br />
          Maximal {zahl(TAGESCAP)} Schritte pro Tag zählen.<br />
          Nachtragen ist 48 Stunden rückwirkend möglich.<br />
          Die Woche beginnt am Montag.
        </p>
      </section>
    </div>
  );
}
