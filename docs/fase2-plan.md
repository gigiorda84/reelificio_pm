# Piano di implementazione — Fase 2 "Script Lab", rilascio A (scrittura)

- **Stato: approvato dall'utente il 2026-10-14, con tutti i default delle domande aperte.** Consenso raggiunto all'iter2 (Architect APPROVE WITH CHANGES, Critic APPROVE).
  - RALPLAN-DR **DELIBERATE**.
  - Revisioni: `.omc/plans/fase2-script-lab.iter{1,2}.*-review.md`.
  - Modifiche: `## Changelog iter2` e `## Changelog consenso (iter2)`.
  - Dopo l'approvazione il piano diventa `docs/fase2-plan.md`.
- Data: 2026-10-14 · Autore: Planner (consensus loop)
- Input:
  - `.omc/specs/deep-interview-fase2-script-lab.md`: 26 AC, con la correzione del 2026-10-14 sulle parole vietate, che stanno nella sezione Voce;
  - `CLAUDE.md`, `docs/fase1-plan.md`, `docs/brain-plan.md`, `docs/brain-concept.md` § Script Lab;
  - codice del branch `fase-1-s5-drive` al commit `bee3f6f`.
- **Vincolo di processo:**
  - R1 e R2 hanno precedenza assoluta. Il calendario principale usa le date **d'impegno** della Fase 1: R1 il 16 novembre e R2 il 30 novembre (`docs/fase1-plan.md:910`, I9 `:1226`). Il 9 e il 23 novembre sono lo scenario ambizioso.
  - La Fase 2 resta **fuori da staging e produzione fino a dopo R2**. Si verifica con `scripts/db-check/run.sh` e con un progetto sandbox, usato sia dal dev server sia dalle anteprime Vercel del branch (D-A).
- Decisioni in sintesi:
  - SQL in `supabase/fase2/`, promosso in `supabase/migrations/` solo al rilascio, con una guardia hash sulle due funzioni di Fase 1 riscritte e uno script che ne ripristina il corpo originale (D-A);
  - client AI sottile in `fetch` verso OpenRouter, dietro `AiProvider` con un'implementazione finta (D-B);
  - un job `ai_generate` per (generazione, modello) nella `job_outbox`, svuotato da un drain AI dedicato:
    - presa di un job per ogni posto libero, subito prima della chiamata;
    - lease di 150 s, pari al timeout della chiamata (120 s) più 30;
    - tetto globale di concorrenza in configurazione e nuovi tentativi entro la stessa invocazione;
    - cron `ai-drain` **ogni minuto**;
    - un fallimento previsto di un modello non è mai un dead letter (D-C);
  - bibbia in `page_bibles`, solo per interni; la sezione Voce, parole vietate comprese, resta in `voice_briefs` (D-D);
  - versioni come snapshot completi scritti da un trigger `SECURITY DEFINER`. La fonte la dichiarano le RPC della Fase 2, che sono `SECURITY INVOKER` (`save_reel_script`, mix, ripristino), così RLS e blocco dello script continuano a valere. Il trigger riconosce da solo le proposte accettate (D-E).

---

## 1. Sintesi dei requisiti (mappata sui 26 AC)

| AC | Cosa deve essere vero | Fetta |
|---|---|---|
| 1 | Bibbia per pagina: tono, personaggi, durata min–max, CTA ammesse, temi e keyword, script di esempio, modelli predefiniti; sezione Voce con aggettivi, **parole vietate**, audio di riferimento, libertà ammesse, procedura anomalie | S2 |
| 2 | I dati di `voice_briefs` entrano nella bibbia senza perdite (assorbimento logico, ammesso dalla spec); la scheda Voce del reel mostra la sezione Voce | S2, `upgrade.sh` |
| 3 | Salvano la bibbia admin e Responsible `script_writing`; gli altri ricevono `not_authorized` (check db-check) | S2 |
| 4 | Il doppiatore esterno riceve solo la sezione Voce, sia dalla UI sia dall'API | S2 |
| 5 | Backlog di idee per pagina con stati e ripescaggio | S3 |
| 6 | Batch da idee, reel in `idea`, codici `PP-yymm-NN`, idee `scelta` e collegate | S3 |
| 7 | Import del Google Doc invariato | S3, S4 (regressione) |
| 8 | "Avvia stesura" con menù a spunta (1–3 modelli); il resto come in Fase 1 | S6 |
| 9 | Un'esecuzione in background per modello, via `job_outbox`; script intero (4 blocchi più `notes`) da bibbia e idea, oppure dal titolo del reel se l'idea non c'è | S6 (+ idea in S3) |
| 10 | 10 reel × 3 modelli pronti entro 10 minuti | S1 (misura), S6, F2-E3 |
| 11 | Notifica di stesura a generazioni finite, comunque dopo 15 minuti; un messaggio per autore | S6 |
| 12 | Modello fallito: alternativa mancante con "Rigenera", errore registrato, tentativi limitati | S6 |
| 13 | "Rigenera" solo in `bozza`; le alternative precedenti restano | S6 |
| 14 | `ai_runs` per chiamata, con costo, token, durata, esito e altri dati | S6 |
| 15 | Prompt senza nomi, email o id di persone (test) | S6 |
| 16 | Alternative affiancate, base e blocchi presi da altre alternative; il risultato va in `reels` con `script_rev` incrementato | S4 |
| 17 | Ogni generazione, mix o salvataggio crea una versione; ripristino solo in `bozza` | S4 |
| 18 | Provenienza della base e di ogni blocco per ogni reel consegnato | S4 (dati), S7 (report) |
| 19 | Testo bloccato da `revisione` come in Fase 1; poi solo proposte | S4 (regressione) |
| 20 | Avvisi su parole vietate (dalla Voce), durata (2,5 parole/s) e CTA o chiusure ripetute negli ultimi 20 reel | S5 |
| 21 | Avvisi nel reel e nel pannello di revisione; la consegna resta sempre possibile | S5 |
| 22–25 | Metriche per gli admin: rimandi ≤ 1 su 5, costi per pagina e modello, batch da idee contro import, reel per autore | S7 |
| 26 | `run.sh`, typecheck, lint, build e test verdi; test su prompt, controlli e mix | tutte, cancello di S8 |

Non-goal confermati: generazione di idee, Intelligence e Apify, trend e news, commenti per riga, riscritture mirate, punteggio di viralità, caption, fact-check, tetti di spesa, blocchi configurabili, Character Lab, rimozione dell'import del Doc.

---

## 2. RALPLAN-DR — sintesi decisionale

### Principi
1. **R1 e R2 prima di tutto, e nessun contatto con loro.**
   - La Fase 2 non tocca staging né produzione prima di R2.
   - Riscrive **due sole** funzioni SQL di Fase 1, `private.start_writing` e `public.claim_jobs`. Ognuna ha una guardia hash sul corpo e uno script che ne ripristina la versione di Fase 1. Nessuna terza funzione: `decide_text_proposal` resta intatta (D-E).
   - I file TypeScript di Fase 1 toccati sono elencati in §5, così i conflitti di merge si vedono prima.
   - Ogni modifica tollera il codice di R2. Gli interruttori `ai_enabled` e `script_lab_enabled` spengono l'AI senza deploy.
2. **Il database resta l'unico che cambia stato.**
   - Scritture privilegiate tramite funzioni con codice di ritorno (`private.task_action_core`, `fase1_task_engine.sql:620-648`).
   - Dove l'utente scrive già con RLS e grant di colonna (il testo del reel), le RPC sono `SECURITY INVOKER` e non reimplementano policy né blocco.
   - `SECURITY DEFINER` solo dove le tabelle non hanno grant di scrittura per gli utenti (bibbia, idee, generazioni, versioni via trigger).
   - Il worker AI è un client: inizio, esito e costo di ogni chiamata passano da RPC riservate al service role, mai da scritture dirette.
3. **Verso i modelli va solo materiale creativo, in modo dichiarato.**
   - Il prompt prende i campi creativi della bibbia, le **parole vietate** della Voce e l'idea. Gli altri campi della Voce non partono mai.
   - I nomi completi di tutti i profili, disattivati compresi, le email e gli uuid si oscurano ovunque.
   - Nella **nota di rimando** e nello **spunto** si oscurano anche i nomi di battesimo dei profili. Nei campi creativi della bibbia i nomi di battesimo producono solo un avviso nell'editor, perché possono essere personaggi.
   - Il numero di oscuramenti si salva in `ai_runs.redactions` e in `ai_generation_items.redactions`, e compare a chi scrive come badge sull'alternativa: niente avviene in silenzio.
   - Nessun campo `user`, `data_collection: deny`.
   - In `last_error`, nei log e in Sentry vanno solo codici d'errore classificati, mai il corpo delle risposte dei provider.
4. **Il lavoro pagato non si perde e non si ripete.**
   - La riga `ai_runs` nasce `started` **prima** della chiamata e la aggiorna il primo che scrive.
   - Un lease scaduto la porta a `lost`; un risultato che arriva tardi con lo stesso id la riporta a `ok` o `error`, così il costo non si perde.
   - Un output non interpretabile si salva con `parser_warning`.
   - Al massimo 3 tentativi per elemento. Un'alternativa per (generazione, modello), anche con chi scrive in ritardo.
5. **Fette verticali piccole, costruibili senza chiave.** `AI_PROVIDER=fake` ha latenza ed errori configurabili. La chiave serve allo spike S1, che precede S6, e alle verifiche finali.

### Decision drivers (top 3)
1. **Rischio zero per R1 e R2** con un solo sviluppatore, che lavora alla Fase 2 negli spazi lasciati dalla Fase 1 (§9).
2. **Tempi e affidabilità della generazione (AC10–12)**, sopra un'outbox pensata per job da pochi secondi: lease di 2 minuti, backoff in minuti, drain di 45 s (`fase1_outbox.sql:23-117`, `drain.ts:25-30`). I fallimenti dell'AI non devono finire negli allarmi di Fase 1.
3. **Accessi e privacy verificabili** (AC4, AC15) con db-check, api-check e test unitari.

### D-A — Branch, migrazioni, database di sviluppo e promozione

Fatti:
- `run.sh` applica `supabase/migrations/*` e poi il contract preso da `supabase/rollback/` (`run.sh:11-20`).
- `upgrade.sh` salta `*_fase1_drive*` nella tappa R1 (`:26-30`).
- `rehearse-dump.sh --release r2` si ferma su qualunque migrazione pendente che non sia Drive (`:131-134`).
- Gli hotfix nascono con il timestamp del momento (`docs/fase1-plan.md` §8).

| Opzione | Pro | Contro |
|---|---|---|
| **A1. Cartella `supabase/fase2/NNN_<nome>.sql`; `run.sh` la applica dopo migrazioni e contract; `upgrade.sh` ha la tappa "R2 → Fase 2"; `scripts/fase2-promote.sh` sposta i file in `supabase/migrations/` al rilascio** | Nessun `db push` può portarla in staging o in produzione per sbaglio. L'ordine è sempre dopo R1, R2 e i loro hotfix. Una sola rinomina | Gli script dell'harness devono conoscere una seconda cartella (≈ 0,25 g). Il sandbox si migra con uno script. La finestra tra promozione e produzione va protetta (vedi sotto) |
| A2. Timestamp segnaposto nel futuro (`2099…`) | Nessuna modifica all'harness | Un push accidentale dallo staging è possibile, e un timestamp futuro in produzione blocca gli hotfix. Ordine sbagliato rispetto al contract preso da `rollback/` |
| A3. Timestamp reali, rinominati a ogni hotfix | Strumenti standard | Rinomine e `migration repair` ripetuti; facile dimenticarne una |

**Scelta: A1.** A2 è invalidata dal push accidentale e dal timestamp futuro; A3 dal costo ripetuto durante R1.

Regole:
- **Branch e worktree.** `fase-2-script-lab` parte da `fase-1-s5-drive`, nel worktree `../Reelificio_PM-fase2`. I push sullo staging partono solo dal checkout di Fase 1. Merge di `fase-1-s5-drive` (dopo R2, di `main`) ogni settimana e dopo ogni migrazione di Fase 1.
- **Guardia.** `supabase/fase2/000_guards.sql` crea `private._assert_body(regprocedure, md5[])`, che confronta `md5(prosrc)` con un elenco di valori ammessi. La chiamano i file che riscrivono `private.start_writing(uuid,uuid,integer)` e `public.claim_jobs(integer,interval)`. Se un hotfix di R1 o R2 cambia una delle due, `run.sh` fallisce.
- **Rieseguire `031`:**
  - per `claim_jobs` la guardia ammette l'md5 di Fase 1 **oppure** quello di Fase 2;
  - per `start_writing` controlla l'md5 di Fase 1 solo se esiste la firma a 3 argomenti; se esiste già quella a 4 argomenti con l'md5 di Fase 2, salta la riscrittura.
- **Ripristino.** `supabase/rollback/fase2a_restore_fase1.sql`, in quest'ordine:
  0. `set_app_config('ai_enabled', false)`: nessun job AI nuovo;
  1. `cancel_ai_jobs()`: nessun `ai_generate` pendente, che altrimenti il `claim_jobs` di Fase 1 prenderebbe e manderebbe in dead letter con `no handler` (`drain.ts:22`);
  2. solo dopo, elimina le varianti nuove di `start_writing` e ricrea i corpi di Fase 1 (`fase1_task_engine.sql:734-781`, `:1208-1211`; `fase1_outbox.sql:23-57`) con i loro grant.

  `upgrade.sh` lo prova: dopo il ripristino `md5` coincide con quello di Fase 1, nessun job AI resta pendente e i casi di `start_writing` e `claim_jobs` di `06_tasks.sql` e `09_outbox_sweep.sql` passano; poi si va di nuovo avanti.
- **Ogni file `supabase/fase2/*.sql` finisce** con `revoke execute on all functions in schema private from public, anon, authenticated` (guardia 5 di `00_guards.sql`).
- **Finestra di promozione:**
  - il collaudo completo (F2-E1…E9) si fa **prima**, sull'anteprima del branch collegata al sandbox;
  - `fase2-promote.sh` assegna i timestamp nuovi in sequenza **al più una settimana prima della produzione**, insieme al push sullo staging (scenario d'impegno: 4 gennaio per l'11; ambizioso: 7 dicembre per il 14);
  - dal push sullo staging a quello in produzione, **le migrazioni di Fase 1 sono congelate**, quindi per al massimo una settimana;
  - se un hotfix è inevitabile, la mattina del rilascio `fase2-promote.sh --check` lo vede: si rinominano di nuovo i file della Fase 2 dopo l'hotfix, e sullo staging si fa solo contabilità (`migration repair --status reverted <vecchie>` e `--status applied <nuove>`, contenuto identico), poi si ripete la prova su dump;
  - lo script si rifiuta di partire se esiste un timestamp più recente di adesso.

**Ambiente di sviluppo e anteprime.** `.env.local` punta allo staging, che non può ricevere la Fase 2. Per spazio su disco `supabase start` non si usa (`CLAUDE.md`; oggi restano 30 GB liberi, disco al 94%).

| Opzione | Pro | Contro |
|---|---|---|
| **DB1. Progetto sandbox `reelificio-pm-fase2` (Free, AlphaTechnology.ai), solo dati finti, usato dal dev server e dalle anteprime Vercel del branch** | Auth e PostgREST reali; le anteprime del branch servono anche per misurare AC10 e la prova `after()` prima di S8 | Il piano Free limita i progetti attivi (oggi lo staging è attivo e gli altri sono in pausa: da verificare). L'SMTP predefinito invia solo ai membri dell'organizzazione e con un limite orario basso, quindi serve Resend come sullo staging. Migrazioni via Management API |
| DB2. `supabase start` ridotto (`-x studio,imgproxy,realtime,storage-api,edge-runtime,logflare,vector`) | Offline | 8–10 GB di Docker; escluso da `CLAUDE.md` |
| DB3. Postgres di db-check + PostgREST locali (già in `run.sh:27-42`), senza auth | Nessun progetto né Docker | Niente login né UI: le forme delle query si provano con api-check estesa, la UI solo in S8 sullo staging (+1,5 g) |

**Scelta: DB1** (Q1). Se il limite dei progetti lo impedisce: DB2 se si liberano 10 GB, altrimenti DB3.

Regole per DB1:
- **Dev server.** `scripts/fase2-dev.sh` carica `.env.fase2.local` e **verifica che `NEXT_PUBLIC_SUPABASE_URL` contenga il ref del sandbox**, altrimenti si ferma. `.env.fase2.local` deve sovrascrivere:

  | Variabile | Valore |
  |---|---|
  | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` | sandbox |
  | `NEXT_PUBLIC_APP_URL` | localhost |
  | `CRON_SECRET` | proprio |
  | `OPENROUTER_API_KEY` | chiave di sviluppo e anteprima |
  | `AI_PROVIDER` | `openrouter` o `fake` |
  | `GOOGLE_SHARED_DRIVE_ID` | vuoto (Drive spento) |
  | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET` | vuoti |
  | `NEXT_PUBLIC_SENTRY_DSN` | vuoto |
  | `RESEND_API_KEY`, `EMAIL_FROM` | quelli dello staging, solo per i magic link del sandbox |

  `GOOGLE_SERVICE_ACCOUNT_*` resta, perché serve all'import del Doc in F2-E2.
- **Anteprime Vercel.** Le variabili Preview **specifiche del branch `fase-2-script-lab`** puntano al sandbox (stesse voci). Nessuna anteprima della Fase 2 usa lo staging prima di R2. Verifica: lo sweep chiamato sull'anteprima aggiorna il battito del sandbox, come per le anteprime di Fase 1.
- **Migrazioni e accesso.** `scripts/lib/target.ts:20-28` riceve il target `sandbox`. `scripts/fase2-sandbox-migrate.ts` (Management API) si rifiuta se il ref è un altro.

### D-B — Livello AI e strategia per l'output strutturato

Nessun pacchetto AI in `package.json`; zod 4 c'è già (`z.toJSONSchema`).

| Opzione | Pro | Contro |
|---|---|---|
| L1. Vercel AI SDK + `@openrouter/ai-sdk-provider` | È la scelta di `brain-plan.md:100`; astrae i provider, utile più avanti per Anthropic diretto e per lo streaming | Dipendenze con major frequenti. I campi OpenRouter (provider, usage, id della generazione) passano da `providerOptions`. La Batch API di Anthropic non è coperta. Nei job in background lo streaming non serve |
| **L2. Client nostro in `fetch` (`/api/v1/chat/completions`) dietro `AiProvider`, con zod 4** | Zero dipendenze, controllo esatto dei campi OpenRouter, `fetch` finto nei test, provider finto per costruire senza chiave; passare a L1 tocca un solo modulo | Timeout, classificazione degli errori e riparazione del formato si scrivono a mano (≈ 0,5 g) |
| L3. SDK `openai` con `baseURL` OpenRouter | Tipizzato | I suoi retry si sommano a quelli dell'outbox; i tipi non conoscono i campi OpenRouter |

**Scelta: L2.** È una deviazione da `brain-plan.md:100`, registrata nell'ADR.

**Output strutturato:**
- **SO-1 JSON schema rigoroso** (`response_format.json_schema`, `strict`, `provider.require_parameters: true`; campi `hook`, `corpo`, `chiusura`, `cta`, `note_regia`, tutti obbligatori) per i modelli con `structured: true` nel catalogo.
- **SO-3 testo a sezioni** (`HOOK:` … `NOTE:`) per gli altri modelli e come ripiego quando SO-1 non passa la validazione, senza una seconda chiamata. Riusa lo smistamento di `src/lib/parser/parse.ts`; se una sezione manca, `raw_content` + `parser_warning`.
- SO-2 (tool call) è scartata: varia tra provider e non aggiunge affidabilità.

Lo spike S1 fissa i default.

### D-C — Esecuzione della generazione

Base comune: un job `ai_generate` per (generazione, modello) nella `job_outbox` (`dedup_key = 'ai:<generation_id>:<model>'`), scritto nella stessa transazione di `start_writing` o di `request_generation`.

| Opzione | Pro | Contro |
|---|---|---|
| C1. Drain esistente di `task-sweep` | Nessuna route nuova | Sequenziale, 45 s di tempo, route da 60 s, lease di 2 minuti: oltre 75 minuti per 30 chiamate, con esecuzioni doppie. **Viola AC10** |
| C2. Solo `after()` | Latenza minima | Nessuna ripresa né retry |
| **C3. Drain AI dedicato: `after()` subito, cron `ai-drain` ogni minuto, semantica AI propria sopra l'outbox** | AC10 fino a 3 avvii contemporanei, anche con un guasto (calcolo sotto); fallimenti isolati dalla salute di Fase 1; tetto globale | Una route e un cron in più (le esecuzioni a vuoto finiscono subito); `claim_jobs` va riscritta |
| C4. Inngest | Step durevoli | Un fornitore in più che duplica outbox, lease e retry. Rinviato come in Fase 1 D5 (deviazione da `brain-plan.md:47,98`, nell'ADR) |

**Scelta: C3**, con queste regole:

- **Configurazione** in `app_config.ai_settings`: `{max_concurrency: 15, call_timeout_s: 120, max_attempts: 3, start_cutoff_s: 150}`.
- **Presa, un job per posto libero subito prima della chiamata.** `claim_ai_jobs(p_limit)`:
  - prende un `pg_advisory_xact_lock`, così due drain non leggono il tetto insieme;
  - prende `least(p_limit, max_concurrency − job ai_generate con lease vivo)` job;
  - assegna un lease di **`call_timeout_s + 30` = 150 s**;
  - `claim_jobs` di Fase 1 viene riscritta con `and kind <> 'ai_generate'` sia nella presa sia nell'update che manda in dead letter i job con `attempts >= 6` (`fase1_outbox.sql:31-35`). Così il drain esistente non vede mai i job AI, e `task-sweep` non manda in dead letter un job AI lasciando l'elemento aperto e la generazione bloccata in `generation_pending`.
- **Lease più corto di `maxDuration` (300 s), ed è voluto.** Il lavoro protetto dal lease è una sola chiamata, interrotta da `AbortController` a 120 s, più la sua registrazione, non l'intera invocazione. Un writer in ritardo è innocuo: il token di fencing e `record_ai_attempt` (vince chi scrive per primo) proteggono i dati. Il recupero dopo un'invocazione morta costa quindi ≤ 150 s più il cron, invece di ≤ 6 minuti più il cron.
- **Nuovi tentativi nella stessa invocazione.**
  - Per 408, 429, 5xx, timeout e rete, `record_ai_attempt` rimette il job pendente con `run_after = now() + max(Retry-After, jitter 5–30 s)`, al massimo 30 s.
  - Lo stesso drain lo riprende se il ritardo cade dentro la finestra in cui può ancora avviare chiamate (≤ 150 s dall'inizio). Altrimenti lo prende il cron successivo.
  - I tentativi si contano su `ai_generation_items.attempts` (al massimo 3). `fail_job` e il suo backoff in minuti (`fase1_outbox.sql:111-115`) **non si usano** per i job AI.
- **Fallimenti previsti.**
  - Errore definitivo (400, 401, 402, 403 moderazione, 404 modello) oppure 3° tentativo fallito: l'elemento diventa `failed` e il job si **completa** (`done_at`), come fa anche `cancel_ai_jobs()`.
  - Il dead letter (`failed_at`) resta **solo** per un lease scaduto all'ultimo tentativo, cioè un problema d'infrastruttura. Così `job_health.dead_letters_24h` (`fase1_drive.sql:1219`) e l'avviso `dead_letters` (`src/lib/jobs/health.ts:26`) non scattano per un modello che rifiuta.
- **Tempi dell'invocazione** (`maxDuration = 300` sulla route `ai-drain` e sulle pagine con le azioni):
  - nuove chiamate solo fino a 150 s, cioè 300 − 120 di timeout − 30 di coda;
  - la coda (≤ 20 s) è il completamento dei costi (≤ 10 s) e `drainOutbox({deadlineMs: 8000})`, dentro i 30 s riservati.
- **Cron `ai-drain` ogni minuto, di default** su Vercel Pro (la frequenza al minuto va verificata in S0). Un'esecuzione senza job pronti esce dopo una sola `claim_ai_jobs` (≈ 100 ms). Esecuzioni sovrapposte sono sicure: il tetto è globale, sotto lock consultivo. In locale, `cron-loop.ts` chiama `ai-drain` ogni minuto e le altre route ogni 5.
- **Avvio immediato:** `after(() => drainAiJobs())` nell'azione toglie fino a 60 s di attesa, ma AC10 non dipende da lui. Nessuna `fetch` lanciata senza attenderne la risposta.

**Calcolo del caso peggiore** (lancio = 10 reel × 3 modelli = 30 job; tetto 15; latenza p95 ≤ 90 s, da confermare nello spike, quindi una portata minima di 15 chiamate ogni 90 s = 10 al minuto; presa in ordine `run_after, id`, quindi i lanci si servono nell'ordine di arrivo):

| Lanci contemporanei | Senza guasti | Con un guasto (`after()` morto a t=60 s con 15 chiamate in volo, oppure un 429 sull'ultima chiamata) | Con due guasti (entrambi) |
|---|---|---|---|
| 1 (30 job) | 2 ondate: ≤ 3 min | `after()` morto: i 15 lease bloccano il tetto fino a ≤ 210 s, poi 2 ondate (il cron al minuto riprende subito): ≤ 6,5 min. Un 429: ripresa entro 30 s più un minuto di cron, ≤ 5,5 min | ≤ 8,5 min |
| 2 (60 job) | 4 ondate: il 1° lancio ≤ 3 min, il 2° ≤ 6 min | `after()` morto: tutto riparte a 210 s, 60 job in 6 min: ≤ 9,5 min | ≤ 11,5 min, **fuori AC10** |
| 3 (90 job) | 6 ondate: il 3° lancio ≤ 9 min | ≤ 12,5 min, **fuori AC10** | fuori |

AC10 vale quindi **per 1–2 lanci contemporanei con un guasto, e per 3 lanci senza guasti**. Il picco realistico è l'inizio mese con molti autori. Le leve sono due:
- alzare `max_concurrency` (a 25: 3 lanci in ≤ 6 min), se lo spike non mostra 429 a quella concorrenza;
- la riga di `ai_health` sull'arretrato per lancio (D-C, S6), che avvisa prima che `job_backlog` scatti a 30 minuti.

Se lo spike misura p95 > 90 s: si toglie il modello dal catalogo, oppure si alzano `call_timeout_s` e `maxDuration` (Vercel Pro con Fluid compute arriva fino a 800 s, da verificare), tenendo lease = timeout + 30.

### D-D — Modello dati della bibbia

La RLS è per riga e interni ed esterni usano lo stesso ruolo `authenticated`. Gli esterni leggono `voice_briefs` delle pagine visibili (`fase1_access.sql:77-80`).

| Opzione | Pro | Contro |
|---|---|---|
| **B1. `page_bibles` per i campi creativi, solo interni; la sezione Voce (aggettivi, parole vietate, audio, libertà, procedura) resta in `voice_briefs`; un solo editor e `save_bible` salvano entrambe in una transazione** | AC4 garantito dalla RLS. Nessun dato spostato (AC2 per costruzione; la spec corretta ammette l'assorbimento logico). Commenti `voice_brief` e `voice-tab.tsx` invariati | Due tabelle e due contatori di versione: si usa `page_bibles.version` |
| B2. Tabella unica e lettore `SECURITY DEFINER` per gli esterni, `voice_briefs` eliminata | Una tabella | Garanzia più debole (una funzione che salta la RLS), copia dei dati, commenti da rimappare, contract distruttivo |
| B3. Colonne nuove in `voice_briefs` | Nessuna tabella nuova | **Invalidata da AC4:** l'esterno leggerebbe tutta la riga |

**Scelta: B1, con colonne tipizzate** (campi fissi per spec) e JSONB solo per gli script di esempio.
- **Parole vietate:** restano in `voice_briefs.banned_words` (`initial_schema.sql:138`), nella sezione Voce, visibili ai doppiatori come oggi (correzione della spec). Le usano il prompt e il controllo AC20a.
- **Nessun contract:** la vecchia policy `voice_briefs_admin_write` (`initial_schema.sql:353`) resta. Riguarda solo gli admin ed è innocua: l'editor nuovo scrive con `save_bible`.

### D-E — Storico delle versioni

`decide_text_proposal` aggiorna `reels` (`fase1_task_engine.sql:1047`) **prima** di marcare la proposta `accepted` (`:1053`). Un trigger che cercasse la proposta accettata non la troverebbe.

| Opzione | Pro | Contro |
|---|---|---|
| V1a. Solo trigger, fonte da impostazione locale; proposta riconosciuta come pendente con `base_rev = old.script_rev` e `proposed_text = new.<campo>` | Cattura ogni percorso | Re-sync e salvataggio manuale indistinguibili; `stale` del form non atomico (rilettura in `updateReelScript`) |
| V1b. Solo scritture esplicite (RPC e azioni scrivono la versione) | Comportamento visibile; `stale` atomico | Per le proposte bisogna riscrivere `decide_text_proposal`, una terza funzione di Fase 1 (viola P1); un percorso dimenticato perde versioni |
| **V1c. Ibrida: un unico trigger (`SECURITY DEFINER`) scrive le versioni; la fonte la dichiarano le RPC della Fase 2 (`save_reel_script`, `apply_script_version`, `restore_script_version`, tutte `SECURITY INVOKER`); la proposta si riconosce come in V1a; il resto vale `manuale`** | Ogni percorso è coperto da un solo scrittore. Fonte giusta per form, re-sync (`resync`), mix, ripristino e proposta. `stale` atomico nel form e nel re-sync. RLS (`reels_update_member`) e blocco (`reels_script_lock`) continuano ad applicarsi perché le RPC girano come utente. Nessuna terza funzione di Fase 1 | Il riconoscimento della proposta è una regola implicita, da testare in `13_versions.sql` |
| V2. Differenze | Meno spazio | Ripristino e mix complessi; risparmio inutile a questa scala |
| V3. Snapshot su Drive | Esistono già | Solo da `animazione` in poi, e non interrogabili |

**Scelta: V1c**, con snapshot completi (~50 MB al mese a 50 pagine).

Dettagli:
- **Fonte:** le RPC fanno `set_config('reelificio.script_source', …, true)` e la azzerano dopo l'update. `p_source` accetta solo `manuale` e `resync`, e `resync` solo dagli admin. `mix` e `ripristino` li imposta la RPC stessa, mai il chiamante.
- **Perché `SECURITY INVOKER`** (sintesi dell'Architect):
  - in una funzione `SECURITY DEFINER` `current_user` è il proprietario, quindi `reels_script_lock` (`fase1_task_engine.sql:956`) e `reels_update_member` (`fase1_access.sql:33-42`) non varrebbero più, e andrebbero reimplementati in plpgsql, con il rischio che divergano;
  - da utente, `update reels … where id = $1 and script_rev = $2 returning id` è atomico sotto il lock di riga, e la RLS, i grant di colonna (`fase0_security.sql:141-146`) e il blocco restano la sola fonte delle regole;
  - nessuna delle tre RPC ha bisogno di `SECURITY DEFINER`: leggono `script_versions` (visibile agli interni) e scrivono `reels` con i diritti dell'utente;
  - il controllo in più per mix e ripristino (admin, Responsible `script_writing` o titolare del compito aperto) usa i soli helper pubblici `is_admin()`, `has_raci_role()` e `holds_open_task()`. In `bozza` l'unico compito aperto è il `writing` (`tasks_one_open_per_reel`, `fase1_core.sql:646`). Le funzioni `private` non sono eseguibili da `authenticated`.
- **Riconoscimento della proposta:** vale se cambia **un solo** blocco, esiste una proposta `pending` su quel campo con `base_rev = old.script_rev` e `proposed_text is not distinct from` il valore nuovo. Le proposte esistono solo da `revisione` (`fase1_task_engine.sql:998`), quando solo gli admin scrivono direttamente; un admin che digita esattamente il testo proposto equivale alla proposta.
- **Un cambio vero, una versione:** `reels_sync_state` incrementa `script_rev` solo per un cambio vero (`fase1_core.sql:476-481`).

---

## 3. Default (spec più quelli introdotti dal piano)

| Voce | Default | Perché |
|---|---|---|
| Claude via OpenRouter | **Confermato:** un'integrazione sola | Un client, una contabilità |
| Modelli spuntabili | **1–3, default 3.** Preselezionati da `page_bibles.default_models`; **se mancano, i primi 3 del catalogo**; **nei batch `import`, nessuno preselezionato** (il testo esiste già, si spunta a mano). È una **deviazione da AC8** ("preselezionato con i predefiniti"), dichiarata in Q9. Catalogo in `app_config.ai_models`: `[{id, label, structured, enabled, provider_order?}]`; la SQL rifiuta id fuori catalogo | Una bibbia vuota non spegne l'AI in silenzio. Oggi tutti i batch di produzione sono `import`: preselezionare 3 modelli farebbe pagare 3 alternative per script che esistono già |
| Velocità di lettura | **2,5 parole/s**, per pagina in `page_bibles.words_per_second` (1,5–4) | Personaggi diversi |
| Ripetizioni | **Ultimi 20 reel della pagina** con CTA o chiusura, escluso il reel, per `created_at` decrescente | Spec |
| Notifica | **A generazioni chiuse, o comunque dopo 15 minuti.** Il `notify` nasce con `run_after = now() + 15 min` e viene anticipato a `now()` quando l'ultimo elemento si chiude. Misurato: ≤ 15 min più un giro di sweep | La notifica è nella stessa transazione dell'avvio |
| Orologio dello SLA di stesura | **Invariato** (`_create_task` → `_restart_clock`, `fase1_task_engine.sql:131-194`) | Lo SLA è di 7200 minuti (`fase1_core.sql:515`) |
| Batch da idee | **Admin e Responsible `script_writing`.** Mese e anno espliciti salvati in `batches.period` (primo giorno del mese); l'etichetta è `Batch <Mese>`. Per i batch `import` nati dopo la migrazione, `period` resta nullo perché `createBatch` non cambia: le metriche usano **`coalesce(period, mese del codice del primo reel)`** | `detectBatchYearMonth` usa l'anno corrente (`codes.ts:20-33`); impostare `period` in `createBatch` ne erediterebbe il difetto e toccherebbe un altro file di Fase 1 |
| Aggiunta a un batch | Solo a batch con `origin = 'ideas'`; il numero continua dopo il massimo `NN` di `batches.period` | Il trigger delle idee `doc` (unicità di `reel_id`) e il re-sync per ordinale (`batches/actions.ts:189-223`) romperebbero i batch `import` |
| Fonte `doc` | Un'idea `doc` `scelta` per ogni reel importato (trigger) | Ogni reel ha un'idea (Q5) |
| Rimandi | **≤ 1 su 5.** "Script Lab" = almeno una generazione prima del primo `review`; "rimandato" = almeno un `review` `sent_back` | Ricavabile da `tasks` e `ai_generations` |
| "Rigenera" con la nota di rimando | **Sì, facoltativo** (casella), con oscuramento; primo taglio | Agisce su AC22 |
| Alternative e storico | **Solo interni** | Materiale di lavoro (Q7) |
| Interruttori | `pages.script_lab_enabled` (admin, `pages_admin_write`) e `app_config.ai_enabled`, entrambi spenti di default; senza, "Avvia stesura" è quello di Fase 1 | Rampa e spegnimento senza deploy |
| Limiti AI | `ai_settings`: concorrenza 15, timeout 120 s, 3 tentativi, avvio fino a 150 s; cron `ai-drain` ogni minuto; `max_tokens` 1500, temperatura per modello nel catalogo | Lo spike li conferma; la concorrenza è la leva per i lanci contemporanei (D-C) |
| Una generazione per volta | `generation_pending` se il reel ne ha una in corso | Niente spese doppie |
| Chiavi OpenRouter | **Due chiavi:** sviluppo e anteprime (sandbox, poi staging) e produzione | Il confronto mensile di AC14 per ambiente |

---

## 4. Criteri di accettazione verificabili

Verifiche: **db** = check SQL, **api** = `api-check.mjs`, **up** = `upgrade.sh`, **unit** = vitest, **e2e** = scenari F2-E* (§7.3).

| # | Criterio verificabile | Verifica |
|---|---|---|
| AC1 | `page_bibles` ha `tone`, `characters`, `themes[]`, `keywords[]`, `allowed_ctas[]`, `duration_min_s`/`duration_max_s` (5 ≤ min ≤ max ≤ 180), `words_per_second` (1,5–4), `example_scripts jsonb` (≤ 5 elementi `{title, hook, corpo, chiusura, cta}`), `default_models text[]` (≤ 3, distinti), `version`. La Voce, parole vietate comprese, è in `voice_briefs`. `/pages/[id]/bibbia` salva tutto in una chiamata | db `11_bible.sql`, e2e F2-E1 |
| AC2 | Righe di `voice_briefs` e checksum invariati dopo la migrazione; una riga `page_bibles` per pagina; `voice-tab.tsx` invariato | up `06_fase2.sql`, db `11` |
| AC3 | `save_bible`: admin → `ok`; Responsible `script_writing` non admin → `ok`; interno senza ruolo, approvatore ed esterno → `not_authorized`, senza righe cambiate; versione superata → `stale`; scrittura diretta su `page_bibles` come `authenticated` → negata | db `11`, api |
| AC4 | Esterno `e` con un compito sulla pagina: `page_bibles` → 0 righe, `voice_briefs` → 1 riga (parole vietate comprese), anche da PostgREST. `/rpc/save_bible` → `not_authorized`. `ideas`, `script_versions`, `ai_*` → 0 righe | db `11`, api, e2e F2-E1 |
| AC5 | `upsert_idea` e `set_idea_status` (`backlog` ↔ `scartata`) per admin e Responsible; un'idea `scelta` non torna indietro (`invalid_state`); tre schede nel backlog | db `12_ideas.sql`, e2e F2-E2 |
| AC6 | `create_batch_from_ideas(page, 2026, 12, ids[10])` → batch con `origin = 'ideas'` e `period = 2026-12-01`, 10 reel in `idea` `TT-2612-01…10` (in continuazione, se ne esistono già); idee `scelta` e collegate. Idea già scelta o di un'altra pagina → `invalid_input` senza righe create. `p_batch_id` di un batch `import` → `invalid_input`. Codici SQL uguali a `buildReelCode` su `PP-2611-01`, `PP-2611-12`, `PP-2701-100` | db `12`, unit `codes.test.ts`, e2e F2-E2 |
| AC7 | `scripts/test-parser.ts` invariato. Su staging l'import crea batch e reel come prima, più le idee `doc`; il re-sync aggiorna con `save_reel_script(…, 'resync')` | db `13`, e2e F2-E2 |
| AC8 | Menù con preselezione (§3). `start_writing(batch, n, models)` → N `writing` per ordinale più N × \|models\| job. Senza modelli o con un interruttore spento → Fase 1 identica. Chiamate a 2 argomenti (`public`) e a 3 argomenti (`private`, `06_tasks.sql:300`, `08_approvals.sql:21`) funzionano | db `14_ai_jobs.sql`, up, e2e F2-E3, F2-E10 |
| AC9 | Ogni job riuscito → versione `ai` con modello, `ai_run_id`, 4 blocchi e `notes` (da `note_regia`), oppure `raw_content` + `parser_warning`. Reel senza idea → prompt con il titolo | db `14`, unit `prompt`/`parse`, e2e F2-E3 |
| AC10 | Per lancio (10 × 3), entro **10 minuti** dalla risposta di "Avvia stesura", con il cron `ai-drain` al minuto:<br>(a) **1 lancio** con modelli reali, 3 prove su 3;<br>(b) **2 lanci contemporanei** con un guasto indotto alla volta (`AI_KICK_DISABLED=1`, `AI_FAKE_429_ONCE`);<br>(c) **3 lanci contemporanei** senza guasti, con il provider finto alla latenza p95 dello spike.<br>Misura per generazione: `max(items.updated_at) − min(items.created_at)` | e2e F2-E3, F2-E5 |
| AC11 | Un messaggio di assegnazione per autore, dopo l'ultima chiusura e prima di `run_after` originale. Con il drain AI fermo, notifica tra 15 e 20 minuti. Due avvii nello stesso minuto → un messaggio (`fase1_task_engine.sql:774-778`) | db `14`, e2e F2-E3, F2-E5 |
| AC12 | Errore 500 finto su un modello: 3 tentativi nella stessa invocazione (ritardi 5–30 s), poi elemento `failed` con codice classificato, 3 righe `ai_runs` `error`, **job completato e 0 dead letter**. Errore 400: 1 tentativo. Lease scaduto al 3° tentativo → dead letter (solo in questo caso). Il reel mostra 2 alternative e "alternativa mancante" | db `14`, unit `errors`, e2e F2-E4 |
| AC13 | `request_generation` in `bozza` per admin, Responsible o assegnatario del `writing` aperto → `ok`; fuori da `bozza` → `invalid_state`; con una generazione in corso → `generation_pending`; versioni precedenti conservate | db `14`, e2e F2-E4 |
| AC14 | Ogni chiamata ha **una** riga `ai_runs`: nata `started` prima della `fetch`, chiusa una sola volta (vince chi scrive per primo) come `ok`/`error`, oppure `lost` a lease scaduto. Un risultato tardivo con lo stesso id riporta `lost` a `ok`/`error`. Campi: `model`, `provider`, token, `cost_usd`, `cost_status` (`pending`/`final`/`unavailable`), `redactions`, pagina, reel, persona, scopo, durata, codice. Costi completati solo per le righe con `openrouter_id`, tramite RPC. La somma mensile per chiave coincide con l'attività OpenRouter entro il 5% (le righe `lost` sono elencate a parte) | db `14`, unit `openrouter`, e2e F2-E3 |
| AC15 | Test: le sentinelle (email, nomi completi di profili attivi e disattivati, uuid) messe in personaggi, spunto e nota non arrivano nel prompt, e `redactions` le conta. **Un nome di battesimo di un profilo nella nota e nello spunto si oscura; nei campi creativi della bibbia resta (avviso nell'editor).** Il conteggio è visibile a chi scrive (`ai_generation_items.redactions`). **Le parole vietate della Voce ci sono; aggettivi, audio, libertà e procedura no.** Corpo della richiesta con `data_collection: 'deny'` e senza `user` | unit `prompt.test.ts`, `openrouter.test.ts` |
| AC16 | Pannello Alternative: colonne per modello (schede su mobile). `apply_script_version(reel, base, {cta: v2}, rev)` → blocchi della base con la CTA di v2, `script_rev + 1`, versione `mix` con `base_version_id` e `block_sources`. Rev superata → `stale`; fuori da `bozza` → `invalid_state` (controllato dopo `for update` sul reel) | db `13_versions.sql`, unit `mix`, e2e F2-E6 |
| AC17 | Una versione per percorso, con fonte giusta: `manuale` (form, `save_reel_script`), `resync`, `mix`, `ripristino`, `proposta` (accettata), `import`, `ai`. Nessuna versione senza cambio. Ripristino solo in `bozza` | db `13`, e2e F2-E7 |
| AC18 | `reel_script_provenance(reel)`: modello della base, modello o `manuale` di ogni blocco, salvataggi manuali dopo il mix, per l'ultima consegna `writing` | db `13`, S7 |
| AC19 | In `revisione`: update diretto da Responsible → 42501 (`fase1_task_engine.sql:949-968`); `save_reel_script` da non admin → 42501 dallo stesso trigger, mappato a `not_authorized` (la RPC è `SECURITY INVOKER`); `apply` e `restore` → `invalid_state`; le proposte funzionano | db `13` |
| AC20 | Parola vietata della Voce trovata in "l'idiota" e "IDIOTA", con la posizione; 120 parole a 2,5/s = 48 s fuori da 30–45; CTA uguale dopo la normalizzazione → "uguale", somiglianza ≥ 0,6 (tarata in S5 sul fixture di maggio; era 0,8) → "molto simile" | unit `checks.test.ts` |
| AC21 | Avvisi nel reel e in `/approvazioni`; `deliver` con avvisi → `ok` | e2e F2-E8 |
| AC22–25 | `script_lab_metrics(p_from, p_to)` (solo admin, altrimenti 42501): rimandi, costi per mese × pagina × modello, batch per origine e mese (`coalesce(period, mese del primo codice)`), bibbie complete, reel per autore, provenienza; numeri uguali alle query di controllo | db `15_metrics.sql`, e2e F2-E9 |
| AC26 | `run.sh` (PG16 e PG17) con i check 00–15 e l'allowlist; `upgrade.sh` con la tappa Fase 2 e il ripristino; typecheck, lint, build e test verdi | S8 |

---

## 5. Implementazione per fette verticali

**Ordine di esecuzione:** S0 → S2 → S4 → S1 → S6 (provider finto) → S3 → S5 → S7 → S8.
- S6 ha bisogno solo della bibbia (S2) e delle versioni (S4). Il prompt usa l'idea quando c'è e il titolo del reel altrimenti; S3 aggiunge l'idea al prompt (0,25 g compresi in S3).
- I file SQL sono numerati in ordine di esecuzione: `000` guardie, `001` valore di enum, `010` bibbia, `020` versioni, `030`/`031` AI, `040` idee, `050` metriche.
- Regole comuni: grant espliciti, schema `private`, ogni file chiude con `revoke execute on all functions in schema private…`, un check per ogni policy, mappatura dei codici come `src/lib/tasks/actions.ts:22-36`.

| Fetta | Giorni (iter2) | Chiave |
|---|---|---|
| S0 Fondamenta, sandbox, prova Vercel | 1,5 | no |
| S2 Bibbia | 2,5 | no |
| S4 Versioni ed editor (+30%) | 4 | no |
| S1 Spike AI | 1 | **sì (scadenza: venerdì 30 ottobre)** |
| S6 Generazione in background (+30%) | 6 | finto; vera solo nella verifica |
| S3 Idee e batch da idee | 2,5 | no |
| S5 Controlli | 1,5 | no |
| S7 Metriche e costi | 1,5 | no |
| **Subtotale S0–S7** | **20,5** | |
| e2e sul sandbox con i modelli veri (misure di AC10) | 1 | sì |
| S8: collaudo F2-E1…E9 sull'anteprima del branch con il sandbox (1,5), promozione con staging e regressione (1), prova su dump e rilascio (0,5) | 3 | sì |
| **Totale** | **24,5** + 1 di stabilizzazione = 25,5 | |

Avvio di S0 in ritardo: la finestra del 14–16 ottobre è in parte spesa per le revisioni del piano. La mezza giornata persa si prende dal margine del 7–11 dicembre (§9).

**Superficie di Fase 1 toccata.**
- **SQL:** `private.start_writing`, `public.start_writing`, `public.claim_jobs`, tutte con guardia e ripristino.
- **TypeScript**, da riguardare a ogni merge:
  - `src/lib/reels/actions.ts` (`updateReelScript` → `save_reel_script`);
  - `src/lib/batches/actions.ts` (update del re-sync `:333-345` → `save_reel_script(…, 'resync')`; errore 23505);
  - `src/lib/tasks/actions.ts` (`startWriting` con i modelli e `after()`);
  - `src/lib/jobs/notify.ts:280-289` (conteggio delle alternative);
  - `src/lib/jobs/health.ts:18-29` e `src/lib/alerts/rules.ts` (problemi AI);
  - `src/lib/observability/scrub.ts:11-12`;
  - `scripts/cron-loop.ts:74-76`;
  - `src/lib/pages/actions.ts:153` (interruttore);
  - `src/app/(app)/batches/[id]/{page,start-writing}.tsx`, `reels/[id]/{page,task-panel}.tsx`, `pages/[id]/{page,production-settings}.tsx`, `approvazioni/approval-card.tsx`;
  - `src/lib/voice-briefs/actions.ts` e `pages/[id]/voice-brief-editor.tsx` (eliminati);
  - `src/messages/it.json`, la navigazione;
  - `scripts/db-check/{run.sh,upgrade.sh,rehearse-dump.sh,checks/00_guards.sql,api-check.mjs}`, `scripts/lib/target.ts`, `.env.example`, `vercel.json` (al rilascio).

### S0 — Fondamenta · 1,5 giorni · senza chiave

- **Worktree e branch** (D-A). `supabase/fase2/000_guards.sql` (`_assert_body`) e `001_enum_values.sql` (`alter type job_kind add value 'ai_generate'`, in un file a sé, regola di Fase 1 D2; `fase1_core.sql:49`).
- **Harness:**
  - `run.sh` applica `supabase/fase2/*.sql` dopo il contract di R1 (`:14-20`), e non lo fa se esistono già file `*_fase2_*` promossi;
  - `upgrade.sh`: la tappa R1 salta `*_fase2_*`; tappa finale dopo `05_drive_switch.sql` con Fase 2, `06_fase2.sql`, ripristino (`fase2a_restore_fase1.sql`), controlli di Fase 1, di nuovo la Fase 2 (i file `03x` sono rieseguibili: `drop … if exists` e guardia che ammette l'md5 di Fase 1 o di Fase 2, D-A) e `14_ai_jobs.sql`; in più, una seconda esecuzione di `031` senza ripristino deve passare;
  - allowlist in `00_guards.sql:11-24`, sezione `-- Fase 2`.
- **Script:** `fase2-promote.sh` (con `--check`), `fase2-dev.sh` (verifica il ref), `fase2-sandbox-migrate.ts`, target `sandbox`, `fase2-seed.ts` (pagina `TT`, utenti, bibbia P&P da `tests/fixtures/bible-porcino-papaya.json`, scritta a mano da `tests/fixtures/porcino-papaya-may.txt`, senza dati personali).
- **Sandbox** (DB1, con l'OK dell'utente): progetto, SMTP Resend, migrazioni, login. Variabili Preview del branch verso il sandbox.
- **Prova Vercel** (nessuna chiave, nessun DB):
  - route usa e getta `/api/spike/long` (segreto cron, `maxDuration = 300`, 200 s di attesa con un log ogni 30 s) e un'azione con `after()` di 150 s su una pagina con `maxDuration = 300`, su anteprima;
  - **si ripete dopo l'attivazione di Vercel Pro / Fluid compute** (prerequisito di R1), perché i risultati su Hobby non sono rappresentativi;
  - se `after()` non arriva in fondo, il ripiego è il cron `ai-drain` ogni minuto (D-C).
- `.env.example`: `OPENROUTER_API_KEY=` e `AI_PROVIDER=`.

**Fatto quando:**
- `run.sh` e `upgrade.sh` sono verdi;
- un carattere cambiato in `start_writing` fa fallire la guardia;
- il dev server fa login sul sandbox e si rifiuta di partire con il ref dello staging;
- la prova Vercel su Hobby è annotata e quella su Pro è pianificata.

**Stato (2026-10-14):**
- **Fatto e verde:**
  - worktree `../Reelificio_PM-fase2`, branch `fase-2-script-lab` da `fase-1-s5-drive` (`ea8df2f`);
  - `supabase/fase2/000_guards.sql`: `_assert_body` più i pin md5 di `private.start_writing`, `public.start_writing` e `public.claim_jobs`, controllati solo finché esiste la firma di Fase 1. Sono rieseguibili, e un carattere cambiato in `start_writing` fa fallire la guardia (provato);
  - `001_enum_values.sql`;
  - `run.sh` e `upgrade.sh` verdi con la tappa Fase 2 (`apply_fase2` in `lib.sh`; la tappa R1 salta `*_fase2_*`);
  - allowlist con la sezione Fase 2.
- **Sandbox `reelificio-pm-fase2`** (ref `vgpjcqttekxxnkaeyhmh`, org Free AlphaTechnology.ai, Francoforte, PG 17.11), creato via Management API con l'OK dell'utente:
  - migrazioni, contract di R1 e Fase 2 applicati con `scripts/fase2-sandbox-migrate.ts` (un file per richiesta, atomico: provato con un errore voluto). La seconda esecuzione non ha nulla da fare. `00_guards.sql` è verde sul sandbox;
  - auth come lo staging: iscrizioni chiuse, magic link, SMTP Resend con mittente "Reelificio Fase 2 (sandbox)", redirect `localhost` e anteprime `*-gigiordas-projects`;
  - `scripts/fase2-seed.ts`: admin `hello@reelificio.com` più il fixture di Fase 1 (Pagina Test TT, 9 utenti di prova, batch).
- **Ambiente e strumenti:**
  - `scripts/fase2-dev.sh` si rifiuta di partire con il ref dello staging, con un `.env.local` nel worktree o con Drive, Telegram o Sentry valorizzati (provato);
  - il dev server sul sandbox risponde, e `task-sweep` aggiorna il battito del sandbox mentre quello dello staging resta fermo;
  - `scripts/fase2-promote.sh` (`--dry-run`, `--check`, `--rebase`) provato su un clone usa e getta. Rifiuta la promozione senza il contract di R1 come migrazione e con timestamp futuri, e `--check` vede un hotfix successivo;
  - target `sandbox` in `scripts/lib/target.ts`; `.env.example` con `OPENROUTER_API_KEY` e `AI_PROVIDER`.
- **Anteprima del branch sul sandbox** (OK dell'utente):
  - variabili Preview **specifiche del branch** `fase-2-script-lab`: Supabase del sandbox, `CRON_SECRET` proprio, `NEXT_PUBLIC_APP_URL` del branch, `AI_PROVIDER=fake`, `GOOGLE_SHARED_DRIVE_ID` e `NEXT_PUBLIC_SENTRY_DSN` vuoti. Vercel le accetta solo dopo il push del branch: la prima anteprima (`7c09981`), partita prima delle variabili, è stata annullata durante la build;
  - verifica: `task-sweep` chiamato sull'anteprima aggiorna il battito del sandbox, e quello dello staging resta fermo.
- **Prova Vercel su Hobby** (2026-10-14, `fra1`, route usa e getta `/api/spike/long`, solo sandbox, con segreto cron):
  - `after()` di 150 s: arrivato in fondo, risposta in < 1 s;
  - attesa dentro la richiesta: 180 s completati, HTTP 200 (la prova chiedeva 200 s, ma il ciclo a passi da 30 s si ferma a 180).
  - Esito: su Hobby `after()` e `maxDuration = 300` reggono almeno 150 e 180 s. **Si ripete dopo Vercel Pro**, poi si toglie la route e `/api/spike` da `PUBLIC_PATHS`.
- **Da fare:** login dal browser sul sandbox (magic link nella casella `hello@`).

### S2 — Bibbia · 2,5 giorni · senza chiave

**SQL** `010_bible.sql`:
- `page_bibles` (colonne di AC1, `page_id` unique, `version`, `updated_by`, timestamp; backfill di una riga per pagina). RLS `select` con `(select public.is_internal())`; `revoke all` ad `anon` e `authenticated`, poi `grant select`.
- `private._can_edit_script_lab(actor, page)`: admin, oppure interno e `has_raci_role_uid(page, 'script_writing', 'responsible', actor)` (`fase1_core.sql:170-191`).
- `public.save_bible(p_page_id, p_bible jsonb, p_voice jsonb, p_expected_version)`:
  - codici `ok`, `not_authorized`, `invalid_input`, `stale`;
  - lock della riga, `page_bibles` con versione + 1, upsert di `voice_briefs` (parole vietate comprese; la sua versione cresce solo se la Voce cambia);
  - rifiuti registrati in `task_events`.
- `pages.script_lab_enabled`: scrivono solo gli admin, con la policy esistente (`initial_schema.sql:337`), da `updatePageProduction` (`src/lib/pages/actions.ts:153`).

**Codice:**
- `src/lib/bible/{schema,queries,actions}.ts`;
- `src/app/(app)/pages/[id]/bibbia/{page,bible-editor}.tsx` con le sezioni Tono, Personaggi, Durata, CTA, Temi e keyword, Script di esempio ("copia da un reel approvato"), Modelli predefiniti, **Voce (aggettivi, parole vietate, audio, libertà, procedura)**;
- **avviso nell'editor** quando un campo contiene il nome di battesimo di un profilo (es. "Marco"): avvisa e basta, non cambia nulla;
- nella pagina della pagina una scheda "Bibbia" con completezza e link al posto di `VoiceBriefEditor`, che si elimina insieme a `saveVoiceBrief` (`src/lib/voice-briefs/actions.ts:46`);
- `voice-tab.tsx` invariato; interruttore in `production-settings.tsx`; i18n `bible`.

**Verifiche:**
- db `11_bible.sql`: matrice di AC3 e AC4, `stale`, vincoli, backfill, l'interno non admin che non scrive `pages.script_lab_enabled`;
- allowlist: `save_bible`;
- api-check come esterno;
- unit `schema.test.ts` (limiti, completezza, ricerca dei nomi di battesimo).

**Fatto quando:** sul sandbox il Responsible non admin compila la bibbia e l'esterno di prova vede solo la Voce.

**Stato (2026-10-14):**
- **Fatto e verde:**
  - `supabase/fase2/010_bible.sql` come da D-D. In più:
    - un trigger su `pages` crea la bibbia vuota delle pagine nuove;
    - gli script di esempio hanno i limiti dei reel (corpo 8000, CTA 2000), così ogni reel approvato si può copiare;
    - una Voce tutta vuota non crea una riga `voice_briefs`;
  - `11_bible.sql` (AC3, AC4, `stale`, limiti, catalogo dei modelli, nessuna scrittura diretta, interruttore, Voce vuota). Una prova di mutazione (permesso indebolito) lo fa fallire;
  - `api-check` (8 controlli come Responsible, interno senza ruolo, esterno, admin e anon);
  - `upgrade.sh` con `seed-fase2-before.sql` e `06_fase2.sql`: AC2, cioè checksum di `voice_briefs` invariato e una bibbia vuota per pagina;
  - `src/lib/bible/{schema,queries,actions}.ts` con 12 test; `/pages/[id]/bibbia`; scheda Bibbia nella pagina; `VoiceBriefEditor` e `saveVoiceBrief` eliminati; interruttore nelle impostazioni di produzione; i18n `bible`;
  - typecheck, lint, 105 test e build verdi;
  - sandbox migrato; `fase2-seed.ts` scrive la bibbia P&P (`tests/fixtures/bible-porcino-papaya.json`) sulla Pagina Test.
- **Review indipendente:** nessun difetto grave, 5 osservazioni basse. Sono corrette la Voce vuota (1) e i limiti degli esempi, con il messaggio che nomina il campo (3). Restano:
  - (2) una scrittura della Voce fuori dall'editor viene sovrascritta dal salvataggio successivo: oggi l'unica via è `save_bible`, perché la policy diretta è solo per gli admin e l'editor vecchio è eliminato;
  - (4) dopo `stale` le modifiche si riapplicano a mano, come dice il messaggio;
  - (5) il codice di S2 richiede `010` applicato: è sempre vero, perché le migrazioni precedono il codice (§8) e le anteprime del branch usano il sandbox.
- **S2 chiusa il 2026-10-14:** l'utente ha provato in Chrome sul sandbox la bibbia come admin e come Responsible non admin (`hello+autore`), che la salva. Prima della prova si è corretta la password SMTP del sandbox, copiata con le virgolette.

### S4 — Versioni ed editor · 4 giorni · senza chiave

**SQL** `020_versions.sql`:
- `script_versions`:
  - colonne: `id`, `reel_id`, `source` (`ai`, `mix`, `manuale`, `resync`, `ripristino`, `proposta`, `import`), `model`, `ai_run_id`, `generation_id` (FK in S6), `author_id`, `base_version_id`, `block_sources jsonb`, `restored_from_id`, `proposal_id`, i 4 blocchi, `notes`, `raw_content`, `parser_warning`, `script_rev`, `created_at`;
  - indice `(reel_id, created_at desc)`; solo interni, nessun grant di scrittura.
- **Trigger** `private.reels_record_version()` (D-E, V1c), `AFTER INSERT OR UPDATE OF hook, corpo, chiusura, cta, notes, raw_content`:
  - in update solo se `script_rev` cambia; in insert, con testo, fonte `import`;
  - la fonte arriva da `reelificio.script_source`, altrimenti dal riconoscimento della proposta, altrimenti `manuale` (autore `auth.uid()`).
- Backfill di una versione `import` per ogni reel con testo.
- **RPC, tutte `SECURITY INVOKER`** (D-E):
  - **`public.save_reel_script(p_reel_id, p_fields jsonb, p_expected_rev, p_source text default 'manuale')`:**
    - campi ammessi: quelli del grant di colonna di `fase0_security.sql:141-146` tranne file e pubblicazione, cioè `title`, `format`, `category`, i 4 blocchi, `notes`, `raw_content`, `parser_warning`;
    - `p_source` solo `manuale` o `resync`, e `resync` solo se `is_admin()`, altrimenti `invalid_input`;
    - imposta la fonte, poi `update reels set … where id = p_reel_id and script_rev = p_expected_rev returning id`, atomico sotto il lock di riga, e azzera la fonte;
    - con 0 righe: se il reel è visibile con un'altra revisione → `stale`, altrimenti `not_authorized` (RLS);
    - il 42501 di `reels_script_lock` diventa `not_authorized`;
    - nessuna regola reimplementata: valgono RLS, grant e blocco;
  - **`apply_script_version(p_reel_id, p_base, p_blocks, p_expected_rev)`** e **`restore_script_version(p_reel_id, p_version_id, p_expected_rev)`:**
    - **prima `select … for update` sul reel** (con la RLS di update), poi il controllo di `state = 'bozza'` e della revisione;
    - poi il controllo in più `is_admin() or has_raci_role(page, 'script_writing', 'responsible') or holds_open_task(reel)`, con i soli helper pubblici;
    - imposta fonte e metadati (`mix` o `ripristino`), fa l'update e azzera;
  - `reel_script_provenance(p_reel_id)` (`security invoker`).
- Il trigger delle versioni è l'unico oggetto `SECURITY DEFINER` della fetta, perché `script_versions` non ha grant di scrittura.
- **Codice di Fase 1:**
  - `updateReelScript` chiama `save_reel_script`, e il form manda `script_rev`;
  - l'update del re-sync (`batches/actions.ts:333-345`) chiama `save_reel_script(…, 'resync')` con la revisione letta per il diff; un `stale` va tra i conflitti dell'anteprima.

**Codice:** `src/lib/script-lab/{mix,versions,actions}.ts`; `reels/[id]/alternatives.tsx` (colonne o schede, "Usa come base", "prendi da …", anteprima, Applica; posto riservato per "Rigenera" e per il badge mancante); `version-history.tsx` (fonte, modello, autore, data, confronto, Ripristina); la scheda Script (`reels/[id]/page.tsx:222-234`) contiene ScriptTab, Alternative e Storico; i18n `scriptLab`. Il seed inserisce versioni `ai` finte.

**Verifiche:**
- db `13_versions.sql`:
  - una versione per percorso, con la fonte giusta per form, re-sync, mix, ripristino, **proposta accettata tramite `decide_text_proposal`** e import;
  - nessuna versione senza cambio;
  - `stale` e `invalid_state`;
  - stesso esito di `save_reel_script` e dell'update diretto per ogni utente del seed (per costruzione, ma lo si verifica);
  - `resync` rifiutato a un non admin, `p_source = 'mix'` rifiutato a chiunque;
  - `prosecdef = false` per le tre RPC;
  - 42501 in `revisione`;
  - provenienza.
- allowlist: `save_reel_script`, `apply_script_version`, `restore_script_version`, `reel_script_provenance`;
- api-check;
- unit `mix.test.ts`.

**Fatto quando:** F2-E6 (con alternative finte) e F2-E7 passano sul sandbox; `scripts/test-resync.ts` è verde.

**Stato (2026-10-15):**
- **Fatto e verde:**
  - `supabase/fase2/020_versions.sql` come da D-E (V1c). I due aiuti previsti nello schema `public` sono incorporati nelle RPC, per non esporli via API. `created_at` è `clock_timestamp()`, così l'ordine resta giusto anche dentro una transazione. La provenienza senza consegna considera tutte le versioni;
  - `13_versions.sql`:
    - ogni percorso con la sua fonte (modifica, re-sync, mix, ripristino, proposta accettata tramite `decide_text_proposal`, import);
    - nessuna versione senza cambio; `stale`; parità con l'update diretto per i 5 utenti del seed; rifiuti in `revisione`; provenienza; esterni;
    - una prova di mutazione (controllo di chi compone tolto) lo fa fallire;
  - `api-check` (8 controlli); `06_fase2.sql` con il backfill `import`;
  - `src/lib/script-lab/{mix,versions,actions}.ts` con 6 test;
  - `alternatives.tsx` e `version-history.tsx` nella scheda Script, solo per gli interni;
  - `updateReelScript` e il re-sync passano da `save_reel_script`;
  - alternative finte (`demo/alpha|beta|gamma`) nel seed;
  - typecheck, lint, 111 test e build verdi;
  - sandbox migrato, con i guard verdi.
- **Review indipendente:** nessun difetto grave, due importanti, entrambi corretti:
  - (1) il form dello script si rimonta quando cambia la revisione e non si azzera all'invio, così una bozza non finisce mai su una revisione nuova e un `stale` non la cancella;
  - (2) il re-sync applica alle revisioni dell'anteprima confermata, controlla l'admin una volta sola prima di scrivere, e mostra i reel non aggiornati (`skipped`) nel dialogo dopo l'applicazione.
  - Tra le minori è corretta la base delle alternative quando cambiano (S6). Restano: due proposte identiche pendenti sullo stesso campo, dove la versione indica la più recente, e le note di regia della base che sostituiscono le note (volute; le precedenti restano nello storico).
- **`scripts/test-resync.ts`:** prova solo la logica del diff, che non è cambiata, e legge lo staging. Il percorso di applicazione è coperto da `13_versions.sql` e da `api-check`; la prova dal vivo del re-sync si fa in S3 con F2-E2, quando un batch del Doc viene importato sul sandbox.
- **S4 chiusa il 2026-10-15.** L'assistente ha fatto le prove in Chrome sul sandbox con la sessione admin dell'utente, su TT-2611-02 (in `bozza`, compito `writing` aperto):
  - **F2-E6:** base `demo/alpha`, CTA da `demo/beta`; l'anteprima mostra "CTA · demo/beta"; Applica → "Script aggiornato."; il form mostra il testo del mix (rev 1); hook corretto a mano e salvato. Storico: Import → Mix → Modifica;
  - **F2-E7:** Ripristina sulla versione Import → testo originale, rev 3, voce "Ripristino" che punta all'Import. "Script pronto" → `revisione`, revisione assegnata ad Approvatore Test; il pannello Alternative dice "solo in Bozza", senza pulsanti, e lo Storico non ha più Ripristina;
  - **DB:** `import@0 → mix@1` (con `block_sources`) `→ manuale@2 → ripristino@3`. La provenienza alla consegna è: base `demo/alpha`, blocchi `manuale`, `edited_after_mix`. Nessun errore in console;
  - **Non provato dall'interfaccia:** la proposta accettata, perché come admin il reel in `revisione` mostra il form modificabile e non "Proponi". È coperta da `13_versions.sql` tramite `decide_text_proposal`.

### S1 — Spike AI su 3 modelli · 1 giorno · **con chiave (entro venerdì 30 ottobre)**

**Script:** `scripts/spike-ai-models.ts`, fuori dall'app, con risultati in una cartella scratch. Bibbia P&P del fixture e 2 idee di prova.

**Candidati e riserve nominati in anticipo:**
- un Claude Sonnet (riserva: Claude Haiku);
- un GPT (riserva: Gemini, e viceversa);
- un modello cinese tra DeepSeek, Qwen e Kimi (riserva: un altro dei tre);
- Mistral come riserva generale con provider EU.

**Prove:**
- SO-1 e SO-3 × 5 per modello;
- 15 chiamate in parallelo;
- instradamento con `data_collection: deny` e `require_parameters`;
- `usage.cost` nella risposta e ritardo dell'endpoint `generation`;
- quota di timeout a 120 s.

**Uscita: tutti e 3 i modelli predefiniti** devono superare:
- interpretazione ≥ 9/10 sulla strategia migliore;
- p95 ≤ 90 s;
- nessun 429 con 15 chiamate in parallelo (altrimenti si abbassa il tetto);
- lettura alla cieca di Teo e Gabri con **media ≥ 3,5 su 5 e almeno il 60% "usabile come base"**;
- costo per script annotato (atteso ≤ 0,05 $).

Un modello che non passa viene sostituito dalla sua riserva, con mezza giornata in più presa dalla riserva di calendario.

**Esito:** `docs/brain-plan.md` § "Esiti dello spike Fase 2", e `ai_models` e `ai_settings` in `scripts/fase2-config.sql`.

### S6 — Generazione AI in background · 6 giorni · provider finto; chiave nella verifica finale

**SQL** `030_ai.sql`:
- `ai_generations`:
  - `id`, `reel_id`, `page_id`, `requested_by`, `origin` (`start_writing`/`rigenera`), `models text[]`, `notify_key`, `use_sendback_note`, `status` (`pending`/`done`), `created_at`, `settled_at`;
  - indice unico parziale "una `pending` per reel".
- `ai_generation_items`: `(generation_id, model)` come chiave primaria; `status` (`queued`/`ok`/`failed`/`skipped`), `attempts`, `version_id`, `last_error_code` (solo codici classificati), **`redactions`**, copiato da `ai_runs` e leggibile da chi scrive per il badge, `created_at`, `updated_at`.
- `ai_runs`:
  - `id`, `generation_id`, `job_id`, `model`, `purpose`, `page_id`, `reel_id`, `requested_by`, `provider`, `attempt`;
  - `outcome` (`started`/`ok`/`error`/`lost`), `error_code`;
  - `tokens_in`, `tokens_out`, `cost_usd`, `cost_status` (`pending`/`final`/`unavailable`), `redactions`, `duration_ms`, `openrouter_id`;
  - `prompt_version`, `prompt_sha256`, `started_at`, `finished_at`;
  - né prompt né testo.
- FK di `script_versions`. RLS: generazioni ed elementi per gli interni, `ai_runs` solo per gli admin.
- `app_config`: `ai_enabled = false`, `ai_models = []`, `ai_settings` (D-C).

**SQL** `031_ai_jobs.sql`, rieseguibile:
- **`claim_jobs`:** guardia (md5 di Fase 1 o di Fase 2), poi `create or replace` con `kind <> 'ai_generate'` **sia nella presa sia nell'update del dead letter con `attempts >= 6`** (`fase1_outbox.sql:31-35`).
- **`claim_ai_jobs(p_limit)`:**
  - lock consultivo;
  - per i lease AI scaduti: le righe `started` diventano `lost` (`cost_status = 'unavailable'`); se l'elemento è a `max_attempts` diventa `failed` con `lease_exhausted`, il job va in dead letter e la generazione si chiude, altrimenti il job torna pendente;
  - poi la presa con il tetto e il lease di 150 s.
- **`begin_ai_run(p_job_id, p_lease_token)`:** verifica il token.
  - Elemento già chiuso (`ok`, `failed` o `skipped`): job completato e nient'altro, `skip`; lo stato dell'elemento non si tocca.
  - Elemento `queued` con il reel fuori da `bozza`: elemento `skipped`, job completato, `skip`.
  - Altrimenti `attempts + 1` e riga `ai_runs` `started`; restituisce `run_id`.
- **`record_ai_attempt(p_job_id, p_lease_token, p_run_id, p_result jsonb)`:**
  - aggiorna la riga se è `started`, **oppure `lost` con lo stesso `p_run_id`**: un risultato tardivo dopo la scadenza del lease recupera costo e token. Una riga già `ok` o `error` non cambia, perché vince chi scrive per primo;
  - copia `redactions` sull'elemento;
  - riuscita con elemento `queued`: versione `ai`, elemento `ok`, chiusura della generazione, job completato;
  - errore temporaneo sotto il massimo: job pendente con `run_after` tra 5 e 30 s → `retry`;
  - errore definitivo o massimo raggiunto: elemento `failed`, chiusura, job **completato** → `failed`;
  - token superato: si registra solo il costo, più la versione se l'elemento è ancora `queued` → `stale_lease`.
- **`private._settle_generation(gen)`:** senza elementi `queued` → `done`; se nessun'altra generazione con lo stesso `notify_key` è `pending`, `run_after = now()` sul job `notify`.
- **`ai_cost_candidates(p_limit)`** e **`set_ai_run_cost(p_run_id, p_cost, p_in, p_out)`** (solo service role): candidate solo le righe `pending` **con `openrouter_id`**; dopo 24 h diventano `unavailable`.
- **`request_generation(p_reel_id, p_models, p_use_sendback_note default false)`:** codici `ok`, `not_authorized`, `invalid_state`, `invalid_input`, `generation_pending`, `not_enabled`.
- **`start_writing`:**
  - guardia;
  - `drop function public.start_writing(uuid, integer)` **esplicito**, `drop function private.start_writing(uuid, uuid, integer)`;
  - `private.start_writing(p_actor, p_batch_id, p_n, p_models text[] default null)`: il ciclo di `fase1_task_engine.sql:759-771`; con modelli e interruttori accesi crea generazioni, elementi e job, e il `notify` a +15 minuti con `payload.ai = true`; altrimenti è il corpo di Fase 1;
  - `public.start_writing(p_batch_id, p_n default 10, p_models default null)`.
- **`cancel_ai_jobs()`:** elementi `failed` (`cancelled`), job **completati**, notifiche anticipate.
- **`ai_health()`:**
  - **arretrato per lancio**: minuti dell'elemento `queued` più vecchio per generazione, il massimo e il numero di generazioni oltre 10 minuti (`ai_backlog`, soglia AC10);
  - elementi `queued` da più di 20 minuti (`ai_stuck`);
  - `failed` oltre il 30% nelle 24 h per modello;
  - righe `pending` con `openrouter_id` da più di 1 h, ignorando `unavailable`;
  - battito di `ai_drain` più vecchio di 5 minuti (il cron gira ogni minuto).

**Codice:**
- **Livello AI**, `src/lib/ai/`:
  - `provider.ts`, `openrouter.ts` (`AbortController` al timeout; `provider: {data_collection: 'deny', require_parameters, order?}`, `usage: {include: true}`; nessun `user`), `fake.ts` (`AI_FAKE_LATENCY_MS`, `AI_FAKE_FAIL_MODELS`, `AI_FAKE_429_ONCE`);
  - `prompt.ts`: **input tipizzato con i campi creativi di `page_bibles`, `voice_briefs.banned_words` (le altre colonne Voce non sono nel tipo) e idea o titolo**, più le ultime 5 chiusure e la nota facoltativa; `PROMPT_VERSION`;
    - **l'idea arriva da `getIdeaForReel` (S3): titolo e spunto**; per un'idea `doc`, o senza idea, il titolo del reel. Voce spostata qui da S3, perché `src/lib/ai/` nasce in S6;
  - `redact.ts`:
    - nomi completi di **tutti** i profili (disattivati compresi), email, telefoni e uuid → `[persona]` ovunque;
    - **nomi di battesimo dei profili → `[persona]` solo nella nota di rimando e nello spunto**; nei campi della bibbia restano, perché possono essere personaggi (avviso nell'editor, S2);
    - conteggio restituito;
  - `parse.ts`; `errors.ts` (classificazione e codici, nessun corpo di risposta).
- **Esecuzione:**
  - `src/lib/ai/drain.ts`, `drainAiJobs()`: finestra di D-C, un job per posto libero, coda di 30 s. `nextClaimSize()` è pura;
  - `src/lib/jobs/handlers/ai-generate.ts`;
  - `src/app/api/cron/ai-drain/route.ts` (segreto cron, `maxDuration = 300`, `system_heartbeats('ai_drain')`); senza job pronti esce subito;
  - costi completati in coda al drain.
- **`scripts/cron-loop.ts`:**
  - le route partono **in parallelo** (`Promise.allSettled`) e senza attendere il giro precedente, oggi sono in sequenza (`:74-76`);
  - ogni giro parte al prossimo multiplo di N minuti dell'orologio;
  - cadenza per route, **`ai-drain` ogni minuto di default** (`--every ai-drain=1`), le altre ogni 5;
  - `DEFAULT_ROUTES` riceve `ai-drain`.
- **Avvio immediato:** `after(() => drainAiJobs())` in `startWriting` e in `regenerateScript`, se non è impostato `AI_KICK_DISABLED=1` (serve a F2-E5). `maxDuration = 300` in `batches/[id]/page.tsx` e `reels/[id]/page.tsx`.
- **Contorno:**
  - `notify.ts:280-289`: "Alternative pronte: X di Y";
  - `health.ts`: `ai_backlog`, `ai_stuck` e `ai_failing`, nell'avviso e nello stand-up;
  - `scrub.ts`: chiavi `prompt|messages|completion|spunto|idea`;
  - UI: menù con preselezione (§3), stato in corso con `router.refresh()` ogni 5 s, badge, "Rigenera", "N nomi oscurati" sull'alternativa;
  - `scripts/fase2-config.sql`.

**Verifiche:**
- db `14_ai_jobs.sql`:
  - le chiamate a 2, 3 e 4 argomenti;
  - `claim_jobs` senza AI, e un job AI con `attempts >= 6` e lease scaduto non va in dead letter tramite `claim_jobs`;
  - il tetto rispettato con due prese nella stessa finestra;
  - lease di 150 s, `lost` e dead letter solo per lease esaurito;
  - **un risultato tardivo riporta `lost` a `ok` con lo stesso `run_id`**;
  - un fallimento definitivo completa il job senza dead letter, e così `cancel_ai_jobs`;
  - vince chi scrive per primo;
  - `retry` con `run_after` da 5 a 30 s;
  - `skipped` solo per elementi `queued` fuori da `bozza`; un elemento `ok` resta `ok`;
  - `redactions` copiato sull'elemento;
  - la riga di arretrato per lancio di `ai_health`;
  - una seconda esecuzione di `031` senza errori;
  - notifica anticipata o a +15 minuti;
  - `request_generation`;
  - candidati di costo solo con `openrouter_id`;
  - permessi.
- `run.sh`: due `claim_ai_jobs` concorrenti con tetto 1 → un solo job (schema di `:44-58`).
- allowlist: `request_generation`.
- api-check: le RPC service role negate, `ai_runs` → `[]` per un non admin, `start_writing` a 2 argomenti.
- unit: `prompt` (AC15, parole vietate presenti, altri campi Voce assenti, sentinella con un nome di battesimo), `redact`, `parse`, `errors`, `openrouter`, `drain`.

**Fatto quando:**
- con il provider finto sull'anteprima del branch (latenza 20–90 s, un modello in errore, un 429): 1, 2 e 3 lanci contemporanei come in AC10, una notifica per autore, badge, "Rigenera";
- con la chiave: F2-E3 una volta.

### S3 — Idee e batch da idee · 2,5 giorni · senza chiave

**SQL** `040_ideas.sql`:
- `ideas`: `page_id`, `title`, `spunto`, `source` (`manuale`/`doc`; il rilascio B aggiunge `intelligence`), `status`, `reel_id` unique `on delete set null`, `created_by`, `decided_at`; solo interni, nessun grant di scrittura.
- `batches.origin` (`import` di default) e **`batches.period date`**:
  - backfill dal codice del primo reel (`yymm`);
  - check `origin = 'ideas'` ⇒ `period` non nullo;
  - per i batch `import` nati dopo, `period` resta nullo (`createBatch` invariato) e le metriche usano `coalesce(period, mese del codice del primo reel)` (§3).
- `private._reel_code(prefix, year, month, ordinal)`.
- **RPC:** `upsert_idea`, `set_idea_status` (`backlog` ↔ `scartata`), `create_batch_from_ideas(p_page_id, p_year, p_month, p_idea_ids, p_batch_id default null)`.
  - Con `p_batch_id` vale **solo** per batch `origin = 'ideas'` della stessa pagina e usa `batches.period`.
  - Lock su pagina e idee.
- **Trigger** `reels_doc_idea()` sugli insert nei batch `import`; backfill delle idee `doc`.

**Codice:**
- `src/lib/ideas/*`; `pages/[id]/idee/{page,ideas-backlog,create-batch-dialog}.tsx`; `reels/[id]/idea-box.tsx`; badge dell'origine;
- `createBatch` mappa l'errore 23505 su `reels.code` (`actions.ts:136-143`);
- ~~il prompt di S6 riceve titolo e spunto dell'idea~~: spostato in S6 (`prompt.ts`), perché `src/lib/ai/` nasce lì.

**Verifiche:**
- db `12_ideas.sql`: permessi, transizioni, numerazione, parità dei codici, rifiuto dei batch `import`, `period`, trigger;
- allowlist: `upsert_idea`, `set_idea_status`, `create_batch_from_ideas`;
- api-check: query del backlog;
- unit `codes.test.ts`.

**Fatto quando:** F2-E2 passa sul sandbox; `test-create-batch.ts` e `test-parser.ts` sono invariati.

**Stato (2026-10-15): S3 chiusa.**
- **Fatto e verde:**
  - `040_ideas.sql` (commit `bae82c2`, test `3cc3459`) e UI delle idee (`e148c4e`);
  - `run.sh` (con `api-check` e il nuovo controllo di concorrenza), `upgrade.sh`, typecheck, lint, 127 test, build;
  - `test-parser.ts` e `test-create-batch.ts` invariati; `test-parser.ts` passa.
- **F2-E2 provato dall'assistente in Chrome** sul sandbox (sessione admin):
  - **Pagina Test:**
    - tre idee aggiunte; una scartata e ripescata;
    - "Batch Dicembre" (Da idee) con TT-2612-01 e 02, poi una terza idea aggiunta allo stesso batch come TT-2612-03;
    - il reel mostra l'idea con lo spunto.
  - **Nuova pagina "Porcino & Papaya" (PP):** l'import del Doc di maggio dà 20 reel PP-2605-01…20, 20 versioni `import` e 20 idee "Dal Doc" tra le scelte.
  - **Re-sync con conflitto:**
    - anteprima su PP-2605-01 ritoccato a mano; nel frattempo un salvataggio da un'altra scheda;
    - "Salva" lascia il reel com'è e lo elenca tra i non aggiornati;
    - un re-sync rifatto da capo scrive la versione `resync` e riporta il testo del Doc; lo storico conserva le tre versioni manuali.
  - `period` resta nullo sul nuovo batch `import`, come previsto.
- **Correzioni dalla prova** (`36fce82`): il form dello script mandava gli a capo come CRLF (codifica multipart del browser).
  - Ogni salvataggio manuale risultava diverso dall'import su tutti i blocchi multiriga, e il re-sync li segnalava tutti.
  - Ora `updateReelScript` salva LF, come il parser.
  - Il difetto c'era già in Fase 1; sul sandbox restano due versioni di prova con CR.
- **Correzioni dalla revisione indipendente:**
  - **Titolo vuoto:** un'intestazione `SCRIPT 5 — ` senza titolo faceva fallire l'import intero sul vincolo di `ideas.title`. Trigger e backfill ora usano il codice del reel.
  - **Collisioni di codice:**
    - nel re-sync, un nuovo numero di script con un codice già preso da un batch da idee dà `duplicate_codes` invece di `unknown`;
    - il messaggio copre anche un Doc che ripete un numero di script.
  - **`create_batch_from_ideas`:**
    - permessi controllati prima del lock;
    - lock `for no key update` sulla pagina;
    - una collisione con un import concorrente dà `stale` e annulla tutto;
    - niente aggiunte a un batch chiuso.
  - **UI:**
    - conteggi reali nelle schede (le scelte in lista sono al massimo 200);
    - la selezione tiene solo le idee ancora nel backlog;
    - anno e numero massimo di idee (50) controllati nel dialogo, con messaggi propri;
    - le idee `doc` mostrano il titolo attuale del reel;
    - i batch chiusi non compaiono più tra quelli a cui aggiungere idee.
  - **Test aggiunti:**
    - titolo vuoto, in `12_ideas` e in `06_fase2` sul backfill;
    - numerazione dopo i codici di un batch `import`;
    - percorso admin delle tre RPC;
    - batch da idee di un'altra pagina e batch chiuso;
    - collisione → `stale` senza righe scritte;
    - due `create_batch_from_ideas` concorrenti in `run.sh`;
    - query di `listIdeasBatches` e `countIdeas` in `api-check`.
  - **Prova per mutazione:** quattro mutanti, tutti uccisi (trigger senza ripiego, batch chiuso accettato, niente gestore `stale`, niente lock sulla pagina).
  - **Sandbox:** le due funzioni cambiate sono state riapplicate con `create or replace` e l'md5 di `040_ideas.sql` aggiornato; `fase2-sandbox-migrate.ts --dry-run` non trova nulla in sospeso.

### S5 — Controlli · 1,5 giorni · senza chiave

- `src/lib/script-lab/checks.ts`, solo funzioni pure:
  - `normalize`;
  - `findBannedWords`, che usa `voice_briefs.banned_words`;
  - `estimateDuration`, che toglie le etichette `^[A-ZÀ-Ü ]+:` e le note tra parentesi;
  - `similarity`: trigrammi, 0,8 tarato sul fixture di maggio;
  - `runChecks`.
- `recent.ts`: ultime 20 CTA e chiusure per pagina.
- UI: `reels/[id]/checks-panel.tsx`, riga in `approvazioni/approval-card.tsx`, conteggio in `task-panel.tsx` senza mai disabilitare "Consegna".
- Unit `checks.test.ts`. Nessuna migrazione.

**Stato (2026-10-15): S5 chiusa.**
- **Fatto e verde:**
  - `checks.ts` (pure), con 14 test compresa la taratura sul batch di maggio. La stima della durata si sposta qui da `mix.ts`;
  - `recent.ts`: contesto per pagina e ultimi 20 reel, con una query per tabella e pagina;
  - la sezione "Controlli" nella scheda Script, il conteggio in `task-panel.tsx` (accanto a "Script pronto" e alla decisione sullo script) e gli avvisi sulle card di script in `/approvazioni`;
  - typecheck, lint e 124 test verdi. Commit `3610cc8`.
- **Soglia di somiglianza 0,6 invece di 0,8**, tarata come previsto sul fixture di maggio:
  - nel batch le 20 CTA diverse arrivano al massimo a 0,36 tra loro e le chiusure a 0,23;
  - la stessa formula riformulata dà 0,67–0,73, con una parola tolta 0,96;
  - con 0,8 le riformulazioni sfuggirebbero.
- **F2-E8 provato dall'assistente in Chrome** sul sandbox (sessione admin), su TT-2611-03:
  - aggiunta "idiota" alle parole vietate della Voce;
  - hook con "l'idiota" e un testo di 120 parole → 4 avvisi nel reel: parola vietata in Hook, durata 48 s su 30–45, CTA e chiusura uguali a TT-2611-02;
  - "Script pronto" → `ok`, reel in `revisione`, "4 avvisi sul testo" accanto alla decisione;
  - revisione riassegnata ad Admin Sandbox per vederla nella sua coda: la card in `/approvazioni` mostra i 4 avvisi e "Approva" resta disponibile;
  - nessun errore in console.

### S7 — Metriche e costi · 1,5 giorni · senza chiave

- **SQL** `050_metrics.sql`: `script_lab_metrics(p_from, p_to)`, solo admin (42501), mesi in Europe/Rome. Sezioni:
  - `sendback`;
  - `costs`, per mese × pagina × modello: costo `final`, conteggio `pending`, `unavailable` e `lost`, chiamate, errori, token, p95;
  - `batches`, per mese con `coalesce(period, mese del codice del primo reel)` e per origine;
  - `bibles`, complete se hanno tono, personaggi, durata e almeno una CTA;
  - `authors`;
  - **`provenance`**: quota di basi dall'AI per modello, blocchi per modello, quota di modifiche manuali dopo il mix.
- **UI:** `src/app/(app)/script-lab/page.tsx` (solo admin), voce di navigazione.
- **Verifiche:** db `15_metrics.sql`, allowlist `script_lab_metrics`, api-check 42501.

### S8 — Collaudo, promozione e rilascio · 3 giorni + 1 · dopo R2

- **Preparazione:**
  - `rehearse-dump.sh --release f2a` (solo `*_fase2_*` pendenti; `:53-56`, `:131-134`);
  - `checks-upgrade/06_fase2.sql`;
  - `scripts/fase2-e2e/README.md`.
- **Procedura:** §8.
- **Documenti:** `docs/fase2-plan.md`; `CLAUDE.md` (cartella `supabase/fase2/` fino alla promozione, route `ai-drain`, env AI, due chiavi, regole sul prompt); `docs/brain-plan.md` (esiti dello spike, deviazioni dall'AI SDK e da Inngest); `.env.example`.

**Ripartizione:**
- collaudo completo sull'anteprima del branch collegata al **sandbox**, prima della promozione;
- promozione, push sullo staging e regressione (F2-E10 con Drive, F2-E1 e F2-E3 rapidi) al più una settimana prima della produzione (D-A).

**Fatto quando:** F2-E1…E10 sono firmati, la pagina pilota è in produzione, e dopo 48 h non ci sono avvisi `ai_backlog`, `ai_stuck`, `ai_failing` né dead letter AI.

---

## 6. Migrazione dei dati e rollback

**Dati.** Nessun dato esistente cambia: niente si sposta da `voice_briefs`, e `reels` resta intatta (né `script_rev` né `updated_at`). Backfill idempotenti:
- una `page_bibles` vuota per pagina;
- `batches.origin = 'import'`, con `period` dal codice;
- un'idea `doc` per reel;
- una versione `import` per reel con testo.

Prova senza perdite di AC2 in `06_fase2.sql`: numero di righe e `md5(string_agg(row_to_json(v)::text …))` di `voice_briefs` uguali prima e dopo, e ogni pagina presente in `page_bibles`.

**Expand senza contract.**
- Tutto è additivo, salvo due riscritture compatibili: `start_writing` con `p_models default null` e `claim_jobs` filtrata.
- Il codice di R2 funziona sopra l'expand, come provano `upgrade.sh` e F2-E10.
- Non c'è un contract della Fase 2: `voice_briefs_admin_write` resta (D-D).

**Rollback, dal più leggero, sempre in quest'ordine:**
0. `set_app_config('ai_enabled', false)`: nessun job AI nuovo.
1. `select cancel_ai_jobs()` (insieme al passo 0 in `scripts/fase2-ai-off.sql`). Si fa **sempre**, anche prima del passo 2: con il codice di R2 i job pendenti resterebbero senza drain e farebbero scattare `job_backlog`. Meno di un minuto, senza deploy. Per una sola pagina basta l'interruttore.
2. Promote del deployment di R2 su Vercel. Basta, perché non c'è contract.
3. Solo dopo i passi 0–1, se serve il comportamento esatto di Fase 1 nel database: `supabase/rollback/fase2a_restore_fase1.sql` (D-A, che ripete 0–1 all'inizio), provato in `upgrade.sh`. Le tabelle della Fase 2 restano, ignorate dal codice vecchio.

Per tornare avanti si rieseguono i file `031` (`drop … if exists`), poi il deploy.

---

## 7. Test plan esteso

### 7.1 Unit (vitest, solo moduli puri)

| Modulo | Casi |
|---|---|
| `src/lib/ai/prompt.ts` (AC15) | Sentinelle di email, nomi completi (attivi e disattivati) e uuid in personaggi, spunto e nota: assenti dal prompt, contate. **Sentinella con un nome di battesimo di un profilo:** oscurata nella nota e nello spunto, lasciata nei personaggi. **Parole vietate presenti; aggettivi, audio, libertà e procedura assenti** (il tipo non li accetta, e le sentinelle lo verificano). Titolo come ripiego. Budget di parole. `PROMPT_VERSION` → `sha256` |
| `src/lib/ai/redact.ts` | Nomi con accenti e apostrofi, nessun oscuramento parziale dentro altre parole, telefoni italiani |
| `src/lib/bible/schema.ts` | Limiti; ricerca dei nomi di battesimo per l'avviso, senza modifiche |
| `src/lib/ai/parse.ts` | JSON valido, JSON in un blocco di codice markdown, ripiego a sezioni, testo grezzo |
| `src/lib/ai/errors.ts` | 400/401/402/403/404 → definitivo; 408/429/5xx/`AbortError`/rete → temporaneo con `Retry-After` limitato a 30 s; il codice non contiene mai il corpo della risposta |
| `src/lib/ai/openrouter.ts` (`fetch` finto) | Corpo della richiesta; costo; `openrouter_id`; timeout |
| `src/lib/ai/drain.ts` | Finestra scorrevole, nessuna nuova chiamata dopo 150 s, coda entro 30 s, un job per posto libero |
| `scripts/cron-loop.ts` (funzione pura `nextTick`) | Allineamento all'orologio, cadenza per route (`ai-drain` ogni minuto, le altre ogni 5) |
| `src/lib/script-lab/checks.ts`, `mix.ts`, `src/lib/batches/codes.ts` | Come in iter1 (accenti, apostrofi, durata, soglie; provenienze; i 3 codici) |

Obiettivo: circa 65 test nuovi, `pnpm test` sotto i 10 s.

### 7.2 Integrazione (db-check SQL + PostgREST)

| Check | Copre |
|---|---|
| `00_guards.sql` (agg.) | Allowlist: `save_bible`, `save_reel_script`, `upsert_idea`, `set_idea_status`, `create_batch_from_ideas`, `apply_script_version`, `restore_script_version`, `reel_script_provenance`, `request_generation`, `script_lab_metrics`. Funzioni service role negate; RLS ovunque; nessuna `using (true)` |
| `11_bible.sql` | AC3, AC4, `stale`, vincoli, interruttore |
| `12_ideas.sql` | Permessi, numerazione, `period`, rifiuto dei batch `import`, trigger `doc` |
| `13_versions.sql` | Fonte per percorso (proposta tramite `decide_text_proposal`, re-sync), RPC `SECURITY INVOKER` (`prosecdef = false`) e parità con l'update diretto, elenco chiuso di `p_source`, `stale`, blocco, provenienza |
| `14_ai_jobs.sql` | Firme di `start_writing`; filtro di `claim_jobs`, compreso il dead letter con `attempts >= 6`; tetto; lease; `lost` e `lost → ok` tardivo; `skipped` solo da `queued`; nessun dead letter per i fallimenti previsti; chi scrive per primo; `retry`; notifica; candidati di costo; `redactions` sull'elemento; arretrato per lancio; `031` eseguito due volte |
| `15_metrics.sql` | Numeri del fixture, 42501 |
| `run.sh` (concorrenza) | Due `claim_ai_jobs` con tetto 1 |
| `upgrade.sh` + `06_fase2.sql` | Sopra R2 in volo: AC2, backfill, compatibilità con R2, **ripristino delle funzioni di Fase 1 (dopo `ai_enabled = false` e `cancel_ai_jobs`, senza job AI pendenti) e ritorno in avanti** |
| `rehearse-dump.sh --release f2a` | Dump di produzione su PG17 |
| `api-check.mjs` (agg.) | Esterno → `[]` sulle tabelle della Fase 2 e 1 riga di `voice_briefs`; query di backlog e alternative; RPC negate; `start_writing` a 2 argomenti |

### 7.3 End-to-end

Durante lo sviluppo e nel collaudo completo di S8: sull'**anteprima del branch collegata al sandbox**. Dopo la promozione, solo la regressione sullo **staging** (F2-E10 con Drive, F2-E1 e F2-E3 rapidi). Con `cron-loop.ts` (route in parallelo, `ai-drain` ogni minuto) e `fase2-seed.ts`.

| Scenario | Passi | Esito atteso |
|---|---|---|
| F2-E1 (AC1–4) | Il Responsible non admin compila la bibbia; l'interno senza ruolo prova; l'esterno apre il reel e interroga `page_bibles` via REST | Salvata; `not_authorized`; l'esterno vede la Voce, parole vietate comprese, e REST restituisce `[]` |
| F2-E2 (AC5–7) | Backlog con scarto e ripescaggio; batch "Dicembre 2026"; aggiunta di 2 idee allo stesso batch; import e re-sync del Doc P&P su un'altra pagina | `TT-2612-01…12`; l'import funziona come prima, con idee `doc` e versioni `resync` |
| F2-E3 (AC8–11, 14) | 10 × 3 con modelli reali, cronometro | ≤ 10 min (3 prove); una notifica; 30 `ai_runs` `final` o `pending` con id |
| F2-E4 (AC12–13) | Un id di prova non valido nel catalogo; poi "Rigenera" | Badge; elemento `failed`; **nessun dead letter**; "Rigenera" aggiunge l'alternativa |
| F2-E5 (AC10–11) | 2 lanci contemporanei con (a) `AI_KICK_DISABLED=1` oppure (b) `AI_FAKE_429_ONCE`; (c) 3 lanci contemporanei con il provider finto alla latenza p95 dello spike | Ogni lancio ≤ 10 min; `ai_backlog` sale e torna a zero. Con `ai-drain` tolto dal loop: notifica tra 15 e 20 minuti |
| F2-E6 (AC16, 18) | Base A, CTA da B, correzione a mano, consegna | Provenienza: base A, CTA B, modifica manuale sì |
| F2-E7 (AC17, 19) | Ripristino in `bozza`; proposta accettata in `revisione`; ripristino e "Rigenera" in `revisione` | Versioni `ripristino` e `proposta`; in `revisione` rifiutati |
| F2-E8 (AC20–21) | Parola vietata, 48 s su 30–45, CTA ripetuta | 3 avvisi nel reel e in `/approvazioni`; consegna riuscita |
| F2-E9 (AC22–25) | `/script-lab` come admin e come non admin | Numeri giusti; redirect |
| F2-E10 (Fase 1) | Pagina senza interruttore; stand-up e sweep (sul sandbox); ciclo Drive fino a `programmato` (solo sullo staging, dove Drive c'è) | Identico a R2; nessun job AI; `job_health` pulito |

### 7.4 Osservabilità

- **`ai_runs`:** `started`, `ok`, `error` e `lost`, con `cost_status`. È la fonte di AC14 e AC23. Ogni mese si confronta con l'attività OpenRouter, per chiave, entro il 5%; i `lost` si riportano a parte.
- **`ai_health()`**, nell'avviso `job_health` e nello stand-up: `ai_backlog` (elemento `queued` più vecchio per lancio, oltre 10 minuti), `ai_stuck`, `ai_failing`, costi `pending` con id oltre 1 h, battito di `ai_drain` oltre 5 minuti. Nessun dead letter per i rifiuti dei modelli (D-C).
- **Badge per chi scrive:** `ai_generation_items.redactions` sull'alternativa ("N nomi oscurati").
- **Log JSON** `{evt: 'ai_run', model, gen, attempt, ms, tokens, cost, outcome, code, redactions}`, senza testo.
- **Sentry:** solo dead letter per lease esaurito ed errori della route, con il codice classificato; niente corpi di risposta.
- **Pagina `/script-lab`:** costi e qualità (provenienza).

---

## 8. Verifica e procedura di rilascio

### Comandi per ogni fetta (worktree `fase-2-script-lab`)
```bash
scripts/db-check/run.sh && scripts/db-check/upgrade.sh
PG_BIN=/opt/homebrew/opt/postgresql@17/bin scripts/db-check/run.sh   # a fine fetta
pnpm test && pnpm typecheck && pnpm lint && pnpm build && pnpm exec tsx scripts/test-parser.ts
pnpm exec tsx scripts/fase2-sandbox-migrate.ts && scripts/fase2-dev.sh   # sandbox; verifica il ref
# MAI `supabase db push` da questo worktree prima di S8
```

### Procedura (dopo R2; ogni passo con l'OK esplicito dell'utente)

0. **Prerequisiti:**
   - R2 in produzione da almeno 48 h, con `job_health` pulito;
   - Vercel Pro attivo e prova `after()` su Pro fatta;
   - due chiavi OpenRouter su Vercel: sviluppo e anteprime, poi Production;
   - catalogo approvato;
   - pagina pilota scelta.
1. **Collaudo completo sull'anteprima del branch collegata al sandbox** (impegno: 15–18 dicembre; ambizioso: venerdì 4 e lunedì 7 dicembre mattina). F2-E1…E9 e la parte senza Drive di F2-E10, firmati in `scripts/fase2-e2e/README.md`. Nessuna migrazione si muove.
2. **Promozione e staging, al più una settimana prima della produzione** (impegno: lunedì 4 gennaio; ambizioso: lunedì 7 dicembre):
   - merge di `main`, `fase2-promote.sh`, tag `fase2a`; `run.sh` e `upgrade.sh` verdi su PG16 e PG17;
   - **da qui fino alla produzione le migrazioni di Fase 1 sono congelate** (≤ 1 settimana);
   - `migration list` e `db push --dry-run` mostrano **solo** i file `fase2`; poi il push (o la Management API); guardie in sola lettura; `fase2-config.sql`;
   - le variabili Preview del branch passano dal sandbox allo staging;
   - regressione sullo staging: F2-E10 con il ciclo Drive, F2-E1 e F2-E3 rapidi.
3. **Prova su dump:** dump fresco; `rehearse-dump.sh --release f2a` su PG17; report letto dall'utente (impegno: giovedì 7 gennaio; ambizioso: giovedì 10 dicembre).
4. **Produzione, di lunedì:**
   1. la mattina, `fase2-promote.sh --check`: se c'è un timestamp di Fase 1 più recente, nuova rinomina, contabilità sullo staging (D-A) e nuova prova su un dump di meno di 2 h;
   2. 30 minuti di finestra senza modifiche; dump;
   3. da `fase2a`: `db push --dry-run`, poi `db push`; poi guardie in sola lettura;
   4. env di produzione: `OPENROUTER_API_KEY` di produzione, `AI_PROVIDER=openrouter`;
   5. `vercel.json` con `{"path": "/api/cron/ai-drain", "schedule": "* * * * *"}` (ogni minuto, D-C);
   6. merge su `main`;
   7. `fase2-config.sql --target production`, con l'interruttore acceso **solo sulla pagina pilota**;
   8. smoke test: una generazione a 1 modello su `TT`, con la riga `ai_runs` e la versione, e `ai_health()` pulito;
   9. CLI ricollegata allo staging. Fine del congelamento delle migrazioni di Fase 1.
5. **Rampa:** una settimana di scrittura reale sulla pilota. Poi l'interruttore si accende su tutte le pagine attive se valgono tutte queste condizioni:
   - nessun avviso `ai_backlog`, `ai_stuck` né `ai_failing`;
   - costo per script entro ±50% dello spike;
   - **segnale di qualità dalla provenienza** (AC18): almeno il 50% dei reel consegnati ha la base da un'alternativa AI; quota di modifiche manuali dopo il mix riportata (attesa alta, si osserva);
   - rimandi della pilota non peggiori del mese precedente;
   - nessuna segnalazione bloccante di chi scrive.

**Rollback:** §6.

---

## 9. Calendario, checkpoint e piano B

Le finestre di rilascio della Fase 1 sono **congelate**: niente Fase 2, nemmeno in locale.

Stime: S0–S7 **20,5 g**, più 1 g di e2e sul sandbox, più S8 3 g (collaudo sull'anteprima 1,5, promozione con staging e regressione 1, prova su dump e rilascio 0,5) = **24,5 g**, più 1 g di stabilizzazione.

La finestra del 14–16 ottobre è in parte spesa per le revisioni del piano: la mezza giornata di S0 persa si recupera dal margine del 7–11 dicembre.

Regola comune ai due scenari: **collaudo completo sull'anteprima del branch collegata al sandbox; promozione e staging al più una settimana prima della produzione**, così il congelamento delle migrazioni di Fase 1 dura una settimana o meno. Nessun rilascio di venerdì (`fase1-plan.md:908`).

Festivi: martedì 8 dicembre, 24–25 dicembre, 1 e 6 gennaio.

### Scenario d'impegno (Fase 1 al piano B: R1 lunedì 16 novembre, R2 lunedì 30 novembre; `fase1-plan.md:910`)

| Finestra | Fase 1 (gg) | Fase 2 (gg) |
|---|---|---|
| 14–16 ott | e2e, bot di staging (1) | **S0** 1,5 · **S2** 0,5 (avvio in ritardo per le revisioni: −0,5, recuperato il 7–11 dicembre) |
| 19–23 ott | e2e R1 (2) | **S2** 2 · **S4** 1 · **F2-1 venerdì 23** |
| 26–30 ott | preparazione di 0a (2) | **S4** 3 (fine) · **chiave entro venerdì 30** |
| 2–4 nov | correzioni dopo il checkpoint del 3 (2) | **S1 spike** 1 · **F2-2 martedì 3** |
| 5–6 nov | correzioni R1 — **congelato** | — |
| 9–11 nov | preparazione di 0a (1,5) | **S6** 1,5 |
| 12–13 nov | **prova 0a — congelato** | — |
| 16–17 nov | **R1 + stabilizzazione — congelato** | — |
| 18–25 nov | resto di S5 Drive ed e2e di R2 (2,5) | **S6** 3,5 |
| 26–27 nov | **collaudo R2 — congelato** | — |
| 30 nov–1 dic | **R2 + documenti — congelato** | — |
| 2–4 dic | riserva della Fase 1 | **S6** 1 (fine, 6 in tutto) · **S3** 2 |
| 7–11 dic (8 festivo) | — | **S3** 0,5 · **S5** 1,5 · **S7** 1,5 · recupero di S0 0,5 (margine azzerato) |
| lun 14 dic | — | e2e sul sandbox con la chiave, misure di AC10 (1) · **F2-3** |
| 15–18 dic | — | **S8 (1):** collaudo F2-E1…E9 sull'anteprima collegata al sandbox (1,5) · preparazione della prova `f2a` e dei documenti (0,5) · margine (2) |
| 21–23 dic, 28–31 dic | — | riserva; nessuna migrazione si muove |
| lun 4 gen | — | **S8 (2):** promozione, push sullo staging, regressione (1); **inizio del congelamento** delle migrazioni di Fase 1 |
| 5, 7–8 gen (6 festivo) | — | margine 5; **prova su dump giovedì 7** (0,5); margine 8 |
| **lun 11 gen 2027** | — | **Impegno: pagina pilota in produzione** (batch di febbraio); stabilizzazione 11–12; fine del congelamento; estensione lunedì 18 gennaio |

### Scenario ambizioso (checkpoint di Fase 1 del 3 novembre superato: R1 lunedì 9, R2 lunedì 23)

| Finestra | Fase 1 (gg) | Fase 2 (gg) |
|---|---|---|
| 14 ott–30 ott | come sopra | **S0, S2, S4** (7,5 g utili: S4 finisce lunedì 2 novembre mattina); chiave entro venerdì 30 |
| 2–4 nov | correzioni (1) | **S4** 0,5 · **S1** 1 · **S6** 0,5 |
| 5–6, 9–10 nov | **prova 0a, R1 e stabilizzazione — congelato** | — |
| 11–13 nov | condivisione Drive reale (0,5) | **S6** 2,5 |
| 16–18 nov | preparazione del collaudo (0,5) | **S6** 2,5 |
| 19–20, 23–24 nov | **collaudo R2, R2 e documenti — congelato** | — |
| 25–27 nov | — | **S6** 0,5 (fine) · **S3** 2,5 |
| 30 nov–2 dic | riserva di Fase 1 non usata | **S5** 1,5 · **S7** 1,5 |
| gio 3 dic | — | e2e sul sandbox con la chiave (1) · **F2-3** |
| ven 4, lun 7 dic | — | collaudo sull'anteprima collegata al sandbox (1,5) · **lunedì 7 pomeriggio: promozione e staging**, inizio del congelamento |
| 9–11 dic (8 festivo) | — | regressione sullo staging mer 9 · **prova su dump giovedì 10** · margine venerdì 11 |
| **lun 14 dic** | — | **Ambizioso: pagina pilota in produzione** (batch di gennaio sulla pilota); estensione lunedì 11 gennaio |

**Checkpoint:**
- **F2-1, venerdì 23 ottobre**, legato al checkpoint SQL di Fase 1 dello stesso giorno:
  - condizioni: S0 e S2 verdi in `run.sh` e `upgrade.sh`, e il motore SQL di Fase 1 stabile (nessuna modifica attesa a `start_writing` e `claim_jobs`);
  - **è il cancello della SQL di S6**: `030`/`031` riscrivono funzioni di Fase 1 e si scrivono solo dopo questo checkpoint.
  - Se fallisce: niente ambizioso, tagli 1–2.
- **F2-2, martedì 3 novembre**, legato all'I9 di Fase 1:
  - condizioni: S4 verde, chiave arrivata e spike fatto;
  - lo scenario della Fase 1 decide quale calendario si segue.
  - Se la chiave manca, S6 parte con il provider finto e ogni giorno di ritardo della chiave sposta di un giorno F2-3 e il rilascio. Se S4 non è verde: tagli 1–3.
- **F2-3** (ambizioso: giovedì 3 dicembre; impegno: lunedì 14 dicembre): S0–S7 verdi ed e2e del sandbox con modelli reali (AC10 per 1, 2 e 3 lanci). Se no: +1 settimana, che nello scenario d'impegno resta dentro la riserva fino all'11 gennaio.

**Chiave OpenRouter: una sola scadenza, venerdì 30 ottobre (prima di S6).**

**Tagli pre-concordati,** nell'ordine; nessuno toglie un AC:
1. Rigenera con la nota (−0,25 g);
2. aggiunta di idee a un batch esistente (−0,25 g);
3. confronto affiancato nello storico (−0,25 g);
4. `/script-lab` senza selettore del mese (−0,5 g);
5. costi solo da `usage.cost`, se lo spike li mostra sempre presenti (−0,25 g).

**Probabilità** (stima onesta, S4 e S6 già a +30%):
- pilota entro il 14 dicembre ~20% (richiede la Fase 1 ambiziosa, stimata ~35%, e la Fase 2 senza margine);
- entro lunedì 21 dicembre (opzione di Q3) ~40%;
- **entro l'11 gennaio ~75%**.

### Prerequisiti a carico dell'utente

| Quando | Azione |
|---|---|
| Entro il 15 ottobre | Q1: progetto sandbox (verificare il limite dei progetti Free attivi) con SMTP Resend; variabili Preview del branch `fase-2-script-lab` verso il sandbox (OK alla modifica delle variabili Vercel) |
| **Entro venerdì 30 ottobre** | Account OpenRouter: privacy (`data_collection: deny`, esclusione dei provider che conservano o addestrano), credito (~25 $), **chiave di sviluppo e anteprima** in `.env.local` e `.env.fase2.local`; 30 minuti di Teo e Gabri per la lettura alla cieca |
| Dopo l'attivazione di Vercel Pro (prerequisito di R1) | Ripetere la prova `after()` e `maxDuration` sull'anteprima; verificare che il cron al minuto sia ammesso |
| Prima di S8 | **Chiave di produzione** separata su Vercel Production; catalogo approvato; pagina pilota |
| Prima dell'estensione | Bibbie delle pagine attive compilate dai Responsible (AC24) |

---

## 10. Rischi e mitigazioni

| Rischio | Prob. | Impatto | Mitigazione |
|---|---|---|---|
| R1 o R2 slittano oltre il piano B | Media | Medio | Calendario d'impegno sulle date di piano B, riserva fino all'11 gennaio, checkpoint legati, tagli |
| Un hotfix cambia `start_writing` o `claim_jobs` | Media | Alto | `_assert_body`, merge settimanale, script di ripristino provato |
| Un hotfix nasce tra il push sullo staging e quello in produzione | Bassa (finestra ≤ 1 settimana) | Alto | Collaudo completo prima, sull'anteprima collegata al sandbox; promozione al più una settimana prima della produzione; congelamento delle migrazioni di Fase 1 solo in quella settimana; `promote --check` e nuova rinomina con contabilità sullo staging; nuova prova su dump |
| Le RPC del testo divergono dalle regole di Fase 1 | Bassa | Alto | `save_reel_script`, mix e ripristino sono `SECURITY INVOKER`: valgono RLS, grant e `reels_script_lock` (verifica `prosecdef = false`) |
| `claim_jobs` di Fase 1 manda in dead letter un job AI e blocca `generation_pending` | Bassa | Medio | `kind <> 'ai_generate'` anche nell'update del dead letter con `attempts >= 6` (check 14) |
| Ripristino con l'AI accesa: job AI presi da `claim_jobs` di Fase 1 (`no handler`) | Bassa | Medio | Ordine fisso: `ai_enabled = false`, `cancel_ai_jobs()`, poi ripristino (§6, D-A) |
| Push accidentale della Fase 2 | Bassa | Molto alto | Cartella separata, worktree, nessun `db push` fino a S8 |
| Anteprime del branch sullo staging | Bassa | Alto | Variabili Preview per branch verso il sandbox; verifica del battito |
| Sandbox impossibile (limite dei progetti Free, SMTP) | Media | Medio | Resend come sullo staging; DB2; DB3 con la UI in S8 (+1,5 g) |
| Chiave in ritardo | Media | Medio | Provider finto; scadenza unica il 30 ottobre; slittamento dichiarato giorno per giorno |
| Latenza o 429 oltre AC10, o più lanci contemporanei a inizio mese | Media | Alto | Tetto globale, nuovi tentativi nella stessa invocazione, lease di 150 s, cron `ai-drain` ogni minuto, spike con uscita su tutti e 3 i modelli, catalogo modificabile; caso peggiore per 1–3 lanci (D-C); `ai_backlog` per lancio; `max_concurrency` alzabile |
| Allarmi di Fase 1 per i rifiuti dei modelli | Bassa | Medio | Fallimento definitivo = job completato; dead letter solo per lease esaurito |
| Costi persi (chiamate interrotte) | Media | Basso | `started` → `lost`, recuperato a `ok`/`error` da un risultato tardivo; costi completati solo con id; confronto mensile per chiave entro il 5% |
| Dati personali o corpi di risposta verso modelli, log o Sentry | Bassa | Molto alto | Input tipizzato; oscuramento dei nomi completi ovunque e dei nomi di battesimo in nota e spunto, contato e visibile a chi scrive; avviso nell'editor della bibbia; codici classificati; `scrub.ts` |
| L'esterno vede bibbia o alternative | Bassa | Molto alto | RLS solo interni, guardie, api-check come esterno, F2-E1 |
| `after()` non affidabile su Vercel | Media | Basso | AC10 non dipende da `after()`: cron `ai-drain` ogni minuto (frequenza da verificare su Pro in S0) |
| `cron-loop` sfasato in sviluppo | Bassa | Basso | Route in parallelo, allineamento all'orologio, `ai-drain` ogni minuto |
| Bassa adozione o qualità | Media | Alto | Scenario 4 del pre-mortem; cancello di qualità nella rampa |

---

## 11. Pre-mortem (4 scenari, modalità deliberate)

**Scenario 1: "Le alternative arrivano dopo un'ora e costano il doppio."**
- **Come succede:** un modello ragiona oltre 120 s; i 429 rimandano tutto; `after()` muore; dieci autori lanciano insieme a inizio mese e il tetto serializza tutto; le chiamate interrotte vengono pagate senza traccia.
- **Segnali:** `ai_backlog` (lancio fermo oltre 10 minuti); `ai_stuck`; più del 20% delle notifiche partite dal ripiego dei 15 minuti; righe `lost` o `stale_lease`; quota di 429.
- **Mitigazioni:**
  - lease di 150 s con `AbortController` a 120 s;
  - un job per posto libero e tetto globale con lock consultivo;
  - nuovi tentativi nella stessa invocazione con `Retry-After`;
  - righe `started` prima della chiamata, e `lost → ok/error` per i risultati tardivi;
  - cron `ai-drain` ogni minuto, così AC10 non dipende da `after()`;
  - AC10 dichiarato per 1–3 lanci, con `max_concurrency` come leva;
  - spike con uscita su tutti e 3 i modelli, catalogo senza deploy, interruttore d'emergenza.

**Scenario 2: "Il doppiatore ha letto la bibbia e un nome è finito a un modello."**
- **Come succede:** policy sbagliata; nome completo nei "personaggi"; "Teo, accorcia…" nella nota di rimando; errore di moderazione che rimanda indietro l'input fino a Sentry.
- **Segnali:** guardie o api-check come esterno rossi; `prompt.test.ts` rosso; `redactions > 0` che cresce su una pagina (visibile anche a chi scrive); eventi Sentry con testo.
- **Mitigazioni:**
  - B1 (solo interni; Voce in `voice_briefs`);
  - input tipizzato, oscuramento di tutti i nomi completi e dei nomi di battesimo in nota e spunto, contato e mostrato come badge;
  - avviso sui nomi di battesimo nell'editor della bibbia;
  - codici classificati invece dei corpi di risposta;
  - `scrub.ts`, F2-E1.

**Scenario 3: "La Fase 2 ha rotto la Fase 1 in produzione."**
- **Come succede:** `start_writing` ha perso un hotfix o senza modelli non notifica più; `claim_jobs` esclude i `notify`, oppure manda in dead letter job AI; PostgREST trova due `start_writing` ambigue; un hotfix tra staging e produzione ferma il push a metà; un salvataggio del testo aggira il blocco da `revisione`.
- **Segnali:** compiti `writing` senza notifica dopo 30 minuti; `job_backlog`; dry-run con file inattesi; F2-E10 rosso; testo cambiato in `revisione` senza proposta.
- **Mitigazioni:**
  - guardie hash (md5 di Fase 1 o di Fase 2) e `drop` esplicito della firma vecchia;
  - ramo senza modelli identico a Fase 1, provato con 2 e 3 argomenti;
  - `09_outbox_sweep.sql` invariato e verde; filtro AI anche nel dead letter;
  - RPC del testo `SECURITY INVOKER`, quindi blocco e RLS di Fase 1;
  - promozione al più una settimana prima, con congelamento e `promote --check`;
  - nessun contract;
  - ripristino in tre livelli, in ordine fisso: interruttori e `cancel_ai_jobs`, deployment R2, `fase2a_restore_fase1.sql`.

**Scenario 4: "Le alternative non servono: chi scrive le ignora e torna al Doc."**
- **Come succede:** italiano piatto, personaggi fuori tono, durata sbagliata; "Rigenera" a ripetizione; editor scomodo su mobile; la pilota scrive tutto a mano partendo da una base vuota.
- **Segnali:** meno del 50% delle basi dall'AI (provenienza AC18); molte generazioni `rigenera` per reel; avvisi di durata e ripetizione frequenti; batch `import` che continuano (AC24); lettura alla cieca sotto soglia.
- **Mitigazioni:**
  - soglia di qualità nello spike (media ≥ 3,5 e almeno il 60% usabili come base);
  - script di esempio nella bibbia e ultime chiusure nel prompt, con `PROMPT_VERSION` per confrontare;
  - "Rigenera" con la nota di rimando;
  - modello predefinito per pagina scelto dalla provenienza;
  - cancello di qualità nella rampa (§8, passo 5), estensione solo se superato;
  - import del Doc sempre disponibile come ripiego.

---

## ADR

- **Decisione:** il rilascio A dello Script Lab si costruisce sopra il motore della Fase 1.
  - **Bibbia:** `page_bibles`, solo per interni, più `voice_briefs` come sezione Voce, parole vietate comprese, che gli esterni leggono come oggi; si salvano insieme con `save_bible`.
  - **Idee:** `ideas` con batch da idee (`origin`, `period`, codici SQL uguali a `buildReelCode`).
  - **Versioni:** snapshot completi scritti da un solo trigger `SECURITY DEFINER`. La fonte la dichiarano le RPC della Fase 2, che sono `SECURITY INVOKER` (`save_reel_script` con `stale` atomico e `p_source` in un elenco chiuso, mix, ripristino), così RLS, grant e `reels_script_lock` di Fase 1 continuano a valere. Il trigger riconosce le proposte accettate senza toccare `decide_text_proposal`.
  - **Generazione:**
    - un job per (generazione, modello) nella `job_outbox`, svuotato da un drain AI dedicato;
    - un job per posto libero, lease di 150 s, tetto globale, nuovi tentativi nella stessa invocazione;
    - `ai_runs` scritte prima della chiamata, con recupero `lost → ok/error` per i risultati tardivi;
    - fallimenti previsti senza dead letter; `claim_jobs` filtrato anche nel dead letter;
    - `after()` più cron `ai-drain` **ogni minuto**; AC10 dichiarato per 1–3 lanci contemporanei.
  - **Notifica:** accodata a +15 minuti e anticipata alla chiusura.
  - **Client AI:** client nostro su OpenRouter dietro `AiProvider`, con SO-1 e ripiego SO-3.
  - **Controlli e metriche:** controlli come funzioni TS pure; metriche come funzione SQL solo per admin.
  - **Sviluppo e rilascio:**
    - SQL in `supabase/fase2/`, con guardie hash (md5 di Fase 1 o di Fase 2) e script di ripristino eseguito dopo `ai_enabled = false` e `cancel_ai_jobs`;
    - sandbox per il dev server e per le anteprime, dove si fa il collaudo completo;
    - promozione al più una settimana prima della produzione, con le migrazioni di Fase 1 congelate solo in quella settimana;
    - nessun contract; interruttori.
- **Drivers:** rischio zero per R1 e R2; AC10–12 con modelli eterogenei; accessi e privacy verificabili.
- **Alternative considerate:**
  - A2 e A3; DB2 e DB3;
  - L1 e L3; SO-2;
  - C1, C2, C4;
  - B2 e B3;
  - V1a, V1b, V2, V3.
- **Perché questa scelta:**
  - nessun push accidentale e nessuna terza funzione di Fase 1, né regole di Fase 1 reimplementate;
  - AC10 con un guasto, fino a 2 lanci contemporanei, senza fornitori nuovi;
  - AC4 garantito dalla RLS;
  - nessun dato spostato;
  - si costruisce quasi tutta senza chiave.
- **Conseguenze:**
  - due funzioni di Fase 1 riscritte, con guardia e ripristino;
  - harness con una seconda cartella fino alla promozione;
  - route e cron `ai-drain` ogni minuto (esecuzioni a vuoto brevi), `cron-loop` in parallelo;
  - la capacità a inizio mese dipende da `max_concurrency`: oltre 3 lanci contemporanei AC10 non è garantito;
  - `voice_briefs` resta per sempre;
  - due chiavi OpenRouter;
  - costi delle chiamate interrotte solo riconciliati (`lost`);
  - sandbox da mantenere fino al rilascio;
  - costi solo visibili, senza tetto.
- **Deviazioni da `docs/brain-plan.md`** (da annotare lì in S8):
  - riga "AI" (`:100`), "un livello unico (AI SDK)" → client nostro in `fetch` dietro `AiProvider`;
  - riga "Job" (`:98`) e decisione `:47` ("Inngest… rinviato alla Fase 2") → **anche in Fase 2 niente Inngest**: outbox, drain dedicato e cron di Vercel Pro.
- **Follow-up:**
  - rilascio B (Intelligence, "Genera idee": `purpose = 'idea_generation'`, `ideas.source = 'intelligence'`);
  - modello predefinito per pagina dalla provenienza dopo 2 mesi;
  - riga di costo giornaliera;
  - `AiProvider` per Anthropic diretto con Batch API;
  - streaming per catturare `openrouter_id` delle chiamate interrotte, se i `lost` superano il 5%;
  - AI SDK solo per un'interfaccia in streaming; Inngest solo per job a più step;
  - dopo la promozione: togliere dall'harness il supporto a `supabase/fase2/` ed eliminare il sandbox.

---

## Domande aperte per l'utente (solo decisioni, ognuna con un default)

La questione delle parole vietate è **chiusa** dalla correzione della spec (stanno nella Voce).

| # | Domanda | Default |
|---|---|---|
| Q1 | Dove gira la Fase 2 prima di R2? | Sandbox `reelificio-pm-fase2` (Free, AlphaTechnology.ai) con Resend, usato da dev server e anteprime del branch; se il piano Free non lo consente, `supabase start` ridotto, altrimenti Postgres e PostgREST locali (UI provata solo in S8) |
| Q2 | Modelli dello spike e giudici | Claude Sonnet, GPT (o Gemini), un cinese; riserve: Haiku, Gemini (o GPT), un altro cinese, Mistral EU; Teo e Gabri alla cieca |
| Q3 | Date | **Impegno: pagina pilota lunedì 11 gennaio 2027** (batch di febbraio), estensione il 18 gennaio. Ambizioso: lunedì 14 dicembre. Opzione: lunedì 21 dicembre (promozione giovedì 17) se F2-3 è verde il 14, accettando la stabilizzazione sotto Natale; nessun rilascio di venerdì. Pilota: Porcino & Papaya |
| Q4 | "Rigenera" con la nota di rimando | Sì, facoltativo; primo taglio |
| Q5 | Significato della fonte `doc` | Un'idea per ogni reel importato |
| Q6 | Deviazioni da `brain-plan` (AI SDK, Inngest) | Accettate |
| Q7 | Alternative e storico solo per gli interni | Sì |
| Q8 | Credito e chiavi OpenRouter | Due chiavi (sviluppo e anteprime; produzione); ~25 $ per lo spike, poi ricarica automatica; nessun tetto nell'app |
| Q9 | Nei batch `import`, "Avvia stesura" preselezionata senza modelli (deviazione da AC8)? | Sì: il testo esiste già e oggi tutti i batch di produzione sono `import`, quindi preselezionare 3 modelli farebbe pagare 3 alternative per ogni script scritto; chi vuole le alternative le spunta. I batch da idee seguono AC8 (predefiniti della bibbia, o i primi 3 del catalogo) |

Le domande vanno copiate in `.omc/plans/open-questions.md` all'approvazione (questa iterazione scrive solo il piano).

---

## Changelog iter2

| Voce di revisione | Cosa è cambiato |
|---|---|
| Spec: parole vietate nella Voce | Ora stanno nella sezione Voce, in `voice_briefs.banned_words`, visibili ai doppiatori, usate dal prompt e da AC20a. Gli altri campi Voce non vanno nel prompt (principio 3, AC1, AC4, AC15, D-D, `prompt.ts` e `prompt.test.ts`). La domanda è chiusa |
| 1. Calendario e piano B | §9 riscritta: scenario d'impegno (R1 16/11, R2 30/11) e ambizioso, con tutte le fette e gli e2e ricollocati. Ordine S0 → S2 → S4 → S1 → S6 → S3 → S5 → S7. F2-1 il 23 ottobre è il cancello della SQL di S6; F2-2 il 3 novembre; F2-3. Chiave entro il 30 ottobre. S4 da 3 a 4 g e S6 da 4,5 a 6 g (+30%). **Impegno 11 gennaio 2027, ambizioso 14 dicembre**; probabilità ricalcolate. Il prompt usa il titolo quando l'idea manca |
| 2. Versioni | D-E: aggiunte V1a (riconoscimento della proposta pendente) e V1b (scritture esplicite); scelta V1c, ibrida. Nuova RPC `save_reel_script` (`stale` atomico) per il form e il re-sync; fonti `resync` e `proposta`, quest'ultima riconosciuta con `base_rev = old.script_rev` e `proposed_text = new`. Nessuna terza funzione di Fase 1 (`fase1_task_engine.sql:1047`/`:1053` citati) |
| 3. AC10 con i nuovi tentativi | D-C: nuovi tentativi nella stessa invocazione (`Retry-After`, jitter 5–30 s, conteggio su `ai_generation_items.attempts`), un job per posto libero, lease di 150 s con `AbortController` a 120 s (motivato rispetto a `maxDuration`), tabella del caso peggiore con un 429 e con `after()` morto; dichiarato il limite con due guasti |
| 4. Tetto globale | `claim_ai_jobs` prende `least(p_limit, cap − lease vivi)` con lock consultivo; il tetto sta in `app_config.ai_settings.max_concurrency` |
| 5. Allarmi di Fase 1 | Fallimento previsto = elemento `failed` più `complete_job`, anche in `cancel_ai_jobs`; dead letter solo per lease esaurito (citati `fase1_drive.sql:1219` e `health.ts:26`); AC12 e check 14 aggiornati |
| 6. Cadenza di `cron-loop` | Route in parallelo e allineamento all'orologio, cadenza per route (S6, unit `nextTick`); file tra quelli di Fase 1 toccati |
| 7. `ai_runs` prima della chiamata | `begin_ai_run` crea la riga `started`; `record_ai_attempt` la aggiorna (vince chi scrive per primo); `lost` per i lease scaduti; `cost_status`; costi completati solo con `openrouter_id`, tramite le RPC `ai_cost_candidates` e `set_ai_run_cost`; `ai_health` ignora `unavailable` |
| 8. Batch | `p_batch_id` solo per batch `origin = 'ideas'`; nuova colonna `batches.period` con backfill e check |
| 9. Ambiente di sviluppo e anteprime | Variabili Preview del branch verso il sandbox; verifica del ref in `fase2-dev.sh`; elenco delle variabili sovrascritte; limite dei progetti Free, SMTP Resend; ripieghi DB2 e DB3; prova `after()` su anteprima ripetuta dopo Vercel Pro; tolto il ripiego `fetch` lanciato senza attenderne la risposta (ora cron ogni minuto) |
| 10. Finestra di promozione | (Tempi superati dal consenso: promozione al più una settimana prima della produzione.) Promozione al primo giorno di S8, congelamento delle migrazioni di Fase 1 fino alla produzione, `promote --check` la mattina con nuova rinomina e contabilità sullo staging; `supabase/rollback/fase2a_restore_fase1.sql` provato in `upgrade.sh` |
| 11. `start_writing` | `drop` esplicito di `public.start_writing(uuid,integer)`; `p_models default null` anche nella privata (`06_tasks.sql:300`, `08_approvals.sql:21`); ogni file della Fase 2 finisce con la revoca su `private` |
| 12. Applica e ripristina | `select … for update` sul reel prima del controllo di `bozza` |
| 13. `run.sh` e `upgrade.sh` | Tolto il contract di `voice_briefs` (opzione dell'Architect): niente contract della Fase 2; `upgrade.sh` prova invece ripristino → ritorno in avanti delle funzioni riscritte |
| 14. Tempo del drain | Nuove chiamate solo fino a 150 s; la coda (costi ≤ 10 s, `drainOutbox` 8 s) sta nei 30 s riservati |
| 15. Chiavi OpenRouter | Due chiavi (sviluppo e anteprime; produzione) nei default, nei prerequisiti e in Q8 |
| 16. Privacy | Oscurati i nomi completi di tutti i profili, disattivati compresi; conteggio in `ai_runs.redactions` mostrato sull'alternativa; nomi di battesimo come avviso nell'editor della bibbia; solo codici classificati in `last_error_code`, nei log e in Sentry |
| 17. ADR | Deviazioni da `brain-plan.md:100` (AI SDK) e `:47,98` (Inngest) registrate |
| 18. Preselezione | Bibbia senza predefiniti → primi 3 del catalogo; batch `import` → nessuna preselezione |
| 19. Uscita dello spike | Tutti e 3 i modelli predefiniti devono passare, con riserve nominate e soglia di qualità alla cieca (media ≥ 3,5, almeno il 60% usabili come base) |
| 20. Incoerenze | `ai_generation_items.created_at` aggiunta; `AI_KICK_DISABLED` e `AI_FAKE_429_ONCE` dichiarate per F2-E5; elenco dei file TS di Fase 1 toccati in §5 |
| 21. Segnale di qualità | Il cancello della rampa usa la provenienza (≥ 50% di basi dall'AI, modifiche manuali riportate); aggiunto il pre-mortem 4 su adozione e qualità; `provenance` nelle metriche |

---

## Changelog consenso (iter2)

Revisioni: `.omc/plans/fase2-script-lab.iter2.architect-review.md` (APPROVE WITH CHANGES) e `.omc/plans/fase2-script-lab.iter2.critic-review.md` (APPROVE).

| Voce | Cosa è cambiato |
|---|---|
| 1. Stato e changelog | Intestazione "consenso raggiunto — pending approval dell'utente"; questa sezione |
| Calendario e congelamento (Architect 1 + Critic 7) | Collaudo completo sull'anteprima del branch collegata al sandbox (impegno 15–18 dicembre, ambizioso 4–7 dicembre). Promozione e staging al più una settimana prima della produzione: impegno lunedì 4 gennaio per l'11; ambizioso lunedì 7 dicembre per il 14. Congelamento delle migrazioni di Fase 1 ≤ 1 settimana (D-A, §8, §9, rischi). Tolta da Q3 l'opzione di venerdì (`fase1-plan.md:908`). 0,5 g del margine del 7–11 dicembre per l'avvio in ritardo di S0. Totali corretti: S0–S7 20,5 g + e2e sul sandbox 1 + S8 3 (ripartito) = 24,5 + 1 di stabilizzazione; nota sulla finestra del 14–16 ottobre spesa per le revisioni. Probabilità: 14 dicembre ~20%, 21 dicembre ~40%, 11 gennaio ~75% |
| AC10 con lanci contemporanei (Architect 2) | Cron `ai-drain` ogni minuto di default (esecuzioni a vuoto immediate, sicure sotto il tetto). Tabella del caso peggiore per 1, 2 e 3 lanci, con `after()` morto e un 429. AC10 dichiarato per numero di lanci (1–2 con un guasto, 3 senza). Riga `ai_backlog` (arretrato per lancio) in `ai_health`. `cron-loop` in parallelo, allineato all'orologio, con `ai-drain` ogni minuto. F2-E5 e AC10 aggiornati |
| `save_reel_script` `SECURITY INVOKER` (Architect, sintesi) | D-E, S4: `update … where id and script_rev returning id` con la fonte impostata; RLS e `reels_script_lock` restano in vigore. Anche `apply_script_version` e `restore_script_version` sono INVOKER, con il controllo in più fatto con gli helper pubblici (nessun definer serve). Il trigger delle versioni resta DEFINER. Check `prosecdef = false` |
| `p_source` in elenco chiuso (Architect 7) | Solo `manuale` e `resync`; `resync` solo per gli admin |
| Risultati tardivi (Architect 3) | `record_ai_attempt` riporta `lost → ok/error` se il `run_id` coincide (S6, AC14, check 14) |
| `claim_jobs` riscritta (Architect 4) | Esclude `ai_generate` anche dall'update del dead letter con `attempts >= 6` (`fase1_outbox.sql:31-35`) |
| Rieseguire `031` (Architect 5 + Critic 2) | Guardia con md5 di Fase 1 o di Fase 2; per `start_writing` si salta se c'è già la firma a 4 argomenti; seconda esecuzione provata in `upgrade.sh` e nel check 14 |
| Ordine del rollback (Architect 6 + Critic 8) | Passo 0 `ai_enabled = false`, passo 1 `cancel_ai_jobs()`, solo dopo il ripristino dei corpi di Fase 1 (D-A, §6, `upgrade.sh`) |
| Badge degli oscuramenti (Critic 3) | `redactions` copiato su `ai_generation_items`, visibile a chi scrive |
| Nomi di battesimo (Critic 4) | Oscurati nella nota di rimando e nello spunto; nei campi creativi della bibbia solo un avviso; sentinella in `prompt.test.ts` e AC15 |
| `begin_ai_run` (Critic 5) | Solo un elemento `queued` diventa `skipped`; un elemento chiuso completa soltanto il job |
| Deviazione da AC8 (Critic 6) | Nuova Q9 (batch `import` senza preselezione), con il motivo; default invariato |
| `batches.period` (Critic 9) | Regola delle metriche `coalesce(period, mese del codice del primo reel)`; `createBatch` non cambia, per non ereditare il difetto dell'anno e non toccare un altro file di Fase 1 (§3, S3, S7, AC22–25) |
