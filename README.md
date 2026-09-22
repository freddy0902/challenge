# Schritte-Challenge

Schritte-Wettbewerb für eine Freundesrunde. Tages-, Wochen- und Monatswertung nach der Summe der Schritte.

Die Daten kommen automatisch aus der Google Health API. Der Zugang läuft über eine Einladungsliste, es gibt keine öffentliche Seite.

## Aufbau

Ein einziger Cloudflare Worker macht alles. Frontend und API liegen deshalb auf demselben Hostnamen, was eine einzige Access-Anwendung ausreichen lässt.

| Teil | Aufgabe |
|---|---|
| Cloudflare Access | Einladungsliste, Login per Einmal-PIN |
| Worker, statische Assets | liefert das gebaute Frontend aus |
| Worker /api/daten | Rangliste, prüft das Access-Token |
| Worker /api/nachtragen | Notnagel, 48 Stunden rückwirkend |
| Worker /auth/* | Google-OAuth-Flow |
| Worker Cron | 23:50 und 06:10, mehrere Tage rückwirkend |
| D1 | teilnehmer, eintraege |
| Cloudflare Workers Builds | baut und deployt bei jedem Push auf main |

Die E-Mail aus dem Access-Token ist das Bindeglied zur Tabelle teilnehmer.

## Einrichtung

Siehe EINRICHTUNG.md.

## Spielregeln

Gewertet wird die Summe der Schritte.

Der Tag endet um 23:59 Uhr deutscher Zeit.

Die Woche beginnt am Montag.

Nachtragen ist 48 Stunden rückwirkend möglich.

Plausibilitätsprüfung und Nachtragefrist laufen im Worker, nicht im Frontend.
