# Schritte-Challenge – Einrichtung

Ein einziger Cloudflare Worker liefert das Frontend aus, bedient die API und
fährt den nächtlichen Sync. Davor sitzt Cloudflare Access als Einladungsliste.
Die Daten liegen in D1. GitHub bleibt Quellcodeverwaltung und Deploy-Auslöser.

Reihenfolge einhalten: Access braucht den Worker, der Worker braucht die
Datenbank, und Google braucht die fertige Adresse.

---

## 1. Datenbank

```bash
npm install
npx wrangler login

npx wrangler d1 create schritte
# Die ausgegebene database_id in wrangler.toml eintragen

npx wrangler d1 execute schritte --remote --file=schema.sql
```

## 2. Worker zum ersten Mal deployen

```bash
npm run deploy
```

Die Ausgabe nennt die Adresse, etwa
`https://schritte-challenge.<dein-subdomain>.workers.dev`. Die brauchst du gleich.

## 3. Cloudflare Access einrichten

Im Dashboard unter **Zero Trust → Access → Applications**:

1. **Add an application → Self-hosted**
2. Als Domain die Worker-Adresse aus Schritt 2 eintragen
3. Policy anlegen:
   - Action: **Allow**
   - Include: **Emails** → die Adressen deiner Freunde einzeln eintragen
4. Unter **Authentication** die Methode **One-time PIN** aktivieren.
   Damit bekommt jeder einen sechsstelligen Code per Mail – kein Google-Konto,
   kein Passwort, nichts einzurichten.
5. Die **Application Audience (AUD) Tag** kopieren.

Dann in `wrangler.toml` eintragen:

```toml
[vars]
ACCESS_TEAM = "deinteam"        # aus https://deinteam.cloudflareaccess.com
ACCESS_AUD  = "<der kopierte AUD-Tag>"
```

Der kostenlose Tarif deckt bis zu 50 Nutzer dauerhaft ab.

### Warum der Worker das Token trotzdem prüft

Access blockt unerlaubte Anfragen schon vorher. Der Worker prüft das
`Cf-Access-Jwt-Assertion`-Token zusätzlich – als zweite Verteidigungslinie und
weil er die E-Mail ohnehin braucht, um zu wissen, wer gerade da ist.

## 4. Google Cloud

1. Neues Projekt, **APIs & Dienste → Bibliothek** → „Google Health API" aktivieren.
2. **OAuth-Zustimmungsbildschirm**, Audience **Extern**. Als Website die
   Worker-Adresse eintragen.
3. Unter **Datenzugriff** genau diesen Scope:
   `https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly`
4. **Anmeldedaten → OAuth-Client-ID → Webanwendung**, Weiterleitungs-URI:
   `https://<worker-adresse>/auth/callback`

### Die eine echte Hürde

Solange der Zustimmungsbildschirm im Status **Testing** steht, verfallen
Googles Refresh-Tokens nach sieben Tagen. Für eine Challenge über Monate
unbrauchbar. Ihr müsst die OAuth-App veröffentlichen, und weil
Gesundheitsdaten als sensibel gelten, hängt daran eine Google-Überprüfung.
Plant Vorlauf ein.

Bis dahin funktioniert der Notnagel im Frontend: eigener Tageswert von Hand,
48 Stunden rückwirkend, landet mit `quelle = 'manuell'` in derselben Tabelle.

## 5. Geheimnisse setzen

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put GOOGLE_REDIRECT_URI   # https://<worker-adresse>/auth/callback
npx wrangler secret put STATE_SECRET          # openssl rand -hex 32
```

Dann erneut `npm run deploy`.

## 6. Teilnehmer anlegen

Die E-Mail muss **exakt** der entsprechen, die in der Access-Richtlinie steht –
darüber erkennt der Worker, wer gerade eingeloggt ist.

```bash
npx wrangler d1 execute schritte --remote --command \
  "insert into teilnehmer (id,email,name,kurz,farbe) values
   (lower(hex(randomblob(16))),'freddy@example.com','Freddy','FR','#FFC14D'),
   (lower(hex(randomblob(16))),'jonas@example.com','Jonas','JO','#5FD3C4');"
```

Wer in Access eingeladen ist, aber hier keine Zeile hat, kommt zwar auf die
Seite, taucht aber in keiner Wertung auf.

## 7. Verbinden

Jeder öffnet die Worker-Adresse, bekommt seinen PIN per Mail und tippt einmal
auf **Google Health verbinden**. Danach nichts mehr von Hand.

## 8. Deploy über GitHub

In **Settings → Secrets and variables → Actions** anlegen:

- `CLOUDFLARE_API_TOKEN` – Token mit der Vorlage *Edit Cloudflare Workers*
- `CLOUDFLARE_ACCOUNT_ID`

Danach deployt jeder Push auf `main` automatisch.

---

## Test

```bash
# Sync von Hand anstoßen (läuft sonst per Cron)
npx wrangler dev --test-scheduled
curl "http://localhost:8787/__scheduled?cron=10+4+*+*+*"

# Was der Worker in Produktion tut, live mitlesen
npx wrangler tail
```

Fehler pro Person stehen zusätzlich in `teilnehmer.sync_fehler` und werden im
Frontend angezeigt.

## Lokal entwickeln

```bash
npm run dev
```

Ohne Worker im Rücken schlägt `/api/daten` fehl und die App fällt auf
Demo-Daten zurück – praktisch zum Gestalten.

## Aufs iPhone

Worker-Adresse in Safari öffnen → Teilen → **Zum Home-Bildschirm**. Manifest
und Apple-Meta-Tags sind gesetzt, die App startet dann ohne Browserleiste.
Die Access-Sitzung hält, ihr müsst euch nicht ständig neu anmelden.

## Offener Punkt

Bei `steps` ist `countSum` als Summenfeld dokumentiert. Für `distance` steht
der Feldname in der Referenz nicht eindeutig fest, deshalb liest
`worker/sync.js` dort defensiv den ersten numerischen Wert aus dem
Rollup-Objekt und fällt sonst auf die Umrechnung aus den Schritten zurück.
Nach dem ersten Lauf einmal im API Explorer gegenprüfen und festnageln.
