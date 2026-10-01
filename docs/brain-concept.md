# Reellificio Brain — sintesi del concept

Fonte: Claude Doc "Reellificio Brain — concept dell'app" (25/09/2026, sezioni aggiornate al 27/09/2026), https://claude.ai/artifact/4PfzK9tY8fY3pVxWbDdLFp. Il doc vive in un'altra organizzazione ed è leggibile solo dal browser del team: questa è una sintesi fedele per le sessioni di sviluppo. In caso di dubbio vale il doc originale. Le decisioni prese dopo (2026-10-01) sono in `docs/brain-plan.md`.

## Visione

Un'unica app che porta un reel dall'idea alla pubblicazione, sapendo cosa funziona e cosa sta succedendo oggi. Unisce tre cose oggi separate: motore di scraping, scrittura degli script, gestione della pipeline di produzione.

- **Obiettivo misurabile:** per le pagine di attualità (politica, sport…) da notizia a reel pubblicato in **meno di 24 ore**; per le evergreen (Porcino & Papaya, psicologia relazionale, Mixtory) batch mensili senza colli di bottiglia.
- **Quattro domande quotidiane:** di cosa parliamo (scraping + news) · come lo scriviamo (script su pattern virali, nel tono della pagina) · chi lo fa e quando (stato, owner, scadenza) · ha funzionato (i numeri tornano nel cervello). L'ultima rende l'app un *brain* e non un gestionale.

## Moduli

Ogni pagina tematica è un **workspace** con la sua bibbia (tono, personaggi, regole, competitor, fonti news). Flusso: Intelligence + Attualità → Brain (dati + pattern) → Character Lab → Script Lab → Produzione → Pubblicazione → Analytics → di nuovo Brain.

| Modulo | Cosa fa | Owner (RACI) | Esisteva |
|---|---|---|---|
| Intelligence | Scraping profili, metriche, trascrizioni, ricerca per tema | Gabri / Giuse | Sì, da estendere (servizio esterno) |
| Attualità | Monitor news e trend, alert su notizie "reellabili" | Giuse | No |
| Character Lab | Crea personaggi: schede, prove grafiche AI, test, kit | Teo/Nam, Matteo, Gabri | No |
| Script Lab | Idee, hook, script, versioni, bibbia pagina | Teo | No |
| Produzione | Stati, assegnazioni, testo confermato, file audio/video | Gabri (PM) | Questa app (Reelificio PM) |
| Pubblicazione | Calendario, caption, post automatico | SMM | No |
| Analytics | Metriche pagine proprie e competitor, report | Nam / Gabri | Parziale (scraping) |

## Intelligence — scraping per tematiche

Base: il motore attuale (profili IG/TikTok → like, follower, share, commenti → trascrizione). Livelli aggiunti:

1. **Ricerca per tema** (lista temi per workspace; hashtag, keyword in caption e trascrizioni, account correlati → i 50 reel più performanti sul tema negli ultimi 30/90 giorni) e **per creator** (lista per workspace; una volta al mese nuovi video con analytics pubbliche, trascrizione, caption, commenti, outlier score → storico per creator).
2. **Outlier score** = performance del reel / media dell'account (3x = il triplo del solito).
3. **Analisi AI della trascrizione:** hook (tipo: domanda, provocazione, dato shock, "POV"), struttura (setup → twist → payoff, durata, ritmo), tema/sotto-tema/tono/CTA, perché ha funzionato → **libreria di pattern** interrogabile ("hook a domanda sul tema gelosia con outlier > 3").
4. **Commenti: testo completo e sentiment.** Pagine nostre, competitor e, per la politica, profili di politici, partiti, testate e pagine satiriche. Primi 300–500 per post, a 24h e 72h. Claude classifica ogni commento: sentiment (positivo, negativo, neutro, **ironico**), emozione, bersaglio, tipo (domanda, richiesta, battuta, insulto, spam/bot), tema reale. Valutazione per post e per gruppo (tema, format, personaggio, creator, periodo) con 2–3 indicazioni pratiche per lo Script Lab.
   - Viste: termometro dei politici, cosa fa arrabbiare la gente, battute del pubblico, com'è arrivato il nostro reel (allarme shitstorm su soglia), allarme bot.
   - Limite: i commenti non sono un sondaggio. Privacy: username pseudonimizzato, nessun profilo individuale, dopo ~12 mesi solo aggregati; da verificare in sede legale.
- Viste principali: Esplora tema · Scheda reel · Libreria hook · Watchlist competitor · Termometro sentiment.
- Frequenza: competitor e temi ogni notte; trend emergenti ogni 6 ore per le pagine di attualità.

## Attualità — news in tempo reale

Segnala ogni giorno le 5–10 notizie più reellabili per pagina e le trasforma in brief per lo Script Lab. Generico: ogni workspace sceglie fonti e palinsesto (politica, sport, gossip, tech).

- Fonti: agenzie (ANSA, Adnkronos, AGI), giornali (Corriere, Repubblica, Il Post, Fatto, Sole 24 Ore, Gazzetta), trend (Google Trends IT, TikTok/IG, X, commenti sotto i post dei politici).
- **Licenze:** i feed RSS ANSA sono solo per uso non commerciale → serve un accordo o un aggregatore con licenza. Da decidere prima di sviluppare.
- Funzionamento: articoli raggruppati in **storie** → **punteggio di reellabilità** (velocità, conflitto/emozione, personaggi riconoscibili, spazio per satira, coerenza con la pagina) → **news brief** (fatti in 5 righe, fonti linkate, posizioni, 3 angoli) → alert Telegram per le storie calde, chi è di turno decide in 15 minuti.
- Palinsesto prevedibile: calendario di eventi noti (sedute, dibattiti TV, partite, festival).

## Character Lab — creare personaggi

Flusso: engine suggerisce concept → scheda scritta → prove grafiche AI (più motori) → scelta + rifinitura del designer → test (script pilota + reel di prova) → Gabri approva (o rivedi) → kit personaggio al montaggio.

1. **Engine che suggerisce personaggi — da mettere in un secondo momento.** Parte dai dati del Brain: buchi nel cast, pubblici non raggiunti, archetipi con outlier alto nei competitor (da reinventare, mai copiare), richieste nei commenti. Ogni suggerimento: nome provvisorio, cosa personifica, tema che sblocca, perché funzionerebbe, rischio di somiglianza.
2. **Scheda personaggio** (entra nella bibbia della pagina): Chi è · Carattere (3 tratti, un difetto, cosa vuole) · Voce (registro, tic, tormentoni, parole che non direbbe mai) · Relazioni · Temi · Look (testo) · Casting voce (doppiatore titolare e riserva) · Limiti (stereotipi da evitare, linee rosse). Claude compila la prima versione, Teo e Gabri la rifiniscono.
3. **Prove grafiche AI** su più motori, risultati affiancati: stile della pagina bloccato; pacchetto di prova (fronte, profilo, retro; 6–8 espressioni; accanto ai personaggi esistenti); l'immagine scelta diventa il riferimento.
4. **Test prima di investire:** 2–3 script pilota e un reel semplice come Reel di prova.
5. **Consegna:** kit personaggio su Drive (model sheet, espressioni, palette, scheda, riferimenti di movimento, campioni di voce) → libreria asset, compare nei kit di montaggio.

Attenzioni: rappresentazione (ridere *con* le persone, rilettura da membri delle community), regole delle piattaforme (contenuti adulti solo allusivi), diritti (design definitivo rifinito da un designer umano; controllo somiglianza). Ruoli: Teo e Nam propongono, Matteo (AD) guida lo stile, Gabri approva l'ingresso nel cast.

## Script Lab

AI scrive la prima bozza, gli umani fanno la differenza.

- **Ingredienti:** bibbia della pagina (personaggi, tono, parole vietate, durata 30–45s o 60–90s, CTA ammesse, script approvati) · pattern provati (outlier alto sul tema) · materia prima (tema evergreen, reel competitor da *trasformare*, news brief).
- **Output per idea:** 5 hook alternativi · 2–3 versioni complete · note di regia per l'animazione · caption e hashtag · **punteggio di viralità previsto** con motivazione.
- **Funzioni:** editor con versioni e commenti per riga · "riscrivi più corto / più cattivo / più scientifico" sulle battute · controllo automatico (durata stimata, parole vietate, CTA o formule ripetute negli ultimi 20 reel) · per l'attualità fact-check di ogni affermazione contro le fonti del brief.
- **Multi-motore:** selettore (Claude, ChatGPT, Gemini, altri aggiungibili), stesso prompt per tutti, vista confronto, scelta e mix (hook da un motore, corpo da un altro), editing tracciato, "Conferma e manda in revisione" (blocca la versione, stato Revisione, avviso Telegram all'approvatore). Si registra motore, versioni scartate e modifiche umane → dopo qualche mese motore predefinito per pagina. Un unico livello di collegamento ai motori, costi tracciati per motore.
- **Regola d'oro:** nessuno script passa in produzione senza approvazione umana.

## Produzione — workflow, ruoli, pipeline 24h

Pipeline: Idea → Bozza ⇄ Revisione → Confermato → **Doppiaggio ∥ Animazione** → Montaggio → Approvazione finale → Programmato → Pubblicato. Il trigger parallelo dal testo confermato salva 2–3 giorni sui batch e rende possibili le 24 ore.

| Ruolo | Vede | Fa nell'app |
|---|---|---|
| Script (Teo, team) | Idee, bozze, news brief | Scrive, versiona, manda in revisione |
| Art Director (Matteo) | Animazioni e montaggi in lavorazione | Note visive |
| Doppiatori (esterni) | Solo i propri testi | Adattamenti parola per parola, registra dall'app |
| Montaggio (Lorenzo, Daniele) | Testo confermato, audio, note regia | Scarica materiali, carica il video |
| SMM | Reel approvati | Caption finale, programma |
| Gabri (PM e approvazione) | Tutto + KPI | Approva script e reel, priorità, assegnazioni, KPI |

| | Binario Batch (evergreen) | Binario Express (attualità) |
|---|---|---|
| Tempo | Settimane, batch 10+10+5 | < 24 ore |
| Revisione | Ciclo completo | Gabri o delegato, 30 min max |
| Doppiaggio | Doppiatore assegnato | Doppiatori di turno (voci sempre umane) |
| Animazione | Custom | Template e personaggi pre-animati |

Timeline Express: notizia → brief (1h) → script approvato (3h) → audio (6h) → animazione + montaggio (16h) → approvazione finale (18h) → pubblicazione (≤ 24h). Funziona solo con turni di reperibilità e una libreria di asset pronti.

Tempi massimi nel doc (Batch / Express): scrittura 2 giorni / 2h; approvazione script 24h / 30 min; approvazione finale 24h / 30 min; pubblicazione 24h / 1h. **Coda approvazioni** su una schermata, Express in cima, con cosa è cambiato, controlli superati, Approva / Rimanda con nota vocale; obiettivo < 2 minuti per reel. Delegato di riserva quando Gabri è assente. (Decisione successiva: approvatori per gruppo di pagine, vedi plan.)

Notifiche: ogni cambio di stato avvisa il prossimo owner su Telegram (topic giusto); semaforo rosso se una fase sfora la scadenza.

## Pubblicazione

Il doc propone Notion come calendario (DB "Calendario": pagina, piattaforme, data/ora, video Drive, caption, hashtag, copertina, stato Pronto/Programmato/Pubblicato/Errore, link al post, ID reel) e un worker ogni 5 minuti verso Instagram Graph API, TikTok Content Posting API, YouTube. Vincoli: IG via API solo con account Business/Creator collegati a una pagina Facebook e app Meta approvata; TikTok richiede un audit (prima i post restano privati). Scelta consigliata nel doc: partire con Notion → Make/Zapier → tool di scheduling (es. Metricool), portare la pubblicazione in casa quando le app sono approvate. (Il plan sposta il calendario dentro l'app: vedi `brain-plan.md`.)

## Analytics

Confronta ogni reel pubblicato con la previsione dello Script Lab e con i competitor.

| Livello | Domanda | Dati |
|---|---|---|
| Reel | Ha funzionato? Perché? | Views, retention, share, salvataggi, commenti, follower generati, outlier |
| Pagina | Stiamo crescendo? Cosa satura? | Crescita, media views per tema/format/personaggio/hook, frequenza |
| Mercato | Come andiamo vs competitor? | Stesse metriche sui competitor, temi che loro coprono e noi no |

Dati propri via API ufficiali (Instagram Insights, TikTok, YouTube). Ogni settimana Claude produce un report per pagina (cosa ha funzionato, 3 azioni) e aggiorna i pesi della libreria pattern. KPI del Reellificio: tempo medio per fase, reel in ritardo, tempo notizia → pubblicazione Express, script scartati vs approvati.

## Automazioni per il team

Obiettivo: nessuno chiede "a che punto siamo?" o "dove trovo il file?". Flusso: script confermato → bot assegna il doppiatore del personaggio → portale doppiatore → controllo audio AI → kit montaggio automatico → montatore carica il video → controllo e revisione.

- **Doppiatori:** voce fissa per personaggio (titolare + riserva; se il titolare non accetta entro un tempo, es. 2h sull'Express, passa alla riserva) · Accetto / Non posso dal bot Telegram · portale personale senza login complicato (testo, indicazioni, glossario pronunce, audio di riferimento; registrazione dal browser o upload) · adattamenti controllati (entro le regole passano, altrimenti al Team Script) · controllo audio automatico (trascrizione vs testo confermato, durata, silenzi, volume, distorsione; se non passa torna al doppiatore con la motivazione).
- **Kit e registrazione da remoto:** kit standard ~150 € a doppiatore (microfono USB-C dinamico cardioide, es. Shure MV6 o Audio-Technica ATR2100x-USB; cuffie chiuse; adattatore; guida di setup) in comodato d'uso con modulo firmato, tracciato nell'app. Registrazione dall'app (PWA, battuta per battuta, prova microfono, WAV) oppure con l'app del telefono e caricamento. Upload a pezzi, ripresa, offline. Poi in automatico: pulizia (rumore, normalizzazione, silenzi), controllo AI, salvataggio nell'app e nella cartella Drive del reel con nome standard (pagina_reel_personaggio_battuta_versione, grezzo e pulito), avviso al montatore. Drive tramite account di servizio di Sweet Life Faktory; ogni doppiatore vede solo le proprie cartelle.
- **Montatori:** kit montaggio automatico su Drive (audio, script, note di regia, asset personaggi, template pagina) · sottotitoli SRT · lip sync automatico (Adobe Character Animator, Rhubarb) · revisione su timecode in stile Frame.io (note al secondo, disegno sul fotogramma, nota vocale, confronto versioni, Approva / Rimanda) · controllo video automatico (9:16, durata, sottotitoli, volume, testi fuori dalle zone coperte dall'interfaccia).
- **PM:** stand-up automatico su Telegram ogni mattina · scadenze con escalation (owner, poi PM) · disponibilità e carico per persona · agente "producer" AI che propone azioni · compensi freelance a fine mese · onboarding automatico.

Priorità nel doc: fase 1 bot con pulsanti, kit montaggio, stand-up + escalation, assegnazione per personaggio; fase 2 controllo audio e sottotitoli; fase 3 lip sync e revisione su timecode; fase 4 agente producer, compensi, onboarding.

## Valutazione e debolezze (dal doc)

Forte sulla parte creativa, debole nei passaggi tra persone. Correzioni proposte: l'app come unica fonte (Telegram solo notifiche con pulsanti, Notion aggiornato in automatico) · kit automatici al posto dei passaggi di file · approvazione in un tap + filtro di Teo + delegato · disponibilità e carico · controlli automatici a ogni passaggio · MVP stretto (Produzione + Script Lab) per non avere troppi moduli per un solo dev.

## Evoluzioni

| Evoluzione | Impatto | Sforzo | Quando (doc) |
|---|---|---|---|
| Test degli hook con Reel di prova IG | Molto alto | Medio | Fase 4 |
| Commenti → idee (backlog con punteggio) | Alto | Basso | Fase 4 |
| Memoria personaggi e serialità (canone, archi, allarme saturazione) | Alto | Medio | Fase 4 |
| Sicurezza contenuti (esterni vedono solo l'assegnato, filigrana, revoca, backup) | Medio | Basso | Fase 1 |
| Un reel, tanti formati | Alto | Basso | Dopo il lancio |
| Previsione che impara | Alto | Medio | Dopo 3 mesi di dati |
| Riciclo evergreen | Medio | Basso | Dopo 6 mesi di archivio |
| Brand partnership (media kit, sponsor nello script, report) | Alto (ricavi) | Medio | Dopo il lancio |
| Altre lingue | Alto (crescita) | Alto | Quando le pagine italiane sono stabili |

## Stack e dati (proposta del doc)

Frontend React/Next.js · Supabase (ruoli, realtime) · pgvector · più motori AI (API dirette o OpenRouter) · trascrizione (motore esistente o Whisper) · worker + cron · bot Telegram sui topic esistenti · Notion API + API social · Google Drive. Entità: Pagina (workspace + bibbia), Tema, Account monitorato, Reel esterno, Commento (pseudonimizzato), Pattern, Storia news, Idea, Script (versioni), Reel produzione, Persona (ruolo), Post pubblicato (metriche). Costi AI stimati nel doc per 30 script/mese: 7–15 € con un motore, 20–45 € con tre.

## Rischi legali e operativi

| Rischio | Contromisura nell'app |
|---|---|
| Deepfake di politici reali (art. 612-quater c.p., L. 132/2025) | Mai clonare voce o volto di persone reali; solo personaggi inventati o caricature riconoscibili come satira |
| Diffamazione | Fact-check obbligatorio contro le fonti; virgolettati solo se verificati e linkati |
| Licenze news | Licenza o aggregatore autorizzato; solo fatti riformulati |
| Scraping social (ToS Meta/TikTok) | Account di scraping separati; API ufficiali per i dati propri |
| Etichetta AI (AI Act, policy piattaforme) | Flag "contenuto AI" in pubblicazione |
| Periodi elettorali (par condicio, AGCOM) | Calendario elettorale con avviso automatico |
| Burnout sul binario Express | Finestra di copertura (es. 8–22) e rotazione della reperibilità |

**Checklist bloccante Express:** non si passa a "Programmato" senza fonti linkate, fact-check completato e ok di Gabri (o delegato).

## Pagina politica: GLI UMANI (aggiornato 27/09/2026)

Nasce anonima dentro il Reellificio, tutta in animazione. Obiettivo: diventare molto virale, poi collaborazioni di comunicazione dichiarate con un partito, una coalizione o un'area. Spazio libero sui temi del lavoro e del tempo; calendario 2027 (politiche e comunali, tra cui Torino e Milano); vantaggio produttivo del binario Express.

- **Format:** serie animata vista con gli occhi di Rob, un'AI che deve capire come funzionano gli umani. Programmi: ROB, La Riunione degli Umani, Se lo inventassimo oggi, Benvenuti nel 2026, Assurdo ma vero; solo *Gli umani che comandano* è direttamente politico e parte sempre da una notizia reale. Satira trasversale sui politici veri in caricatura evidente; video generato con AI, **voci sempre umane**, etichetta "contenuto AI" sempre attiva.
- **Workspace dedicato:** fonti di attualità, competitor (pagine satiriche, pagine dei partiti, creator politici), bibbia con tono, valori e linee rosse.
- **Percorso:** crescita indipendente → reveal del Reellificio → collaborazioni dichiarate.
- **Regole:** reveal prima di qualunque contenuto pagato (regolamento UE sulla pubblicità politica); solo crescita organica (Meta e Google non accettano pubblicità politica nell'UE da ottobre 2025); passaggio con un avvocato prima del lancio; par condicio nei periodi elettorali. Un'eventuale app community richiede consenso esplicito (le opinioni politiche sono dati particolari GDPR).

## Roadmap e decisioni aperte (dal doc)

| Fase | Contenuto | Durata |
|---|---|---|
| 1 — Fondamenta | Database, login e ruoli, Produzione, bot Telegram con pulsanti, assegnazione per personaggio, kit montaggio su Drive, stand-up, import scraping | 4–6 sett. |
| 2 — Script Lab | Bibbie, Character Lab base, analisi trascrizioni, libreria pattern, generazione script | 4 sett. |
| 3 — Attualità + Express | Monitor news, brief, binario 24h, fact-check, pubblicazione | 4–6 sett. |
| 4 — Analytics | API social proprie, report, ciclo di apprendimento, test hook, analisi commenti, memoria personaggi | 3–4 sett. |

Decisioni aperte nel doc: chi sviluppa · licenza news · avvocato e cast di GLI UMANI · voci AI sulle altre pagine · finestra di copertura e turni Express · pubblicazione con tool di scheduling o API proprie · altre pagine di attualità · owner della ricerca e delegato per le approvazioni.
