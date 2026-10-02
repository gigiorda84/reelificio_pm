# Fase 1 — decisioni e domande aperte

> Copia versionata di `.omc/plans/open-questions.md`. Registro delle decisioni per il piano [`docs/fase1-plan.md`](fase1-plan.md), approvato il 2026-10-02 con tutti i default.

## Fase 1 Produzione 2.0 (`docs/fase1-plan.md`) - 2026-10-01

**2026-10-01: l'utente ha accettato tutti i default.** Le voci sotto sono confermate così come scritte nel piano. Restano aperte solo quelle che richiedono un dato o un'azione esterna (sezione "Ancora da fare").

### Ancora da fare (servono un dato o un'azione, non una decisione)

- [ ] **Nome del delegato di Gabri** — serve prima di S3 per approvazioni e assenze. Non ha default.
- [x] (fatto, verificato 2026-10-02 via API con lo service account: Shared Drive "Reelificio Produzione" e "Reelificio Staging" visibili, `domainUsersOnly`/`driveMembersOnly`/`copyRequiresWriterPermission` = false, download consentito ai lettori, service account con `canManageMembers` = Gestore; la condivisione verso una Gmail esterna resta da provare nello spike S0) **Admin Workspace (prima dello spike S0):** consentire la condivisione esterna sugli Shared Drive, la condivisione di cartelle con non membri e il download per i lettori; creare gli Shared Drive "Reelificio Produzione" e "Reelificio Staging" con lo service account come Gestore. È il cancello per S5 (Drive, R2).
- [ ] **SMTP sullo staging:** la produzione ha già Resend come SMTP (`smtp.resend.com:465`, mittente `noreply@alphatechnology.ai`, limite 30 email/ora, verificato 2026-10-01). Lo staging non ha SMTP personalizzato (limite 2 email/ora): configurarlo dal dashboard Supabase con la stessa chiave Resend prima di S0.
- [ ] **Acquisti prima di R1:** Vercel Pro (uso commerciale, cron ogni 5 minuti) e Supabase Pro (backup giornalieri). Il budget è approvato; l'attivazione la fa l'utente.
- [ ] **Prima di S3:** per ogni pagina titolare e riserva di doppiatore e animatore, eventuale validatore e flag di validazione.
- [ ] **Prima di R2:** email Google di ogni esterno (`drive_email`).

### Confermate (default accettati il 2026-10-01)

- [x] (fatto 2026-10-01, `disable_signup: true`) Disattivare "Allow new users to sign up" sul progetto Supabase di produzione.
- [x] ~~Rilascio in due tempi (R1 solo interni ~13/11, R2 esterni + Drive ~27/11) oppure unico~~ — superata dall'iter2 (D7), vedi "Rilasci" sotto.
- [x] Reel importati in `idea` con "Avvia stesura" manuale.
- [x] SLA Batch che saltano sabato e domenica, festività italiane escluse in Fase 1 (follow-up); escalation Express anche di notte.
- [x] Rimando dall'approvazione finale: all'animatore, con "Rimanda al doppiaggio" solo dall'app.
- [x] Nota nei rimandi facoltativa; da Telegram solo tramite link all'app (niente `force_reply`).
- [x] Visibilità degli esterni dopo una consegna: 7 giorni.
- [x] Stand-up ogni giorno alle 08:30; nel weekend solo con Express o ritardi.
- [x] Validatore senza riserva: l'admin riassegna.
- [x] Ordine dei tagli se il calendario slitta: `archivio/` → U3 al posto di U1 → "Apri in Drive" al posto dell'audio servito; data di riserva 4 dicembre (stima iter2: 35 giorni + 10 di riserva; **iter3: ~37 giorni**, chiusura 24 novembre, riserva 4 dicembre).
- [x] Budget per Vercel Pro e Supabase Pro prima di R1 (attivazione in "Ancora da fare").
- [x] Conservazione dei video: nessuna politica in Fase 1; upgrade a Business Standard pianificato intorno a 5–10 pagine (30 GB per utente in pool), con soglia di spazio nel controllo di salute.

#### Iter2

- [x] **Rilasci:** R1 lunedì 9 novembre con stati, compiti, viste, Telegram, sweep, stand-up e account esterni (consegne con link); R2 solo Drive (D7). *La data di R2 (giovedì 19 novembre) è superata dall'iter3: vedi "R2 lunedì 23 novembre" sotto.*
- [x] **Approva-ciò-che-hai-visto:** blocco dello script da `revisione` (per correggere si rimanda in `bozza`) e revisione `script_rev` nei pulsanti Telegram e nell'app (`stale` se il testo è cambiato).
- [x] **Re-sync del batch:** i reel da `revisione` in poi non vengono più sovrascritti ma elencati come conflitti "in produzione" (piccola modifica a `src/lib/batches/actions.ts`).
- [x] **Thread dei commenti visibile agli esterni**, con la casella "Nota interna" (`internal_only`) per gli interni e avviso al team al rilascio.
- [x] **Supabase Pro prima di R1.**
- [x] **Scheduler: cron Vercel Pro invece di Inngest** per sweep (ogni 5 min) e stand-up; Inngest rinviato alla Fase 2.
- [x] **Editor degli override SLA per pagina:** resta nel piano, non si taglia.
- [x] **Notifiche notturne:** le notifiche Batch tra 20:00 e 08:00 partono silenziose (`disable_notification`); Express sempre con suono.
- [x] **Telegram primario, email di riserva** per le notifiche dei compiti; le preferenze salvate per `assignment`, `phase_approval_request`, `phase_rejected` vengono azzerate ai nuovi default.
- [x] **Tagli a impatto zero sugli AC:** kanban per stato, scheda Attività, pulizia dei pulsanti Telegram superati, `/compiti/[id]`, selezione multipla in "Avvia stesura", card Salute sistema, assenza in autoservizio, comando `/chatid`.
- [x] **SMTP personalizzato:** Resend su entrambi i progetti prima di S0. Produzione già a posto; staging in "Ancora da fare".
- [x] **`supabase db push` e transazioni** — verificato nel sorgente della CLI (`apps/cli-go/pkg/migration/file.go`, `ExecBatch`): ogni file, con il suo insert nella cronologia, è un unico batch in pipeline, quindi **atomico per file ma non per push**; `CREATE INDEX CONCURRENTLY`, `VACUUM`, `ALTER SYSTEM`, `CLUSTER` girano fuori dal batch. Resta un controllo di 5 minuti sullo staging con la CLI 2.54.11 in S1.

### Iter3 — nuove decisioni (2026-10-02, ognuna con un default — **default accettati dall'utente il 2026-10-02 insieme all'approvazione del piano**)

- [x] **Tagli di R1** — `/collaboratori` → `scripts/fase1-collaborators.ts`; diff parola per parola delle proposte → testo affiancato; offboarding in UI → `fase1-collaborators.ts offboard`. **Default: applicati da subito** (il calendario iter3 li sconta; le tre UI tornano in S6 se resta tempo, altrimenti Fase 2). Perché conta: senza, R1 il 9 novembre non è raggiungibile con il lavoro di sicurezza aggiunto in iter3. L'editor SLA resta (decisione del 2026-10-01).
- [x] **Checkpoint venerdì 23 ottobre** — se la parte SQL di S2 (`06_tasks.sql`, `08_approvals.sql`, `upgrade.sh` fino alla riconciliazione) non è verde e spinta sullo staging, piano B. **Default: piano B = R1 lunedì 16 novembre, R2 lunedì 30 novembre, chiusura 1° dicembre**, riserva 4 dicembre invariata. Perché conta: decide la data in anticipo invece di slittare giorno per giorno.
- [x] **R2 lunedì 23 novembre** (era giovedì 19) — il passaggio R1 → R2 aggiunge ~1 giorno a S5 e si evita il rilascio di venerdì. **Default: 23 novembre.** Alternativa: 19 novembre applicando subito il taglio `archivio/` di R2.
- [x] **Rampa degli esterni** — nelle prime 48 h dopo R1 esterni titolari su una sola pagina, poi su tutte. **Default: sì; pagina = quella con più reel attivi da `confermato` in poi nel report del passo 0a (a parità, Porcino & Papaya).** Perché conta: limita l'impatto di un errore di accesso ai primi giorni.
- [x] **Deploy anticipato `fase1-pre-r1`** (filtro dei destinatari su `main`, nessuna migrazione) entro il 16 ottobre come bersaglio del rollback. **Default: sì**, con OK al deploy come per ogni azione in produzione.
- [x] **Congelamento degli account in produzione dal dump 0a al passo 4 di R1** (5–9 novembre). **Default: sì**; un collaboratore urgente si aggiunge dopo il passo 6b.
- [ ] **Allowlist interna** `supabase/backups/fase1/internal-emails.txt` (email di tutti gli interni, rivista dall'utente) e **`collaborators.csv`** (email, nome, tipo, `drive_email`). Servono prima della prova del 5 novembre. Nessun default: è un dato.
- [x] **Migrati in `validazione`** — approvati vanno in `bozza` con un compito di stesura (nel flusso vecchio la validazione precedeva la stesura). **Default: sì** (il dump del 2026-10-01 ne ha 0 o quasi).
- [x] **Toolchain** — `postgresql@16` (installato) per l'iterazione, `postgresql@17` da installare (~100 MB) per prova su dump, confronto di schema e giro pre-rilascio. **Default: sì.**
- [x] **Commenti `internal_only`** — un interno può cambiare il flag sui propri commenti, un esterno no. **Default: sì.**

### Dopo il consenso (2026-10-02) — default accettati con l'approvazione del piano

- [x] **Come comunicare le date al team** — l'Architect consiglia di presentare **R1 il 16 novembre come impegno** e il 9 novembre come obiettivo ambizioso, perché il piano stesso dà al 9 novembre ~30% di probabilità. **Default: sì.**
- [x] **Secondo checkpoint martedì 3 novembre** — la parte R1 dello scenario E1 è verde sullo staging, altrimenti si passa al piano B. **Default: sì.**
- [x] **Nuovo dump di produzione in S1** (sola lettura, formato nuovo con `schema-public.sql` e `migrations.txt`) per costruire la base del confronto di schema. Il dump del 2026-10-01 non basta. **Default: sì**, con OK al momento come per ogni accesso alla produzione.
