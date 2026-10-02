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

### Aggiornamento dopo l'intervista della Fase 1 (2026-10-01)

Le decisioni complete sono nella specifica `.omc/specs/deep-interview-fase1-produzione-2-0.md`. Quando questo documento le contraddice, valgono queste:

- **Pipeline:** doppiaggio e animazione sono **in sequenza** (prima il doppiaggio, poi l'animazione), fatti da persone diverse. L'animatore consegna il video già montato.
- **Approvazione audio:** l'approvatore approva l'audio prima che parta l'animazione.
- **Validazione scientifica:** solo per le pagine che la richiedono.
- **Compiti:** il centro della Fase 1 è il **compito** (assegnatario, scadenza, stato).
- **Personaggi:** in Fase 1 non ci sono come entità. Ogni pagina ha un doppiatore e un animatore, ciascuno con titolare e riserva.
- **Esterni:** hanno **account veri**, solo su invito, e vedono solo i reel assegnati. Il link magico per singolo reel viene superato.
- **File:** finiscono su un **Drive condiviso**, una cartella per reel, condivisa con l'esterno assegnato e revocata a lavoro concluso. Non vanno su Supabase Storage.
- **Telegram:** è facoltativo. I pulsanti arrivano in un messaggio privato; chi non usa Telegram riceve un'email.
- **Approvazioni:** al rilascio approvano Gabri e un delegato. I gruppi di pagine sono predisposti ma spenti.
- **Express leggero:** solo priorità e scadenze strette.

### Piano della Fase 1 approvato (2026-10-02)

Il piano esecutivo è [`docs/fase1-plan.md`](fase1-plan.md). L'hanno approvato Architect e Critic dopo tre giri di revisione, e poi l'utente. Le decisioni sono in [`docs/fase1-decisioni.md`](fase1-decisioni.md). Dove contraddice questo documento, vale il piano. In sintesi:

- **Rilasci:**
  - **R1:** tutto tranne Drive, account esterni compresi; le consegne avvengono con link.
  - **R2:** solo Drive.
  - Ogni rilascio segue l'ordine expand → codice → contract. Il passo 0 è una prova generale su un dump di produzione.
- **Date:**
  - si parte lunedì 5 ottobre;
  - **R1 il 16 novembre è l'impegno**, il 9 novembre è l'obiettivo ambizioso;
  - R2 il 23 novembre, chiusura il 24 novembre;
  - checkpoint il 23 ottobre e il 3 novembre;
  - piano B: R1 il 16 novembre e R2 il 30 novembre;
  - riserva il 4 dicembre.
- **Scheduler:** i cron di Vercel Pro sostituiscono Inngest, rinviato alla Fase 2. Nella tabella Architettura sotto, la riga "Job" vale quindi dalla Fase 2.
- **Prima di R1:**
  - Vercel Pro e Supabase Pro;
  - un deploy `fase1-pre-r1` entro il 16 ottobre, che serve come bersaglio del rollback.

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

Codice sul branch `fase-0-hardening`, migrazioni `20261001120000_fase0_security.sql` e `20261001130000_fase0_scale.sql`, verificate con `scripts/db-check/run.sh`. **Applicate in produzione il 2026-10-01** (`supabase db push --linked`) e codice pubblicato con push su `main` (commit `ea8a242`).

- [x] Sicurezza: nessun utente può modificare `is_admin` o il collegamento Telegram del proprio profilo (permessi per colonna + funzioni `claim_admin_if_first`, `unlink_telegram`)
- [x] Sicurezza: login solo per utenti invitati (`shouldCreateUser: false`, `enable_signup = false` in locale)
- [x] Sicurezza: disattivato "Allow new users to sign up" nel progetto Supabase di produzione (2026-10-01, via Management API; `/auth/v1/settings` riporta `disable_signup: true`)
- [x] Sicurezza: reel inseribili/eliminabili solo da admin; modificabili da admin e membri R/A/C della pagina, solo nelle colonne di contenuto; le azioni segnalano `not_authorized`; `setReelPhase` rimosso
- [x] Bug: approvazione tramite `decide_phase_advance()` (atomica, approvatore RACI anche non admin, DoD ricontrollata, richieste superate rifiutate)
- [x] Ambiente: progetto Supabase di staging `reelificio-pm-staging` (Free, RAG-chatbot messo in pausa per liberare il posto); `.env.local` → staging, `.env.production.local` → produzione; CLI collegata allo staging
- [ ] Backup: l'organizzazione Supabase è sul piano Free, quindi la produzione non ha backup automatici. Fare un dump manuale prima di ogni migrazione (primo dump: 2026-10-01). Passare a Pro prima del rilascio della Fase 1
- [x] Scala: `published_at` (i reel pubblicati escono da kanban, dashboard, buffer e alert), indici, conteggi in SQL (`active_reel_counts`, `batch_reel_counts`, `stuck_reels`), kanban a 100 card per colonna con totale, lista batch limitata a 200, niente `.in()` con id illimitati
- [x] Job: `maxDuration = 60` su tutti i cron
- [ ] Infra: Vercel Pro, Supabase Pro (Inngest per i cron frequenti → Fase 2: in Fase 1 bastano i cron di Vercel Pro, `docs/fase1-plan.md` D5)
- [ ] Osservabilità: Sentry — integrato nel codice in S0 (branch `fase-1-produzione`, solo errori, niente replay né tracing, email e testo degli script tolti da `beforeSend`). Progetto Sentry in regione EU (`ingest.de.sentry.io`), DSN in `.env.local` dal 2026-10-02: un evento di prova da Node è arrivato con email e testo dello script già oscurati. Restano la prova dentro l'app Next e il DSN sulle variabili Vercel

### Esiti degli spike S0 (Fase 1)

Dettagli e comandi in `docs/fase1-plan.md` §S0. Aggiornato al 2026-10-02.

- **Drive in scrittura (Node):** passi 1, 2 e 4 superati sullo Shared Drive "Reelificio Staging" (`0AGUeee-dn1H3Uk9PVA`): lo service account crea cartelle e file e apre sessioni resumable con `Origin`; caricati a chunk da 8 MiB due WAV da 50 e 300 MB. I membri del Drive compaiono sulla cartella con `permissionDetails[].inherited = true` (S5 non deve revocarli). **Da fare:** condivisione `reader` e `writer` verso una Gmail esterna, download, revoca (passi 3 e 3b).
- **Upload dal browser (D6):** **U1 regge su Chromium desktop**: preflight CORS accettato, header `Range` leggibile sui 308, interruzione a metà chunk e ripresa con `bytes */<size>` fino al 200 finale. **Da fare:** Safari iOS; se fallisce, U3.
- **Media su iPhone (AC2):** route `/api/spike/audio/<id>` provata in locale e sul Preview Vercel (`fra1`, link firmati con bypass della protezione). Risponde 206 con al massimo 4 MB per risposta e 416 fuori misura, e regge i salti sui WAV da 50 e 300 MB. Da curl ogni pezzo da 4 MB arriva in 2–3 s; la prima richiesta costa 2–4 s per l'avvio a freddo e i metadati. **Da fare:** prova da Safari e dal browser interno di Telegram su iPhone, con i tempi.
- **Deep link Telegram:** script pronto (`scripts/spike-telegram-deeplink.ts`). **Da fare:** serve il bot di staging.

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
