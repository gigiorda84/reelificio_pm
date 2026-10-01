# Reellificio Brain — piano di sviluppo

Stato al 2026-10-01. Il concept è in `docs/brain-concept.md`; questo file registra le decisioni prese, l'architettura, le fasi e i costi. Aggiornalo quando una decisione cambia o una fase si chiude.

## Decisioni (2026-10-01)

- **Il Brain si costruisce evolvendo questa app** (Reelificio PM). Il "prototipo React" del concept è questa app: niente nuovo repo.
- **Priorità:** Produzione a 50 pagine, preceduta da una Fase 0 di messa in sicurezza.
- **Scala:** 2 pagine al mese 1 → 20 al mese 12 → 50 al mese 24; ~25 reel pubblicati per pagina al mese; ~10 utenti interni con account. Doppiatori, montatori e altri esterni entrano dal portale con link personale, senza account.
- **Approvazioni:** un approvatore per **gruppo di pagine** (dal RACI). Gabri approva Express, pagine sensibili e casi escalati; delegato di riserva quando è assente. Con 50 pagine un solo approvatore avrebbe ~80 approvazioni al giorno.
- **Motori AI:** OpenRouter per il selettore multi-motore dello Script Lab, inclusi i modelli cinesi. Claude diretto (Anthropic API) per i lavori in blocco con Batch API (analisi trascrizioni, commenti, report). Ai modelli cinesi si manda solo materiale creativo, mai dati personali; provider EU dove esistono e `data_collection: deny` a livello di account.
- **Sviluppo:** un solo sviluppatore con Claude. Le fasi vanno in sequenza; dove esiste un servizio pronto lo si compra invece di costruirlo (pubblicazione, scraping, trascrizione).
- **Scraping:** il motore esistente è un servizio esterno; si integra via API/webhook in Fase 2.
- **Calendario di pubblicazione nell'app** (unica fonte di verità); fase iniziale tramite tool di scheduling (Metricool), API dirette dopo le approvazioni Meta/TikTok/YouTube. Notion non è più il calendario.
- **Engine che suggerisce personaggi:** dopo Intelligence e Analytics, perché vive dei loro dati.

## Vincoli esterni

- **Vercel Hobby** consente un cron al giorno ed è solo per uso non commerciale → Vercel Pro (Fase 0).
- **Google Workspace Starter:** i Drive condivisi ci sono, ma 30 GB per utente in pool. Passare a Business Standard (2 TB per utente) intorno a 5–10 pagine. A 50 pagine si accumulano ~3,5 TB/anno di audio e video.
- **Verifica Meta Business da fare:** blocca app review, pubblicazione via API, commenti propri gratis e insights. Fino ad allora: Metricool per pubblicare, scraping per i commenti propri, niente Analytics via API.
- **TikTok:** senza audit dell'app i post via API restano privati. **YouTube:** upload privati fino all'audit.
- **Licenza news** (ANSA o aggregatore) e **avvocato** per GLI UMANI prima della Fase 4.

## Valutazione dell'app esistente (2026-10-01)

Riusabile: auth magic link, pagine (→ workspace), Voice Brief (→ bibbia), import batch da Google Doc, scheda reel con commenti e @menzioni, RACI, avanzamento fase con approvazione, DoD, alert buffer/stuck, notifiche Telegram/email con matrice, inviti magic-link per esterni (→ portale), daily update e digest.

Problemi da risolvere prima di scalare:

- **Sicurezza:** `profiles_update_self` permette a chiunque di impostarsi `is_admin`; il login crea account per qualunque email; `reels` scrivibile da ogni utente autenticato; un approvatore RACI non admin non riesce ad aggiornare la richiesta (resta `pending` mentre il reel avanza); `setReelPhase` chiamabile senza controlli.
- **Scala:** i reel pubblicati restano in `publication` per sempre; liste non paginate (kanban, dashboard, alert, batch) oltre il limite di 1.000 righe di Supabase già nel primo mese a regime; il buffer conta anche i reel già postati; nessun indice su `reels.page_id`; filtri `.in()` con migliaia di id; cron sequenziali senza `maxDuration` e senza retry.
- **Ambiente:** `.env.local` punta alla produzione; niente staging, Sentry, test automatici.
- **Modello dati:** personaggi cablati (enum `porcino_mono`/`papaya_mono` e parser); pipeline a 6 fasi lineari contro le 8 del concept con rami paralleli; ruoli solo `is_admin` (`page_members` e `user_role` mai usati); semaforo sempre verde; Drive in sola lettura; Telegram solo invio, niente pulsanti.

## Architettura

| Livello | Scelta |
|---|---|
| App + DB | Questo repo; Supabase Pro (EU) con pgvector |
| Hosting | Vercel Pro, `fra1` |
| Job | Inngest: cron frequenti, retry, fan-out per pagina, step durevoli |
| Worker media | Un container EU (Railway o Fly) con ffmpeg/ffprobe/Rhubarb: pulizia audio, controllo video, SRT, lip sync |
| AI | Un livello unico (AI SDK) verso OpenRouter e Anthropic; tabella `ai_runs` con costi per motore, pagina e reel |
| File | Upload riprendibile su Supabase Storage → archivio su Drive condiviso (l'account di servizio non ha spazio proprio) |
| Notifiche | Bot Telegram con pulsanti inline e topic per pagina; email per digest |
| Pubblicazione | Calendario nell'app → Metricool (API) → API dirette dopo le approvazioni |
| Osservabilità | Sentry |

Modello dati, cambi principali:

- **Personaggi:** entità per pagina (scheda, stato concept → prova → cast → archiviato, doppiatore titolare e riserva, kit Drive, canone); reel ↔ personaggi molti-a-molti. Sostituisce l'enum di format cablato.
- **Pipeline:** stato generale del reel (gli 8 del concept) più **task** (doppiaggio, animazione, montaggio, approvazioni) con owner, scadenza e SLA per binario Batch/Express. I task alimentano semaforo, escalation, carico e compensi.
- **Collaboratori esterni:** entità propria con link personale permanente al portale e chat Telegram; evolve gli inviti per singolo reel.
- **Ruoli:** ruolo globale per utente + approvatori per gruppo di pagine; RLS basata su ruolo e RACI.
- **Script:** versioni (motore, costo, modifiche umane), idee, news brief. **Intelligence:** reel esterni, commenti pseudonimizzati, pattern ed embedding. **Analytics:** post pubblicati e snapshot delle metriche.

## Fasi (un solo sviluppatore, partenza 5 ottobre 2026; durate da validare dopo la Fase 0)

| Fase | Settimane | Pronta circa | Contenuto |
|---|---|---|---|
| 0. Messa in sicurezza | 1–2 | metà ottobre | Vedi checklist sotto |
| 1. Produzione 2.0 | 3–8 | fine novembre | Pipeline a 8 stati con task paralleli, binari Batch/Express, approvatori per gruppo, viste per ruolo, personaggi base con assegnazione automatica, bot Telegram con pulsanti, portale collaboratori, kit su Drive, stand-up ed escalation |
| 2. Script Lab + Character Lab | 9–14 | metà gennaio | Bibbia, script multi-motore, editor con versioni, controlli automatici, schede e prove grafiche dei personaggi, integrazione scraping, analisi trascrizioni, libreria pattern |
| 3. Automazioni media | 15–18 | metà febbraio | Registratore per doppiatori, controllo AI dell'audio, SRT, controllo video, revisione su timecode |
| 4. Attualità + Express | 19–24 | fine marzo | News, brief, fact-check, binario 24h, checklist bloccante, pubblicazione |
| 5. Analytics | 25–28 | fine aprile | Insights, report settimanali, previsione che impara, memoria personaggi; poi engine dei personaggi |

GLI UMANI: con questa sequenza l'Express arriva a fine marzo. Se la pagina parte prima, lavora sul binario Batch dalla Fase 1 con news gestite a mano.

### Checklist Fase 0

Codice sul branch `fase-0-hardening`, migrazioni `20261001120000_fase0_security.sql` e `20261001130000_fase0_scale.sql`, verificate con `scripts/db-check/run.sh`. **Non ancora applicate in produzione.**

- [x] Sicurezza: nessun utente può modificare `is_admin` o il collegamento Telegram del proprio profilo (permessi per colonna + funzioni `claim_admin_if_first`, `unlink_telegram`)
- [x] Sicurezza: login solo per utenti invitati (`shouldCreateUser: false`, `enable_signup = false` in locale)
- [ ] Sicurezza: disattivare "Allow new users to sign up" nel progetto Supabase ospitato (dashboard)
- [x] Sicurezza: reel inseribili/eliminabili solo da admin; modificabili da admin e membri R/A/C della pagina, solo nelle colonne di contenuto; le azioni segnalano `not_authorized`; `setReelPhase` rimosso
- [x] Bug: approvazione tramite `decide_phase_advance()` (atomica, approvatore RACI anche non admin, DoD ricontrollata, richieste superate rifiutate)
- [ ] Ambiente: progetto Supabase di staging; `.env.local` non punta più alla produzione
- [x] Scala: `published_at` (i reel pubblicati escono da kanban, dashboard, buffer e alert), indici, conteggi in SQL (`active_reel_counts`, `batch_reel_counts`, `stuck_reels`), kanban a 100 card per colonna con totale, lista batch limitata a 200, niente `.in()` con id illimitati
- [x] Job: `maxDuration = 60` su tutti i cron
- [ ] Infra: Vercel Pro, Supabase Pro, Inngest per i cron frequenti
- [ ] Osservabilità: Sentry

## Costi mensili stimati (IVA esclusa, persone escluse)

Prezzi di listino al 2026-10-01, cambio ipotizzato 1 $ = 0,86 €. Scenario base: 1 motore per gli script, 300 reel e 5.000 commenti competitor per pagina al mese. Scenario pieno: 3 motori, 500 reel e 9.000 commenti.

| € al mese (base) | 2 pagine | 10 | 20 | 35 | 50 |
|---|---|---|---|---|---|
| Piattaforma (Vercel, Supabase, Inngest, worker, Sentry, email) | 104 | 189 | 211 | 284 | 284 |
| Pubblicazione (Metricool) | 69 | 69 | 69 | 130 | 130 |
| AI script | 19 | 97 | 190 | 333 | 476 |
| AI analisi (reel esterni, commenti, report, news) | 46 | 75 | 136 | 190 | 244 |
| Scraping (Apify) | 37 | 171 | 188 | 329 | 470 |
| Trascrizioni + immagini | 16 | 23 | 35 | 58 | 76 |
| **Totale base** | **~290** | **~625** | **~830** | **~1.320** | **~1.680** |
| Totale scenario pieno | ~340 | ~780 | ~1.280 | ~2.120 | ~2.810 |

Totali: 7–10 mila € il primo anno, 16–26 mila € il secondo. Leve: limitare lo scraping dei commenti competitor ai post con outlier alto e condividere i competitor tra pagine; scendere a 1–2 motori dopo aver scelto il migliore per pagina (un motore cinese costa ~1/3 di Sonnet); eliminare Metricool quando si pubblica via API. Esclusi: licenza news, avvocato, upgrade Workspace (13,60 €/utente/mese), kit doppiatori (~150 € l'uno una tantum), PITR Supabase (~100 $/mese, opzionale).

## Azioni in parallelo (team)

- [ ] Verifica Meta Business → app Meta → app review (pubblicazione, commenti, insights)
- [ ] App TikTok per sviluppatori + audit; audit API YouTube
- [ ] Preventivo licenza news; avvocato per GLI UMANI
- [ ] Gruppi di pagine con approvatori e delegato di Gabri
- [ ] Account OpenRouter
- [ ] Upgrade Google Workspace a Business Standard (entro ~5–10 pagine)
