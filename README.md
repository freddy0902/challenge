# Schritte-Challenge

Schritte-Wettbewerb für eine Freundesrunde. Tages-, Wochen- und Monatswertung,
gleichzeitig nach Gesamtschritten und nach Punkten (Tagessieg 3, Platz 2 zwei,
Platz 3 einen).

Die Daten kommen automatisch aus der **Google Health API** – der App, die auf
iPhone und Android Schritte allein über die Handysensoren zählt. Der Zugang
läuft über eine Einladungsliste, es gibt keine öffentliche Seite.

## Aufbau

Ein einziger Cloudflare Worker macht alles. Frontend und API liegen deshalb auf
demselben Hostnamen, was eine einzige Access-Anwendung ausreichen lässt.

| Teil | Aufgabe |
|---|---|
| Cloudflare Access | Einladungsliste, Login per Einmal-PIN, kein Auth-Code |
| Worker, statische Assets | liefert das gebaute Frontend aus |
| Worker `/api/daten` | Rangliste, prüft das Access-Token |
| Worker `/api/nachtragen` | Notnagel, 48 Stunden rückwirkend |
| Worker `/auth/*` | Google-OAuth-Flow |
| Worker Cron | 23:50 und 06:10, mehrere Tage rückwirkend |
| D1 | `teilnehmer`, `eintraege` |
| GitHub Actions | baut und deployt bei jedem Push auf `main` |

Die E-Mail aus dem Access-Token ist das Bindeglied zur Tabelle `teilnehmer`.

## Einrichtung

Siehe [EINRICHTUNG.md](EINRICHTUNG.md).

## Spielregeln

- Der Tag endet um 23:59 Uhr deutscher Zeit
- Maximal 30.000 Schritte pro Tag zählen
- Die Woche beginnt am Montag
- Nachtragen 48 Stunden rückwirkend

Cap, Plausibilitätsprüfung und Nachtragefrist laufen im Worker, nicht im
Frontend.
