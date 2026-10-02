# Piano di implementazione — Fase 1 "Produzione 2.0"

> Copia versionata del piano approvato il 2026-10-02. Originale e storico di lavoro in `.omc/plans/` (non versionato): specifica dell'intervista `.omc/specs/deep-interview-fase1-produzione-2-0.md`, snapshot iter1–iter3 e revisioni di Architect e Critic. Le decisioni dell'utente sono in [`docs/fase1-decisioni.md`](fase1-decisioni.md). Se il piano cambia durante l'esecuzione, aggiornare questo file.

- **Status: APPROVATO dall'utente il 2026-10-02**, con tutti i default di `docs/fase1-decisioni.md` (anche le decisioni iter3 e quelle dopo il consenso) · **Iterazione 3** — Architect iter3 = **APPROVE**, Critic iter3 = **APPROVE**. Le correzioni lasciate all'esecutore (I1–I15) sono in `## Correzioni inline dal consenso` (in fondo): applicarle durante l'esecuzione, le prime tre prima della prova 0a. Storico: `## Changelog iter3`, `## Changelog iter2`; revisioni in `.omc/plans/*-review.md`.
- Modalità: RALPLAN-DR **DELIBERATE** (migrazione dello stato dei reel, RLS per esterni, Drive in scrittura, azioni da Telegram)
- Data: 2026-10-02 (iter2: 2026-10-01) · Autore: Planner (consensus loop) · Revisori attesi: Architect, Critic
- Input: `.omc/specs/deep-interview-fase1-produzione-2-0.md` (spec, 12 AC), `docs/brain-plan.md`, `docs/brain-concept.md`, `CLAUDE.md`, codice al commit `f54ab35`, dump di produzione `supabase/backups/2026-10-01-prod/` (pg_dump 18.6 da Postgres 17.6)
- Vincolo di processo: solo sviluppo e verifica su **staging**; la produzione si tocca solo con OK esplicito dell'utente (procedura in §8)
- Fatti cambiati dall'iter1: signup pubblico di produzione **già disattivato** (2026-10-01, `disable_signup: true`); codice Fase 0 già in produzione (`ea8a242`), restano solo attività di setup gratuite → **S0 parte lunedì 5 ottobre**
- Decisioni nuove in sintesi: funzioni interne nello schema `private`; rilascio **R1 = tutto tranne Drive, esterni inclusi**, R2 = solo Drive; ogni rilascio = expand → codice → contract; prova generale su dump di produzione come passo 0 di ogni rilascio; job Drive unico e idempotente `drive_reconcile`; scheduler = **cron Vercel Pro** (Inngest rinviato alla Fase 2); target **R1 lunedì 9 novembre** (con i tre tagli di R1 di §9), **R2 lunedì 23 novembre** (chiusura 24 novembre, ~37 giorni lavorativi), riserva 4 dicembre; checkpoint venerdì 23 ottobre → altrimenti R1 16 novembre, R2 30 novembre
- Iter3 in sintesi: account esterni creati al passo 6b da CSV rivisto (mai prima dell'expand); compiti marcati `requires_drive` alla creazione e "kit legacy" per il passaggio R1 → R2; toolchain Postgres fissata (PG16 per l'iterazione, PG17 per prova su dump e confronto con la produzione); rollback su un deployment `fase1-pre-r1` già sicuro e `fase1_reconcile_tasks()` per tornare avanti; commenti con grant di colonna; confronto dello schema di produzione al passo 0; seconda prova la mattina del rilascio

---

## 1. Sintesi dei requisiti (mappata sui 12 AC)

| AC | Cosa deve essere vero | Dove lo costruiamo |
|---|---|---|
| 1 Zero WhatsApp | Un reel va da Confermato a Programmato con tutti i compiti creati, notificati e chiusi nell'app | S2 (motore), S4 (notifiche) → R1; con Drive automatico in R2 |
| 2 Approvazione < 2 min | Script, audio e video finale si approvano o rimandano con ≤ 2 tap (+ nota opzionale) da Telegram o dalla coda mobile; Express in cima; si approva ciò che si è visto | S0 (spike media su iPhone), S3 (`/approvazioni`), S4 (pulsanti), S5 (audio servito dal server) |
| 3 Ritardi in automatico | Semaforo giallo al 75% e rosso alla scadenza; escalation all'assegnatario alla scadenza e a Gabri a +50%; stand-up giornaliero nel gruppo | S2 (scadenze), S4 (sweep, stand-up) |
| 4 Account esterni | Login invite-only; l'esterno vede solo i reel con i suoi compiti (RLS + db-check); legge script/note/file precedente, consegna, commenta, propone modifiche parola per parola; non riceve digest né promemoria interni | S1 (RLS, account), S3 (UI esterni, proposte, offboarding) → **R1**; S5 (upload su Drive) → R2 |
| 5 Assegnazione con riserva | Doppiaggio al titolare alla conferma; "Non posso" o timeout → riserva; animazione al titolare animatore dopo l'audio approvato; doppiatore ≠ animatore, anche nelle riassegnazioni manuali | S2 |
| 6 Validazione scientifica | Solo per pagine marcate, prima di Confermato; validatore anche esterno | S2, S3 (flag pagina, account) |
| 7 Migrazione senza perdite | Mappatura delle 6 fasi; conteggi uguali; commenti, DoD e `published_at` preservati; provata su dump reale **prima** di ogni rilascio | S1 (harness + `rehearse-dump.sh`), passo 0 di §8 |
| 8 Cartella Drive e kit | Cartella per reel nello Shared Drive; upload con nome standard; kit = audio approvato + script con note; condivisione con l'esterno revocata a fine compito | S5 (`drive_reconcile`) → R2 |
| 9 Telegram opzionale | Pulsanti inline per chi ha Telegram; email con link per gli altri; la matrice `/settings` continua a funzionare | S4 |
| 10 Express leggero | Flag Express sul reel → SLA Express, primo nelle code e nello stand-up | S2, S3, S4 |
| 11 Modello approvatori | Gabri approvatore di tutte le pagine; delegato quando Gabri è assente; schema pronto per gruppi di pagine senza riscritture | S1, S2, S3 |
| 12 Visibilità e modifica | Interni vedono tutto, home = vista per ruolo; modificano dove hanno un compito o un ruolo RACI; admin ovunque | S1 (policy), S2, S3 |

Non-goal confermati (restano fuori): entità personaggi, registratore e controlli AI dell'audio, news/fact-check Express, pubblicazione via API, attivazione dei gruppi di approvatori, step di montaggio separato, Telegram obbligatorio, compensi.

---

## 2. RALPLAN-DR — sintesi decisionale

### Principi
1. **Il database è l'unica fonte di verità e l'unico che cambia stato.** Ogni transizione passa da una funzione SQL `SECURITY DEFINER` che restituisce un codice errore (pattern Fase 0: `decide_phase_advance()` in `supabase/migrations/20261001120000_fase0_security.sql:181-252`). L'app, Telegram e i job sono solo client. `reels.state` è memorizzato ma ogni scrittura passa da `private._set_state()`, che verifica `state = private.derived_state(reel)` (stato ricavato dal compito aperto o dall'ultimo chiuso).
2. **Expand → codice → contract, e rollback onesto.** Ogni rilascio applica prima migrazioni che il codice in produzione tollera (tabelle, colonne, funzioni nuove, policy più strette ma equivalenti per gli interni), poi il codice, poi una migrazione di **contract** separata che spegne i vecchi percorsi (`decide_phase_advance`, grant su `posted_url`, insert delle richieste). Il bersaglio del rollback del codice è il deployment **`fase1-pre-r1`**: codice Fase 0 più il filtro dei destinatari tollerante alle colonne (digest, promemoria, menzioni senza esterni), in produzione da S1, quindi sicuro anche con account esterni attivi (iter3). Il rollback del solo codice basta **fino al contract**; dopo, si usa `supabase/rollback/fase1_r1_uncontract.sql` (ripristina grant, policy di insert e trigger permissivo) **e mai** le policy `using (true)` finché esistono account esterni. Per tornare avanti dopo un uncontract: re-contract e `fase1_reconcile_tasks()`, che riallinea i compiti agli stati cambiati dal codice vecchio (provato in `upgrade.sh`).
3. **Minimo privilegio per default.** Funzioni interne nello schema `private` (non esposto da PostgREST, nessun `USAGE` per `anon`/`authenticated`); ogni funzione `public` nasce con `revoke execute … from public, anon, authenticated` e grant espliciti, verificati da una allowlist in `00_guards.sql`. Le policy `using (true)` diventano `is_internal() or <ambito>` **nella stessa release** in cui un profilo nuovo nasce `external`. Drive condiviso in sola lettura e revocato a fine compito.
4. **Fette verticali piccole e verificabili.** Ogni fetta finisce con migrazioni + check `scripts/db-check` + UI minima, eseguibile su staging; nessuna fetta scrive righe outbox senza un handler già attivo (i job Drive si accodano solo con `app_config.drive_enabled = true`, cioè da R2). Nessuna policy o funzione nuova senza check SQL e PostgREST.
5. **Il servizio esterno è un trasporto sostituibile.** Scheduler, Telegram e Drive sono dietro funzioni pure (`runTaskSweep()`, `drainOutbox()`, `reconcileReelDrive()`): il cron Vercel di Fase 1 si può sostituire con Inngest o pg_cron senza toccare la logica.

### Decision drivers (top 3)
1. **Correttezza e sicurezza degli accessi** con utenti esterni reali (AC4) e azioni che approvano da Telegram (AC2, AC9).
2. **Migrazione senza perdite** di un sistema in produzione (AC7), provata su dati reali prima di toccarlo, con un solo sviluppatore e (fino all'upgrade) un piano Supabase Free senza backup automatici.
3. **Capacità di un solo sviluppatore** (~37 giorni lavorativi stimati con i tagli di R1, §9) e vincoli dei piani: Vercel Pro obbligatorio prima di R1 (uso commerciale, cron ogni 5 min), body Vercel 4,5 MB, Supabase Free 50 MB per file.

### D1 — Modello dati e workflow (decisione centrale)

| Opzione | Pro | Contro |
|---|---|---|
| **A. Tabella `tasks` come fonte di verità; lo stato del reel avanza tramite funzioni SQL quando i compiti si chiudono** | Rispecchia l'ontologia della spec (il Compito è l'oggetto centrale, R9); storico di riassegnazioni, rifiuti, rimandi ed escalation; RLS degli esterni naturale ("reel su cui ho un compito"); base per carico, compensi e compiti per personaggio delle fasi 2–4 | Più tabelle e funzioni; serve un invariante "un solo compito aperto per reel" e un check che stato e compito restino coerenti |
| B. Estendere l'enum `reels.phase` + colonne assegnatario/scadenza sul reel, senza tabella compiti | Meno join, meno codice iniziale | Perde lo storico (titolare che rifiuta → riserva, rimandi, escalation per tentativo); l'RLS esterni richiede una colonna per ruolo; il Fase 2 (più doppiaggi per reel) obbliga a rifare il modello; contraddice R9 |
| C. Stato del workflow in Inngest (step.sleepUntil / waitForEvent), DB come proiezione | Timer durevoli "gratis" per timeout e attese | La verità esce da Postgres: niente RLS né `SECURITY DEFINER` sulle transizioni (viola il vincolo Fase 0); esecuzioni ∝ compiti × step (≈ 60k/mese a 50 pagine > 50k Free); run lunghi giorni/settimane attraverso i deploy (versioning dei workflow); non testabile con `scripts/db-check` |

**Scelta: A.** B è invalidata perché contraddice la decisione R9 della spec e va rifatta in Fase 2. C è invalidata dal vincolo "transizioni solo via funzioni SQL" e dal tetto di esecuzioni Inngest Free.

Precisazioni iter2 (antitesi dell'Architect: "lo stato è derivato dai compiti, memorizzarlo crea copie ridondanti"):
- `reels.state` resta memorizzato (serve a indici, kanban, RLS e codice legacy), ma è scritto solo da `private._set_state()`, che solleva `invalid_state` se il valore non coincide con `private.derived_state(reel)`. Un trigger rifiuta scritture su `reels.phase` se `state` non cambia nella stessa istruzione (esenti le righe legacy `qc`/`published`, normalizzate dal backfill).
- L'indice `tasks_one_open_per_reel` vale in Fase 1 (un solo compito aperto per reel: il flusso è sequenziale). In Fase 2 (più doppiaggi per reel) diventa `(reel_id, kind)`: è un indice parziale, cambiarlo non tocca i dati. L'argomento "compiti paralleli" di D1 riguarda la Fase 2, non la Fase 1.

### D2 — Strategia di migrazione dell'enum `pipeline_phase`

Dipendenze attuali da `pipeline_phase`: `reels.phase`, `raci_configs.phase` (PK), `reel_assignments.phase`, `phase_advance_requests.from/to_phase`, `alerts.phase`, `magic_link_invites.phase`, `has_raci_role(uuid, pipeline_phase, text)`, `stuck_reels()`, `active_reel_counts()`, policy DoD su `'editing'` (`20260513130000_dod_checklist.sql:35-56`), kanban (`src/lib/pipeline/queries.ts:61-81`), dashboard (`src/app/(app)/dashboard/page.tsx:64-74`), digest (`src/lib/digest/weekly.ts:49,59,83`), buffer (`src/lib/alerts/rules.ts:29`), inviti (`src/lib/invites/actions.ts:256-262`).

| Opzione | Pro | Contro |
|---|---|---|
| M1. Rinominare e aggiungere valori a `pipeline_phase` | Nessuna riscrittura dati, tutte le colonne seguono | Il codice vecchio si rompe all'istante (letterali enum non validi) → deploy in lockstep con downtime; `ALTER TYPE … ADD VALUE` non usabile nella stessa transazione; RACI sovraccaricato di 10 stati; altri valori deprecati che si accumulano (`qc`, `published` già lo sono) |
| **M2. Nuovo enum `reel_state` + colonna `reels.state`; `reels.phase` resta come "macro-fase" legacy sincronizzata da trigger via `state_raci_phase()`** | Expand/contract: codice vecchio e rollback funzionano; RACI resta per macro-fase (6 righe per pagina, editor invariato); buffer, dashboard, digest e policy DoD continuano a funzionare senza modifiche; enum nuovo usabile nella stessa migrazione (è `CREATE TYPE`, non `ADD VALUE`) | Due colonne da spiegare; un trigger; una migrazione di contract futura (Fase 2) |
| M3. Tabella di lookup `reel_states` (text FK) | Stati aggiungibili senza limiti enum | Rompe la convenzione del repo (enum ovunque) e la tipizzazione; stessa complessità di backfill |

**Scelta: M2.** Regola operativa: i nuovi valori di enum *esistenti* (`notification_event`, `alert_kind`) vanno in un file di migrazione separato e vengono usati solo dai file successivi (stesso schema di `20260512120000_alerts.sql:12`). Nota di equità (Critic): anche M2 rompe il codice vecchio quando si spengono i vecchi percorsi; la differenza è che con M2 quel passo è isolato nella migrazione di contract (principio 2), mentre con M1 coincide con l'expand.

**Tabella completa `state_raci_phase(reel_state) → pipeline_phase`** (immutable; asserita riga per riga in `05_fase1_model.sql`):

| `state` | `phase` (macro-fase RACI/legacy) | Motivo |
|---|---|---|
| `idea` | `research_prescript` | round-trip con la fase legacy |
| `bozza` | `script_writing` | round-trip |
| `revisione` | `script_writing` | la revisione è parte della stesura (RACI `script_writing`) |
| `validazione` | `scientific_validation` | round-trip |
| `confermato` | `dubbing` | script bloccato, doppiaggio in attesa di accettazione |
| `doppiaggio` | `dubbing` | round-trip |
| `animazione` | `editing` | round-trip |
| `approvazione_finale` | `editing` | **non** `publication`: il buffer (`src/lib/alerts/rules.ts:29`) non deve contare reel non approvati; la policy DoD su `'editing'` (`20260513130000_dod_checklist.sql:35-56`) resta valida |
| `programmato` | `publication` | round-trip; è il buffer del BP |
| `pubblicato` | `publication` | come oggi i pubblicati restano in `publication` con `published_at` |

Round-trip verificato per le 6 fasi attive (`state_raci_phase(legacy_phase_to_state(p, null)) = p`). Le righe deprecate `qc` → `approvazione_finale` → `editing` e `published` → `pubblicato` → `publication` cambiano `phase`: il backfill le normalizza esplicitamente e il report pre-migrazione le conta.

### D3 — Modello di accesso degli esterni

| Opzione | Pro | Contro |
|---|---|---|
| **E1. Account reali + RLS: `profiles.account_type`; ogni policy di lettura diventa `(select is_internal()) or <ambito>`; gli esterni vedono i reel tramite `visible_reel_ids()` (compiti aperti, o chiusi con esito da ≤ 7 giorni)** | RLS-enforced e verificabile in db-check (richiesto da AC4); un solo percorso dati per interni ed esterni; i commenti e le notifiche esistenti funzionano | Tocca le policy di ~20 tabelle; serve un check "nessuna policy `using (true)` residua" |
| E2. Esterni serviti da server action con client service-role (come oggi `/invite/[token]`, `src/lib/invites/actions.ts:137-303`) | Nessuna modifica alle policy | Bypassa RLS: un bug = fuga di dati; duplica ogni query; AC4 chiede esplicitamente l'enforcement RLS |
| E3. Esterni membri di pagina (`page_members`) | Policy semplici per pagina | Viola AC4 ("solo i reel con compiti assegnati"); espone tutti gli script non pubblicati della pagina |

**Scelta: E1.** E2 ed E3 sono invalidate dal testo di AC4. Iter2: la riscrittura delle policy, `account_type`, il trigger `handle_new_auth_user` aggiornato e `scripts/invite-users.ts` arrivano **in S1** (rilascio R1), così non esiste una finestra in cui un profilo nasce `external` senza la RLS che lo isola, né interni invitati che perdono i diritti. Dettagli residui chiusi: gli esterni non leggono `batches` (`source_doc_url` contiene il doc mensile, `20260505203358_initial_schema.sql:169`); `profile_names()` restituisce solo nomi di persone che compaiono su reel visibili al chiamante; ogni vista ha `security_invoker = true`; le funzioni service-role che spediscono a tutti i profili filtrano `account_type = 'internal'`.

### D4 — Sicurezza dei pulsanti inline Telegram (`callback_query`)

| Opzione | Pro | Contro |
|---|---|---|
| **T1. `callback_data = "v1:<op>:<taskId>[:<rev>]"` (≤ 52 byte; `rev` = `reels.script_rev` per le approvazioni di script/validazione); webhook autenticato dall'header segreto esistente (`route.ts:14-20`); solo `chat.type = 'private'`; `from.id` → `profiles.telegram_chat_id` (indice unico parziale); autorizzazione ricontrollata in SQL da `task_action_as(p_actor, …)` (solo `service_role`, chiama `private.task_action_core`); idempotenza dalla macchina a stati; collegamento con **token opaco casuale** monouso, scadenza 15 min; email all'utente a ogni nuovo collegamento** | Nessuna tabella di nonce per i pulsanti; l'autorizzazione è la stessa dell'app; un pulsante inoltrato o vecchio fallisce in modo sicuro ("Già deciso", "Non autorizzato", "Testo cambiato: riapri") | Dipende dal fatto che `telegram_chat_id` identifichi una sola persona → il token di oggi (`<uuid>.<sig>`, `src/lib/notifications/telegram-link.ts:19-33`) non scade, non è monouso, è firmato con il segreto del webhook e contiene `.` (non valido nei deep link `t.me/<bot>?start=`, che accettano ≤ 64 caratteri `[A-Za-z0-9_-]`, `settings/telegram-link.tsx:23`) |
| T2. T1 + firma HMAC troncata nel `callback_data` | Difesa in profondità | Beneficio marginale: i dati del callback arrivano solo da messaggi inviati dal bot e il webhook è già autenticato |
| T3. Tabella di nonce monouso per i pulsanti | Scadenza e monouso espliciti | Tabella e pulizia in più senza sicurezza aggiuntiva rispetto al ricontrollo SQL |

**Scelta: T1.** Il token di collegamento diventa 32 caratteri casuali base64url, salvato come `sha256` in `telegram_link_tokens(token_hash, user_id, expires_at, used_at)` (solo service role): monouso, 15 minuti, nessuna chiave di firma da gestire (supera la richiesta di una chiave separata). Il collegamento è accettato solo da chat privata; la migrazione S1 azzera i `telegram_chat_id` negativi (id di gruppo) e i duplicati, riportandoli nel report.

### D5 — Job frequenti (timeout, escalation, stand-up, Drive)

| Opzione | Pro | Contro |
|---|---|---|
Base comune a tutte le opzioni: **outbox transazionale** `job_outbox` scritta dalle funzioni SQL nella stessa transazione della transizione, svuotata subito con `after()` di Next; retry con backoff in Postgres; claim con **lease** (`lease_until`) e contatore di generazione per i job deduplicati (§S4). Le opzioni differiscono solo per *chi* chiama ogni 5 minuti `runTaskSweep()` (sweep SQL + drain) e alle 08:30 lo stand-up.

| Opzione | Pro | Contro |
|---|---|---|
| J1. Cron Inngest (`*/5`, `TZ=Europe/Rome 30 8 * * *`) | Cronologia dei run, `onFailure`, cron con fuso orario | Fornitore in più, endpoint pubblico `/api/inngest`, bypass della protezione Preview, elaborazione negli USA; i retry li fa già l'outbox, quindi Inngest farebbe solo da timer; 17,5k esecuzioni/mese |
| J2. Un run Inngest per compito con `step.sleepUntil` | Timer precisi | Esecuzioni ∝ compiti (sfora 50k a ~40 pagine); run lunghi attraverso i deploy |
| J3. Supabase `pg_cron` + `pg_net` | Tutto nel DB | Logica divisa DB/app, segreti nel DB, osservabilità scarsa |
| **J4. Cron Vercel Pro: `/api/cron/task-sweep` ogni 5 min e `/api/cron/standup` (06:30 e 07:30 UTC; il handler parte solo se a Roma sono le 08:30 ± 10 min e lo stand-up del giorno non è già stato inviato)** | Nessun servizio in più; tutto in EU (`fra1`); stessa autenticazione dei cron esistenti (`isAuthorizedCronRequest()`, `src/lib/auth/cron.ts`); Vercel Pro è comunque obbligatorio prima di R1 | Cron solo sul deployment di produzione (su staging lo sweep si invoca a mano o con `scripts/cron-loop.ts`); niente retry del cron (non serve: lo sweep è idempotente e basato sul tempo, il run successivo recupera); cron in UTC (risolto dal doppio orario) |

**Scelta: J4** (cambia l'iter1). La spec indicava Inngest perché Vercel Hobby consente un cron al giorno; quel vincolo sparisce con Vercel Pro, prerequisito di R1. J1 è invalidato per Fase 1 dal rapporto costo/beneficio (un fornitore e un endpoint pubblico per fare da timer, dati personali nei payload degli step elaborati negli USA); torna utile in Fase 2 per i job AI a più step (fan-out per pagina, step durevoli), quando `runTaskSweep()` potrà esservi spostato senza modifiche. J2 è invalidato dal tetto di esecuzioni; J3 resta possibile perché lo sweep è una funzione SQL. La voce "Inngest per i cron frequenti" della checklist Fase 0 (`docs/brain-plan.md:99`) passa alla Fase 2: è una domanda aperta con default.

### D6 — Percorso di upload dei file (vincolo: body Vercel 4,5 MB; un WAV di 60 s ≈ 17 MB, un video ≫ 100 MB)

| Opzione | Pro | Contro |
|---|---|---|
| **U1. Upload diretto browser → Google: il server crea una sessione resumable dello service account (con header `Origin`) nella cartella del reel; il browser invia a chunk da 8 MiB; il server verifica e registra** | File mai sul server; nome standard deciso dal server; la cartella resta in sola lettura per l'esterno | CORS sulla sessione resumable (incluso `Access-Control-Expose-Headers: Range` per riprendere) da verificare **in un browser vero**; uploader con chunk e ripresa da scrivere |
| U2. Supabase Storage → copia su Drive da job | CORS noto | Free = 50 MB per file e 1 GB totale: inutilizzabile per i video |
| U3. L'esterno carica il file nella cartella Drive (condivisa come `writer`; nello Shared Drive diventa "Collaboratore" e di norma non può eliminare), l'app "Sincronizza", verifica e rinomina | Nessun CORS, nessun uploader custom, ripresa gestita da Drive | Permesso di scrittura all'esterno; un passaggio manuale in più; il nome standard lo impone la sincronizzazione |

**Scelta: U1 condizionata allo spike browser di S0** (Chrome desktop e Safari iOS, file da 20 MB, interruzione e ripresa). Se lo spike fallisce o la ripresa non è affidabile → **U3** (stessa riconciliazione Drive, cambia il ruolo `reader` → `writer` e il pulsante "Carica" diventa "Apri cartella + Sincronizza"); la decisione è scritta in `docs/brain-plan.md` a fine S0 e S5 la segue senza riprogettare. U2 resta invalidata dai limiti di Supabase Free (anche con Pro un video da 4 GB andrebbe comunque copiato su Drive).

### D7 — Rilasci in produzione (deciso ora, iter2)

| Opzione | Pro | Contro |
|---|---|---|
| **R-split. R1 (9/11) = stati, compiti, viste, esterni con account e RLS, Telegram, sweep, stand-up; R2 (23/11; era 19/11) = solo Drive (cartelle, upload, kit, condivisioni)** | Tutto il rischio di migrazione (mappatura stati, RLS, account) è in R1 e arriva in produzione dieci giorni lavorativi prima, con tre settimane di uso reale prima della fine di novembre; R2 è additivo (tabelle file, scope Drive, job) e dipende da un prerequisito esterno (admin Workspace) che non blocca più R1; AC1–AC7 e AC9–AC12 verificabili già in R1 | Due finestre di rilascio (~0,5 g in più per R2); tra R1 e R2 le consegne avvengono incollando un link (come oggi) |
| R-merge. Un solo rilascio a fine novembre | Una sola finestra e una sola prova | Migrazione più grande in una volta; nessun uso reale prima della scadenza; un ritardo Drive (Workspace) blocca tutto |
| R-iter1. R1 solo interni, R2 esterni + Drive | — | Invalidata dalle review: i titolari esterni non esistono in R1 (FK su `profiles`), il default `external` precede la RLS, `invite-users.ts` arriva tardi, la RLS (rischio maggiore) cade nella release meno provata |

**Scelta: R-split con R2 solo Drive.** Modello operativo tra R1 e R2 (playbook in §8): gli esterni ricevono l'account al passo 6b del rilascio (dopo expand e codice, mai prima) e ricevono i compiti; consegnano incollando un link `https://` (il motore lo scrive in `audio_drive_url`/`video_drive_url`); l'animatore vede nel reel il link dell'audio approvato e lo script; nessun nuovo magic link (il pannello inviti mostra solo "Revoca"); gli inviti esistenti funzionano fino alla scadenza. AC2 in R1 è verificabile per script e tap; i tempi dei media su iPhone si misurano in R2 (in R1 il link porta a WeTransfer o Drive personali: compromesso accettato).

**Rampa degli esterni (sintesi Architect iter2, solo configurazione):** nelle prime 48 h dopo R1 gli esterni sono titolari e riserve su **una sola pagina**; sulle altre i campi titolare/riserva restano vuoti, quindi un reel che arriva a `confermato` crea un compito `unassigned` che l'admin assegna a mano o lascia fino all'estensione. Dopo 48 h senza anomalie (nessun fallimento delle guardie, esterno di test con 1 reel, nessuna notifica di digest/promemoria a esterni) si estende alle altre pagine con `fase1-prod-config-ramp.sql` (stesse regole di risoluzione per email), insieme all'accensione di stand-up ed escalation. Nessun costo di codice.

**Passaggio R1 → R2 (iter3):** ogni compito porta `requires_drive`, copiato da `app_config.drive_enabled` alla creazione. I compiti nati in R1 restano a consegna con link e non aspettano il kit; per i reel con audio approvato solo come link `drive_reconcile` produce un **kit legacy** (script + `<codice>_audio_link.txt`) che conta come pronto (dettagli in S5).

---

## 3. Default per le domande aperte della spec

| Domanda | Default scelto | Perché |
|---|---|---|
| SLA Batch per lavoro di doppiaggio/animazione e accettazione | Doppiaggio **48 h**, animazione **72 h**, accettazione **24 h** (doppiatore e animatore). Express: accettazione 2 h, doppiaggio 3 h, animazione 10 h, approvazione audio 30 min. Validazione 48 h / 2 h | Valori proposti dalla spec; Express ricavato dalla timeline del concept (script approvato 3 h → audio 6 h → animazione 16 h → finale 18 h). Tutto modificabile per pagina in `sla_policies` |
| Orario stand-up e chat del gruppo | **08:30 Europe/Rome tutti i giorni** (cron Vercel alle 06:30 e 07:30 UTC, il handler parte solo all'ora giusta di Roma e una volta al giorno, `system_heartbeats('standup')`); sabato e domenica il messaggio parte solo se ci sono elementi Express o in ritardo. Contenuto: "In ritardo" (compiti aperti oltre la scadenza), "Consegne di oggi" (compiti aperti con scadenza oggi, ora di Roma), "Da assegnare"; Express in testa. Chat id in env `TELEGRAM_TEAM_CHAT_ID`: quando il bot viene aggiunto al gruppo, il webhook registra nei log l'update `my_chat_member` con l'id della chat (nessun comando `/chatid`) | La spec dice "daily"; nel weekend il Batch è fermo (vedi calendario SLA) e un messaggio vuoto sarebbe rumore; env = zero UI; il log evita `getUpdates` (incompatibile con il webhook) e un comando da mantenere |
| Calendario degli SLA | **Batch:** le scadenze saltano sabato e domenica (ora di Roma; festività escluse in Fase 1). **Express:** tempo reale, escalation anche di notte. Soglie precalcolate alla creazione del compito: `yellow_at` (75%), `due_at` (100%), `escalate_at` (150%) | Un compito Batch assegnato venerdì alle 18 non passa alla riserva sabato; l'Express è urgente per definizione; soglie salvate = semaforo e sweep sono semplici confronti |
| Rimandi e stato "da assegnare" | I compiti di lavoro finiscono `delivered`, quelli di approvazione `approved` o `sent_back`. Un rimando crea un **nuovo compito per la stessa persona già `in_progress`** (nessuna nuova accettazione), con la nota. Nuovo stato `unassigned` quando non c'è un candidato. L'approvazione finale rimanda all'animatore (preselezionato: Rimanda → Conferma = 2 tap, anche da Telegram); dall'app c'è anche "Rimanda al doppiaggio" (audio da rifare → doppiaggio, poi l'animazione torna allo stesso animatore). Il validatore rimanda in `bozza` | Cicli espliciti e verificabili; nessuna scadenza di accettazione ripetuta per chi ha già accettato il lavoro |
| Chi imposta l'Express | Admin o approvatore effettivo, in qualunque stato prima di `programmato`; il compito aperto ricalcola le soglie con lo SLA Express | AC10 senza nuovi ruoli |
| Script dopo la consegna dell'autore | **Bloccato da `revisione` in poi** (iter2; era da `confermato`): HOOK/CORPO/CHIUSURA/CTA, note e `raw_content` cambiano solo tramite una proposta accettata o un admin; per correggere durante la revisione si rimanda in `bozza`. `propose_text_change` lo può chiamare chi ha un compito aperto sul reel (anche esterno), un interno membro della pagina o con ruolo RACI sulla pagina, o un admin; decide l'approvatore effettivo, il delegato o un admin. Ogni modifica incrementa `reels.script_rev` (trigger); l'approvazione di script e validazione porta la revisione vista (`callback_data` `…:<rev>`, parametro `p_expected_rev` dall'app) e restituisce `stale` se è cambiata. Una modifica admin a script bloccato accoda `drive_reconcile` (kit rigenerato, da R2). Il re-sync del batch salta i reel da `revisione` in poi e li elenca come conflitti "in produzione" nell'anteprima (modifica piccola a `src/lib/batches/actions.ts`, che la spec dava per invariato → domanda aperta con default) | Approva-ciò-che-hai-visto (AC2); oggi il re-sync sovrascrive i reel modificati in qualunque fase (`src/lib/batches/actions.ts:320-336`) e gira come admin, quindi un trigger che esenta gli admin non basterebbe |
| Approvazione audio: sotto-step o stato | **Sotto-step**: compito `audio_approval` dentro lo stato `doppiaggio` (badge "audio da approvare") | La spec elenca 10 stati senza audio approval; il kanban resta a 9 colonne attive; il compito dà comunque SLA, semaforo e pulsanti |
| Validatori: account o magic link | **Terzo tipo di esterno con account** (`external_kind = 'validator'`), oppure un interno | Un solo modello di accesso e una sola matrice db-check; il magic link richiederebbe un secondo percorso di autorizzazione service-role |
| DoD sui nuovi stati | Spunte automatiche: `script_validated` all'approvazione script/validazione, `audio_recorded` all'approvazione audio, `qc_approved` all'approvazione finale; `editing_done` e `subtitles` spuntate dall'animatore nel modulo di consegna (obbligatorie). **Gate: l'approvazione finale richiede tutte e 5** (codice `dod_incomplete`). **Reel in volo al cutover:** `fase1_backfill_open_tasks()` inserisce le voci mancanti dei passi già superati (`dubbing` → `script_validated`; `editing` → + `audio_recorded`; `qc` → + `editing_done`, `subtitles`) con `checked_by = null` e `note = '[migrazione Fase 1]'`, senza toccare le righe esistenti | Il gate resta dove stava (fine montaggio → pubblicazione) e la checklist diventa quasi tutta automatica; senza backfill i reel migrati in `doppiaggio`/`animazione` si bloccherebbero su `dod_incomplete` |
| SMM e Programmato → Pubblicato | Dopo l'approvazione finale il reel entra in `programmato` con un compito `scheduling` al primo Responsible RACI della macro-fase `publication` (SMM), chiuso quando l'SMM salva caption + data. `posted_url` passa da `publish_reel(reel, url)` → stato `pubblicato`, che **chiude anche il compito `scheduling` se è ancora aperto** (`published_at` resta gestito dal trigger esistente in `20261001130000_fase0_scale.sql:18-35`); il grant di colonna su `posted_url` si revoca nella migrazione di contract | Riusa RACI; il buffer (`programmato` non pubblicato) resta la regola BP; un URL inserito a mano in qualunque fase non può più far "sparire" un reel con compiti aperti |
| Dismissione `magic_link_invites` e `/invite/[token]` | **Da R1:** nessun nuovo invito (pannello solo "Revoca"; gli esterni hanno l'account). Gli inviti esistenti funzionano fino alla scadenza: lettura, commenti e link ai file; "lavoro pronto" non crea più una richiesta di avanzamento (oggi lo fa fuori dal motore, `src/lib/invites/actions.ts:236-303`) ma scrive un commento e notifica l'assegnatario del compito aperto. **Fase 2:** contract che elimina pagina, azioni e tabella dopo la scadenza dell'ultimo invito (TTL max 60 giorni, `actions.ts:33`) | Il lavoro esterno in corso non resta bloccato al cutover; nessuna transizione fuori dalle funzioni SQL; una sola regola per R1 e R2 (risolve la contraddizione dell'iter1) |
| Condivisione esterna sullo Shared Drive | **Prerequisito bloccante di S5 (Drive)**, verificato nello spike S0 (`scripts/spike-drive-write.ts`): crea cartella, sessione resumable, condivide con una Gmail di test, la Gmail scarica un file, revoca | Dipende dall'admin Workspace, non dal codice |
| Scheduler | **Cron Vercel Pro** (D5/J4): `/api/cron/task-sweep` ogni 5 min, `/api/cron/standup`; su staging e in sviluppo `scripts/cron-loop.ts` chiama le route ogni 5 min. Inngest passa alla Fase 2 | Vercel Pro è obbligatorio prima di R1; un fornitore in meno |
| Interruttori globali | Tabella `app_config` (solo service role e admin): `escalation_enabled`, `standup_enabled`, `drive_enabled`. **Escalation spenta** = lo sweep timbra `overdue_notified_at`/`escalated_at` e scrive `task_events` (`op = 'overdue_suppressed'`) ma non accoda notifiche; riaccendendola notificano solo le soglie superate dopo la riaccensione. Stessa semantica per `tasks.escalation_paused` (compiti migrati non ancora confermati); `confirm_migrated_tasks` **ricalcola** le soglie da `now()` (`started_at`, `yellow_at`, `due_at`, `escalate_at` via `add_sla`) e azzera i timbri presi in pausa, così nessuna soglia timbrata in pausa resta muta e nessuna parte già scaduta. Scadenza dell'accettazione → riserva funziona anche a escalation spenta (è assegnazione, AC5) | Lo stato vive nel DB, così lo leggono sia SQL sia TS; nessuna raffica di notifiche arretrate quando si riaccende |
| Canale delle notifiche dei compiti | **Telegram primario, email di riserva** per gli eventi dei compiti (`assignment`, `phase_approval_request`, `phase_rejected`, `task_overdue`, `task_escalated`, `text_proposal`): l'email parte solo se la preferenza email è attiva **e** Telegram non è collegato, è spento per quell'evento o l'invio fallisce **in modo definitivo** (403 bot bloccato, 400 `chat not found`) o il job finisce in dead letter; 429 e 5xx si ritentano con il backoff dell'outbox, senza email. La migrazione S1 cancella le righe `notification_prefs` di `assignment`, `phase_approval_request`, `phase_rejected` (salvate con il vecchio default Telegram spento) e ne riporta il numero; `saveOwnPrefMatrix` salva solo le differenze dai default | Oggi `saveOwnPrefMatrix` salva tutte le righe (`src/lib/notifications/prefs-actions.ts:22-41`), quindi la regola "preferenza esplicita" dell'iter1 non distingue nulla; evita la doppia notifica Telegram + email |
| Stato iniziale dei reel importati | **`idea`** (nessun compito); pulsante "Avvia stesura" sulla pagina del batch con un numero N (default 10): avvia i primi N reel in `idea` per ordinale (niente selezione multipla, tagliata); le notifiche di assegnazione dello stesso autore si raggruppano in un solo messaggio (dedup per autore e minuto) | 25 compiti di scrittura creati insieme diventerebbero rossi insieme e genererebbero 25 escalation e 25 messaggi |
| Stato "Confermato" | Compito di doppiaggio **in attesa di accettazione**; all'accettazione → `doppiaggio`. Per l'animazione non esiste uno stato analogo: all'approvazione audio il reel entra in `animazione` con il compito `animation` `assigned` (badge "da accettare"). Asimmetria voluta: "Confermato" è uno stato della spec, un "Audio approvato" no | Dà un significato operativo allo stato citato da AC1 e AC6 senza inventare stati |
| Visibilità degli esterni dopo la chiusura | Compiti aperti + compiti chiusi con esito (consegnato/approvato/rimandato) da ≤ 7 giorni; rifiutati/scaduti/annullati → accesso immediatamente perso; profilo disattivato → nessun reel | Vede l'esito del proprio lavoro senza tenere l'archivio |
| Notifiche notturne | **Nessun rinvio** (le "ore di silenzio" dell'iter1 sono tagliate): le notifiche Batch tra 20:00 e 08:00 Europe/Rome partono con `disable_notification: true` (arrivano senza suono); Express sempre con suono. Cambio di prodotto rispetto all'iter1 → domanda aperta | Stesso beneficio a costo quasi zero, nessun job rimandato nell'outbox; le scadenze Batch saltano già il weekend |
| Commenti visti dagli esterni | L'esterno legge e scrive il thread del reel (AC4). Nuovo flag `comments.internal_only` ("Nota interna", solo interni): RLS lo nasconde agli esterni; avviso nel rilascio al team che il thread è ora visibile ai collaboratori. **Iter3:** update solo sulle colonne `body`, `mentions`, `internal_only` (grant di colonna; `target_type`, `target_id`, `parent_id` non modificabili); il `with check` dell'update ripete la regola dell'insert, quindi un esterno non può mettere `internal_only = true` né spostare il commento; un interno può cambiare `internal_only` sui propri commenti. Un commento `internal_only` **non notifica mai** un esterno, nemmeno se menzionato | Senza flag ogni discussione interna sul reel diventa visibile all'esterno; senza grant di colonna un PATCH sposterebbe il commento su un reel non visibile |
| Offboarding di un esterno | `offboard_collaborator(user)` (admin): `profiles.deactivated_at`, compiti aperti → candidato successivo o `unassigned`, titolare/riserva azzerati sulle pagine, condivisioni Drive revocate via `drive_reconcile`; il ban con `auth.admin.updateUserById(..., { ban_duration })`. In R1 si lancia da `scripts/fase1-collaborators.ts offboard <email>` (taglio di R1, §9); il pulsante in UI arriva dopo R1 se resta tempo. **Cancellazione GDPR:** `tasks.assignee_id on delete restrict` impedisce di cancellare l'utente auth; la richiesta di cancellazione si gestisce con anonimizzazione (`scripts/fase1-anonymize.sql`, S6: `full_name = 'Ex collaboratore'`, `email`/`drive_email`/`telegram_chat_id` azzerati, email auth sostituita con `deleted+<id>@invalid` e utente bannato), che conserva lo storico dei compiti | Mancava nell'iter1; senza, un ex collaboratore resta titolare e conserva accessi |
| Riassegnazione manuale | `assign_task(task, user)` verifica il tipo: `dubbing` → doppiatore (esterno `dubber` o interno), `animation` → animatore (esterno `animator` o interno), `validation` → validatore o interno, approvazioni e `writing`/`scheduling` → solo interni; rifiuta l'animatore uguale all'ultimo doppiatore che ha consegnato (e viceversa) con `invalid_assignee` | AC5 vale anche per le riassegnazioni dell'admin |

---

## 4. Criteri di accettazione verificabili

Ogni criterio ha una verifica concreta: **db** = check SQL in `scripts/db-check/checks/`, **api** = `api-check.mjs` via PostgREST, **unit** = vitest, **e2e** = scenario manuale su staging (§7.3).

| # | Criterio verificabile | Verifica |
|---|---|---|
| AC1 | Scenario E1: il reel `TT-2611-01` va da `confermato` a `programmato` con 5 compiti (`dubbing`, `audio_approval`, `animation`, `final_approval`, `scheduling`) tutti chiusi con `closed_via ∈ {app, telegram}`, con doppiatore e animatore **esterni**; ogni compito creato produce ≥ 1 riga `notifications` con `channel ∈ {telegram, email}` (le righe `in_app` sono escluse: sono sempre consegnate, `dispatch.ts:106-109`) e `delivered_at` non nullo entro 60 s; 0 interventi SQL manuali. In R1 le consegne sono link; in R2 upload su Drive | e2e E1 (R1 e di nuovo in R2) + query di controllo §7.3 |
| AC2 | Telegram: Approva = 1 tap, Rimanda = 2 tap (Rimanda → Conferma, destinazione preselezionata); coda `/approvazioni`: Approva = 1 tap, Rimanda = 2 tap + nota opzionale; con 2 item (Batch in scadenza prima, Express dopo) l'Express è il primo; un'approvazione di script con `rev` superata restituisce `stale`; audio e video si aprono su iPhone (Safari e browser interno di Telegram) secondo l'esito dello spike S0; 3 prove cronometrate < 2 min dall'apertura della notifica, fatte su iPhone | e2e E2, api (ordinamento, `stale`), spike S0 |
| AC3 | `yellow_at` = 75% e `escalate_at` = 150% della durata SLA calcolata da `add_sla()` (Batch: un compito di 24 h creato venerdì alle 18:00 scade lunedì alle 18:00; Express: tempo reale); semaforo verde/giallo/rosso ai bordi `yellow_at`/`due_at` (test a −1 s/+0 s); sweep eseguito 2 volte su un compito scaduto produce **1** notifica `task_overdue` all'assegnatario e, oltre `escalate_at`, **1** `task_escalated` all'approvatore effettivo (al delegato e agli admin se l'assegnatario è l'approvatore stesso); con `escalation_enabled = false` lo sweep timbra senza accodare e, riacceso, non recupera le soglie già timbrate; lo stand-up del fixture (3 in ritardo, 2 in scadenza oggi, 1 da assegnare, 1 Express) li elenca tutti con l'Express in testa, ≤ 4096 caratteri | unit, db `06_tasks.sql` (`add_sla`) e `09_outbox_sweep.sql`, e2e E3 |
| AC4 | L'esterno X legge esattamente i reel con suoi compiti (fixture: 1 su 3) e 0 righe da `batches`, `raci_configs`, `alerts`, `daily_updates`, `reel_dod_items`, `phase_advance_requests`, commenti `internal_only` e profili altrui; `profile_names()` gli restituisce solo nomi presenti sui suoi reel e mai email; non può aggiornare `reels`, inserire `tasks`, commentare reel non suoi né spostare un proprio commento su un altro bersaglio o renderlo "Nota interna", non riceve notifiche di menzione da commenti `internal_only`, eseguire alcuna funzione fuori dall'allowlist (`/rpc/task_action_as` e lo schema `private` → errore); può commentare il suo, proporre una modifica e consegnare; non compare tra i destinatari di digest settimanale e promemoria giornaliero; dopo `offboard_collaborator` vede 0 reel. Un'email non invitata riceve `not_invited` | db `00_guards.sql`, `07_externals.sql`, api (stesse query come esterno), unit (`internalRecipients`), e2e E4 (audio ≥ 20 MB in R2) |
| AC5 | Alla conferma: compito `dubbing` al titolare in stato `assigned`, scadenza +24 h lavorative (Batch) / +2 h (Express); "Non posso" → nuovo compito alla riserva nella stessa transazione; timeout via sweep → riserva; entrambi indisponibili → compito `unassigned` + notifica agli admin; con riserva animatore = doppiatore del reel, il candidato viene saltato; la pagina rifiuta titolare = riserva dello stesso ruolo e titolare doppiatore = titolare animatore; `assign_task` rifiuta tipo sbagliato e doppiatore = animatore (`invalid_assignee`) | db `06_tasks.sql`, e2e E5 |
| AC6 | Pagina con `requires_scientific_validation = true`: approvazione script → `validazione` con compito al validatore (anche esterno); pagina senza flag → `confermato`. Approvare uno script vuoto restituisce `script_missing` | db `06_tasks.sql`, e2e E6 |
| AC7 | Harness di upgrade con fixture legacy (≥ 1 reel per fase incl. `qc`/`published` + 1 pubblicato + commenti + DoD + 1 richiesta pending + 1 `telegram_chat_id` duplicato e 1 di gruppo): conteggio reel identico, mappatura per stato esatta, `published_at`/commenti/DoD **preesistenti** identici (checksum sulle righe pre-migrazione; le voci DoD aggiunte dal backfill contate a parte), richiesta pending → `cancelled`; **prima di ogni rilascio** la stessa prova sul dump reale di produzione (completa il 5–6 novembre, ripetuta su un dump fresco la mattina del rilascio) dà conteggi uguali al report pre-migrazione, schema di produzione senza differenze nuove e nessuna condizione di stop | db `scripts/db-check/upgrade.sh`, `scripts/db-check/rehearse-dump.sh` (S1), passo 0 di §8 |
| AC8 | Entro 2 min dalla conferma esiste la cartella `TT-2611-01 — <titolo>` nello Shared Drive di staging; gli upload si chiamano `TT-2611-01_audio_v1.wav`, `_v2…`; prima che il compito `animation` sia notificato la radice della cartella contiene l'audio approvato e `TT-2611-01_script_v<n>.txt` (versioni superate in `archivio/`) e `reels.kit_ready_at` è valorizzato; il permesso Drive dell'animatore esiste a compito `in_progress` ed è rimosso ≤ 10 min dopo la consegna, anche se un job di condivisione viene ritentato dopo la revoca (`drive_reconcile` converge) | e2e E8 + `scripts/check-drive-folder.ts` (lista file e permessi), db `10_files.sql` |
| AC9 | Utente con Telegram: messaggio con pulsanti, decisione registrata con `closed_via = 'telegram'`, **nessuna email** per lo stesso evento; utente senza Telegram: email con link `/reels/<id>?task=<taskId>`; disattivando email per `task_overdue` in `/settings` non arriva più l'email (nessuna riga `notifications` email); la matrice salva solo le differenze dai default | e2e E9, unit (`resolveTaskChannels`) |
| AC10 | `set_reel_track(reel, 'express')` ricalcola la scadenza del compito aperto con lo SLA Express; il reel è primo in `/compiti`, `/approvazioni`, nella colonna del kanban e nello stand-up | db `06_tasks.sql`, api, e2e E10 |
| AC11 | Gruppo predefinito con approvatore Gabri: i compiti di approvazione vanno a lui; con `absent_until` futuro (impostato dall'admin) i nuovi vanno al delegato e `set_absence()` sposta quelli aperti; una pagina assegnata al gruppo B usa l'approvatore di B **senza modifiche al codice**; il delegato può decidere anche quando Gabri è presente | db `08_approvals.sql` |
| AC12 | Un interno senza ruoli vede tutti i reel (conteggio = totale) ma l'update restituisce 0 righe → `not_authorized`; con un compito aperto sul reel l'update riesce; l'admin modifica tutto; da `revisione` in poi i blocchi dello script sono bloccati per tutti tranne admin e proposte accettate; `/`, `/login` e il callback portano a `/compiti`; un esterno che apre `/pipeline` viene reindirizzato da `src/proxy.ts` | db `02_reels.sql` aggiornato, `06_tasks.sql` (blocco), api, e2e E12 |

---

## 5. Implementazione per fette verticali

Convenzioni valide per tutte le fette:
- Branch `fase-1-produzione` da `main`; ogni fetta = commit/PR sul branch. Ingegneria dei rilasci in §8 (tag `fase1-r1`, contract in un commit separato, hotfix).
- **Migrazioni:** si creano con `supabase migration new <nome>` nel momento in cui si scrivono (timestamp reali, mai pre-datati); si itera in locale con `scripts/db-check/run.sh` (DB nuovo a ogni esecuzione); si pubblicano su **staging** con `supabase db push --linked` solo a fine fetta e da quel momento il file è immutabile (correzioni = nuova migrazione). Nessuna modifica a migrazioni già in produzione.
- **Atomicità:** la CLI Supabase invia ogni file di migrazione, con il suo insert nella cronologia, come un unico batch in pipeline (`apps/cli-go/pkg/migration/file.go`, `ExecBatch`): **ogni file è atomico, un push di più file no**. Quindi: niente `CREATE INDEX CONCURRENTLY`, `VACUUM`, `ALTER SYSTEM`, `CLUSTER` (la CLI li esegue fuori dal batch e rompe l'atomicità); ogni file deve lasciare un sistema funzionante anche se il file successivo fallisce; `run.sh` applica ogni file con `psql --single-transaction` per riprodurre lo stesso comportamento.
- **Funzioni:** quelle interne vivono nello schema `private` (`create schema private; revoke all on schema private from public, anon, authenticated;` nessun `USAGE` concesso: anche un `EXECUTE` di default non basta per chiamarle; PostgREST espone solo `public`, `supabase/config.toml` `[api] schemas`). Ogni funzione `public` nuova: `security definer`, `set search_path = public, private`, `revoke execute … from public, anon, authenticated` e poi grant espliciti (precedente: `stuck_reels`, `20261001130000_fase0_scale.sql:115`). Nessuna funzione con parametro `p_actor` è eseguibile da `anon`/`authenticated`. Restituiscono `text` con codici (`ok`, `not_authorized`, `invalid_input`, `task_not_found`, `invalid_state`, `invalid_assignee`, `stale`, `file_missing`, `kit_not_ready`, `dod_incomplete`, `script_missing`, `proposal_stale`). Le server action mappano il codice su un tipo TS (come `src/lib/phase-advance/actions.ts:160-177`); gli update diretti su tabella mantengono `.select('id')` → `not_authorized`.
- **Ordine dei lock:** ogni transizione e lo sweep bloccano prima la riga `reels` e poi la riga `tasks` (`for update`); lo sweep usa `skip locked` sui reel.
- Ogni policy RLS usa `(select public.is_internal())` / `(select public.visible_reel_ids())` per avere un initPlan valutato una volta per query.
- Stringhe UI e messaggi Telegram/email in `src/messages/it.json`; per i messaggi fuori richiesta (job, webhook) si usa `createTranslator({ locale: 'it', messages })` di next-intl.

### S0 — Fondamenta e spike (5–7 ottobre) · 3 giorni

**Obiettivo:** chiudere i punti di Fase 0 che servono alla Fase 1 (test runner, Sentry, scheduler deciso) e togliere le incognite esterne (Drive in scrittura, upload dal browser, media su iPhone) prima di scrivere il modello.

- **Test runner:** `pnpm add -D vitest`; `vitest.config.ts` con alias `@` → `src`; script `"test": "vitest run"`; primo modulo `src/lib/tasks/semaforo.ts` + test.
- **Sentry** (punto Fase 0, `docs/brain-plan.md:100`, anticipato prima di R1): `@sentry/nextjs` con regione EU, DSN in env; `beforeSend` che toglie email e testo degli script; nessun replay.
- **Scheduler:** `scripts/cron-loop.ts` (chiama `/api/cron/*` con `Authorization: Bearer ${CRON_SECRET}` ogni 5 minuti) per sviluppo e staging; le route reali arrivano in S4.
- **Spike Drive (Node)** `scripts/spike-drive-write.ts` (`pnpm exec tsx`, env da `.env.local`):
  1. JWT con scope `https://www.googleapis.com/auth/drive`; `GET drives/{GOOGLE_SHARED_DRIVE_ID}`;
  2. crea una cartella di prova;
  3. `permissions.create` (`reader`, `supportsAllDrives=true`, `sendNotificationEmail=false`) sulla **cartella** per una Gmail di test; la Gmail apre e **scarica** un file; poi `permissions.delete` e verifica che l'accesso sia perso;
  3b. (iter3, prova il fallback U3 e il taglio n. 2) stessa cartella condivisa come **`writer`** con una Gmail **non membro** dello Shared Drive: la Gmail carica un file da 20 MB dal browser, non riesce a eliminare file altrui; poi revoca. Si registra anche `permissionDetails[].inherited` dei permessi ereditati dal Drive (servono a non revocarli, S5);
  4. crea una sessione resumable con `Origin: <NEXT_PUBLIC_APP_URL>` e stampa l'URL della sessione per lo spike browser.
- **Spike upload nel browser** `src/app/(app)/spike/upload/page.tsx` (solo admin, rimossa a fine S0): carica 20 MB a chunk da 8 MiB sulla sessione creata dal server, da **Chrome desktop e Safari iOS**; verifica `Access-Control-Allow-Origin` ed `Access-Control-Expose-Headers: Range`; interrompe la rete a metà e riprende con `Content-Range: bytes */<size>`. Esito: U1 se entrambi i browser caricano e riprendono, altrimenti U3 (D6).
- **Spike media su iPhone** (AC2): su un iPhone, sia in Safari sia nel browser interno di Telegram, aprire (a) l'iframe `drive.google.com/file/d/<id>/preview` di un file privato dello Shared Drive, (b) una route prototipo `/api/spike/audio/<fileId>` che inoltra il file da Drive con lo service account rispettando l'header `Range` (`<audio controls>`), **eseguita su un deployment Preview di Vercel** (non `pnpm dev` dietro tunnel), con ogni risposta 206 limitata a ~4 MB (`Content-Range` troncato, sotto i limiti di risposta e durata delle funzioni) e provata su WAV da 50 e 300 MB (avvio, salto in avanti), (c) il link "Apri in Drive". Esito atteso (Architect/Critic): (a) chiede il login per via dei cookie di terze parti → **audio servito dal server** (route definitiva in S5) e video con "Apri in Drive". Tempo misurato dal tap sulla notifica alla riproduzione.
- **Deep link Telegram:** verificare che `t.me/<bot>?start=<token di 32 caratteri [A-Za-z0-9_-]>` arrivi al webhook di staging.
- **Verifiche di prerequisiti** (vedi §9): SMTP personalizzato su entrambi i progetti Supabase; bot Telegram di staging; utente admin sullo staging.

**Variazioni in esecuzione (2026-10-02):**
- Le pagine di prova (upload, media) sono HTML semplici sotto `/api/spike/*`, apribili con un link firmato (24 h) senza sessione dell'app. Così funzionano da Safari iOS, dal browser interno di Telegram e da un Preview Vercel senza login. La firma è un HMAC con chiave derivata dallo service account. `scripts/spike-sign.ts` genera i link, anche con il bypass della protezione Preview. `/spike` (solo admin) li elenca e contiene le prove di Sentry.
- Tutto lo spike si rimuove a fine S0: `src/app/(app)/spike`, `src/app/api/spike`, `src/lib/spike` e la voce `/api/spike` in `PUBLIC_PATHS`.
- Lo script Drive ha un sottocomando per ogni passo (`drives`, `setup`, `share`, `perms`, `revoke`, `files`, `resumable`, `upload-wav`, `trash`), perché tra un passo e l'altro c'è un'azione a mano dalla Gmail.
- `CRON_SECRET` in `.env.local` era vuoto: ora ha un valore casuale locale, valido solo per sviluppo e staging.

**Stato: S0 chiusa il 2026-10-02**, in anticipo sul calendario (5–7 ottobre). Esiti completi in `docs/brain-plan.md` § "Esiti degli spike S0".
- Test runner pronto.
- Sentry provato sul Preview Vercel: arrivano gli errori server, client e Node, con le email oscurate.
- `cron-loop.ts` provato in locale.
- **D6 → U1** (Chromium desktop e Safari iOS caricano e riprendono).
- **Media → audio servito dal server** (l'iframe Drive chiede il login) e video con "Apri in Drive".
- Deep link verificato con il bot di produzione; il confronto esatto si fa in S4 con il bot di staging, ancora da creare.
- Codice di prova rimosso dall'app. La cartella di prova nello Shared Drive di staging contiene i file caricati durante i test.

**Fatto quando:** esiti dei tre spike scritti in `docs/brain-plan.md` (U1/U3, media su iPhone, deep link) e in questo piano; `pnpm test` gira; un errore di prova compare in Sentry.
**Verifica:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`; output di `spike-drive-write.ts`; registrazione dello schermo dell'iPhone per i media.

### S1 — Modello dati, accessi e prova su dump (expand) · 7 giorni (8–16 ottobre)

**Obiettivo:** tutte le tabelle e colonne di Fase 1, backfill dello stato, account interni/esterni con la RLS che li separa, strumenti di prova su dati reali. Il codice in produzione continua a funzionare identico per gli interni (nessun comportamento rimosso). Nomi di file indicativi: i timestamp li assegna `supabase migration new` al momento della scrittura.

**Migrazioni**
1. `<ts>_fase1_enum_values.sql` — solo `ADD VALUE` su enum esistenti (usati dai file successivi):
   - `notification_event`: `task_overdue`, `task_escalated`, `text_proposal` (per assegnazioni e richieste di approvazione si riusano `assignment` e `phase_approval_request`; per i rimandi `phase_rejected`);
   - `alert_kind`: `job_health`.
2. `<ts>_fase1_core.sql`:
   - **Schema `private`** (convenzioni §5): helper e funzioni interne.
   - **Tipi nuovi:** `reel_state` (`idea, bozza, revisione, validazione, confermato, doppiaggio, animazione, approvazione_finale, programmato, pubblicato`), `reel_track` (`batch, express`), `task_kind` (`writing, review, validation, dubbing, audio_approval, animation, final_approval, scheduling`), `task_status` (`unassigned, assigned, in_progress, delivered, approved, sent_back, declined, expired, cancelled`; "aperti" = i primi tre), `account_type` (`internal, external`), `external_kind` (`dubber, animator, validator`), `sla_step` (`writing, review, validation, dubbing_accept, dubbing, audio_approval, animation_accept, animation, final_approval, scheduling`), `job_kind` (`notify, drive_reconcile`), `reel_file_kind` (`audio, video, script, other`).
   - **`profiles`:** `account_type account_type not null default 'external'` con backfill `internal` per tutti i profili esistenti; check `not (is_admin and account_type = 'external')`; `external_kind`, `drive_email text`, `absent_until timestamptz`, `deactivated_at timestamptz`. Nessun nuovo grant di colonna (restano solo `full_name`, `daily_reminder_at`, `20261001120000_fase0_security.sql:80-81`). `telegram_chat_id`: azzerati i valori negativi (chat di gruppo) e i duplicati tranne il più recente, poi indice unico parziale (tutto riportato nel report). **`claim_admin_if_first()`** (`20261001120000_fase0_security.sql:84-104`) ridefinita: `update profiles set is_admin = true, account_type = 'internal'` (il primo admin è interno per definizione; senza, su un ambiente nuovo il check `not (is_admin and external)` la farebbe fallire).
   - **`handle_new_auth_user()`** (`20260505203358_initial_schema.sql:81-99`) legge `account_type` da `raw_app_meta_data` (impostabile solo con la chiave service role; **mai** da `raw_user_meta_data`, che l'utente può scrivere); default `external`.
   - **`notifications`:** `revoke update … from authenticated; grant update (read_at) …` (oggi il destinatario può riscrivere tutto il `payload`, `initial_schema.sql:405-406`; l'app non aggiorna mai altre colonne).
   - **`notification_prefs`:** cancellate le righe di `assignment`, `phase_approval_request`, `phase_rejected` (vecchio default Telegram spento), conteggio nel report (§3, canale delle notifiche).
   - **`app_config`** (`key text pk, value jsonb`; lettura admin, scrittura via `set_app_config()` admin/service role) con `escalation_enabled=false`, `standup_enabled=false`, `drive_enabled=false`.
   - **`telegram_link_tokens`** (`token_hash text pk, user_id, expires_at, used_at`; nessun grant ad `authenticated`).
   - **`approval_groups`** (`id, name, approver_id, delegate_id, is_default`, indice unico parziale su `is_default`, check approver ≠ delegate) + riga seed "Tutte le pagine" (`is_default = true`, approvatore impostato dall'admin dopo la migrazione).
   - **`pages`:** `requires_scientific_validation boolean not null default false`, `dubber_titular_id`, `dubber_reserve_id`, `animator_titular_id`, `animator_reserve_id`, `validator_id` (FK `profiles` `on delete set null`), `approval_group_id` (dormiente); check: titolare ≠ riserva per ciascun ruolo, titolare doppiatore ≠ titolare animatore; trigger che rifiuta come titolare/riserva un profilo con `external_kind` incompatibile o disattivato. La pagina di smoke test di produzione si crea con `active = false` (altrimenti genera `buffer_low` ogni giorno).
   - **`reels`:** `state reel_state not null default 'idea'`, `track reel_track not null default 'batch'`, `state_entered_at timestamptz not null default now()`, `script_rev integer not null default 0`; indice `reels_active_state_idx on reels(state, state_entered_at) where published_at is null`. Le colonne Drive (`pages/batches/reels.drive_folder_id`, `reels.kit_ready_at`, `reels.kit_hash`) arrivano con la migrazione di S5.
   - **`comments.internal_only boolean not null default false`** (§3).
   - **`sla_policies`** (`page_id` nullable = default globale, `track`, `step`, `minutes > 0`, `unique nulls not distinct (page_id, track, step)`) con i default di §3.
   - **`tasks`:** `id, reel_id, kind, status, assignee_id (FK profiles on delete restrict; null solo se unassigned), attempt smallint, previous_task_id, started_at, yellow_at, due_at, escalate_at, accepted_at, delivered_at, closed_at, closed_by, closed_via text check in ('app','telegram','sweep','migration','admin'), decision_note, payload jsonb (file consegnato, revisione vista), notified_at, overdue_notified_at, escalated_at, escalation_paused boolean not null default false, requires_drive boolean not null default false (iter3: copiato da `app_config.drive_enabled` alla creazione; cambia dopo solo quando si spegne Drive, che declassa i compiti aperti, S5), origin text check in ('app','migration'), created_by, created_at, updated_at`; check `(status = 'unassigned') = (assignee_id is null)` sui compiti aperti. Indici: **unico parziale `tasks_one_open_per_reel on tasks(reel_id) where status in ('unassigned','assigned','in_progress')`**, `(assignee_id, due_at)`, `(due_at)` ed `(escalate_at)` sui compiti aperti, `(reel_id, created_at)`.
   - **`task_events`** (append-only: `id bigserial, task_id, reel_id, actor_id` (null = sistema)`, op, channel, code, note, created_at`): ogni operazione, riuscita o rifiutata, scritta dalle funzioni SQL; alimenta la scheda "Attività" e le metriche (quota Telegram, tempi di decisione).
   - **`text_change_proposals`** (`reel_id, task_id, proposed_by, field ('hook','corpo','chiusura','cta'), original_text, proposed_text, base_rev, status ('pending','accepted','rejected'), decided_by, decided_at, decision_note`).
   - **`job_outbox`** (`id bigserial, kind, payload jsonb, dedup_key, run_after, attempts, requested_gen int, claimed_gen int, lease_until, lease_token uuid, last_error, done_at, failed_at`; unico parziale su `dedup_key where done_at is null and failed_at is null`). Semantica in S4: claim con lease di 5 minuti e token di lease (fencing), ri-accodamento deduplicato che incrementa `requested_gen`, dead letter dopo 6 tentativi.
   - **`system_heartbeats`** (`name pk, last_run_at, last_report jsonb`).
   - `reel_files` e `reel_folder_shares` arrivano in S5 (R2): nessuna tabella senza uso nella release che la introduce.
   - **Helper:** `is_internal()`, `state_raci_phase(reel_state) → pipeline_phase` (immutable), `legacy_phase_to_state(pipeline_phase, timestamptz) → reel_state` (immutable: `published_at` non nullo → `pubblicato`; altrimenti `research_prescript→idea`, `scientific_validation→validazione`, `script_writing→bozza`, `dubbing→doppiaggio`, `editing→animazione`, `qc→approvazione_finale`, `publication→programmato`, `published→pubblicato`), `sla_minutes(page, track, step)`, `add_sla(start, minutes, track)` (Batch: salta sabato e domenica nel fuso Europe/Rome; Express: tempo reale), `effective_approver(page)` (approvatore; delegato se l'approvatore è assente; `null` se lo sono entrambi → compito `unassigned` agli admin), `visible_reel_ids()` (interni: nessun filtro; esterni attivi: reel con un loro compito aperto o chiuso con esito da ≤ 7 giorni; disattivati: nessuno), `holds_open_task(reel)` (il chiamante ha un compito aperto sul reel; usato da `reels_update_member`, nell'allowlist di `00_guards.sql`). Tutti in `public` con grant ad `authenticated` (servono alle policy), tranne `legacy_phase_to_state`, `sla_minutes`, `add_sla`, `effective_approver` che stanno in `private`.
   - **Helper con attore esplicito** in `private` (mai eseguibili da `authenticated`), per le funzioni chiamate dal service role dove `auth.uid()` è null: `private.is_admin_uid(uuid)`, `private.is_internal_uid(uuid)`, `private.has_raci_role_uid(page, phase, role, uuid)`; le versioni senza argomenti di Fase 0 restano per le policy.
   - **Backfill** (con `trg_reels_updated_at` disattivato come in `20261001130000_fase0_scale.sql:38-40`, perché il digest legge `updated_at`): `state = legacy_phase_to_state(phase, published_at)`, `state_entered_at = phase_entered_at`; normalizzazione delle righe deprecate (`qc` → `phase = 'editing'`, `published` → `'publication'`) e, **regola unica iter3**, dei reel con `published_at` in una fase diversa da `publication` (→ `state = 'pubblicato'`, `phase = 'publication'`): normalizzati ed elencati nel report, non sono una condizione di stop (il dump del 2026-10-01 ne ha 0).
   - **Trigger** creati *dopo* il backfill: `before update of state, phase, posted_url` (iter3: con solo `of state` un update della sola `phase` non scatterebbe), con un nome che lo fa girare **dopo** il trigger esistente di `published_at` (`20261001130000_fase0_scale.sql:18-35`; i trigger `before` girano in ordine alfabetico) → se cambia `state`: `state_entered_at = now()` e, se cambia la macro-fase, `phase = state_raci_phase(state)`, `phase_entered_at = now()`; un cambio di `phase` senza cambio di `state` (il codice vecchio con `decide_phase_advance`, attivo fino al contract) o un `posted_url` scritto dal codice vecchio (che valorizza `published_at`) aggiorna `state = legacy_phase_to_state(phase, published_at)`, così nella finestra di deploy e dopo un uncontract le due colonne non divergono; la migrazione di contract (S2) sostituisce questo ramo con un rifiuto (`phase` si cambia solo cambiando `state`, Architect A-sintesi); `script_rev` incrementato a ogni modifica di HOOK/CORPO/CHIUSURA/CTA/note/`raw_content`.
   - **RLS sulle tabelle nuove:** lettura interni (`tasks`: interni o `assignee_id = auth.uid()`; `text_change_proposals`: interni o `proposed_by = auth.uid()`; `job_outbox`, `system_heartbeats`, `app_config`, `telegram_link_tokens`: solo admin o nessuno), **nessun grant di scrittura** ad `authenticated` (tutto passa dalle funzioni).
3. `<ts>_fase1_access.sql` — **riscrittura delle policy** (spostata qui da S5 dell'iter1), tollerata dal codice in produzione perché tutti i profili esistenti sono `internal`:
   - sostituzione delle letture `using (true)` (`20260505203358_initial_schema.sql:328-400`, `20260512120000_alerts.sql:49`, `20260506120000_phases_and_phase_advance.sql:63`, `20260513130000_dod_checklist.sql:30`, `20260514120000_daily_updates.sql:31`):
     - `reels`: `(select is_internal()) or id = any ((select visible_reel_ids()))`;
     - `pages`, `voice_briefs`: interni, oppure esiste un reel visibile collegato; `batches`: **solo interni** (`source_doc_url`);
     - `comments` (lettura e insert): interni, oppure `target_type = 'reel'`, reel visibile e `internal_only = false`; insert di un esterno forza `internal_only = false`; **update** (iter3): `revoke update on comments from authenticated; grant update (body, mentions, internal_only) on comments to authenticated`; `comments_update_own` (`20260505203358_initial_schema.sql:396-397`) ricreata con `using (author_id = auth.uid())` e `with check (author_id = auth.uid() and ((select is_internal()) or (target_type = 'reel' and target_id = any ((select visible_reel_ids())) and internal_only = false)))`; delete propri invariato;
     - `profiles`: interni o la propria riga; `profile_names(uuid[])` restituisce `id, full_name` solo per id che compaiono come autori di commenti o assegnatari di compiti su reel visibili al chiamante (interni: tutti), mai email;
     - `raci_configs`, `alerts`, `reel_dod_items`, `daily_updates`, `phase_advance_requests`, `page_members`, `reel_assignments`, `approval_groups`, `sla_policies`, `magic_link_invites`: solo interni;
   - `reels_update_member` (`20261001120000_fase0_security.sql:134-137`) → `is_admin() or (is_internal() and (is_page_member(page_id) or holds_open_task(id)))`; `is_page_member()` richiede `is_internal()`; trigger su `raci_configs` che rifiuta id di profili esterni;
   - `admin_set_collaborator(user, account_type, external_kind, drive_email, full_name)` e `offboard_collaborator(user)` (solo admin; il secondo è completato in S2 con la riassegnazione dei compiti). Variante `set_collaborator_as(p_actor, …)` in `public` eseguibile solo da `service_role` (come `task_action_as`; `p_actor` deve essere un admin), per `scripts/fase1-collaborators.ts` e per la prova su dump.
4. `<ts>_fase1_backfill_fn.sql` — definisce `fase1_backfill_open_tasks()` (solo service role, idempotente) **senza eseguirla**: in produzione la lancia il runbook *dopo* `fase1-prod-config.sql` (titolari, approvatori), così i compiti migrati vanno alle persone giuste. Per ogni reel attivo crea il compito aperto dello stato (`origin = 'migration'`, `escalation_paused = true` finché l'admin non conferma, `status = 'in_progress'` o `unassigned`, `started_at = now()`, soglie da `add_sla`, `notified_at = now()`: **nessun messaggio di assegnazione accodato** per i compiti migrati). Assegnatario, nell'ordine: titolare configurato sulla pagina per il ruolo, primo Responsible RACI della macro-fase, altrimenti nessuno (`reel_assignments` non è usato da nessuna parte in `src`, quindi non è una fonte):
   - `bozza → writing`, `validazione → validation` (`pages.validator_id` se presente), `doppiaggio → dubbing`, `animazione/approvazione_finale → animation/final_approval` (quest'ultima all'approvatore effettivo), `programmato` senza `scheduled_at → scheduling`; `idea` e `pubblicato` senza compito;
   - inserisce le voci DoD mancanti dei passi superati (§3, DoD) con `note = '[migrazione Fase 1]'`.

**TypeScript (stessa fetta, perché gli esterni esistono da R1)**
- `scripts/invite-users.ts`: `createUser({ email, email_confirm: true, app_metadata: { account_type: 'internal' } })` e update esplicito di `profiles.account_type = 'internal'` (anche per utenti già esistenti). Rifiuta di girare se l'email non è nell'allowlist interna (`supabase/backups/fase1/internal-emails.txt`, ignorata da git).
- **`scripts/fase1-collaborators.ts`** (iter3; sostituisce in R1 la pagina `/collaboratori`, taglio di §9): legge un CSV rivisto (`supabase/backups/fase1/collaborators.csv`: `email, full_name, external_kind, drive_email`), con `--dry-run` stampa cosa farebbe; per ogni riga `auth.admin.createUser({ email, email_confirm: true, app_metadata: { account_type: 'external' } })` (o trova l'utente esistente e si ferma se è `internal`), poi `set_collaborator_as(<admin>, …)`; il magic link si invia con Resend in un secondo comando (`send-links`), così gli account si creano prima e gli inviti partono al momento della comunicazione. Sottocomando `offboard <email>` → `offboard_collaborator` + ban. La logica condivisa sta in `src/lib/collaborators/admin.ts` (riusata dalla UI quando arriva), che verifica `is_admin` della sessione **prima** di usare il client service role.
- **Deploy anticipato `fase1-pre-r1` (iter3, entro venerdì 16 ottobre, su `main` come un hotfix, con OK dell'utente):** `src/lib/notifications/recipients.ts` con `internalProfiles(supabase)` in forma **tollerante alle colonne**: `select('*')` e filtro in JS `p.account_type !== 'external' && !p.deactivated_at` (prima della migrazione le colonne non esistono e passano tutti, che sono interni), usato da `src/lib/daily-updates/reminder.ts:21-23` e `src/lib/digest/weekly.ts:34` (oggi spediscono a ogni profilo); `src/lib/notifications/mention.ts` scarta i destinatari esterni. Questo deployment, provato su Preview con un profilo esterno di test (nessuna riga `notifications` per lui dopo i cron di digest e promemoria), è il **bersaglio del rollback del codice** (§6): un "Promote" del deployment precedente non può più mandare digest o promemoria ai collaboratori. Tag `fase1-pre-r1`.
- Nella fetta, sopra il deploy anticipato: `src/lib/notifications/mention.ts` filtra i menzionati a interni o esterni che vedono il reel, e **per i commenti `internal_only` solo a interni** (funzione pura `mentionRecipients({ internalOnly, … })` in `recipients.ts`); `getAdminRecipients()` (`src/lib/alerts/dispatch.ts:16-22`) è già limitato agli admin, che sono interni per vincolo. Elenco di ogni `from('profiles')` con client service role rivisto e annotato nel PR.
- `src/lib/notifications/prefs-actions.ts`: `saveOwnPrefMatrix` salva solo le righe diverse dai default e cancella le altre.
- **UI minima:** etichetta dello stato nel header del reel (`src/app/(app)/reels/[id]/page.tsx:86-92`), chiavi `states.*` in `it.json`.

**db-check e strumenti**
- **Toolchain Postgres fissata (iter3, Critic B3).** Sul Mac `postgres` nel `PATH` è la 14.19 (Homebrew ha anche `postgresql@16`, `libpq@18`, `postgrest`; ~10 GB liberi, niente Docker); il piano richiede PG15+ (`unique nulls not distinct`, viste `security_invoker`). Scelta:
  - `run.sh` e `upgrade.sh`: `PG_BIN=${PG_BIN:-/opt/homebrew/opt/postgresql@16/bin}` (già installato) e `PSQL=/opt/homebrew/opt/libpq@18/bin/psql`; gli script si fermano se `"$PG_BIN/postgres" --version` è < 15;
  - `rehearse-dump.sh` e il confronto di schema: **`postgresql@17`** (`brew install postgresql@17` in S1, ~100 MB), rifiutano una major diversa da 17; prima di ogni rilascio anche `run.sh` e `upgrade.sh` girano una volta con `PG_BIN=/opt/homebrew/opt/postgresql@17/bin`.
  - Compromesso: PG16 subito e senza installazioni per l'iterazione quotidiana; PG17 solo dove conta l'uguaglianza con la produzione (17.6): il dump contiene `SET transaction_timeout` (parametro esistente solo da PG17, errore con `ON_ERROR_STOP` su PG16) e il confronto di schema e ACL tra major diverse darebbe falsi positivi. Nessuna SQL di Fase 1 usa sintassi solo PG17.
- `scripts/db-check/run.sh`: ogni migrazione con `psql --single-transaction` (riproduce l'atomicità per file della CLI, §5); `shim.sql` aggiunge `auth.users.raw_app_meta_data` e lo schema `private` non esposto.
- `seed.sql`: gli utenti `a`–`d` diventano esplicitamente `internal` **prima** dell'update di `is_admin` (oggi `seed.sql:11`; ordine invertito, altrimenti il check `not (is_admin and external)` fallisce: il default ora è `external`); nuovo utente **`e` esterno doppiatore** (`external_kind = 'dubber'`). Aggiornati `02_reels.sql`, `04_scale.sql` (`04_scale.sql:4-6` scrive `posted_url` come membro: dal contract passa da `publish_reel`) e le query `MEMBER`/`OUTSIDER` di `api-check.mjs`.
- `checks/00_guards.sql` (nuovo, generico, **solo query sul catalogo**: nessun fixture, nessuna scrittura, così gira anche in sola lettura sulla produzione ai passi 5 e 7 di §8): (1) RLS attiva su ogni tabella `public`; (2) nessuna policy `SELECT` **o `ALL`** con `qual = 'true'` per i ruoli `authenticated` **o `public`** (lista d'eccezioni vuota); (3) ogni vista in `public` ha `security_invoker = true`; (4) **allowlist** delle funzioni `public` eseguibili da `authenticated` (`has_function_privilege`), esclusi i trigger (`prorettype = 'trigger'::regtype`, ad es. `handle_new_auth_user`); nessuna funzione eseguibile da `anon`; (5) nessuna funzione con un argomento `p_actor` eseguibile da `anon`/`authenticated`; (6) nessun `USAGE` su `private` per `anon`/`authenticated`; (7) ogni `security definer` in `public`/`private` ha `search_path` impostato.
- `checks/05_fase1_model.sql`: le **10 righe** di `state_raci_phase()` (tabella in D2); round-trip delle 6 fasi; normalizzazione `qc`/`published`; i trigger allineano `phase`↔`state`; `active_reel_counts()` non conta un reel in `approvazione_finale` come buffer; `authenticated` riceve 42501 su update di `state`, `track`, `phase`, `script_rev` e su insert in `tasks`, `job_outbox`, `app_config`; un utente creato con `raw_user_meta_data.account_type = 'internal'` nasce comunque `external`.
- `checks/07_externals.sql` (anticipato da S5): matrice dell'esterno `e` con 1 reel su 3 (righe visibili per ogni tabella, `batches` = 0, commento `internal_only` invisibile, `profile_names` limitato e senza email, scritture negate, visibilità persa dopo rifiuto/scadenza/annullamento, dopo 7 giorni da una consegna e dopo `offboard_collaborator`); un id esterno in `raci_configs` → errore; `notifications.payload` non aggiornabile; **commenti (iter3):** come esterno un update di `target_id`, `target_type` o `parent_id` → 42501, `internal_only = true` sul proprio commento → violazione del `with check`, update del `body` del proprio commento → ok; come interno `internal_only` modificabile sui propri commenti.
- **Harness di upgrade** `scripts/db-check/upgrade.sh` + `seed-legacy.sql` + `checks-upgrade/01_fase1_mapping.sql`: migrazioni fino all'ultima di Fase 0, fixture legacy (AC7), migrazioni di Fase 1, `fase1_backfill_open_tasks()` due volte (idempotenza), verifiche di conteggi, mappatura, checksum delle righe preesistenti (`md5(string_agg(id||coalesce(published_at::text,''), ',' order by id))`), DoD aggiunte contate a parte, un solo compito aperto per reel, nessun compito su `idea`/`pubblicato`, nessuna riga `notify` per i compiti migrati; un reel migrato in `validazione` approvato → `bozza` con compito `writing` (§6); un reel con `published_at` fuori da `publication` normalizzato; poi `fase1_r1_uncontract.sql` (dopo il contract di S2) e verifica che nessuna policy `using (true)` ricompaia. Da S2 il percorso completo **contract → uncontract → avanzamento legacy (`decide_phase_advance`, `posted_url` scritto come membro) → re-contract → `fase1_reconcile_tasks()`** con invariante di coerenza verde; da S5 la tappa **R1 → R2**: un reel per stato di R1 → `drive_enabled = true` → `drive_backfill()` → ogni compito aperto si completa fino a `programmato`.
- **Dump di produzione (formato fissato in iter3):** ogni dump in `supabase/backups/<data>-prod/` contiene `data.sql` (pg_dump 18 di `libpq@18`, sola data), `schema-public.sql` (`pg_dump --schema-only --schema=public --no-owner`, con ACL) e **`migrations.txt`** (`supabase migration list` sulla produzione, salvato accanto al dump). Il dump di dati **non** contiene `supabase_migrations` (correzione dell'iter2): la versione di riferimento viene da `migrations.txt`.
- **Prova su dump reale** `scripts/db-check/rehearse-dump.sh <dir-dump>` (costruita qui, non a fine progetto come nell'iter1), su PG17:
  1. Postgres usa e getta; `shim.sql`; migrazioni fino all'ultima versione "Remote" di `migrations.txt` (stop se un file locale fino a quella versione manca o è in più);
  2. **confronto dello schema (Architect iter2 n. 5):** `pg_dump --schema-only --schema=public --no-owner` dello schema ricostruito, normalizzato come quello di produzione (tolti commenti, `SET`, `\restrict`/`\unrestrict`, righe vuote; ordinato per oggetto) e confrontato con `schema-public.sql`; ogni differenza non elencata in `scripts/db-check/drift-allow.txt` è **stop**. La prima esecuzione sul dump del 2026-10-01 produce le differenze attese dovute allo shim (estensioni, ruoli Supabase), riviste una volta e salvate nell'allowlist; da lì una policy, un grant o una funzione cambiati a mano in produzione fermano il rilascio;
  3. `auth.users` caricato in una **tabella di appoggio con tutte le colonne** del dump (`rehearse_stage.auth_users`, 34 colonne, con le insert riscritte verso di essa), poi `insert into auth.users (id, email, raw_app_meta_data) select …`; le altre tabelle `auth` sono scartate. Dati `public` caricati con `psql` di `libpq@18` (gestisce `\restrict`) e `set session_replication_role = replica` (nessun trigger: `on_auth_user_created` non crea profili in conflitto, `updated_at` e `published_at` non cambiano); ritorno a `origin`;
  4. `scripts/fase1-migration-report.sql` "prima" (con il controllo dell'**allowlist interna**: stop se un profilo che diventerà `internal` ha un'email fuori da `internal-emails.txt`), migrazioni di Fase 1 in modalità normale;
  5. **creazione degli esterni dallo stesso `collaborators.csv`** che userà il passo 6b: insert in `auth.users` con `raw_app_meta_data = {"account_type":"external"}` (il trigger crea il profilo `external`), poi `set_collaborator_as(<admin del dump>, …)`;
  6. `scripts/fase1-prod-config.sql` (config reale, sotto revisione), `fase1_backfill_open_tasks()`, report "dopo" con **condizioni di stop** (conteggio reel diverso, `state` nullo, migrazioni inattese, compiti duplicati, policy `using (true)` residue, `00_guards.sql` fallito).
  I dati restano in `supabase/backups/` (ignorato da git) e nel DB temporaneo cancellato dal `trap`.
- **`scripts/fase1-prod-config.sql` risolve le persone per email** (mai per uuid copiati a mano): una funzione temporanea `pg_temp.person(email, expected_type, expected_kind)` solleva un'eccezione se l'email non esiste o se `account_type`/`external_kind` non coincidono; tutto lo script è una transazione, quindi un errore non lascia configurazione parziale. Configura gli esterni su **una sola pagina** (rampa di D7); `fase1-prod-config-ramp.sql` estende alle altre pagine dopo 48 h.
- Verifica della CLI (5 minuti, una volta): su un branch locale usa e getta, una migrazione `select 1; select 1/0;` spinta sullo staging deve fallire senza lasciare righe nella cronologia; poi file rimosso.

- Verifica della CLI, stessa occasione: `supabase migration list --db-url` e `supabase db push --db-url` funzionano con la CLI 2.54.11; se sì, la produzione si tocca solo con `--db-url "$PROD_DB_URL"` (variabile della sola shell di rilascio) e la CLI resta **sempre collegata allo staging**; altrimenti `supabase link` alla produzione e ricollegamento allo staging subito dopo ogni comando (§8).

**Fatto quando:** `run.sh`, `upgrade.sh` (PG16) e `rehearse-dump.sh` (PG17, sul dump di produzione del 2026-10-01 con `drift-allow.txt` rivista e un CSV di prova) verdi; deployment `fase1-pre-r1` in produzione (OK dell'utente); `db push` su staging; il fixture Porcino & Papaya mostra gli stati; kanban, dashboard e digest invariati per un interno; un esterno di test creato con `scripts/fase1-collaborators.ts` vede 0 reel.
**Verifica:** i tre script + `pnpm typecheck && pnpm lint && pnpm test`; lettura del report della prova su dump.

### S2 — Motore dei compiti, contract e pannello sul reel · 6 giorni (19–26 ottobre; parte SQL entro venerdì 23 = checkpoint di §9)

**Obiettivo:** un reel percorre tutto il flusso nell'app, con interni ed esterni; il vecchio avanzamento di fase si spegne solo nella migrazione di contract, applicata dopo il deploy del codice.

**Migrazione di expand** `<ts>_fase1_task_engine.sql` (tollerata dal codice in produzione: aggiunge funzioni e il trigger di blocco dello script; per il codice vecchio l'unico cambio di comportamento è che da `revisione` in poi solo gli admin modificano il testo, cioè per i reel legacy in `dubbing`, `editing`, `qc`, `publication`: cambio voluto, annunciato al team nel messaggio di rilascio)
- In `private` (nessun `USAGE`, nessun grant): `_create_task(reel, kind, assignee, status, attempt, previous)` (soglie da `add_sla`; `unassigned` se l'assegnatario è null; `requires_drive = app_config.drive_enabled`; accoda la notifica di assegnazione salvo i compiti `animation` in attesa del kit, §S5), `_pick_work_candidate(reel, kind)` (titolare → riserva; esclude chi ha già rifiutato/lasciato scadere lo stesso tipo sul reel, i profili disattivati e, per `animation`, l'ultimo doppiatore che ha consegnato), `_enqueue(kind, payload, dedup_key, run_after)`, `_log(task, actor, op, channel, code, note)` su `task_events`, `derived_state(reel)` (dal compito aperto, altrimenti dall'esito dell'ultimo chiuso; **reel senza compiti** (iter3): `published_at` non nullo → `pubblicato`, `programmato` con `scheduled_at` (reel migrati) → `programmato`, altrimenti `idea`; il contatore d'invarianti tratta questi casi come coerenti), `_set_state(reel, state)` (verifica `state = derived_state`), `task_action_core(p_actor, p_task, p_op, p_note, p_payload, p_channel)`. L'autorizzazione usa solo `private.*_uid(p_actor)`, mai `auth.uid()`; ogni operazione blocca prima il reel e poi il compito.
- Esposte ad `authenticated` (attore = `auth.uid()`, chiamano `private.task_action_core`): `task_action(task, op, note, payload)`, `start_writing(batch, n)`, `assign_task(task, user)` (admin; verifica tipo e doppiatore ≠ animatore, §3; chiude il compito corrente come `cancelled` e ne crea uno nuovo con `attempt + 1`), `confirm_migrated_tasks(task_ids uuid[])` (admin; ricalcola le soglie da `now()` e azzera i timbri presi in pausa, §3), `set_reel_track(reel, track)` (admin o approvatore effettivo; ricalcola le soglie del compito aperto), `set_absence(user, until)` (solo admin; sposta al delegato i compiti di approvazione aperti, o li rende `unassigned` se è assente anche lui), `schedule_reel(reel, caption, scheduled_at)`, `publish_reel(reel, posted_url)`, `propose_text_change(reel, field, proposed_text)`, `decide_text_proposal(id, decision, note)`.
- Esposte solo a `service_role` (`revoke … from public, anon, authenticated` esplicito): `task_action_as(p_actor, …)` (webhook Telegram), `sweep_tasks(p_now)`, `claim_jobs(p_limit, p_lease)`, `complete_job(id, gen, lease_token)`, `fail_job(id, lease_token, error)`, `standup_snapshot(p_now)`, `standup_claim(p_date)`, `fase1_backfill_open_tasks()`, **`fase1_reconcile_tasks()`** (iter3, idempotente: per ogni reel attivo annulla con `closed_via = 'admin'` e nota `[riconciliazione]` i compiti aperti che non corrispondono allo `state`, poi crea il compito mancante come il backfill, con `escalation_paused = true` e senza messaggio; scrive `task_events` `op = 'reconcile'` e restituisce il conteggio per reel; si usa solo tornando avanti dopo un uncontract).
- `offboard_collaborator(user)` completata: compiti aperti → candidato successivo o `unassigned` (+ notifica admin), titolare/riserva azzerati, `deactivated_at`.
- **Transizioni** (tutte nella stessa transazione, con le righe outbox delle notifiche; `drive_reconcile` si accoda solo se `app_config.drive_enabled`):

  | Evento | Precondizioni | Effetto |
  |---|---|---|
  | `start_writing(batch, n)` | reel in `idea`; admin o Responsible `script_writing` | primi `n` reel per ordinale → `bozza`, compito `writing` (Responsible RACI), notifiche raggruppate per autore |
  | `writing` deliver | assegnatario, `in_progress` | → `revisione` (script bloccato), compito `review` all'approvatore effettivo |
  | `review` approve | script non vuoto (`script_missing`); `p_expected_rev = script_rev` (`stale`) | DoD `script_validated`; pagina con flag → `validazione` + compito `validation`; altrimenti conferma |
  | `review`/`validation` send_back | — | → `bozza`, nuovo `writing` all'ultimo autore, `in_progress`, nota |
  | `validation` approve | `p_expected_rev = script_rev` | conferma |
  | `validation` approve di un compito con `origin = 'migration'` (iter3) | — (`script_missing` non si applica: nel flusso vecchio la validazione precede la stesura) | → `bozza`, compito `writing` al Responsible RACI `script_writing`, nessuna voce DoD; il resto segue le regole normali (con il flag della pagina il testo scritto passa di nuovo in validazione) |
  | conferma | — | → `confermato`; compito `dubbing` `assigned` al candidato (scadenza = accettazione) oppure `unassigned` + notifica admin; `drive_reconcile` (cartella) |
  | `dubbing` accept | assegnatario, `assigned` | → `doppiaggio`; `accepted_at`, `started_at = now()`, soglie del lavoro; `drive_reconcile` (condivisione) |
  | `animation` accept | assegnatario, `assigned` | stato resta `animazione`; `accepted_at`, `started_at = now()`, soglie del lavoro; `drive_reconcile` (condivisione) |
  | `dubbing`/`animation` decline o scadenza dell'accettazione (sweep) | — | chiude (`declined`/`expired`); nuovo compito al candidato successivo, o `unassigned` + notifica admin; `drive_reconcile` (revoca) |
  | `dubbing` deliver | compito con `requires_drive = false`: payload `file_url` che inizia con `https://` (altrimenti `invalid_input`), scritto in `reels.audio_drive_url`, oppure un file `ready`; `requires_drive = true`: file audio `ready` | compito `audio_approval` all'approvatore; `drive_reconcile` (revoca) |
  | `audio_approval` approve | — | DoD `audio_recorded`; se esiste un file audio `ready` lo marca approvato, altrimenti (consegna R1 con link) vale il kit legacy (S5); → `animazione`, compito `animation` `assigned` al candidato; `kit_ready_at = null` + `drive_reconcile` (archivio, kit); se il nuovo compito ha `requires_drive = true` notifica e soglie partono solo a kit pronto |
  | `audio_approval` send_back | — | → `doppiaggio`, nuovo `dubbing` allo stesso doppiatore, `in_progress`; `drive_reconcile` (condivisione) |
  | `animation` deliver | come `dubbing` deliver secondo `requires_drive` (`file_url` `https://` → `reels.video_drive_url`, oppure file video `ready`); payload con `editing_done` e `subtitles` | DoD inserite; → `approvazione_finale`, compito `final_approval`; `drive_reconcile` (revoca) |
  | `final_approval` approve | 5 voci DoD (`qc_approved` inserita nella stessa transazione) | → `programmato`, compito `scheduling` all'SMM |
  | `final_approval` send_back | payload `to` = `animation` (default, anche da Telegram) | → `animazione`, nuovo `animation` allo stesso animatore, `in_progress` (kit invariato: nessuna attesa); `drive_reconcile` |
  | `final_approval` send_back | payload `to` = `dubbing` (solo dall'app) | → `doppiaggio`, nuovo `dubbing` allo stesso doppiatore, `in_progress`; dopo la nuova approvazione audio l'animazione torna allo stesso animatore `in_progress` e, con Drive attivo, aspetta il kit rigenerato |
  | `assign_task` (anche di un `unassigned`) | admin; tipo e doppiatore ≠ animatore (`invalid_assignee`) | compito corrente `cancelled`; nuovo compito: lavori con accettazione → `assigned`, altri → `in_progress`; notifica al nuovo assegnatario; `drive_reconcile` (revoca al precedente) |
  | `schedule_reel` | assegnatario `scheduling` o admin | caption + data, compito `delivered` |
  | `publish_reel` | stato `programmato`; SMM, admin o membro RACI `publication` | `posted_url` (→ `published_at`), → `pubblicato`; **chiude il compito `scheduling` se ancora aperto** (`closed_via = 'app'`) |
  | `offboard_collaborator` | admin | ogni compito aperto dell'utente come `assign_task` verso il candidato successivo; `drive_reconcile` per i reel toccati |

- **Autorizzazioni dentro `private.task_action_core`:** accept/decline solo l'assegnatario; deliver l'assegnatario o un admin; approve/send_back l'assegnatario, l'approvatore o il delegato del gruppo della pagina, o un admin (per `validation` solo assegnatario o admin). Doppia decisione → `invalid_state`. Ogni chiamata, riuscita o no, scrive `task_events`.
- **Blocco dello script:** trigger `before update` su `reels`: se lo stato è `revisione` o successivo e cambiano `hook`, `corpo`, `chiusura`, `cta`, note o `raw_content`, errore quando `current_user = 'authenticated'` e l'utente non è admin (le funzioni `SECURITY DEFINER`, come `decide_text_proposal`, girano come proprietario e passano). `decide_text_proposal` restituisce `proposal_stale` se `script_rev ≠ base_rev`. Il re-sync (`src/lib/batches/actions.ts`, diff alle righe ~179-210 e applicazione alle ~295-336) salta i reel da `revisione` in poi e li mostra come conflitti "in produzione" nell'anteprima (`resync-button.tsx`).

**Migrazione di contract** `<ts>_fase1_r1_contract.sql` — **commit separato**, applicata dopo il deploy del codice (§8):
- `revoke execute on function decide_phase_advance(...) from authenticated`; `drop policy phase_advance_requests_insert_responsible`; richieste `pending` → `cancelled` con nota `[migrazione Fase 1]` (elenco nel report); `revoke update (posted_url) on reels from authenticated`;
- il trigger `phase` → `state` diventa rigido (rifiuta `phase` senza `state`).
- Inverso documentato: `supabase/rollback/fase1_r1_uncontract.sql` ripristina solo grant, policy di insert e trigger permissivo su `state, phase, posted_url` (mai policy `using (true)`, mai drop di tabelle); provato in `upgrade.sh`. **Ritorno in avanti** (iter3): `supabase/rollback/fase1_r1_recontract.sql` (= il contract, rieseguibile) poi `select fase1_reconcile_tasks()`, perché nel frattempo il codice vecchio può aver spostato `phase`/`state` o scritto `posted_url` lasciando compiti aperti non coerenti; provato in `upgrade.sh` (contract → uncontract → avanzamento legacy → re-contract → riconciliazione).

**TypeScript**
- `src/lib/tasks/constants.ts` (specchio di kind/status/state), `src/lib/tasks/semaforo.ts`, `src/lib/tasks/queries.ts` (compito corrente, storico), `src/lib/tasks/actions.ts` (`acceptTask`, `declineTask`, `deliverTask`, `decideTask` con `expectedRev`, `startWriting`, `assignTask`, `setReelTrack`, `scheduleReel`, `publishReel`, `setAbsence`, `proposeTextChange`, `decideTextProposal`, `offboardCollaborator` che banna anche l'utente con `auth.admin.updateUserById`).
- Pagina reel: `src/app/(app)/reels/[id]/task-panel.tsx` sostituisce `PhaseAdvancePanel` (`page.tsx:102-110`), si apre su `?task=<id>` (destinazione dei link email; niente pagina `/compiti/[id]`); modulo di consegna R1 con campo link; `publish-tab.tsx` usa `publishReel` per `posted_url` e **non invia più `posted_url`** nell'update di colonna (`src/lib/reels/actions.ts:127,144`), così continua a funzionare dopo il contract; pulsante Express. Lo storico `task_events` si scrive ma **la scheda "Attività" è tagliata** (Fase 2).
- `src/lib/invites/actions.ts`: `markDoneAsInvitee` non inserisce più `phase_advance_requests` (righe 273-293) ma scrive un commento "Lavoro pronto" e accoda una notifica all'assegnatario del compito aperto; creazione di nuovi inviti disattivata (pannello solo "Revoca"). `src/lib/dod/actions.ts:59` accetta gli stati `animazione`/`approvazione_finale`.
- i18n: `tasks.kind.*`, `tasks.status.*`, `tasks.actions.*`, `tasks.errors.*`, `states.*`.

**db-check**
- `checks/06_tasks.sql`: percorso completo `idea → pubblicato` con attori distinti; ogni operazione con l'attore sbagliato → `not_authorized`; le stesse operazioni via `task_action_as` con attore esplicito (verifica che non dipendano da `auth.uid()`); doppia approvazione → `invalid_state`; invariante "1 compito aperto per reel" (violazione → errore di indice unico); flag validazione sì/no; rifiuto → riserva → `unassigned`; doppiatore escluso dall'animazione; `assign_task` con tipo sbagliato o doppiatore = animatore → `invalid_assignee`; i tre cicli di rimando (script, audio, finale verso animazione e verso doppiaggio); accept dell'animazione (soglie ricalcolate); `publish_reel` chiude `scheduling`; gate DoD; `script_missing`; `stale` con `rev` superata; blocco dello script da `revisione` (membro → errore, admin e proposta accettata → ok, `proposal_stale`); `add_sla` (venerdì 18:00 + 24 h Batch = lunedì 18:00; Express = +24 h esatte; attraversamento del cambio d'ora); `set_reel_track` ricalcola le soglie; `offboard_collaborator`; con `drive_enabled = false` nessuna riga `drive_reconcile`; una riga `task_events` per ogni operazione; `_set_state` con uno stato non derivato → `invalid_state`. Alla fine: **invariante di coerenza** (nessun reel in stato di lavoro senza compito aperto del tipo atteso, salvo `programmato` dopo la programmazione).
- `checks/08_approvals.sql`: approvatore effettivo, assenza → delegato, `set_absence` (solo admin) riassegna, gruppo B, delegato può decidere.
- `checks/03_phase_advance.sql` diviso: prima del contract il vecchio flusso funziona e aggiorna `state` (questa metà gira **solo in `upgrade.sh`**, perché `run.sh` applica tutte le migrazioni, contract compreso); dopo il contract `decide_phase_advance` non è eseguibile da `authenticated`, insert negato, `phase` senza `state` rifiutato. `checks/02_reels.sql` (update con compito aperto; `posted_url` → 42501 dopo il contract) e `04_scale.sql` (pubblicazione via `publish_reel`). `api-check.mjs`: il flusso `decide_phase_advance` (righe 105-111) diventa `task_action` via RPC; `/rpc/task_action_as`, `/rpc/sweep_tasks`, `/rpc/claim_jobs` come utente → errore; `/rpc/task_action_core` → 404 (schema `private` non esposto).

**Fatto quando:** su staging gli utenti di `scripts/fase1-seed-staging.ts` (pagina "Pagina Test" prefisso `TT` con `active = false`; autore, approvatore, delegato, SMM interni; doppiatore e animatore **esterni** con titolare e riserva) percorrono un reel da `idea` a `pubblicato` solo dall'interfaccia, consegnando con link; `upgrade.sh` prova expand → contract → uncontract → avanzamento legacy → re-contract → `fase1_reconcile_tasks()`.
**Verifica:** `run.sh` (checks 00–08), `upgrade.sh`, `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

### S3 — Viste per ruolo, configurazione, interfaccia degli esterni · 3,5 giorni (27–30 ottobre mattina; con i tre tagli di R1 di §9, senza tagli 5 giorni)

**Obiettivo:** ognuno apre l'app e vede cosa deve fare; Gabri approva da telefono; la pagina si configura senza SQL; un esterno lavora vedendo solo il proprio (UI sopra la RLS di S1).

**Interni**
- **`/compiti`** (`src/app/(app)/compiti/page.tsx`): compiti aperti dell'utente, Express prima poi scadenza, semaforo, azioni del compito. Diventa la home: `src/app/page.tsx:4`, `src/app/auth/callback/route.ts:7`, `src/lib/supabase/middleware.ts:56` → `/compiti`.
- **`/approvazioni`** (mobile-first): compiti `review`, `validation`, `audio_approval`, `final_approval` dove l'utente è assegnatario, approvatore o delegato; card con script (e la sua `rev`), media secondo l'esito dello spike S0 (R1: link consegnato dall'esterno; R2: audio con `<audio>` servito dal server, video con "Apri in Drive"), ultima nota di rimando, proposte accettate; pulsanti Approva (1 tap) e Rimanda (tap → nota opzionale → conferma; per l'approvazione finale destinazione preselezionata "all'animazione", alternativa "al doppiaggio").
- **Kanban** `/pipeline`: **resta per macro-fase** (colonne attuali, alimentate da `phase` che il trigger tiene allineata); ogni card mostra il badge dello stato e il semaforo del compito aperto (embed `tasks` filtrato sui compiti aperti), Express prima. La vista `reel_board` e le 9 colonne di stato sono tagliate (Fase 2, insieme al dashboard per stato).
- **Impostazioni produzione della pagina** `src/app/(app)/pages/[id]/production-settings.tsx`: flag validazione, titolari e riserve (solo profili compatibili), validatore, **tabella SLA Batch/Express con override per pagina** (la spec chiede che l'admin modifichi gli SLA per pagina: non tagliato), gruppo approvatori (nascosto finché c'è un solo gruppo). Server action in `src/lib/pages/actions.ts`.
- **Approvatori:** sezione admin in `/settings` per approvatore e delegato del gruppo predefinito e per l'assenza ("assente fino al …", solo admin; l'autoservizio è tagliato).
- **Batch:** pulsante "Avvia stesura (N)" in `src/app/(app)/batches/[id]/page.tsx` (niente selezione multipla).
- **Navigazione** `src/components/app-shell/top-nav.tsx:11-18`: "Compiti", "Approvazioni" (badge con il conteggio) davanti alle voci esistenti.
- **Allineamenti:** digest (`src/lib/digest/weekly.ts:40-45`) conta i compiti chiusi invece delle richieste approvate; `runAllRules` (`src/lib/alerts/rules.ts:94-97`) smette di proporre `phase_stuck` (sostituito dall'escalation; l'enum resta).

**Esterni (spostato qui da S5 dell'iter1)**
- **Guardia in `src/proxy.ts`** (non nel layout, che non vede il percorso né gira nelle navigazioni client): `updateSession` legge `profiles.account_type` della propria riga (RLS lo consente) e manda un esterno a `/compiti` fuori da `/compiti`, `/reels/<id>`, `/settings`, `/auth/*`; i Server Component ricontrollano. Variante esterna di `TopNav`; `AdminBootstrapBanner` nascosto agli esterni (`getAdminStatus()` vede solo la propria riga).
- **`/collaboratori`** (admin): **taglio di R1** (§9). In R1 creazione, invio dei magic link e offboarding passano da `scripts/fase1-collaborators.ts` (S1), sulla stessa logica `src/lib/collaborators/admin.ts`; la pagina (elenco, creazione, offboarding) arriva dopo R1 se resta tempo nella stabilizzazione o in S6, altrimenti in Fase 2.
- Reel per l'esterno: script in sola lettura con "Proponi modifica" per blocco, note, link/file del passo precedente, commenti (senza `internal_only`), pannello del compito; nascosti RACI, DoD, inviti, batch. Commenti degli interni con casella "Nota interna".
- `src/lib/comments/queries.ts:37-48`: nomi autori tramite `profile_names`.
- Proposte: `src/app/(app)/reels/[id]/proposals.tsx` con **testo originale e proposto affiancati** per blocco (taglio di R1: il diff parola per parola `src/lib/text-diff.ts` passa a dopo R1); notifica `text_proposal` all'approvatore.

**db-check / api-check:** query di `/compiti` e `/approvazioni` con l'ordinamento Express; kanban con embed del compito aperto (conteggio esatto per colonna); come esterno: `reels`, `tasks` con embed, `comments`, `profiles` (solo la propria riga), `profile_names` (nessuna email), `batches` vuoto.

**Fatto quando:** da iPhone (staging su URL pubblico, §7.3) Gabri-test approva 3 elementi in < 2 min; kanban con badge e semaforo corretti; configurazione completa di "Pagina Test" (inclusi due override SLA) dall'interfaccia; un doppiatore esterno di test creato con `scripts/fase1-collaborators.ts` entra con il magic link, vede 1 reel, `/pipeline` lo rimanda a `/compiti`, propone una modifica che l'approvatore accetta; `fase1-collaborators.ts offboard` su un esterno di test → 0 reel visibili, login bloccato e compito riassegnato.
**Verifica:** `run.sh`, `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, e2e E2/E4/E6/E11/E12 (parte R1).

### S4 — Notifiche operative: outbox, Telegram con pulsanti, sweep, stand-up · 4 giorni (30 ottobre pomeriggio–5 novembre mattina)

**Obiettivo:** il sistema rincorre le persone al posto di Gabri.

- **Outbox in SQL** (migrazione `<ts>_fase1_outbox.sql`, solo funzioni service role):
  - `claim_jobs(p_limit, p_lease interval default '5 min')`: prende i job con `done_at` e `failed_at` nulli, `run_after <= now()` e `lease_until` nullo o scaduto (`for update skip locked`), imposta `lease_until = now() + p_lease`, `attempts + 1`, `claimed_gen = requested_gen` e un nuovo **`lease_token = gen_random_uuid()`**, che restituisce; un job il cui processo è morto torna disponibile alla scadenza del lease.
  - `_enqueue` con `dedup_key` già pendente: `requested_gen + 1`, `run_after = least(...)` (nessuna riga nuova). `complete_job(id, gen, lease_token)`: se `requested_gen > gen` (qualcosa è cambiato mentre il job girava) il job torna pendente con `lease_until = null` invece di chiudersi.
  - **Fencing (iter3):** `complete_job` e `fail_job` agiscono solo se `lease_token` coincide con quello della riga, altrimenti restituiscono `stale_lease` senza toccarla: un worker lento non può chiudere un job già ripreso da un altro. In più ogni route che svuota l'outbox ha `maxDuration` (60 s) ben sotto il lease di 5 minuti.
  - `fail_job`: backoff 2^n minuti; al 6° tentativo `failed_at` (dead letter, visibile in `job_health`).
- **Drain** `src/lib/jobs/drain.ts`: `claim_jobs` → handler per tipo → `complete_job`/`fail_job`. Il handler `notify` ricontrolla al momento dell'invio che il compito sia ancora aperto e dello stesso assegnatario (altrimenti chiude il job senza inviare). Le server action e il webhook chiamano `after(() => drainOutbox({ limit: 20 }))`; `drainOutbox()` controlla anche `system_heartbeats('task_sweep')` e, se è più vecchio di 30 minuti, manda un evento Sentry (al massimo uno all'ora).
- **Notifiche dei compiti**
  - `src/lib/notifications/task-messages.ts`: testo, link `/reels/<id>?task=<taskId>` e pulsanti per tipo di compito; titoli con escape HTML.
  - `src/lib/notifications/dispatch.ts` accetta `actions` opzionali; per gli eventi dei compiti usa la funzione pura `resolveTaskChannels({ telegramLinked, prefs, defaults })` (§3: Telegram primario, email solo se Telegram non è disponibile, spento o l'invio fallisce in modo definitivo: 403, 400 `chat not found`, o job in dead letter; 429 e 5xx → `fail_job` e nuovo tentativo, nessuna email). `CHANNEL_DEFAULTS` (`dispatch.ts:14-25`) e `NOTIFICATION_EVENTS` (`types.ts:4-15`) estesi; Telegram attivo di default per gli eventi dei compiti. `/settings` spiega la regola sotto la matrice.
  - `src/lib/notifications/telegram.ts`: `sendTelegramMessage(chatId, text, { replyMarkup, silent })` (`silent` = `disable_notification` per le notifiche Batch tra 20:00 e 08:00 Europe/Rome, §3), `answerCallbackQuery`, `editMessageText`.
  - Nessuna pulizia dei pulsanti superati (tagliata): un pulsante vecchio risponde "Già deciso". Nessun `chat_id`/`message_id` salvato in `notifications.payload`.
- **Webhook** `src/app/api/telegram/webhook/route.ts`:
  - `callback_query` con `src/lib/telegram/callback.ts` (parse/format `v1:<op>:<uuid>[:<rev>]`, op ∈ `acc, dec, apr, rim, rimc, ann`): solo `chat.type = 'private'`; `from.id` → profilo attivo; `rim` sostituisce i pulsanti con "Conferma rimando / Annulla" (destinazione preselezionata); le altre chiamano `task_action_as` con `p_channel = 'telegram'`; sempre `answerCallbackQuery` + modifica del messaggio con l'esito (`ok`, "Già deciso", "Non autorizzato", "Testo cambiato: riapri"); risposta HTTP 200;
  - `/start`/`/link` accettati solo in chat privata; `my_chat_member` registrato nei log (id della chat del gruppo);
  - **registrazione del webhook (iter3):** nel repo non c'è alcuna chiamata `setWebhook` e la registrazione attuale in produzione è sconosciuta. `scripts/telegram-set-webhook.ts` chiama `setWebhook(url, secret_token = <segreto dell'header già verificato in route.ts:14-20>, allowed_updates = ["message","callback_query","my_chat_member"])` e poi `getWebhookInfo`, e fallisce se `allowed_updates` o l'URL non coincidono; si usa su staging in S4 e in produzione al passo 6c di §8;
  - `src/lib/notifications/telegram-link.ts`: token opaco di 32 caratteri `[A-Za-z0-9_-]` in `telegram_link_tokens` (hash, 15 min, monouso, §D4) al posto di `<userId>.<sig>` (righe 19-33); a collegamento riuscito, email all'utente ("Telegram collegato al tuo account; se non sei stato tu, scollegalo da Impostazioni"); un `chat_id` già usato da un altro profilo viene rifiutato (indice unico di S1).
- **Sweep** `src/lib/tasks/sweep.ts` (`runTaskSweep()`, indipendente dal trasporto) chiamato da **`src/app/api/cron/task-sweep/route.ts`** (`*/5 * * * *` in `vercel.json`, `isAuthorizedCronRequest()`, `maxDuration = 60`): `sweep_tasks(now)` poi `drainOutbox({ limit: 100 })`; aggiorna `system_heartbeats('task_sweep')`. In SQL, un reel alla volta (lock reel → compito, `skip locked`): compiti `assigned` oltre `due_at` → `expired` e candidato successivo; timbro `overdue_notified_at` oltre `due_at` (notifica all'assegnatario); timbro `escalated_at` oltre `escalate_at` (notifica all'approvatore effettivo; al delegato e agli admin se l'assegnatario è l'approvatore stesso; agli admin per i compiti `unassigned`); con `app_config.escalation_enabled = false` o `escalation_paused` solo timbro e `task_events`, nessuna notifica (§3); da R2 accoda `drive_reconcile` per i reel con condivisioni aperte senza compito aperto del titolare e per i reel con riconciliazione fallita; conteggio delle violazioni d'invariante.
- **Stand-up** `src/app/api/cron/standup/route.ts` (06:30 e 07:30 UTC; parte solo alle 08:30 ± 10 min di Roma, una volta al giorno con un **claim atomico** `standup_claim(p_date)`: `update system_heartbeats set last_run_at = now(), last_report = jsonb_build_object('date', p_date) where name = 'standup' and last_report->>'date' is distinct from p_date returning true`, così due invocazioni dello stesso cron non mandano due messaggi; sabato e domenica solo se ci sono Express o ritardi; spento se `app_config.standup_enabled = false`): `standup_snapshot(now)` (in ritardo, consegne di oggi, da assegnare; Express prima) → `src/lib/standup/format.ts` (≤ 4096 caratteri, "+N altri — apri l'app") → `TELEGRAM_TEAM_CHAT_ID`; se manca la chat, email agli admin. Il messaggio segnala anche heartbeat vecchio, job in dead letter e violazioni (salute del sistema senza card dedicata).
- **Salute del sistema:** regola `job_health` nell'alert engine giornaliero (heartbeat dello sweep > 30 min, età del job pendente o in lease più vecchio > 30 min, job in dead letter > 0, violazioni d'invariante > 0). La card "Salute sistema" in `/alerts` è tagliata: bastano l'avviso `job_health`, la riga nello stand-up ed Sentry.
- **Env:** `TELEGRAM_TEAM_CHAT_ID`; gli interruttori sono in `app_config` (§3).
- **db-check:** `checks/09_outbox_sweep.sql`: sweep doppio → un timbro e una riga outbox per soglia; escalation spenta → timbri senza righe `notify`, riaccesa → solo soglie nuove; `claim_jobs` non restituisce due volte lo stesso job dentro il lease e lo restituisce dopo la scadenza; dedup che incrementa `requested_gen` e `complete_job` con generazione vecchia che ri-arma il job; `complete_job`/`fail_job` con un `lease_token` superato → `stale_lease` e riga invariata; `standup_claim` due volte nello stesso giorno → una sola `true`; dead letter al 6° tentativo; lo sweep salta un reel bloccato da un'altra transazione; tutte le funzioni della fetta negate ad `authenticated`. api-check: `task_action_as`, `sweep_tasks`, `claim_jobs` negati come utente.
- **unit:** `callback.ts` (≤ 64 byte, `rev`), `standup/format.ts`, `resolveTaskChannels`, `isQuietHour` per `silent` (cambio d'ora del 25/10/2026), formato del token di collegamento.

**Fatto quando:** su staging (bot di staging + tunnel `cloudflared tunnel --url http://localhost:3000` + `scripts/cron-loop.ts`) un'approvazione da Telegram chiude il compito con `closed_via = 'telegram'` e nessuna email; `scripts/fase1-time-travel.ts` sposta indietro `due_at` → sweep → notifiche attese una sola volta; un processo di drain ucciso a metà non blocca il job oltre il lease; `getWebhookInfo` del bot di staging mostra i tre `allowed_updates`; `fase1-prod-config.sql` e `collaborators.csv` pronti e provati con `rehearse-dump.sh`.
**Verifica:** `run.sh` (checks 00–09), `pnpm test`, e2e E1 (R1), E3, E5, E9, E10.

### R1 — Rilascio 1 (prova 5–6 novembre, seconda prova e produzione lunedì 9 novembre) · 1,5 giorni + 2 giorni di stabilizzazione

Procedura in §8 (prova completa su dump il 5–6, congelamento della creazione di account, seconda prova su un dump fresco la mattina del 9, expand, codice, account esterni 6b, webhook 6c, contract, config su una pagina, backfill). Poi due giorni riservati a bug e supporto del primo uso reale con interni ed esterni, prima di iniziare il Drive; a 48 h senza anomalie si estende la rampa degli esterni (D7). Se il checkpoint del 23 ottobre fallisce (§9) le stesse date scorrono di una settimana: R1 lunedì 16 novembre.

### S5 — Drive: cartelle, upload, kit, condivisione (R2) · 6 giorni (11–18 novembre)

**Obiettivo:** file e kit arrivano da soli nel posto giusto con il nome giusto; l'accesso Drive degli esterni segue i compiti.

**Migrazione** `<ts>_fase1_drive.sql` (additiva): `pages/batches/reels.drive_folder_id`, `reels.kit_ready_at`, `reels.kit_hash`; `reel_files` (`reel_id, task_id, kind, version, status ('uploading','ready','failed'), drive_file_id unique, name, mime_type, size_bytes, web_view_link, uploaded_by, approved_at, archived_at`; unico `(reel_id, kind, version)`); `reel_folder_shares` (`reel_id, user_id, email, drive_permission_id, granted_at, revoked_at, last_error`); funzioni `prepare_upload(task, kind, ext, mime, size)` e `finish_upload(file_row, drive_file_id, web_view_link)` (solo chi tiene il compito, `authenticated`), `drive_desired_state(reel)`, `save_drive_folder(reel, kind, folder_id)`, `mark_drive_reconciled(reel, kit_hash, folder_ids, shares jsonb)` e **`drive_backfill()`** (accoda `drive_reconcile` per ogni reel attivo da `confermato` in poi; idempotente grazie al `dedup_key`) (tutte solo service role). Le precondizioni di consegna dipendono dal **compito**, non dall'interruttore globale: `requires_drive = true` (compiti creati con Drive attivo) → file `reel_files` `ready` del tipo giusto; `requires_drive = false` (compiti nati in R1) → link `https://` o file `ready` (iter3, Architect n. 2 / Critic B2). **`finish_upload` scrive anche `reels.audio_drive_url`/`video_drive_url`** (`web_view_link`), così il codice di R1 e un eventuale rollback vedono sempre il file consegnato.

**Job unico `drive_reconcile(reel)`** (`dedup_key = 'drive:<reel_id>'`, sostituisce i cinque job dell'iter1) — `src/lib/jobs/handlers/drive-reconcile.ts`, idempotente, sempre nello stesso ordine:
1. **cartella:** `ensureReelFolder()` (`<PP> — <Pagina>/<Batch>/<PP-2610-01> — <titolo>` + `archivio/`); **l'id si salva con `save_drive_folder()` subito dopo ogni `files.create`** (iter3), non solo al passo 5, così un crash a metà non crea cartelle doppie; recupero per `appProperties.reelId` solo se l'id manca;
2. **archivio:** le versioni audio non approvate e superate vanno in `archivio/`;
3. **kit** (solo da `animazione` in poi): `kit_hash` = hash di HOOK/CORPO/CHIUSURA/CTA, note, proposte accettate e id dell'audio approvato; se diverso da quello salvato scrive `<codice>_script_v<n>.txt` (la versione precedente in `archivio/`). **Kit legacy** (iter3): se il reel non ha un audio approvato in `reel_files` ma ha `audio_drive_url` (consegna R1 con link), il kit è script + `<codice>_audio_link.txt` con l'URL, e `kit_hash` usa l'URL al posto dell'id del file;
4. **permessi:** desiderati = `drive_email ?? email` degli assegnatari esterni con compito `in_progress` di tipo `dubbing` o `animation` sul reel (la validazione precede la cartella; ruolo `reader`, `writer` solo con U3); crea quelli mancanti, **revoca tutti gli altri** registrati in `reel_folder_shares` o presenti sulla cartella con dominio esterno, **saltando i permessi con `permissionDetails[].inherited = true`** (ereditati dallo Shared Drive: non si revocano dalla cartella e il tentativo fallirebbe a ogni giro);
5. `mark_drive_reconciled()`: salva id e `kit_hash`, imposta `kit_ready_at` se il kit corrisponde all'audio approvato (o al link, per il kit legacy) e, se il compito `animation` aperto ha `requires_drive = true` e non è ancora stato notificato, **fa partire le sue soglie e accoda la notifica** (l'animatore viene avvisato solo a kit pronto, anche dopo un rimando). Finché il kit non è pronto, accept e deliver di un compito `animation` con `requires_drive = true` restituiscono `kit_not_ready` e il pannello mostra "Kit in preparazione"; i compiti `animation` nati in R1 non hanno questo cancello.
Se nel frattempo lo stato cambia, `requested_gen` cresce e il job riparte (S4): un `share` ritentato dopo una revoca non può lasciare un permesso vivo, perché ogni esecuzione ricalcola lo stato desiderato. Errore "non è un account Google" → `last_error` sulla condivisione, avviso admin e messaggio all'esterno; il job non fallisce all'infinito.

**Upload** (secondo l'esito dello spike S0):
- **U1:** `prepare_upload` riserva la riga `uploading` con la versione → `src/lib/drive/upload.ts` crea la sessione resumable con `Origin`, `X-Upload-Content-Type/Length`, `appProperties { reelId, taskId, fileRowId }` → `src/components/drive/resumable-upload.tsx` invia chunk da 8 MiB con `Content-Range`, barra di avanzamento, ripresa → `finishUpload` verifica i metadati Drive (cartella, `appProperties`, dimensione) e chiama `finish_upload`. Limiti: audio ≤ 300 MB, video ≤ 4 GB. Righe `uploading` > 24 h → `failed` nello sweep.
- **U3:** "Apri cartella" + "Sincronizza": il server cerca nella cartella il file nuovo dell'utente, lo rinomina col nome standard e chiama `finish_upload`.

**Media per l'approvazione** (esito spike S0): `src/app/api/media/[fileId]/route.ts` inoltra l'audio da Drive con lo service account rispettando `Range` (solo a chi vede il reel, verificato via RLS su `reel_files`); il video si apre con "Apri in Drive" (approvatore e delegato sono membri dello Shared Drive).

**Attivazione in R2:** `fase1-prod-config.sql` imposta `drive_enabled = true` ed esegue `select drive_backfill()`; i reel in volo ricevono cartella, kit (anche legacy) e permessi. **Passaggio dei compiti aperti** (iter3):
- `dubbing`/`animation` nati in R1 (`requires_drive = false`): consegnano ancora con link (o con upload, se preferiscono); l'animazione non aspetta il kit;
- `audio_approval` aperti al passaggio, con audio consegnato come link: l'approvazione non trova un file da marcare e vale il kit legacy; il nuovo compito `animation` nasce con `requires_drive = true` e parte quando `drive_reconcile` ha scritto il kit legacy;
- rimandi dopo il passaggio (anche "al doppiaggio"): i compiti nuovi seguono Drive; se l'audio approvato resta quello del link, vale il kit legacy;
- **spegnere Drive** (incidente, Scenario 3): `set_app_config('drive_enabled', false)` mette `requires_drive = false` sui compiti aperti (`task_events` `op = 'drive_off'`), così tornano subito alla consegna con link; riaccendendo, solo i compiti nuovi tornano su Drive.

- Scheda "File" del reel: elenco `reel_files` con link Drive e versione approvata; campi URL legacy (`audio_drive_url`, `video_drive_url`) visibili agli admin **e a chi ha o ha avuto un compito sul reel** (stessa visibilità del reel) quando non esiste un file approvato dello stesso tipo in `reel_files`: l'animatore di un reel di R1 continua a vedere il link dell'audio.
- `src/lib/drive/client.ts:24` → scope `https://www.googleapis.com/auth/drive`; env `GOOGLE_SHARED_DRIVE_ID` (Shared Drive diverso per staging e produzione).
- **db-check** `checks/10_files.sql`: prepare/finish solo per chi tiene il compito, versioni crescenti, `finish_upload` scrive anche `audio_drive_url`, RLS su `reel_files`/`reel_folder_shares`, `drive_desired_state` dopo assegnazione, rimando e revoca, `mark_drive_reconciled` fa partire le soglie dell'animazione una sola volta. **Passaggio R1 → R2** (iter3): con `drive_enabled = false` un reel per stato di R1 (`confermato`; `doppiaggio` con `dubbing` aperto; `doppiaggio` con `audio_approval` aperto e audio come link; `animazione` con `animation` `assigned` e `in_progress`; `approvazione_finale`; `programmato`) → `drive_enabled = true` → `drive_backfill()` → `mark_drive_reconciled` simulato (kit legacy) → ogni compito aperto si chiude fino a `programmato` senza `kit_not_ready` né `file_missing`; un `final_approval` rimandato all'animazione dopo il passaggio crea un compito `requires_drive = true` che parte a kit legacy pronto. **unit** `naming.ts`, calcolo di `kit_hash` (anche legacy), differenza permessi desiderati/attuali con permessi ereditati ignorati.

**Fatto quando:** su "Reelificio Staging" lo scenario E8 passa con `scripts/check-drive-folder.ts` (contenuto e permessi); lo scenario **E13** (passaggio R1 → R2 con un reel per stato, creati con Drive spento) passa prima di accendere Drive sullo staging; un job `drive_reconcile` eseguito due volte di fila e uno interrotto a metà convergono allo stesso stato, senza cartelle doppie; un rimando al doppiaggio rigenera il kit prima di avvisare l'animatore.
**Verifica:** `run.sh` (checks 00–10), `upgrade.sh` (tappa R1 → R2), `pnpm test`, e2e E1 (R2), E4 (upload ≥ 20 MB), E8, E13.

### S6 — Collaudo completo, documentazione, R2 · 3,5 giorni (19–24 novembre: collaudo 19–20, R2 lunedì 23, documenti 24)

- Scenari e2e E1–E13 (§7.3) completi su staging con i dati di R2, checklist in `scripts/fase1-e2e/README.md`; tempi di AC2 misurati su iPhone. Se resta tempo: pagina `/collaboratori` e diff parola per parola (tagli di R1), altrimenti Fase 2.
- `scripts/fase1-anonymize.sql` (cancellazione GDPR per anonimizzazione, §3) e la sua procedura in `CLAUDE.md`.
- Documentazione (attività di esecuzione, non di questo piano): `CLAUDE.md` (stato del repo, nuove env, cron Vercel, schema `private`, scope Drive, regole stato/compiti, procedura expand → codice → contract); `docs/brain-plan.md`: riga 9 (gli esterni hanno account), riga 60 (file su Drive, non su Supabase Storage), checklist Fase 0 alle righe 96-100 (Supabase Pro, Vercel Pro, Inngest spostato in Fase 2, Sentry fatto), checklist Fase 1 ed esiti degli spike; `.env.example`.
- R2 secondo §8 (0,5 g): prova su dump (con il confronto di schema), migrazione Drive, codice, `drive_enabled = true`, `drive_backfill()`, controllo che ogni compito aperto di R1 abbia un percorso di consegna (report: compiti `requires_drive = false` aperti per tipo, reel in `animazione` con kit legacy pronto).

**Fatto quando:** E1–E12 passati e firmati nella checklist; R2 in produzione; documenti aggiornati.
**Verifica:** checklist e2e; report post-R2; `scripts/check-drive-folder.ts` su un reel reale.

---

## 6. Migrazione dei dati esistenti

Lo stato si calcola nella migrazione; i compiti li crea `fase1_backfill_open_tasks()`, lanciata dal runbook dopo `fase1-prod-config.sql` (§8). Assegnatario: titolare configurato per il ruolo → primo Responsible RACI della macro-fase → `unassigned`. Per `phase` dopo la migrazione vale la tabella `state_raci_phase()` di D2 (le righe `qc` diventano `editing`, `published` diventa `publication`).

| Fase legacy (`reels.phase`) | `published_at` | Nuovo `state` | Compito aperto creato |
|---|---|---|---|
| `research_prescript` | null | `idea` | nessuno |
| `scientific_validation` | null | `validazione` | `validation` (validatore della pagina), `origin = 'migration'`: approvato → `bozza` + `writing` (S2) |
| `script_writing` | null | `bozza` | `writing` |
| `dubbing` | null | `doppiaggio` | `dubbing` `in_progress` (titolare doppiatore) |
| `editing` | null | `animazione` | `animation` `in_progress` (titolare animatore) |
| `qc` (deprecata) | null | `approvazione_finale` | `final_approval` all'approvatore effettivo |
| `publication` | null | `programmato` | `scheduling` solo se `scheduled_at` è null |
| `published` (deprecata) | qualsiasi | `pubblicato` | nessuno |
| qualsiasi | non null | `pubblicato` | nessuno |

- **Invarianti verificate:** numero di reel invariato (la migrazione non inserisce né cancella righe in `reels`); commenti, righe `reel_dod_items` preesistenti, `published_at`, `posted_url` invariati (checksum); le voci DoD aggiunte dal backfill (`note = '[migrazione Fase 1]'`) contate a parte; `phase` invariato per tutte le fasi attive grazie al round-trip, **salvo** le righe normalizzate (`qc`, `published`, `published_at` fuori da `publication`), elencate una per una; richieste pending → `cancelled` con nota (conteggio nel report, nella migrazione di contract).
- **Report pre-migrazione e condizioni di stop** (`scripts/fase1-migration-report.sql`, sola lettura, eseguito sul dump nella prova e poi su produzione): conteggi per fase e pubblicati, commenti, DoD, richieste pending, **elenco dei profili che diventeranno `internal`** (email, data di creazione), `telegram_chat_id` duplicati o negativi, righe `qc`/`published`, reel con `published_at` fuori da `publication` (normalizzati), reel in `scientific_validation` (andranno in `bozza` alla validazione), profili senza utente auth. **Stop** se: un profilo che diventerà `internal` ha un'email **fuori dall'allowlist interna** rivista (`supabase/backups/fase1/internal-emails.txt`; protegge da un esterno creato in produzione prima dell'expand), il conteggio dei reel prima/dopo differisce, uno `state` è nullo, un reel attivo ha più di un compito aperto, `migration list`/`db push --dry-run` elencano migrazioni diverse da quelle attese, il confronto di schema trova differenze fuori da `drift-allow.txt`, `00_guards.sql` fallisce sul dump.
- **Casi segnalati, non corretti in automatico:** compiti creati senza assegnatario (lista "da assegnare" per l'admin). I reel in `validazione` e quelli con `published_at` fuori da `publication` ora hanno una regola (S2 e backfill) e compaiono nel report solo come elenco.
- **Anti-tempesta di notifiche:** i compiti migrati partono all'ora del backfill (`started_at = now()`), non da `phase_entered_at`; nascono con `escalation_paused = true` e `notified_at = now()` (nessun messaggio di assegnazione) finché l'admin non li conferma (`confirm_migrated_tasks`); `escalation_enabled` e `standup_enabled` in `app_config` restano spenti per le prime 24–48 h e servono come interruttori per gli incidenti.
- **Richieste di avanzamento cancellate:** il report elenca richiedente e reel di ogni richiesta `pending` chiusa dal contract, così l'admin avvisa le persone coinvolte.
- **Finestre di deploy:** tra il `db push` di expand e il deploy del codice il codice vecchio funziona per intero (il contract non è ancora applicato; `decide_phase_advance` aggiorna anche `state` via trigger). Tra il deploy e il contract il codice nuovo non usa i percorsi vecchi. Freeze annunciato di 45 minuti per tutta la sequenza.
- **Rollback (onesto, a livelli):**
  1. **prima del contract:** "Promote" su Vercel del deployment **`fase1-pre-r1`** (codice Fase 0 + filtro dei destinatari tollerante alle colonne, in produzione da S1 e provato su Preview con un esterno di test: digest, promemoria e menzioni non raggiungono esterni). Il codice vecchio legge `phase` (allineata dai trigger) e la RLS `is_internal() or …` è equivalente per gli interni. Gli esterni vedrebbero un'interfaccia che non li conosce, nessun dato in più e nessuna email interna; i cron del deployment promosso restano gli stessi di oggi (alert, promemoria, digest), già filtrati;
  2. **dopo il contract:** `supabase/rollback/fase1_r1_uncontract.sql` (fuori da `migrations/`, provato in `upgrade.sh`) ripristina il grant su `decide_phase_advance`, la policy di insert delle richieste, il grant su `posted_url` e il trigger permissivo su `state, phase, posted_url`, poi Promote di `fase1-pre-r1`. **Non ripristina mai le policy `using (true)` e non elimina tabelle**: compiti, proposte e consegne restano; le consegne restano visibili al codice vecchio perché il motore (R1) e `finish_upload` (R2) scrivono anche `audio_drive_url`/`video_drive_url`. **Per tornare avanti:** deploy del codice nuovo, `fase1_r1_recontract.sql`, `select fase1_reconcile_tasks()` e report d'invarianti (provato in `upgrade.sh`);
  3. **rimozione completa dello schema di Fase 1** (`supabase/rollback/fase1_full_down.sql`): solo se `select count(*) from profiles where account_type = 'external'` = 0 dopo l'offboarding di tutti gli esterni (ban, revoca delle condivisioni Drive con `drive_reconcile`); lo script si interrompe altrimenti;
  4. ultima risorsa: ripristino del dump manuale preso al passo 2 di §8 (con Supabase Pro anche il backup giornaliero).

---

## 7. Test plan esteso

### 7.1 Unit (vitest, solo logica pura)

Perché vitest: zero configurazione per TypeScript/ESM, alias `@` con una riga, veloce. Lo si limita a moduli puri (nessun mock di Next o Supabase), così resta economico da mantenere per un solo sviluppatore. La macchina a stati **non** si testa qui: vive in SQL e si testa in db-check, una sola fonte di verità.

| Modulo | Casi |
|---|---|
| `src/lib/tasks/semaforo.ts` | confronti con `yellow_at`/`due_at` a −1 s e +0 s; compito senza soglie (legacy); percentuale mostrata nella card (le soglie le calcola `add_sla` in SQL, testata in db-check) |
| `src/lib/tasks/quiet-hours.ts` (`isQuietHour`) | Batch alle 21:30 → `silent`; Express mai `silent`; cambio d'ora 25/10/2026 e 28/03/2027 |
| `src/lib/telegram/callback.ts` | round-trip con e senza `rev`, ≤ 64 byte, op sconosciuta, uuid non valido, versione diversa da `v1` |
| `src/lib/notifications/telegram-link.ts` | token di 32 caratteri `[A-Za-z0-9_-]`, hash stabile, scadenza |
| `src/lib/notifications/channels.ts` (`resolveTaskChannels`) | Telegram collegato e attivo → solo Telegram; errore definitivo (403, `chat not found`) o dead letter → email; 429/5xx → nessuna email (nuovo tentativo); non collegato → email; email spenta → nessuna email; eventi non di compito invariati |
| `src/lib/notifications/recipients.ts` | filtro interni/attivi **anche senza le colonne nuove** (forma `fase1-pre-r1`: profilo senza `account_type` = interno); menzioni filtrate a chi vede il reel; **commento `internal_only` con un esterno menzionato → esterno escluso** |
| `src/lib/drive/naming.ts`, `src/lib/drive/reconcile-plan.ts` | sanificazione (`/`, emoji, apostrofi), lunghezza, estensione dal MIME, versioni; `kit_hash` stabile; differenza permessi desiderati/attuali (crea, revoca, niente da fare) |
| `src/lib/text-diff.ts` (dopo R1, taglio di §9) | diff parola per parola con apostrofi italiani ("dell'amico"), punteggiatura, spazi |
| `src/lib/standup/format.ts` | Express prima, ritardi prima delle scadenze di oggi, troncamento a 4096 con "+N", riga di salute del sistema |
| `src/lib/notifications/task-messages.ts` | escape HTML dei titoli, pulsanti per tipo di compito, link `/reels/<id>?task=<id>` |

Obiettivo: ~50 test, `pnpm test` < 5 s.

### 7.2 Integrazione (db-check SQL + PostgREST)

Nuovi o aggiornati in `scripts/db-check/`:

| Check | Copre |
|---|---|
| `checks/00_guards.sql` (nuovo, S1, solo catalogo: gira anche in sola lettura sulla produzione) | RLS su ogni tabella `public`; nessuna policy `SELECT` o `ALL` con `qual = 'true'` per `authenticated` o `public`; viste con `security_invoker`; allowlist delle funzioni eseguibili da `authenticated` (trigger esclusi; include `holds_open_task`); nulla eseguibile da `anon`; nessun `p_actor` esposto; nessun `USAGE` su `private`; `search_path` su ogni `security definer` |
| `checks/02_reels.sql`, `04_scale.sql` (agg.) | update con compito aperto, `posted_url` non scrivibile dopo il contract, esterno senza update, pubblicazione via `publish_reel` |
| `checks/03_phase_advance.sql` (agg.) | prima del contract funziona e aggiorna `state`; dopo il contract spento |
| `checks/05_fase1_model.sql` | 10 righe di `state_raci_phase`, round-trip, normalizzazione legacy, trigger, buffer senza `approvazione_finale`, scritture dirette negate, `raw_user_meta_data` ignorato |
| `checks/06_tasks.sql` | macchina a stati completa (tabella di S2), autorizzazioni, invarianti, riserva, `invalid_assignee`, Express, DoD, `script_missing`, `stale`, blocco da `revisione`, offboarding |
| `checks/07_externals.sql` (S1) | matrice di visibilità e scrittura degli esterni, `batches` invisibile, `internal_only`, `profile_names` limitato, profilo nuovo `external`, `notifications.payload` non scrivibile; commenti: niente update di `target_id`/`target_type`/`parent_id`, niente `internal_only = true` da esterno |
| `checks/08_approvals.sql` | approvatore effettivo, assenza (admin), gruppi |
| `checks/09_outbox_sweep.sql` | idempotenza dello sweep, interruttore escalation, lease, token di lease (`stale_lease`), generazione, dead letter, `skip locked`, claim dello stand-up, permessi `service_role` |
| `checks/10_files.sql` | `prepare_upload`/`finish_upload` (+ URL legacy), versioni, RLS file, stato desiderato Drive, avvio delle soglie a kit pronto, passaggio R1 → R2 (un reel per stato, kit legacy, `requires_drive`), spegnimento di Drive che declassa i compiti aperti |
| `upgrade.sh` + `checks-upgrade/01_fase1_mapping.sql` | AC7 su fixture legacy (incluse righe `qc`/`published`, `published_at` fuori da `publication`, `scientific_validation`, chat id duplicati e di gruppo); expand → contract → uncontract → avanzamento legacy → re-contract → `fase1_reconcile_tasks()` senza `using (true)`; tappa R1 → R2 (da S5) |
| `rehearse-dump.sh` + `fase1-migration-report.sql` | su PG17: confronto dello schema di produzione con `drift-allow.txt`, allowlist interna, esterni creati dal CSV, AC7 sul dump reale con `fase1-prod-config.sql`; condizioni di stop; passo 0a e 0b di ogni rilascio |
| `api-check.mjs` (agg.) | kanban con embed del compito aperto, `/compiti` e `/approvazioni` (ordinamento Express), `task_action` come assegnatario e come estraneo, `stale`, `task_action_as`/`sweep_tasks`/`claim_jobs` negati, `/rpc/task_action_core` → 404, query come esterno, `profile_names` senza email |

Nota: `seed.sql` cambia in S1 (utenti `a`–`d` esplicitamente `internal`, nuovo esterno `e`); i check 01–04 si aggiornano nella stessa fetta. I check nuovi inseriscono gli altri fixture in testa al file (dentro la transazione che termina con `ROLLBACK`).

### 7.3 End-to-end (manuale su staging)

Ambiente: Supabase staging + `pnpm dev` + `scripts/cron-loop.ts` + bot Telegram di staging via tunnel; prova finale su un deployment Preview Vercel del branch con env di staging (protezione Preview con bypass per il webhook Telegram; i cron Vercel non girano sui Preview, li chiama `cron-loop.ts`). Dati: `scripts/fase1-seed-staging.ts` (pagina `TT` con `active = false`, 1 approvatore, 1 delegato, 1 autore, 1 SMM, 2 doppiatori e 2 animatori esterni, 1 validatore esterno; email di test con plus-addressing), `scripts/fase1-time-travel.ts` (sposta le scadenze). Gli scenari si eseguono prima di R1 (parte R1, consegne con link) e di nuovo prima di R2 (E1, E4, E8 con Drive).

| Scenario | Passi principali | Esito atteso |
|---|---|---|
| E1 (AC1) | Reel `TT-2611-01` da Confermato a Programmato; doppiatore esterno con Telegram, animatore esterno senza | 5 compiti chiusi da app/Telegram, notifiche Telegram/email consegnate ≤ 60 s, 0 SQL manuale |
| E2 (AC2) | Su iPhone: 3 approvazioni da Telegram e 3 dalla coda, una Express; una con lo script modificato dall'admin dopo l'invio | Tap contati, Express in cima, < 2 min ciascuna, audio riprodotto, la modifica dà "Testo cambiato" |
| E3 (AC3) | Time-travel su 3 compiti + stand-up manuale; escalation spenta e poi riaccesa | Giallo/rosso corretti, 1 notifica per soglia, niente arretrati alla riaccensione, stand-up completo |
| E4 (AC4) | Esterno: login, lettura, consegna (R1 link; R2 upload audio ≥ 20 MB), commento, proposta; poi cron del digest e del promemoria; poi offboarding | Vede 1 reel; altre URL → redirect a `/compiti`; proposta accettata aggiorna il testo; nessun digest né promemoria; dopo l'offboarding 0 reel e login bloccato |
| E5 (AC5) | Titolare preme "Non posso"; poi la riserva lascia scadere | Riserva, poi "da assegnare" + notifica admin |
| E6 (AC6) | Due pagine, con e senza flag | Validazione solo dove serve |
| E7 (AC7) | Report della prova su dump reale (passi 0a e 0b di R1 e R2) | Conteggi identici al report pre-migrazione, schema di produzione senza differenze nuove, allowlist interna rispettata, nessuna condizione di stop |
| E8 (AC8) | Ciclo completo con verifica della cartella, incluso un rimando al doppiaggio | Nomi, kit rigenerato prima dell'avviso all'animatore, `archivio/`, permesso revocato ≤ 10 min |
| E9 (AC9) | Utente con Telegram (nessuna email); utente senza Telegram; poi email disattivata per `task_overdue` | Solo Telegram; email con link; poi nessuna email |
| E10 (AC10) | Express su un reel a metà | Scadenza ricalcolata, primo ovunque |
| E11 (AC11) | Gabri-test assente | Nuove approvazioni al delegato, aperte spostate |
| E12 (AC12) | Interno senza ruoli prova a modificare | `not_authorized`; con compito riesce |
| E13 (AC1, AC8; iter3) | Su staging con Drive spento: un reel per stato di R1 (consegne con link, un'approvazione audio aperta); poi `drive_enabled = true` e `drive_backfill()`; si completano tutti fino a `programmato`; poi un rimando del finale all'animazione | Nessun `kit_not_ready`/`file_missing`; l'animatore di R1 vede ancora il link dell'audio; kit legacy (`_audio_link.txt`) nella cartella; il compito nato dopo il passaggio parte a kit pronto; 0 SQL manuale |

### 7.4 Osservabilità

- **Log strutturati** (una riga JSON) in server action dei compiti, webhook Telegram e drain: `{evt, task_id, reel_id, op, actor, channel, code, ms}`; i codici diversi da `ok` sono `warn`.
- **Sentry** (da S0, prima di R1, regione EU): errori di server action, route cron, webhook e drain; evento dedicato quando l'heartbeat dello sweep supera 30 minuti (controllo opportunistico in `drainOutbox()`); `beforeSend` senza email né testo degli script.
- **Cron Vercel:** log delle invocazioni di `task-sweep` e `standup` nel pannello Vercel; ogni run scrive `system_heartbeats` con il proprio report (compiti scaduti, timbri, job svuotati, durata).
- **DB:** `task_events` (ogni operazione con attore, canale ed esito, compresi i rifiuti `not_authorized` e `stale`: un picco di rifiuti da Telegram è un segnale di abuso o di pulsanti vecchi), `system_heartbeats`, `job_outbox` (backlog, età del job pendente o in lease più vecchio, dead letter), `notifications.delivered_at` null = consegna fallita, rapporto email/Telegram per lo stesso compito (deve essere ~0 per chi ha Telegram), `tasks.closed_via` (quota Telegram vs app per AC2), violazioni d'invariante (reel in stato di lavoro senza compito, compito non coerente con lo stato, condivisione aperta su compito chiuso).
- **Allarmi:** regola `job_health` (heartbeat > 30 min, età del job più vecchio > 30 min, dead letter, violazioni) negli avvisi `/alerts` e su Telegram agli admin; lo stand-up riporta la stessa riga di salute ed elenca i compiti "da assegnare".

---

## 8. Verifica e procedura di rilascio

### Comandi per ogni fetta
```bash
scripts/db-check/run.sh          # PG16 di default; migrazioni + check SQL + api-check (se postgrest è installato)
scripts/db-check/upgrade.sh      # da S1: upgrade da Fase 0 con fixture legacy, contract, uncontract, re-contract, riconciliazione
scripts/db-check/rehearse-dump.sh supabase/backups/<data>-prod   # da S1, solo PG17: schema, allowlist, CSV, config, report
PG_BIN=/opt/homebrew/opt/postgresql@17/bin scripts/db-check/run.sh   # una volta prima di ogni rilascio (anche upgrade.sh)
pnpm test                        # vitest
pnpm typecheck && pnpm lint && pnpm build
pnpm exec tsx scripts/test-parser.ts   # il parser non deve cambiare
supabase db push --linked --dry-run && supabase db push --linked   # solo STAGING (CLI collegata a staging)
```
Poi gli scenari e2e della fetta su staging.

### Ingegneria dei rilasci
- **`fase1-pre-r1`** (entro venerdì 16 ottobre): deploy su `main` del solo filtro dei destinatari tollerante alle colonne (S1), senza migrazioni; è il bersaglio del rollback del codice (§6).
- **R1** (target lunedì 9 novembre, prova completa 5–6 novembre, seconda prova la mattina del 9): S0–S4, esterni inclusi (D7). **R2** (target lunedì 23 novembre): solo Drive (S5). Piano B del checkpoint (§9): R1 16 novembre, R2 30 novembre.
- **Connessione alla produzione:** se la verifica di S1 lo conferma, ogni comando sulla produzione usa `--db-url "$PROD_DB_URL"` (anche dal worktree del tag, che altrimenti avrebbe bisogno di un proprio `supabase link`) e la CLI resta collegata allo staging; altrimenti `supabase link` alla produzione solo per il comando e ricollegamento allo staging **subito dopo**, mai lasciato collegato tra due giorni.
- **Taglio di R1:** a fine S4 il tag `fase1-r1-expand` marca il commit con tutte le migrazioni di expand e il codice; la migrazione di contract sta nel commit successivo, taggato `fase1-r1`. Le migrazioni di S5 si creano solo dopo R1 (le fette sono sequenziali), quindi hanno timestamp successivi.
- **Push in due tempi:** la CLI applica tutte le migrazioni presenti nella cartella, quindi l'expand si spinge da un checkout del tag `fase1-r1-expand` (worktree) e il contract dal tag `fase1-r1` dopo il deploy del codice.
- **Atomicità:** ogni file è atomico, il push di più file no (§5). Se il push si ferma al file N, i file precedenti restano applicati: sono tutti di expand e quindi sicuri da lasciare; si corregge in avanti con una nuova migrazione e si ripete la prova su dump.
- **Hotfix dopo R1:** branch `hotfix/<nome>` da `main`; migrazione creata con `supabase migration new` (timestamp attuale, successivo a tutte quelle rilasciate); prova su dump; push; merge di `main` in `fase-1-produzione` prima di scrivere altre migrazioni. Se sul branch esiste una migrazione non rilasciata con timestamp più vecchio dell'hotfix, la si rinomina con un timestamp nuovo e sullo staging si esegue `supabase migration repair --status reverted <vecchio>` prima di ri-spingerla (nessun `--include-all` in produzione).

**Procedura (per ciascun rilascio; ogni passo richiede l'OK esplicito dell'utente):**
0a. **Prova completa (5–6 novembre per R1):** dump di produzione (`data.sql`, `schema-public.sql`, `migrations.txt`; `pg_dump`/`psql` di `/opt/homebrew/opt/libpq@18/bin`, in `supabase/backups/<data>-prod/`, procedura nella memoria di deployment; se si è usato `supabase link`, ricollegare lo staging **subito**) → `scripts/db-check/rehearse-dump.sh` su PG17 con `collaborators.csv`, `internal-emails.txt` e `fase1-prod-config.sql` verdi, nessuna differenza di schema fuori da `drift-allow.txt`, nessuna condizione di stop, report letto dall'utente. Prerequisiti di §9 completati; `run.sh` e `upgrade.sh` verdi su PG16 e PG17; e2e della release passati su staging.
   **Congelamento degli account (R1):** dal dump 0a fino al passo 4 nessun account si crea in produzione (niente `invite-users.ts`, niente dashboard Supabase, niente nuovi magic link): un account creato prima dell'expand diventerebbe `internal`. Lo verifica il controllo dell'allowlist al passo 3.
0b. **Seconda prova la mattina del rilascio** (~1 h, script già verdi): dump fresco (< 2 h) → `rehearse-dump.sh` con gli stessi file. Verde = via; altrimenti il rilascio salta di un giorno. È questa la prova "< 24 h" richiesta da AC7.
1. Annuncio al team di una finestra di 45 minuti senza modifiche.
2. Nuovo dump manuale subito prima del push (è il punto di ripristino).
3. Report pre-migrazione in sola lettura su produzione (`scripts/fase1-migration-report.sql`, parte "prima"): deve coincidere con quello del passo 0b, salvo le modifiche delle ultime ore; **stop** se un profilo che diventerà `internal` non è nell'allowlist interna.
4. Da `fase1-r1-expand`: `supabase migration list` + `supabase db push --dry-run` sulla produzione → l'elenco deve essere esattamente quello atteso; poi `db push`.
5. Report post-expand → confronto con il passo 3 (conteggi uguali, mappatura attesa, nessun compito ancora creato); **`00_guards.sql` in sola lettura sulla produzione** (`begin read only; … rollback;`, stessa connessione del dump).
6. Env su Vercel (produzione): `TELEGRAM_TEAM_CHAT_ID`, DSN Sentry; da R2 `GOOGLE_SHARED_DRIVE_ID`. Cron `task-sweep` e `standup` in `vercel.json` (richiede Vercel Pro). Push del codice su `main` → deploy automatico.
6b. **Account esterni (R1):** `scripts/fase1-collaborators.ts --dry-run` e poi senza `--dry-run`, con lo stesso `collaborators.csv` provato in 0a/0b (gli account nascono `external` perché l'expand è applicato); controllo: ogni riga del CSV ha `account_type = 'external'` e il `external_kind` atteso. I magic link partono solo con la comunicazione (playbook).
6c. **Webhook Telegram:** `scripts/telegram-set-webhook.ts` sul bot di produzione (`secret_token`, `allowed_updates = ["message","callback_query","my_chat_member"]`) e `getWebhookInfo` letto; senza `callback_query` i pulsanti non arriverebbero.
7. Da `fase1-r1`: `db push --dry-run` (solo il contract) e `db push`; di nuovo `00_guards.sql` in sola lettura sulla produzione.
8. `scripts/fase1-prod-config.sql` (rivisto in anticipo e provato in 0a/0b; risolve le persone per email e si ferma se un'email manca o ha tipo sbagliato): approvatore e delegato, titolari/riserve/validatore/flag delle pagine con gli esterni **su una sola pagina** (rampa di D7), `app_config` con escalation e stand-up spenti; poi `select fase1_backfill_open_tasks()` (idempotente). Report "dopo" rigenerato e confrontato.
9. Smoke test: login admin, `/compiti`, kanban, un'approvazione Telegram su un reel della pagina di test (`active = false`), un esterno di test che vede solo il suo reel, invocazione manuale di `/api/cron/task-sweep` (escalation spenta).
10. L'admin assegna i compiti `unassigned` e conferma quelli migrati (`confirm_migrated_tasks`, che riavvia le soglie).
11. Dopo 24–48 h senza anomalie: `standup_enabled = true`, poi `escalation_enabled = true`; `fase1-prod-config-ramp.sql` estende gli esterni alle altre pagine.
12. Controllo finale che la CLI sia collegata allo staging (`supabase projects list` mostra `zrzgxudzetuztleujfri` come collegato); `PROD_DB_URL` tolta dalla shell.

R2 usa la stessa procedura senza contract né 6b: passi 0a/0b (confronto di schema incluso), dump, push della migrazione Drive, `00_guards.sql` in sola lettura, codice, `drive_enabled = true` + `select drive_backfill()`, report dei compiti di R1 ancora aperti per tipo, controllo di `scripts/check-drive-folder.ts` su un reel reale.

Ordine vincolante: **expand prima del codice, contract dopo il codice** (`CLAUDE.md`: migrazioni prima del codice che chiama le nuove RPC). Rollback: §6.

### Playbook tra R1 e R2
- **Esterni:** account creati al passo 6b del rilascio da `scripts/fase1-collaborators.ts` con il CSV rivisto (email reali, `drive_email` raccolte per R2), **mai prima dell'expand**; nelle prime 48 h titolari su una sola pagina, poi su tutte (rampa di D7); ricevono compiti, consegnano incollando un link `https://` (Drive personale, WeTransfer) che il motore salva in `audio_drive_url`/`video_drive_url`. Nuovi esterni dopo R1: stesso script (o `/collaboratori` quando arriva).
- **Kit:** l'animatore vede nel reel script, note e link dell'audio approvato; nessuna cartella automatica finché R2 non attiva `drive_enabled`.
- **Magic link:** nessun nuovo invito; quelli esistenti funzionano fino alla scadenza (commenti, link file, "lavoro pronto" → commento + notifica all'assegnatario del compito).
- **Comunicazione:** messaggio al team e ai collaboratori con il nuovo flusso, l'avviso che il thread del reel è visibile agli esterni (usare "Nota interna") e la regola Telegram primario / email di riserva.
- **Al passaggio a R2:** i reel in volo ricevono cartella, kit (legacy se l'audio approvato è un link) e permessi da `drive_backfill()`; i compiti nati in R1 si chiudono ancora con il link, quelli nuovi passano dall'upload (S5, "Passaggio dei compiti aperti"); l'animatore di un reel di R1 continua a vedere il link dell'audio.

---

## 9. Rollout, calendario, prerequisiti

### Calendario (un solo sviluppatore; **~37 giorni lavorativi** dal 5 ottobre al 24 novembre con i tagli di R1; riserva al 4 dicembre)

Stima dell'iter2 (iter1: 32 g = S0 2 + S1–S7 30, margine zero), rivista sotto per l'iter3:

| Voce | iter1 → iter2 | Motivo |
|---|---|---|
| S0 | 2 → 3 | spike upload nel browser e media su iPhone, Sentry; Inngest tolto |
| S1 | 3,5 → 6 | RLS e account spostati da S5 (+1), `rehearse-dump.sh` (+0,75), schema `private`, guardie, seed, fan-out, preferenze (+0,75) |
| S2 | 4,5 → 5,5 | contract separato, tabella transizioni completa, `assign_task`/offboarding, proposte spostate da S5, `script_rev` (+1,5); scheda Attività tagliata (−0,5) |
| S3 | 4,5 → 5 | UI degli esterni spostata da S5 (+2,5); tagli: kanban a stati e `reel_board` (−1), `/compiti/[id]`, selezione multipla, assenza in autoservizio (−0,75); resto (−0,25) |
| S4 | 4,5 → 4 | lease e generazione, token, regola dei canali (+1); tagli: ore di silenzio, pulizia pulsanti, `/chatid`, card salute (−1,5) |
| R1 + stabilizzazione | 0 → 3,5 | prova su dump, config, comunicazioni, rilascio e due giorni di correzioni sul primo uso reale |
| S5 Drive (ex S6) | 5 → 5 | `drive_reconcile` al posto di cinque job; route audio |
| S5 esterni (iter1) | 4,5 → 0 | spostato in S1–S3 |
| S6 (ex S7) | 3,5 → 3 | la prova su dump è già in S1; collaudo, documenti, R2 |
| **Totale** | **32 → 35** | +6,75 aggiunti, −3,75 di tagli senza impatto sugli AC |

**Iter3 (Architect n. 3, Critic "Schedule").** Le due review stimano S1–S4 in 22–30 giorni contro i ~20,5 pianificati, e tutti i tagli pre-concordati dell'iter2 erano lavoro di R2: R1 poteva solo slittare. L'iter3 aggiunge lavoro di sicurezza su R1 e introduce tagli di R1 e un checkpoint:

| Voce | iter2 → iter3 | Motivo |
|---|---|---|
| S0 | 3 → 3 | spike `writer` e route audio su Preview: stesse prove, altro ambiente |
| S1 | 6 → 7 | confronto dello schema, toolchain PG17, `auth.users` in appoggio (+0,75); deploy `fase1-pre-r1` (+0,25); CSV, allowlist interna, config per email (+0,4); commenti (+0,1); la logica dei collaboratori arriva qui da S3 |
| S2 | 5,5 → 6 | `fase1_reconcile_tasks()` e percorso di ritorno in `upgrade.sh` (+0,4); validazione migrata, `derived_state` senza compiti, `claim_admin_if_first` (+0,1) |
| S3 | 5 → 3,5 | **tagli di R1**: `/collaboratori` → script (−0,75), diff parola per parola → testo affiancato (−0,5), offboarding in UI → script (−0,25) |
| S4 | 4 → 4 | fencing, claim dello stand-up, regola del fallback, `setWebhook` (+0,25, preso dalla mezza giornata di prova del 5 novembre: rischio dichiarato) |
| R1 + stabilizzazione | 3,5 → 3,75 | seconda prova la mattina del rilascio (+0,25); passi 6b e 6c |
| S5 | 5 → 6 | passaggio R1 → R2: `requires_drive`, kit legacy, test ed E13 (+0,75); id della cartella subito, permessi ereditati (+0,25) |
| S6 | 3 → 3,5 | E13 nel collaudo, script di anonimizzazione; R2 di lunedì |
| **Totale** | **35 → ~37** | +3,9 aggiunti, −1,5 di tagli di R1 |

| Settimana | Date | Lavoro (giorni) |
|---|---|---|
| 1 | 5–9 ott | **S0** 5–7 (3) · **S1** 8–9 (2) |
| 2 | 12–16 ott | **S1** 12–16 (5, fine; `fase1-pre-r1` in produzione) |
| 3 | 19–23 ott | **S2** 19–23 (5): parte SQL; **checkpoint venerdì 23** |
| 4 | 26–30 ott | **S2** 26 (1, fine: pannello e azioni) · **S3** 27–30 mattina (3,5) · **S4** 30 pomeriggio (0,5) |
| 5 | 2–6 nov | **S4** 2–5 mattina (3,5, fine) · **R1** prova completa 0a, config, CSV, comunicazioni 5 pomeriggio–6 (1,5) |
| 6 | 9–13 nov | **R1 lunedì 9** (prova 0b alle 7:30, poi rilascio) + stabilizzazione 9–10 (2) · **S5** 11–13 (3) |
| 7 | 16–20 nov | **S5** 16–18 (3, fine) · **S6** collaudo 19–20 (2) |
| 8 | 23–24 nov | **R2 lunedì 23** · documentazione 23 pomeriggio–24 (1,5) |

- **Target:** R1 **lunedì 9 novembre** (non di venerdì), R2 **lunedì 23 novembre** (era giovedì 19: +1 giorno di S5 per il passaggio R1 → R2, e niente rilasci di venerdì), chiusura Fase 1 martedì 24 novembre (giorno 37).
- **Tagli di R1, pre-concordati e già scontati nel calendario** (default della nuova domanda aperta): (1) `/collaboratori` → `scripts/fase1-collaborators.ts` (stessa API admin; serve comunque al passo 6b); (2) diff parola per parola delle proposte → testo originale e proposto affiancati; (3) offboarding in UI → `fase1-collaborators.ts offboard`. Nessuno toglie un AC: AC4 chiede proposte di modifica a livello di parola che l'approvatore accetta o rifiuta (l'esterno modifica il testo del blocco, l'approvatore vede originale e proposta affiancati; manca solo l'evidenziazione delle parole cambiate) e un offboarding funzionante, non una UI admin. Le tre UI tornano in S6 se resta tempo, altrimenti in Fase 2. **L'editor degli override SLA non si taglia** (decisione dell'utente).
- **Checkpoint venerdì 23 ottobre, fine giornata:** `06_tasks.sql`, `08_approvals.sql` e `upgrade.sh` (fino a re-contract e riconciliazione) verdi in locale e la migrazione del motore spinta sullo staging. Se no → **piano B**: tutto scorre di una settimana, R1 **lunedì 16 novembre**, S5 18–25, collaudo 26–27, R2 **lunedì 30 novembre**, chiusura martedì 1° dicembre, dentro la riserva.
- **Riserva:** **4 dicembre** (giorno 45, +8 giorni sul base).
- **Probabilità (stima onesta, un solo sviluppatore):** R1 il 9 novembre ~30%; R1 entro il 16 novembre ~65%; R2 entro il 24 novembre ~25%; Fase 1 chiusa entro il 4 dicembre ~65%. Il rischio sta nello schema e nelle policy, non nei dati (il dump del 2026-10-01 ha ~22 reel, quasi tutti in `research_prescript`, e 4 profili).

Tagli di R2 pre-concordati (iter2, ordine confermato dall'utente), se a venerdì 13 novembre (piano B: 20 novembre) S5 è in ritardo > 1 giorno:
1. sottocartella `archivio/` (le versioni superate restano nella cartella con il suffisso `_v<n>`);
2. U3 al posto di U1 anche se lo spike è positivo (niente uploader a chunk, ≈ 1,5 g; lo spike 3b ha già provato l'upload `writer`);
3. audio servito dal server sostituito da "Apri in Drive" (AC2 più lento su iPhone: va riverificato).

### Prerequisiti a carico dell'utente

| Quando | Azione |
|---|---|
| ~~Subito~~ **Fatto 2026-10-01** | Signup pubblico disattivato in produzione (`disable_signup: true`, `docs/brain-plan.md:92`) |
| Prima di S0 | Account **Sentry** (regione EU, piano gratuito); bot Telegram di **staging** da BotFather; utente admin sullo staging |
| Prima di S0 | **SMTP personalizzato sullo staging**: la produzione ha già Resend (`smtp.resend.com:465`, mittente `noreply@alphatechnology.ai`, 30 email/ora, verificato 2026-10-01); lo staging no (2 email/ora): configurarlo con la stessa chiave Resend |
| Prima di S1 (deploy `fase1-pre-r1`) | OK al deploy anticipato del filtro dei destinatari su `main` (nessuna migrazione) |
| Prima di S0 (spike) | Admin Workspace: condivisione esterna consentita per gli Shared Drive; creare gli Shared Drive "Reelificio Produzione" e "Reelificio Staging"; service account come **Gestore**; consentire l'accesso ai non membri, la condivisione di cartelle e **il download per i lettori**; un iPhone con Telegram per lo spike media |
| Prima di S3 | Nome del **delegato** di Gabri; per ogni pagina: titolare e riserva di doppiatore e animatore, eventuale validatore e flag di validazione |
| Prima di S4 | Gruppo Telegram del team con il bot aggiunto (amministratore non necessario); id della chat dai log del webhook → `TELEGRAM_TEAM_CHAT_ID` |
| Prima di R1 (prova del 5–6 nov) | `collaborators.csv` (email, nome, tipo, `drive_email` se nota) e `internal-emails.txt` (email di tutti gli interni) rivisti dall'utente; pagina della rampa delle prime 48 h; contenuto di `fase1-prod-config.sql` rivisto. Gli account esterni si creano **solo** al passo 6b del rilascio |
| Dal dump 0a al passo 4 (5–9 nov) | **Nessun account nuovo in produzione** (né `invite-users.ts`, né dashboard, né magic link) |
| Prima di R1 | **Vercel Pro** (Hobby è solo per uso non commerciale e non consente cron ogni 5 minuti) |
| Prima di R1 | **Supabase Pro** (backup giornalieri; `docs/brain-plan.md:96` lo chiede prima del rilascio della Fase 1; domanda aperta con default sì) |
| Prima di R2 | Email Google di ogni esterno (`drive_email`); pianificare l'upgrade Workspace a Business Standard intorno a 5–10 pagine (30 GB per utente in pool) |

---

## 10. Rischi e mitigazioni

| Rischio | Prob. | Impatto | Mitigazione |
|---|---|---|---|
| CORS della sessione resumable non funziona dal browser | Media | Alto | Spike S0 su Chrome e Safari iOS; fallback U3 (condivisione `writer` + "Sincronizza") già progettato |
| Workspace non consente la condivisione di cartelle con esterni | Media | Alto | Prerequisito verificato in S0; fallback: condivisione dei singoli file del kit; R1 non ne dipende |
| Funzione interna eseguibile da un utente (default privileges di Supabase) → approvazioni a nome di altri | Media senza guardia | Molto alto | Schema `private` senza `USAGE`; `revoke … from public, anon, authenticated` su ogni funzione; allowlist in `00_guards.sql`; api-check che chiama `/rpc/task_action_as` e `/rpc/task_action_core` come utente |
| Dimenticare una policy `using (true)` → fuga di dati verso gli esterni | Media | Molto alto | Guardia `00_guards.sql` (ruoli `authenticated` e `public`, viste `security_invoker`); matrice `07_externals.sql`; default `account_type = 'external'` nella stessa release della RLS |
| Esterni nei fan-out service role (digest, promemoria, menzioni) | Alta senza filtro | Alto | `internalProfiles()` in S1; e2e E4 esegue i cron e controlla `notifications` dell'esterno |
| Tempesta di notifiche al cutover | Alta | Alto | Compiti migrati senza messaggio di assegnazione, partenza al backfill, escalation e stand-up spenti in `app_config`, una notifica per soglia, notifiche notturne silenziose |
| Stato del reel e compito aperto divergono | Bassa | Alto | Unico scrittore (`_set_state` verifica lo stato derivato), indice "un compito aperto per reel", trigger `phase`↔`state`, controllo d'invariante nello sweep e in db-check |
| Token di collegamento Telegram trapelato → approvazioni a nome di Gabri | Bassa | Molto alto | Token opaco monouso, 15 min, solo chat privata, email a ogni collegamento, autorizzazione ricontrollata in SQL |
| Outbox bloccata (drain morto dopo il claim) | Media | Alto | Lease di 5 minuti, dead letter visibile, età del job più vecchio in `job_health` e nello stand-up, evento Sentry |
| Permesso Drive lasciato vivo da un job ritentato | Media | Alto | `drive_reconcile` idempotente che ricalcola lo stato desiderato e revoca il resto; generazione che ri-arma il job |
| Cambio d'ora o weekend fanno scattare escalation inutili | Media | Medio | Scadenze Batch che saltano il weekend (`add_sla`); test sul cambio d'ora; festività italiane come follow-up |
| Il testo cambia dopo la consegna dell'autore e si approva o si registra una versione diversa | Media | Alto | Blocco da `revisione`, `script_rev` nei pulsanti e nell'app (`stale`), re-sync che salta i reel bloccati, modifiche solo via proposte accettate |
| Le funzioni chiamate dal service role autorizzano male perché `auth.uid()` è null | Media | Alto | Helper con attore esplicito in `private`; ogni operazione testata anche via `task_action_as` in `06_tasks.sql` |
| La migrazione incontra dati reali inattesi | Media | Molto alto | Prova su dump con condizioni di stop come passi 0a e 0b (la seconda su un dump della mattina stessa) di ogni rilascio; push per file atomico; dump manuale + Supabase Pro |
| Supabase Free: nessun backup | Media | Alto | Dump manuale a ogni rilascio; Supabase Pro prima di R1 |
| Calendario (~37 g stimati; review: S1–S4 22–30 g) | Alta | Medio | Tagli di R1 già scontati; checkpoint del 23 ottobre con piano B (R1 16/11, R2 30/11); tagli di R2 pre-concordati; riserva al 4/12; R2 solo Drive e quindi spostabile senza toccare R1 |
| Un esterno creato in produzione prima dell'expand diventa `internal` (iter3) | Media senza blocco | Molto alto | Account esterni solo al passo 6b; congelamento della creazione di account dal dump 0a al passo 4; stop del report se un futuro `internal` è fuori dall'allowlist interna; config che si ferma su tipo sbagliato |
| Al passaggio R1 → R2 i reel in volo si bloccano su `kit_not_ready`/`file_missing` (iter3) | Alta senza regola | Alto | `requires_drive` per compito, kit legacy, link visibili agli assegnatari; caso in `10_files.sql`, `upgrade.sh` ed E13 |
| La prova su dump non gira o non rispecchia la produzione (toolchain, deriva dello schema) (iter3) | Media | Alto | PG17 e `psql` 18 fissati negli script, `auth.users` in appoggio, `migrations.txt`; confronto dello schema con allowlist; `00_guards.sql` in sola lettura sulla produzione ai passi 5 e 7 |
| Il rollback del codice manda digest e promemoria ai collaboratori (iter3) | Media senza deploy anticipato | Alto | Bersaglio del rollback = `fase1-pre-r1`, già filtrato e provato su Preview con un esterno di test |
| Spazio Shared Drive (30 GB) esaurito dai video | Media | Medio | Soglia nel controllo di salute; upgrade Workspace pianificato |

---

## 11. Pre-mortem (16 scenari di fallimento: 3 dell'iter1 aggiornati, 6 dalle review iter1, 7 dalle review iter2)

**Scenario 1 — "Il bot ci ha sommerso e siamo tornati su WhatsApp" (settimana dopo R1).** I compiti migrati sono quasi tutti senza assegnatario o già in ritardo; lo sweep manda decine di escalation a Gabri e al team, anche di notte; le persone silenziano il bot e tornano a coordinarsi fuori dall'app.
- *Segnali precoci:* > 50 righe `notify` all'ora in `job_outbox`; errori 429 da Telegram; scollegamenti Telegram; compiti "da assegnare" > 0 dopo 24 h; `closed_via = 'telegram'` vicino a zero.
- *Mitigazioni:* compiti migrati creati solo dopo `fase1-prod-config.sql` (quindi alle persone giuste), senza messaggio di assegnazione, con partenza al backfill ed `escalation_paused` finché l'admin non li conferma; `escalation_enabled`/`standup_enabled` spenti per le prime 24–48 h e, riaccesi, senza arretrati; una notifica per soglia per compito; scadenze Batch che saltano il weekend; notifiche notturne Batch silenziose; "Avvia stesura" raggruppa le assegnazioni; lo stand-up raccoglie in un solo messaggio quello che non è urgente.

**Scenario 2 — "Un doppiatore esterno ha visto gli script di tutte le pagine" (dopo R1).** Una tabella è rimasta con `using (true)`, una vista è stata creata senza `security_invoker`, una funzione `SECURITY DEFINER` restituisce righe senza filtro, oppure un fan-out service role (digest) gli manda i nomi delle pagine. Al contrario: un interno viene classificato esterno e perde l'accesso.
- *Segnali precoci:* fallimenti di `00_guards.sql`/`07_externals.sql`; l'api-check come esterno conta più di 1 reel; righe `notifications` di tipo `weekly_digest`/`daily_reminder` per un esterno; segnalazioni di pagine vuote da utenti interni.
- *Mitigazioni:* guardia generica su policy (`authenticated` e `public`), viste e funzioni; matrice di visibilità completa; `internalProfiles()` nei fan-out; default `external` + backfill `internal` verificato nel report e `invite-users.ts` aggiornato nella stessa release; smoke test post-rilascio con un esterno di test che conta le righe visibili per tabella.

**Scenario 3 — "Le consegne non arrivano su Drive" (dopo R2).** La condivisione esterna è disattivata, il CORS blocca gli upload grandi, lo spazio finisce o il service account perde i permessi; le consegne si bloccano e i file tornano a girare via WeTransfer.
- *Segnali precoci:* `drive_reconcile` con ≥ 3 tentativi o in dead letter; righe `reel_files` ferme in `uploading`; errori `storageQuotaExceeded`/`insufficientFilePermissions`; uso dello Shared Drive > 70%.
- *Mitigazioni:* spike S0 come cancello; fallback U3 attivabile senza migrazioni; `drive_enabled = false` riporta in un minuto alle consegne con link di R1 (declassa i compiti aperti a `requires_drive = false`); controllo di spazio nella salute del sistema; upgrade Workspace pianificato.

**Scenario 4 — "Un animatore ha approvato il proprio video come Gabri" (escalation di privilegi via RPC).** Una funzione interna è rimasta eseguibile da `authenticated` per i default privileges di Supabase (`scripts/db-check/shim.sql:32` li riproduce); l'esterno chiama `/rpc/...` con `p_actor` di Gabri o accoda una condivisione Drive verso la propria Gmail.
- *Segnali precoci:* `task_events` con `channel = 'app'` e attore diverso dall'utente della sessione (impossibile per costruzione: se compare è un bug); permessi Drive verso email non presenti in `profiles`.
- *Mitigazioni:* schema `private` senza `USAGE`; nessun `p_actor` esposto; allowlist delle funzioni in `00_guards.sql`; api-check che prova le chiamate vietate come utente; `drive_reconcile` revoca ogni permesso esterno non desiderato.

**Scenario 5 — "R1 si ferma a metà o mappa male i dati" (giorno del rilascio).** L'indice unico su `telegram_chat_id` fallisce su un duplicato, ci sono righe `qc` o `published_at` incoerenti, oppure il push si interrompe dopo il secondo file.
- *Segnali precoci:* la prova su dump dei passi 0a/0b fallisce o mostra condizioni di stop; `--dry-run` elenca file inattesi.
- *Mitigazioni:* prove su dump obbligatorie con condizioni di stop (0b su un dump della mattina stessa); dedup e normalizzazioni dentro la migrazione; ogni file atomico e di expand (un push parziale lascia un sistema funzionante); dump manuale al passo 2; fix in avanti con una nuova migrazione.

**Scenario 6 — "Il rollback ha aperto tutto agli esterni" (dopo R1).** Un bug porta a tornare indietro e lo script di down ripristina `using (true)` mentre gli esterni hanno già account.
- *Segnali precoci:* richiesta di rollback; l'esterno di test vede più di un reel dopo il ripristino.
- *Mitigazioni:* `fase1_r1_uncontract.sql` non tocca la RLS e non elimina tabelle; la rimozione completa si rifiuta finché esiste un profilo `external`; `00_guards.sql` gira anche dopo l'uncontract in `upgrade.sh`; le consegne restano negli URL legacy.

**Scenario 7 — "L'outbox si è bloccata in silenzio" (qualunque momento).** Il drain muore dopo il claim, i job restano presi; lo sweep è vivo, quindi un controllo sul solo heartbeat non vede nulla; le notifiche smettono di arrivare.
- *Segnali precoci:* età del job pendente o in lease più vecchio > 30 min; righe `notifications` assenti per compiti creati; dead letter > 0.
- *Mitigazioni:* lease di 5 minuti; `job_health` sull'età del job più vecchio; riga di salute nello stand-up; evento Sentry; `complete_job` con generazione per non perdere modifiche arrivate durante il job.

**Scenario 8 — "Doppie notifiche, bot silenziato" (prima settimana).** Chi aveva salvato `/settings` riceve Telegram ed email per ogni evento (oggi `saveOwnPrefMatrix` salva tutte le righe), filtra le email come spam e silenzia il bot; chi non ha Telegram perde le assegnazioni.
- *Segnali precoci:* rapporto email/Telegram per lo stesso compito > 0 per utenti con Telegram; scollegamenti Telegram; compiti non accettati entro la scadenza.
- *Mitigazioni:* regola "Telegram primario, email di riserva" (`resolveTaskChannels`); cancellazione delle righe salvate con il vecchio default; salvataggio delle sole differenze; e2e E9.

**Scenario 9 — "Le approvazioni da telefono sono lente e si torna ai vocali WhatsApp" (dopo R1).** Gabri non riesce a sentire l'audio dall'iframe Drive nel browser di Telegram (cookie di terze parti), le approvazioni superano i 5 minuti.
- *Segnali precoci:* tempo tra notifica e decisione (`task_events`) > 5 min per `audio_approval`; `closed_via = 'telegram'` basso per l'audio.
- *Mitigazioni:* spike su iPhone in S0 che decide il percorso; audio servito dal server con `Range` (R2); in R1 il link consegnato si apre nell'app di destinazione; AC2 misurato su iPhone.

**Scenario 10 — "Il doppiatore era interno" (R1).** Un esterno creato in produzione prima dell'expand (dashboard o `invite-users.ts`) viene marcato `internal` dal backfill e legge script, batch ed email di tutte le pagine.
- *Segnali precoci:* il report del passo 3 elenca un profilo fuori dall'allowlist interna; un'email del CSV risulta già esistente al passo 6b.
- *Mitigazioni:* account esterni solo al passo 6b; congelamento dal dump 0a al passo 4; stop sull'allowlist interna in 0a, 0b e 3; `fase1-collaborators.ts` si ferma se trova l'email come `internal`; `fase1-prod-config.sql` si ferma su tipo sbagliato.

**Scenario 11 — "Il giorno di R2 nessuno riesce a consegnare".** Ogni animazione nata in R1 risponde `kit_not_ready`, il link dell'audio è nascosto, si corregge con SQL a mano in produzione (AC1 chiede 0 SQL manuale).
- *Segnali precoci:* E13 rosso su staging; nel report di R2 compiti `requires_drive = false` aperti senza percorso di consegna; `kit_not_ready` in `task_events` dopo l'attivazione.
- *Mitigazioni:* `requires_drive` per compito, kit legacy, link visibili agli assegnatari; caso in `10_files.sql`, tappa R1 → R2 in `upgrade.sh`, E13 prima di accendere Drive sullo staging; `drive_enabled = false` declassa i compiti aperti.

**Scenario 12 — "La prova non è partita la sera prima di R1".** `psql` 14 rifiuta `\restrict`, PG16 rifiuta `SET transaction_timeout`, l'insert di `auth.users` non combacia con lo shim; il passo 0 si salta "solo per questa volta".
- *Segnali precoci:* `rehearse-dump.sh` mai verde sul dump del 1° ottobre entro la fine di S1.
- *Mitigazioni:* `PG_BIN`/`psql` fissati e controllo della versione negli script; tabella di appoggio per `auth.users`; `migrations.txt` salvato con ogni dump; prova verde sul dump reale come condizione di "fatto" di S1; la prova 0b è uno script di ~1 h già collaudato in 0a.

**Scenario 13 — "Il rollback ha mandato il digest ai collaboratori".** Si promuove il deployment precedente e i suoi cron (promemoria, digest del lunedì) scrivono a ogni profilo, esterni compresi, con nomi di pagine e buffer.
- *Segnali precoci:* righe `notifications` di tipo `weekly_digest`/`daily_reminder` per un esterno.
- *Mitigazioni:* bersaglio del rollback = `fase1-pre-r1`, già filtrato e provato su Preview; il passo di rollback indica quel deployment per nome, non "il precedente".

**Scenario 14 — "I pulsanti funzionano sullo staging e non in produzione".** Il webhook del bot di produzione è registrato senza `callback_query` (nessuna `setWebhook` nel repo): i tap non arrivano mai.
- *Segnali precoci:* nessuna riga `task_events` con `channel = 'telegram'` dopo il passo 9; `getWebhookInfo` con `allowed_updates` diversi.
- *Mitigazioni:* passo 6c con `scripts/telegram-set-webhook.ts` e lettura di `getWebhookInfo`; approvazione Telegram nello smoke test del passo 9.

**Scenario 15 — "Una nota interna è arrivata nella casella dell'esterno".** Un interno scrive un commento `internal_only` che menziona l'esterno; la notifica di menzione porta il testo.
- *Segnali precoci:* riga `notifications` di menzione per un esterno su un commento `internal_only`.
- *Mitigazioni:* `mentionRecipients` esclude gli esterni per i commenti `internal_only` (unit); grant di colonna e `with check` sui commenti (`07_externals.sql`).

**Scenario 16 — "Un push per lo staging è finito in produzione".** La CLI resta collegata alla produzione dal 6 al 9 novembre e un `db push` di lavoro corrente parte verso la produzione.
- *Segnali precoci:* `supabase projects list` mostra la produzione come collegata fuori da una finestra di rilascio.
- *Mitigazioni:* `--db-url "$PROD_DB_URL"` per i comandi sulla produzione, CLI sempre collegata allo staging; altrimenti ricollegamento subito dopo ogni comando; controllo al passo 12.

---

## ADR

- **Decisione:** Fase 1 introduce una tabella `tasks` come fonte di verità del lavoro, con una macchina a stati in funzioni SQL `SECURITY DEFINER` (interne nello schema `private`, mai eseguibili dagli utenti) che fa avanzare un nuovo `reels.state` (enum `reel_state`, 10 valori, scritto solo se coincide con lo stato derivato dai compiti) e tiene allineata la colonna legacy `reels.phase` via trigger secondo la tabella `state_raci_phase()`. Gli esterni sono account reali isolati da RLS basata sui compiti, introdotta nella stessa release (R1) in cui i profili nuovi nascono `external`. Telegram agisce con pulsanti verificati via `task_action_as` e con la revisione dello script vista. Notifiche e lavori Drive passano da un'outbox transazionale con lease, svuotata con `after()` e da uno sweep **cron Vercel Pro** ogni 5 minuti; Drive converge con un job unico e idempotente `drive_reconcile` per reel. Ogni rilascio segue expand → codice → contract, preceduto da due prove su dump reale (la seconda la mattina del rilascio, su PG17, con confronto dello schema di produzione); gli account esterni nascono solo dopo l'expand (passo 6b, CSV rivisto) e partono su una pagina; il rollback del codice punta a un deployment `fase1-pre-r1` già sicuro, e il ritorno in avanti passa da `fase1_reconcile_tasks()`. Il passaggio a Drive (R2) vale per compito (`requires_drive`), con kit legacy per l'audio consegnato come link. Le scadenze Batch saltano il weekend; lo script si blocca dalla revisione e cambia solo tramite proposte accettate; gli upload vanno dal browser a Drive (U1) oppure da Drive con sincronizzazione (U3) secondo lo spike.
- **Drivers:** sicurezza degli accessi con esterni e azioni da Telegram; migrazione senza perdite, provata su dati reali, su un sistema in produzione senza backup automatici; capacità di un solo sviluppatore (~37 g con i tagli di R1, checkpoint al 23 ottobre) e vincoli dei piani.
- **Alternative considerate:** B (enum esteso + colonne sul reel, senza compiti); C (stato del workflow in Inngest); M1 (rinomina dei valori di `pipeline_phase`); M3 (tabella di lookup degli stati); E2 (esterni via service-role); E3 (esterni come membri di pagina); T2/T3 (HMAC o nonce nei pulsanti); J1/J2/J3 (cron Inngest, run Inngest per compito, pg_cron); U2/U3 (Supabase Storage, upload su Drive con sincronizzazione); R-merge e R-iter1 (rilascio unico; R1 solo interni).
- **Perché questa scelta:** è l'unica combinazione che mantiene le transizioni in SQL con RLS (vincolo Fase 0), rende verificabile in db-check l'isolamento degli esterni e i privilegi delle funzioni (AC4), permette il rollback del codice senza downtime fino al contract e senza riaprire i dati dopo, mette tutto il rischio di migrazione nella prima release provandolo su un dump reale, e non aggiunge fornitori che fanno solo da timer.
- **Conseguenze:**
  - due colonne di stato fino al contract di Fase 2;
  - circa 20 policy riscritte e un'allowlist delle funzioni da mantenere a ogni migrazione;
  - dipendenze operative nuove: Vercel Pro (cron), Sentry, Shared Drive con condivisione esterna, bot di staging, SMTP personalizzato; Inngest rinviato alla Fase 2 (deviazione dalla spec da confermare);
  - il vecchio flusso di avanzamento di fase e i magic link restano solo come storico;
  - kanban e dashboard restano per macro-fase in Fase 1 (badge di stato e semaforo del compito sulle card);
  - tra R1 e R2 le consegne avvengono con link; il thread del reel è visibile agli esterni salvo "Nota interna";
  - (iter3) in R1 gli esterni si gestiscono da script (`fase1-collaborators.ts`), le proposte si leggono affiancate senza diff; i compiti hanno un flag `requires_drive` che sopravvive a R2; la verifica locale dipende da Homebrew `postgresql@16`/`@17` e `libpq@18`, e la prova su dump da un'allowlist dello schema (`drift-allow.txt`) da rivedere quando cambia lo shim.
- **Follow-up:**
  - contract in Fase 2 (eliminare `phase_advance_requests`, `magic_link_invites`, `/invite/[token]`, `phase_status`, eventualmente `reels.phase` dopo aver spostato RACI e buffer sugli stati; documentare che l'`approver[]` RACI non decide più le transizioni);
  - kanban e dashboard per stato, scheda "Attività", pulizia dei pulsanti Telegram superati;
  - indice "un compito aperto" per `(reel, kind)` quando arrivano più doppiaggi per reel;
  - nota di rimando via risposta Telegram; calendario lavorativo con festività per gli SLA;
  - claim `account_type` nel JWT (access-token hook) se la query in `src/proxy.ts` diventa costosa;
  - attivazione dei gruppi di approvatori intorno a 10 pagine;
  - Inngest per i job AI a più step della Fase 2;
  - (iter3) pagina `/collaboratori`, diff parola per parola e offboarding in UI se non entrano in S6; eliminare `requires_drive` e il kit legacy quando non restano compiti di R1 aperti; funzione SQL dedicata per l'anonimizzazione GDPR se le richieste diventano frequenti.

---

Domande aperte residue: `docs/fase1-decisioni.md` (sezione "Fase 1 Produzione 2.0", voci iter1 e iter2 accettate il 2026-10-01; voci nuove in "Iter3 — nuove decisioni", ciascuna con un default).

---

## Changelog iter2

Riferimenti: Architect = `.omc/plans/fase1-produzione-2-0.iter1.architect-review.md`, Critic = `.omc/plans/fase1-produzione-2-0.iter1.critic-review.md`; i numeri "snapshot:N" puntano a `fase1-produzione-2-0.iter1.snapshot.md`.

**Fatti cambiati:** signup di produzione già disattivato (rimosso da prerequisiti e azioni pendenti, §9); S0 anticipata al 5 ottobre (codice Fase 0 già in produzione, `ea8a242`); riferimenti a `docs/brain-plan.md` aggiornati (checklist Fase 0 alle righe 86-100: 92 signup, 96 backup/Pro, 99 infra, 100 Sentry); codice citato verificato su `0077584`.

### Architect

| # | Rilievo | Risoluzione |
|---|---|---|
| A1 (critico) | Helper interni `SECURITY DEFINER` eseguibili da `authenticated` | Accolto, unito a C1. Schema `private` senza `USAGE`; `revoke … from public, anon, authenticated` su ogni funzione (§5); `task_action_as`, `sweep_tasks`, `claim_jobs`, `standup_snapshot`, `drive_desired_state`, `mark_drive_reconciled` solo `service_role`; allowlist e controllo `p_actor` in `00_guards.sql`; api-check sulle chiamate vietate (S1, S2, §7.2) |
| A2 (alto) | Passo di contract nascosto in S2 | Accolto, unito a C3. `fase1_task_engine` solo expand; `fase1_r1_contract` in un commit separato applicato dopo il deploy; `fase1_r1_uncontract.sql` ripristina solo grant, policy e trigger, mantiene le tabelle (S2, §6, §8). Principio 2 riscritto |
| A3 (alto) | R1 non può usare titolari esterni; default `external` prima della RLS; `invite-users.ts` tardi | Accolto, unito a C12. RLS, account, `handle_new_auth_user`, `invite-users.ts` in S1; UI esterni in S3; R1 include gli esterni, R2 = solo Drive (D7) |
| A4 (alto) | Job Drive come eventi ordinati, nessun lease, job senza handler, rimando senza gate | Accolto, unito a C9. Job unico `drive_reconcile(reel)` deduplicato per reel, che converge cartella → archivio → kit → permessi e imposta `kit_ready_at`; lease di 5 min e contatore di generazione; notifica e soglie dell'animazione solo a kit pronto (vale anche dopo un rimando); nessun job Drive finché `drive_enabled = false`; `drive_backfill()` in R2 (S4, S5) |
| A5 (medio) | `batches.source_doc_url`, `profile_names` globale, viste `security_invoker`, policy `public` | Accolto: esterni senza accesso a `batches`; `profile_names` limitato ai reel visibili; guardia su viste e ruolo `public` (S1) |
| A6 (medio) | Token Telegram firmato col segreto del webhook, non monouso, collegamento da qualunque chat | Accolto con variante: token opaco casuale salvato come hash, monouso, 15 min (nessuna chiave da gestire, supera la richiesta di chiave separata); solo chat private; la migrazione azzera i `telegram_chat_id` di gruppo (D4, S1, S4) |
| A7 (medio) | Ordine dei lock, `skip locked`, ricontrollo all'invio, nessun messaggio per i compiti migrati | Accolto: reel → compito ovunque (§5); sweep per reel con `skip locked`; handler `notify` ricontrolla compito e assegnatario; backfill con `notified_at = now()` (S1, S4) |
| A8 (medio) | Anteprima Drive su iOS, upload provato solo da Node | Accolto, unito a C14: spike nel browser (Chrome, Safari iOS, `Expose-Headers: Range`, ripresa) e spike media su iPhone in S0; U1 condizionata; audio servito dal server, video "Apri in Drive" |
| Antitesi D1 | Lo stato è derivato, memorizzarlo crea copie | Accolta la sintesi: `state` memorizzato ma `_set_state` verifica lo stato derivato; trigger su `phase` permissivo fino al contract, poi rigido (D1, S1, S2) |
| Antitesi D5 | Inngest fa solo da timer, Vercel Pro serve comunque | Accolta: J4 (cron Vercel Pro) scelto, Inngest in Fase 2; domanda aperta con default |
| Antitesi D6 | U3 evita l'uploader custom | Accolta in parte: U1 solo se lo spike browser passa, U3 come alternativa già progettata e come taglio n. 2 |
| Sintesi: tagli | Attività UI, ore di silenzio, `/chatid`, editor SLA | Accolti i primi tre; **editor SLA non tagliato** (la spec lo richiede): domanda aperta |
| Deriva documenti | `brain-plan.md:9` e `:60` contraddicono D3/D6 | Elencati come modifiche di S6 (questo piano non tocca `docs/`) |
| Cambio di prodotto non segnalato | Le ore di silenzio ritardano le escalation | Ore di silenzio tagliate; notifiche notturne silenziose, segnalate come cambio in domanda aperta |

### Critic — bloccanti e medi

| # | Rilievo | Risoluzione |
|---|---|---|
| C1 (critico) | Funzioni interne eseguibili da ogni utente | = A1 |
| C2 (alto) | R1 migra la produzione senza prova su dati reali | `rehearse-dump.sh` costruito in S1 sull'harness di upgrade; caricamento con `session_replication_role = replica` (nessun `on_auth_user_created`); report con condizioni di stop; "prova verde su dump < 24 h" = passo 0 di ogni rilascio (S1, §6, §8) |
| C3 (alto) | Il rollback riapre tutto; "reversibile per costruzione" esagerato | Rollback a livelli: mai `using (true)`, mai drop di tabelle finché esistono esterni (`fase1_full_down.sql` si rifiuta); motore R1 e `finish_upload` scrivono anche `audio_drive_url`/`video_drive_url`; Principio 2 riscritto; revoche spostate nel contract (§2, S2, S5, §6) |
| C4 (alto) | Digest e promemoria agli esterni | `internalProfiles()` in `reminder.ts` e `weekly.ts`; menzioni filtrate; revisione di ogni `from('profiles')` service role; check in `07_externals.sql`, unit, e2e E4 (S1) |
| C5 (medio) | `state_raci_phase()` incompleta | Tabella di 10 righe in D2 (`approvazione_finale` → `editing`, quindi il buffer non conta reel non approvati) asserita in `05_fase1_model.sql` |
| C6 (medio) | Reel in volo bloccati da `dod_incomplete` | Il backfill inserisce le voci DoD dei passi superati con `note = '[migrazione Fase 1]'`; AC7 confronta solo le righe preesistenti (§3, S1, §4) |
| C7 (medio) | Regola di fallback email inapplicabile | "Telegram primario, email di riserva" indipendente dalle righe salvate (`resolveTaskChannels`); cancellazione delle righe salvate col vecchio default; `saveOwnPrefMatrix` salva solo differenze (§3, S1, S4) |
| C8 (medio) | Buchi nella tabella delle transizioni | Aggiunti: accept dell'animazione, `validation` approve, `publish_reel` chiude `scheduling`, `assign_task` revoca e notifica, offboarding; asimmetria Confermato/animazione documentata; semantica degli interruttori (timbro senza notifica, nessun arretrato) (§3, S2) |
| C9 (medio) | Outbox senza lease né ordine | = A4; più età del job più vecchio in `job_health` e nello stand-up |
| C10 (medio) | Ingegneria dei rilasci assente | `supabase migration new` al momento della scrittura, nessun timestamp pre-datato; tag `fase1-r1-expand`/`fase1-r1`; push in due tempi; percorso di hotfix e `migration repair`; atomicità per file verificata nel sorgente della CLI (§5, §8) |
| C11 (medio) | "I check esistenti continuano a funzionare" falso | Seed `a`–`d` esplicitamente `internal`, nuovo esterno `e`; aggiornati `02_reels.sql`, `03_phase_advance.sql`, `04_scale.sql`, `api-check.mjs` (S1, S2, §7.2) |
| C12 (medio) | Modello operativo di R1 indefinito e contraddittorio | = A3; playbook tra R1 e R2 in §8; una sola regola sui magic link (§3) |
| C13 (medio) | Si può approvare uno script diverso da quello visto | Blocco da `revisione` + `script_rev` nel `callback_data` e nell'app (`stale`) (§3, D4, S2) |
| C14 (medio) | Revisione media da mobile non verificata | = A8; AC2 misurato su iPhone; route audio con `Range` in S5 |
| C15 (medio) | Calendario a margine zero | Ristimato a 35 g con tabella delle differenze; tagli a impatto zero applicati; target R1 9/11, R2 19/11, riserva 4/12 (+10 g) (§9) |

### Non bloccanti (Architect e Critic)

| Rilievo | Esito |
|---|---|
| Token Telegram ≤ 64 caratteri `[A-Za-z0-9_-]` | Accolto (32 caratteri casuali) |
| `notifications.payload` scrivibile dal destinatario | Accolto: update solo su `read_at`; nessun id di messaggio salvato |
| Guardie: escludere trigger, controllare ruolo `public` e viste | Accolto (`00_guards.sql`) |
| Ordine dei lock reel → compito | Accolto (§5) |
| Guardia esterni in `src/proxy.ts` | Accolto (S3) |
| Claim `account_type` nel JWT via access-token hook | **Rinviato**: la query sulla propria riga in `proxy.ts` basta a 10–30 utenti; l'hook richiede configurazione su due progetti; follow-up nell'ADR |
| Ore di silenzio anche per riassegnazioni e assegnazioni | **Superato**: ore di silenzio tagliate; tutte le notifiche Batch notturne partono silenziose |
| Sentry prima di R1 | Accolto (S0) |
| `job_health` giornaliero troppo lento | Accolto: controllo opportunistico in `drainOutbox()` + evento Sentry |
| Pagina di smoke test `active = false` | Accolto (S1, §8) |
| `fase1-prod-config.sql` rivisto | Accolto (S4, §8 passo 8, provato nella prova su dump) |
| Supabase Pro "consigliato" contro `brain-plan.md:96` | Accolto: prerequisito di R1, domanda aperta con default sì |
| Deriva di `brain-plan.md` | Elencata in S6 |
| Blocco dello script e re-sync contro la spec | Accolto: re-sync salta i reel bloccati (modifica piccola a `actions.ts`) → domanda aperta; la modifica admin di testo bloccato accoda `drive_reconcile` |
| Offboarding degli esterni | Accolto (`offboard_collaborator`, S1–S3) |
| `assign_task` applica tipo e doppiatore ≠ animatore | Accolto (`invalid_assignee`) |
| `tasks.assignee_id` `ON DELETE` | Accolto: `restrict` (si disattiva, non si cancella) |
| Shared Drive "i lettori possono scaricare" | Accolto (prerequisiti, spike S0) |
| Thread dei commenti visibile agli esterni | Accolto: flag `internal_only` + avviso al team; domanda aperta |
| J4 respinto su premessa debole; Inngest elabora negli USA | Accolto: J4 scelto (D5) |
| Indice "un compito aperto" contro l'argomento dei compiti paralleli | Chiarito in D1 (Fase 2: indice per `(reel, kind)`) |
| `approval_groups` duplica `approver[]` del RACI | **Mantenuto**: i gruppi servono ad AC11; documentato nell'ADR che l'`approver[]` RACI non decide più le transizioni |
| `reel_assignments` mai usato in `src` | Accolto: tolto dalle fonti del backfill |
| La query di AC1 deve escludere `in_app` | Accolto (§4) |
| Rimando del video finale in 3 tap | Accolto: destinazione preselezionata, 2 tap |
| Validatore senza riserva | **Non cambiato**: l'admin riassegna (domanda aperta esistente) |
| Finestra di 7 giorni per gli esterni | **Non cambiata**: default confermabile (domanda aperta esistente) |
| Assegnazioni di "Avvia stesura" in raffica | Accolto: notifiche raggruppate per autore |

### Respinti o non adottati (riepilogo)
- **Taglio dell'editor degli override SLA per pagina** (sintesi Architect, taglio n. 2 dell'iter1): respinto, la spec lo richiede; serve l'OK dell'utente.
- **Unione di R1 e R2**: respinta (D7): con R2 solo Drive, l'unione aumenterebbe il rischio di un'unica migrazione e legherebbe R1 al prerequisito Workspace.
- **Chiave separata per firmare il token Telegram** (A6): sostituita da un token opaco monouso, che non richiede chiavi.
- **Access-token hook** (Critic): rinviato a follow-up.
- **`--include-all` per migrazioni fuori ordine**: escluso; si rinomina la migrazione non rilasciata.

---

## Changelog iter3

Riferimenti: Architect = `.omc/plans/fase1-produzione-2-0.iter2.architect-review.md` (modifiche 1–9), Critic = `.omc/plans/fase1-produzione-2-0.iter2.critic-review.md` (B1–B5 + non bloccanti); "snapshot:N" = `fase1-produzione-2-0.iter2.snapshot.md`. Decisioni del 2026-10-01 (default accettati) non riaperte. Fatti verificati su `f54ab35`: `run.sh:12` usa i binari nel `PATH` (PG 14.19), Homebrew ha `postgresql@16`, `libpq@18`, `postgrest`; il dump del 2026-10-01 è pg_dump 18.6 da PG 17.6 con `SET transaction_timeout`; `claim_admin_if_first()` imposta solo `is_admin`; `seed.sql:11` imposta `is_admin` prima di qualunque `account_type`; `reminder.ts` e `weekly.ts` leggono ogni profilo.

### Architect iter2

| # | Rilievo | Risoluzione |
|---|---|---|
| 1 (alto) | Account esterni creati prima dell'expand diventano `internal`; config non provabile | Accolto, unito a Critic B1. Passo 6b dopo expand e codice con `scripts/fase1-collaborators.ts` e CSV rivisto; congelamento della creazione di account dal dump 0a al passo 4; stop del report su profili fuori dall'allowlist interna; `fase1-prod-config.sql` per email con eccezione su email mancante o tipo sbagliato; `rehearse-dump.sh` crea gli stessi esterni dallo stesso CSV; testo di snapshot:590/:646 corretto (§8 playbook, §9 prerequisiti). Sintesi adottata: esterni titolari su una pagina per 48 h, poi `fase1-prod-config-ramp.sql` (D7, §8 passi 8 e 11) |
| 2 (alto) | Il passaggio R1 → R2 blocca i reel in volo | Accolto, unito a B2. `tasks.requires_drive` copiato da `drive_enabled` alla creazione; kit legacy (script + `_audio_link.txt`); `audio_approval` senza file approvato usa il kit legacy; link legacy visibili agli assegnatari; spegnere Drive declassa i compiti aperti; caso in `10_files.sql`, tappa in `upgrade.sh`, E13; `drive_backfill()` nell'elenco funzioni di S5 (D7, S2, S5, §7) |
| 3 (medio-alto) | R1 ottimistico, tagli solo di R2 | Accolto. Tagli di R1 (`/collaboratori` → script, diff → testo affiancato, offboarding in UI → script) scontati nel calendario; checkpoint venerdì 23 ottobre con piano B (R1 16/11, R2 30/11); seconda prova la mattina del rilascio; probabilità ristimate. Editor SLA **non** tagliato (decisione utente). `/approvazioni` → `/compiti` filtrato non adottato: tocca la coda mobile di AC2 (§9) |
| 4 (medio) | Rollback non onesto: invii a esterni, nessuna riconciliazione | Accolto: deploy `fase1-pre-r1` tollerante alle colonne come bersaglio del rollback (scelto al posto di una build di rollback separata: è lo stesso filtro, già in produzione, e non serve tenerla aggiornata); trigger su `state, phase, posted_url`; `fase1_reconcile_tasks()`; percorso contract → uncontract → legacy → re-contract → riconciliazione in `upgrade.sh`; Principio 2 riscritto (§2, S1, S2, §6) |
| 5 (medio) | Deriva dello schema di produzione non provata | Accolto: `schema-public.sql` in ogni dump, confronto normalizzato con lo schema ricostruito e `drift-allow.txt`, stop sulle differenze nuove; `00_guards.sql` solo catalogo, in sola lettura sulla produzione dopo i passi 5 e 7 (S1, §8) |
| 6 (medio) | Commenti: spostabili dagli esterni; note interne via menzione | Accolto, = B5 (§3, S1, `07_externals.sql`, unit) |
| 7 (medio) | Reel migrati in `validazione` saltano la stesura | Accolto: approvazione di una `validation` con `origin = 'migration'` → `bozza` + `writing`; asserito in `checks-upgrade` (S2, §6) |
| 8 (basso-medio) | Dettagli Drive e outbox | Accolti tutti: spike `writer` di una Gmail non membro (S0 3b); permessi ereditati saltati; id della cartella salvato subito; token di lease su `complete_job`/`fail_job` + `maxDuration` 60 s; route audio su Preview con 206 da ~4 MB |
| 9 (basso) | Coerenza | Accolti: una regola per `published_at` fuori da `publication` (normalizza e riporta); `derived_state()` per reel senza compiti; `claim_admin_if_first()` e ordine di `seed.sql`; chi chiama `propose_text_change`; `setWebhook` (passo 6c); fallback email solo su errore definitivo o dead letter; claim atomico dello stand-up; "34 giorni" corretto; testo "aggiunge solo funzioni" corretto (il blocco dello script cambia il comportamento del codice vecchio, annunciato) |
| Antitesi | R1a interni / R1b esterni | Non adottata come release separata; adottata la sintesi (rampa su una pagina, solo config) |

### Critic iter2 — bloccanti

| # | Rilievo | Risoluzione |
|---|---|---|
| B1 (alto) | Creazione degli esterni contraddittoria, percorso di fuga | = Architect 1 (§8 passi 0a, 3, 6b, 8; S1 `rehearse-dump.sh`, `fase1-prod-config.sql`; §9 prerequisiti; Scenario 10) |
| B2 (alto) | Il cutover di R2 blocca i reel di R1 | = Architect 2 (S5 "Passaggio dei compiti aperti", `10_files.sql`, `upgrade.sh`, E13; Scenario 11) |
| B3 (medio) | La toolchain non esegue né il SQL né il dump | Accolto con la scelta del coordinatore: `run.sh`/`upgrade.sh` su `postgresql@16` già installato con `psql` di `libpq@18`; `rehearse-dump.sh` e confronto di schema su `postgresql@17` (da installare in S1, ~100 MB su ~10 GB liberi) perché il dump ha `SET transaction_timeout` (solo PG17) e il confronto di ACL tra major diverse darebbe falsi positivi; `run.sh`/`upgrade.sh` ripetuti su PG17 prima di ogni rilascio; `auth.users` in tabella d'appoggio a 34 colonne; `migrations.txt` accanto a ogni dump; corretta l'affermazione che il dump di dati contenga le versioni (S1, §8; Scenario 12) |
| B4 (medio) | Il bersaglio del rollback manda digest e promemoria | = Architect 4: `fase1-pre-r1` con filtro `select('*')` + JS, in produzione da S1 e provato su Preview (S1, §6, §8; Scenario 13) |
| B5 (medio) | Gli esterni spostano i propri commenti | Accolto: `grant update (body, mentions, internal_only)`, `with check` che ripete la regola dell'insert (l'esterno non può mettere `internal_only = true`; l'interno sì, sui propri); commenti `internal_only` mai notificati a esterni; casi in `07_externals.sql`, unit su `mentionRecipients`, AC4 aggiornato (§3, S1, §4, §7; Scenario 15) |

### Critic iter2 — non bloccanti

| Rilievo | Esito |
|---|---|
| Menzioni `internal_only` agli esterni | Accolto (B5) |
| `file_url` solo `https://` in SQL | Accolto (`invalid_input`, tabella delle transizioni) |
| `holds_open_task()` fuori da helper e allowlist | Accolto (S1, `00_guards.sql`) |
| Trigger `before update of state, phase` | Accolto, più `posted_url` (Architect 4) |
| Metà "prima del contract" di `03_phase_advance.sql` solo in `upgrade.sh` | Accolto, scritto in S2 |
| `published_at` fuori da `publication`: una regola | Accolto: normalizza e riporta, nessuno stop (S1, §6) |
| Freschezza della prova | Accolto: prova 0b la mattina del rilascio |
| CLI lasciata collegata alla produzione | Accolto: `--db-url` se la CLI lo supporta (verifica in S1), altrimenti ricollegamento immediato; controllo al passo 12 (Scenario 16) |
| `setWebhook` con `allowed_updates` e `secret_token` | Accolto (S4, passo 6c, Scenario 14) |
| Soglie dei compiti migrati | Accolto: `confirm_migrated_tasks` le ricalcola da `now()` |
| `/collaboratori` verifica l'admin prima del service role | Accolto in `src/lib/collaborators/admin.ts` (usata da script e UI) |
| `00_guards`: `cmd = 'ALL'` con `qual = 'true'` | Accolto |
| `drive_backfill()` mancante tra le funzioni di S5 | Accolto |
| Cancellazione GDPR con `on delete restrict` | Accolto: anonimizzazione documentata (§3, S6) |
| Testo superato (34 giorni, SMTP di produzione sconosciuto) | Corretto (§2, §9) |
| C10: il worktree ha bisogno di un proprio `supabase link` | Risolto con `--db-url`, o link esplicito nel worktree (§8) |
| C14: in R1 i link aprono WeTransfer/Drive personali | Compromesso accettato, scritto in D7 (AC2 media misurato in R2) |

### Respinti o non adottati (iter3)
- **Taglio dell'editor SLA** (candidato dell'Architect): respinto, decisione dell'utente.
- **`/approvazioni` → `/compiti` filtrato** (candidato dell'Architect): non adottato, riduce la coda mobile di AC2; resta possibile solo con l'OK dell'utente.
- **Build di rollback separata e taggata** (Architect 4, prima variante): sostituita dal deploy `fase1-pre-r1` (variante del Critic), che è lo stesso codice già in produzione.
- **Release R1a/R1b** (antitesi dell'Architect): sostituita dalla rampa per configurazione.
- **Solo `postgresql@17` per tutto** (opzione b del coordinatore): non adottata per l'iterazione quotidiana; PG17 resta obbligatorio dove conta l'uguaglianza con la produzione.

## Correzioni inline dal consenso (iter3, 2026-10-02)

Architect iter3 (`.omc/plans/fase1-produzione-2-0.iter3.architect-review.md`, N1–N10) e Critic iter3 (`.omc/plans/fase1-produzione-2-0.iter3.critic-review.md`, 1–9) approvano il piano. Le voci sotto non richiedono un altro giro: l'esecutore le applica nella fetta indicata e spunta la casella. Le righe "snapshot:N" dei revisori si riferiscono a `fase1-produzione-2-0.iter3.snapshot.md`.

**Prima della prova 0a (bloccano il giorno del rilascio):**

- [ ] **I1 — Script TS verso la produzione** (Arch N2, Critic 1). Loader comune `--target staging|production` (`.env.local` o `.env.production.local`) che stampa il project ref, controlla `rbcgtwohcsqjmyjzhlbx` e lo username del bot, e chiede conferma digitata. Gli script solo-staging (`fase1-seed-staging.ts`, `fase1-time-travel.ts`) rifiutano un URL di produzione. In 0a si esegue `fase1-collaborators.ts --target production --dry-run`. Il controllo dopo 6b passa da `psql "$PROD_DB_URL"`; al passo 12 si tolgono le chiavi di produzione dalla shell. Vale anche per 6c (`telegram-set-webhook.ts`), `send-links` e `offboard`. — S1 (loader), S4 (runbook)
- [ ] **I2 — Configurazione e prova separate per R2** (Arch N1, Critic 2). `scripts/fase1-r2-enable-drive.sql`: solo `drive_enabled = true`, `drive_backfill()` e report dei compiti aperti con `requires_drive = false` per tipo. `rehearse-dump.sh --release r1|r2`: in modalità r2 confronto di schema, solo la migrazione S5, lo script R2, le guardie; niente ricreazione degli esterni né backfill R1. Il §8/R2 (snapshot:454) usa lo script R2, mai `fase1-prod-config.sql`. Lo script della rampa (`fase1-prod-config-ramp.sql`) si prova dentro la prova di R1. — S1 (r1), S5 (r2)
- [ ] **I3 — Guardie consapevoli del contract** (Arch N4). Variabile `contract_applied`: in modalità expand l'allowlist di `00_guards.sql` include anche `decide_phase_advance`. Le guardie in modalità expand girano nella prova; sulla produzione si usano `PGOPTIONS='-c default_transaction_read_only=on'` invece di `begin read only`. — S1, S2

**Durante l'esecuzione:**

- [ ] **I4 — Trigger di sincronizzazione a confronto di valori** (Arch N3). I rami legacy scattano solo se `phase` o `published_at` cambiano davvero (`is distinct from`); il ramo `posted_url` imposta anche `phase = 'publication'` come il backfill; stessa regola per `script_rev` e per il blocco dello script (il codice vecchio manda tutti i campi a ogni salvataggio: `src/lib/reels/actions.ts:82`, `:141-145`). Test in `upgrade.sh`: un salvataggio Publish del codice vecchio non sposta indietro un reel in `revisione`/`confermato`/`approvazione_finale`. — S1
- [ ] **I5 — Base del confronto di schema** (Arch N5, Critic 4). Nuovo dump di produzione in S1 (sola lettura, OK dell'utente) nel formato di §6, con `schema-public.sql` e `migrations.txt`; `drift-allow.txt` costruito da quello, con voci su istruzioni normalizzate e non su blocchi di diff; entrambi i lati con lo stesso `pg_dump` di `libpq@18`. Il criterio di S1 si riferisce a questo dump, non a quello del 2026-10-01. — S1
- [ ] **I6 — Casi limite del cancello del kit** (Arch N6, Critic 3). (a) Con `drive_enabled = false` i compiti `animation` aperti con `notified_at is null` ricevono soglie da `now()` e la notifica di assegnazione. (b) Un reel migrato da `doppiaggio` in poi senza audio approvato né `audio_drive_url` ha un kit legacy di solo script, considerato pronto, con avviso all'admin ed elenco nel report di R2. (c) L'URL del kit legacy viene dal payload del compito di doppiaggio approvato, non da `reels.audio_drive_url`. Casi in `10_files.sql`. — S5
- [ ] **I7 — Oggetti di S5 usati in S2** (Arch N7). La versione R1 di `private.task_action_core` e `_create_task` gestisce solo i link; S5 le sostituisce con `create or replace`. In alternativa `kit_ready_at` e `reel_files` nascono in S1. Scelta da annotare nel changelog di S2. — S2
- [ ] **I8 — Menzioni scritte dagli esterni** (Arch N8). `resolveValidMentions` (`src/lib/comments/actions.ts:41`) risolve tramite `profile_names()`; un commento di un esterno notifica l'approvatore del compito aperto; `updateComment` seleziona anche `internal_only` (`actions.ts:135`). Unit test. — S3
- [ ] **I9 — Secondo checkpoint martedì 3 novembre** (Arch N9): la parte R1 di E1 è verde sullo staging, altrimenti piano B. Comunicare al team R1 il **16 novembre come impegno** e il 9 novembre come obiettivo ambizioso. — §9
- [ ] **I10 — Toolchain** (Critic 5). `run.sh`/`upgrade.sh`/`rehearse-dump.sh` chiamano `$PG_BIN/initdb` e `$PG_BIN/pg_ctl` in modo esplicito (`libpq@18/bin` contiene anche `initdb` e `pg_ctl`); dopo l'avvio si verifica `show server_version_num`. Filtro esplicito per gli INSERT di `data.sql` in `auth.identities`, `sessions`, `refresh_tokens`, `flow_state`, `one_time_tokens`, `mfa_amr_claims`. Le colonne della tabella di appoggio di `auth.users` si ricavano dall'intestazione dell'INSERT del dump, non sono fisse a 34. — S1
- [ ] **I11 — Profilo esistente che in realtà è esterno** (Critic 6). `existing-externals.txt` rivisto e accettato dal report; ban prima del passo 4; conversione al passo 6b con `fase1-collaborators.ts --convert-existing`, poi unban. In S1 si confrontano i 4 profili di produzione con l'allowlist. — S1, S4
- [ ] **I12 — Fixture di smoke test in produzione** (Critic 7). `fase1-prod-smoke.sql` dopo il passo 8: pagina di test (`active = false`), un reel con un compito di approvazione per un admin collegato a Telegram, un esterno di test con 1 reel (nel CSV); offboarding dell'esterno di test a fine passo 11. — S4
- [ ] **I13 — Ordine del ramo R1 → R2 in `upgrade.sh`** (Critic 8): migrazione fino al tag `fase1-r1`, fixture, poi S5, poi attivazione di Drive. Così si prova il `create or replace` di S5 su righe esistenti. — S5
- [ ] **I14 — Dettagli minori** (Arch N10, Critic 9):
  - `standup_claim` confronta `text` con `date`: usare `p_date::text` e inserire la riga `system_heartbeats('standup')`.
  - Il "fatto quando" di S6 cita E1–E13.
  - Rimando di una `validation` migrata senza "ultimo autore": si ripiega sul Responsible del RACI.
  - `derived_state()` guarda lo stato corrente, non solo `scheduled_at`.
  - L'estensione della rampa elenca i compiti migrati assegnati tramite il RACI, per riassegnarli.
  - Il bersaglio del rollback è l'ultimo deployment di `main` che discende da `fase1-pre-r1`.
  - `requires_drive` resta finché esiste il percorso di incidente "Drive spento"; la data di rimozione si fissa all'inizio della Fase 2.
  - Non fare affidamento sul trigger `handle_new_auth_user` per `account_type`: GoTrue può scrivere `app_metadata` dopo l'INSERT, quindi contano gli aggiornamenti espliciti di `invite-users.ts` e `set_collaborator_as`.

- [ ] **I15 — Magic link valido in qualunque browser** (trovato nella prova dello staging, 2026-10-02).
  - **Problema:** il login usa PKCE (`exchangeCodeForSession` in `src/app/auth/callback/route.ts`). Un link aperto in un browser diverso da quello che l'ha chiesto, per esempio dall'app di posta o dal telefono, fallisce con `code challenge does not match previously saved code verifier`. Per gli esterni (AC4) è un blocco.
  - **Correzione:**
    - nuova route `src/app/auth/confirm/route.ts` che chiama `verifyOtp({ type, token_hash })` lato server e scrive i cookie sulla risposta di redirect, come fa già la callback;
    - template email "Magic Link" con link `…/auth/confirm?token_hash={{ .TokenHash }}&type=email`, su staging e produzione (dashboard o Management API), più `supabase/templates/magic_link.html` e `[auth.email.template.magic_link]` in `config.toml`;
    - l'origine del link deve coincidere con quella dell'app: produzione `https://app.reelificio.com`; sullo staging il `site_url` è `http://127.0.0.1:3000` mentre lo sviluppo gira su `localhost:3000`, quindi va allineato;
    - `/auth/confirm` va in `PUBLIC_PATHS`;
    - `next` è accettato solo come percorso relativo;
    - la callback PKCE resta, per i link già inviati.
  - **Verifica:** un link chiesto in Chrome e aperto in Safari, e dall'app Mail su iPhone, arriva a `/dashboard`. Da aggiungere allo scenario E4.
  - S3, al massimo 0,5 giorni.

## Changelog consenso (2026-10-02)

- Architect iter3: **APPROVE** (N1–N10 inline). Critic iter3: **APPROVE** (1–9 inline; gate ralplan tutti Pass).
- Aggiunta la sezione "Correzioni inline dal consenso" (I1–I14), che unisce i rilievi dei due revisori senza duplicati. I15 (magic link in qualunque browser) è stata aggiunta il 2026-10-02 dopo la prova di login sullo staging.
- `docs/fase1-decisioni.md`: corrette le righe superate (stima iter2, data R2 del 19 novembre); aggiunte tre decisioni dopo il consenso (date comunicate al team, checkpoint del 3 novembre, nuovo dump in S1).
- Stato: **approvato dall'utente il 2026-10-02**, con tutti i default.
