Mudi Dokan App — Plan
Nov 13, 2026 · @Md Iqbal Hossain
Lokkho
Dokandar ba karmochari, jara type korte pare na ba korte chay na, tader jonno ekta app. Mul input hobe voice, ar mul output hobe boro icon + bole shonano (TTS).
Prototype check: Bangla voice command theke maal, poriman, dam, naam alada kora jay. "করিম চাল এক কেজি বাকিতে নিল", "এক হাজার পাঁচশ টাকা জমা", "দুইটা সাবান" — sob thik moto parse hoyeche.
Decisions
• Platform: shudhu Android.
• Phone: ekadhik phone; eki dokaner data sob phone e sync hobe.
• Dam: kena dam ar becha dam dutoi rakha hobe, jate lav hisab kora jay.
• Voice reference: prottek command er audio save hobe, pore shune vul thik korar jonno.
• Audio storage: dokaner Google Drive (15 GB free, card lagbe na). Shob phone e dokaner eki Google account login thakbe.
• Data storage: sob text data (maal, bikri, kena, baki/joma, voice_logs) Firebase Firestore e; audio file Google Drive e.
• Audio retention: 30 din. Protidin app khulle 30 din er purono audio Drive ar phone theke delete hobe; voice_logs er row thakbe (transcript soho), shudhu audio 'expired' mark hobe.
• Input: voice main, kintu user chaile type kore-o input dite parbe.
Main features (MVP)
1.  📦 Maal (inventory): "নতুন চাল ৫০ কেজি কেনা ৫৫ বেচা ৬০" bolle maal jog hobe kena ar becha dam soho. Maal age theke thakle stock barbe; kena dam bodlale average kena dam hisab hobe.
2.  🛒 Bikri: "চাল ২ কেজি" bolle stock kombe ar ajker bikri te jog hobe. "১০০ টাকার চিনি" bolleo hobe, app nije poriman hisab korbe. Ek command e onek maal (basket): "করিম বাকিতে নিয়েছে দুই কেজি চাল ২০০ টাকা ৩ কেজি চাল ৪০০ টাকা ৫ কেজি তেল ৬০০ টাকা" — customer ar নগদ/বাকি puro basket er; eki maal dui bar thakle alada line. Dam: "২০০ টাকা করে", "কেজি ২০০", "প্রতি কেজি ২০০", "২০০ টাকা কেজি" = per unit (mot = poriman × dam); shudhu "২০০ টাকা" = oi line er mot.
3.  📒 Baki khata: "করিম ২০০ টাকা বাকি" ba "করিম ১০০ জমা" diye hisab rakha jabe. "করিম চাল ১ কেজি বাকিতে নিল" bolle eki sathe bikri ar baki dutoi hobe.
4.  Stock jana: "চাল কত আছে?" jiggesh korle app bole debe koto ache ar dam koto.
5.  💰 Lav hisab: prottek bikri te sei somoyer kena dam save hobe. "আজ লাভ কত?" (ba "এই মাসে লাভ কত") er uttor e 4 ta jinish bolbe, ei kromey:
    – বিক্রি (sales) = shob bikri (nogod + baki) er mot dam.
    – মোট লাভ (gross profit) = বিক্রি − bikri kora maal er kena dam (prottek sale e save kora sei somoyer kena dam × poriman).
    – খরচ (expenses) = oi somoyer shob expense entry (feature 7).
    – আসল লাভ (net profit) = মোট লাভ − খরচ.
    Malik/poribar er nea taka (owner_withdrawal, feature 10) lav e dhora hobe na — eta khoroch na. Maal kena (purchase) o khoroch na; sheta bikri hole kena dam hishebe ashe.
    TTS: "আজ বিক্রি ৪,৮৫০ টাকা। মোট লাভ ৯২০। খরচ ৫৭০। আসল লাভ ৩৫০ টাকা।"
6.  🎧 Voice reference: prottek voice command er audio save hobe, tar transcript ar je entry hoyeche tar sathe link kore. Itihas list e prottek entry te ▶️ button thakbe: shune naam, poriman ba dam er vul thik kora jabe. Thik korle original entry muchbe na; ekta correction entry hobe, ager ar porer dui hisab-i dekha jabe.
7.  🧾 Khoroch (expense): "বিদ্যুৎ বিল ৫০০ টাকা খরচ", "চা নাস্তা ৫০ খরচ", "ভাড়া দিলাম ২০০০" bolle khoroch entry hobe (ki, koto taka). Cash screen er "খরচ বলুন" button e "খরচ" shobdo chara-o hobe. Khoroch cash theke kome ar net profit theke bad jay (feature 5).
8.  🏁 Opening cash: prothombar chalu korar somoy (Setup) "এখন ক্যাশে কত টাকা?" — bole, type kore ba note gune deoa jabe. Etai prothom diner গতকালের ক্যাশ.
9.  💵 Din sheshe cash milano (Cash + CashCount screen): হাতে থাকার কথা = গতকালের ক্যাশ + নগদ বিক্রি + বাকি জমা − খরচ − nogod kena − মালিক নিল. "গুনে মিলান" e note (১০০০…১০) gune "গুনে পেলাম" er sathe milabe, kom/beshi dekhabe. "দিন শেষ করুন" = din bondho, gune paoa taka porer diner opening cash.
10. 👤 Malik/poribar er taka nea (owner_withdrawal): "মালিক ৫০০ নিল", "আব্বু ১০০০ নিল বাসার জন্য". Ke nilo (person), koto, keno (note).
    First-person ("৩০০ টাকা নিলাম", "৫০০ তুললাম", naam chara) phone er role dekhe: role owner → owner_withdrawal, person = device_name; role staff ba role set na thakle → expense, item "অগ্রিম বেতন", person = device_name (lav theke bad jabe). Naam bolle ("মালিক ৫০০ নিল") role jai hok owner_withdrawal. Hate thakar kotha cash theke kome, kintu khoroch na, tai lav hisab e ashe na.
Jara porte pare na, tader jonno UX
• Screen er majhe ekta boro 🎤 button, niche 3 ta icon tab.
• Prottek command er por app bole shonabe, jemon "চাল ২ কেজি, ১২০ টাকা। ঠিক আছে?" Tarpor boro ✅/❌ button chapa jabe, ba mukhe "হ্যাঁ"/"না" bola jabe.
• Je kono maal ba customer er upor tap korle app sheta bole shonabe.
• Je tab khola thakbe, command sei kaj hishebe dhora hobe. Tai Bikri tab e shudhu "চাল ২ কেজি" bolle-i hobe.
• Mic er pashe ekta text box: type kora command ("চাল ২ কেজি") voice er moto eki parser ar eki confirm card diye jabe. Bangla ba English digit dutoi chalbe.
• Confirm card er maal, poriman, dam, customer field tap kore edit kora jabe (number pad / product list theke beche newa). Voice ektu vul hole puro command abar bolte hobe na.
Tech
Kaj
Ki use hobe
App
React Native + Expo (dev build lagbe, Expo Go te cholbe na)
Voice → text
expo-speech-recognition, bn-BD (Android er Google recognizer)
Text → voice
expo-speech (Bangla voice)
Data
expo-sqlite, offline-first: phone e local copy, internet pele sync
Sync (multi-phone)
Firebase Firestore (offline cache soho) + dokaner Google account login; data event hishebe (kena, bikri, baki, joma) push/pull hobe
Audio save
expo-speech-recognition er recordingOptions.persist (Android 13+): recognizer nijei audio file save kore. File age phone e save hoy, internet pele Google Drive er "Dokan Audio" folder e upload hoy (Google Sign-In, drive.file scope). Drive fileId Firestore er voice_logs e save hoy; onno phone oi fileId diye download kore bajay. Upload fail hole retry queue.
Bujha (parsing)
Nijer rule-based Bangla parser: shongkha shobdo ("আড়াই", "পাঁচশ"), unit, keyword dhore
Table: products (naam, unit, becha dam; stock ar gor kena dam store hoy na — v_stock view e purchases − sales theke hisab), purchases (kena: poriman, kena dam), sales (poriman, becha dam, sei somoyer kena dam), customers (baki), ledger (baki/joma er itihas), expenses (khoroch: item, taka), owner_withdrawals (malik nilo: person, taka, note), day_close (din shesh: opening cash, thakar kotha, gune paoa, note count; setup er opening cash o ekhane). Prottek row e id (UUID), device_id, updated_at thakbe sync er jonno.
voice_logs (audio file, transcript, kon phone, somoy). Prottek entry (purchase, sale, ledger, expense, owner_withdrawal) e voice_log_id thakbe; correction entry corrects_id diye ager entry ke point korbe.
product_aliases (alias → product): STT eki maal alada banane likhte pare ("পেঁয়াজ"/"পিঁয়াজ"); audio shune naam thik korle vul banan ta automatic alias hoye jabe. ledger e party_type (customer/supplier) — supplier/মহাজন Phase 3, kintu column MVP schema tei thakbe jate pore migration na lage. Prottek entry te device_name (phone e ekbar set kora naam, jemon "Abbu", "Karmochari 1").
devices (device_id, device_name, role: owner | staff, updated_at): Setup step ২ e set hoy, settings theke bodlano jay. Parser pure thake: app parseCommand e ctx.deviceRole ar ctx.deviceName pathay (ownerNames er moto).
Phase (incremental build order)
Parser (Phase 1) done. Tarpor ek ek step e, prottek step er shesh e app phone e chole:
1.  Expo shell (dev build, TypeScript) + design token + bottom tab bar (বিক্রি / মাল / বাকি, placeholder screen) + SQLite schema with migrations (devices soho). App parser import kore.
2.  Listening → Confirm → sale save + pilot debug log (transcript, parse result, user thik korlo ki na). ← ekhan theke dokane test shuru (50–100 asol command; 80% er kom thik hole command design bodlano).
3.  Pick-by-picture fallback (Pick screen: chobi, number pad, type kora).
4.  Stock, Baki, Customer screen.
5.  Cash, CashCount, History (phone e save kora audio replay).
6.  Pilot log theke parser/command fix.
7.  Firestore sync + multi-phone.
8.  Drive audio upload, retry queue, 30 din por auto-delete.
MVP er baki (step gulor sathe/pore): voice e undo ("ভুল হয়েছে"/"বাতিল" bolle shesh entry correction diye ulte jabe), product naam alias, Setup screen (device_name + role, opening cash).
After MVP: supplier/mohajon er baki ("রহিম ট্রেডার্স থেকে ৫০ কেজি চাল বাকিতে কিনলাম"), "আজকের হিসাব" voice summary, protidin raat e Drive e backup (Excel/JSON), masher hisab bole shonano, kom stock alert.
Pore: barcode scan (ager POS kaj er sathe jora), customer ke SMS e baki mone koriye deoa.
Risk
• Naam vul shona: STT maal ba customer er naam vul likhte pare. Tai mil na hole kachakachi naam suggest korbe, ar confirm chara kichu save hobe na.
• Internet: Google Bangla STT shadharonoto online e kaj kore. Offline chalate phone e Bangla offline pack download korte hobe, seta test kore dekhte hobe.
• Sync conflict: duita phone offline e eki maal bikri korle stock vul hote pare. Tai stock sorasori edit hobe na; prottek kena/bikri event hishebe save hobe, ar stock = kena − bikri, sync er por hisab hobe.
• Dokaner bhir: sobdo onek thakle shuddhota kombe. Tai tap kore bola (push-to-talk), sob somoy sunte thaka na.
• Purono Android: recognizer theke audio save shudhu Android 13+ e kaj kore. Purono phone e hoy audio chara cholbe, naki age expo-audio diye record kore sei file recognizer ke dite hobe. Test kore dekhte hobe.
• Storage: 16 kHz WAV e 4 sec er clip ~130 KB. Din e 200 command hole ~25 MB/din, mase ~750 MB. Drive er 15 GB Gmail/Photos er sathe share hoy; bhore gele upload bondho. 30 din rakhle raw audio ~750 MB, compress (AAC/Opus) korle ~75 MB, tai 15 GB e sohoje cholbe.
Open questions
1.  Ager POS er 226 ta product er Excel catalog ta shurute import korbo?
2.  Barcode MVP te rakhbo, naki pore?
3.  Malik ar karmochari er alada login lagbe? Karmochari ki kena dam ar lav dekhte parbe? (devices.role ekhon ache; permission er jonno eta use kora jabe.)
Screens
Design (11 ta screen, 390×844 phone): <https://claude.ai/code/artifact/178f8815-6636-44e0-959c-4191e254c838>
Design file gulo (project/*.dc.html) ei link theke abar pora jabe. Phase 2 er age kono UI code hobe na.

Screen list (design file → naam → kaj → main elements → kothay theke khole)
1.  Setup.dc.html — প্রথমবার চালু / "দোকান চালু করুন". Prothombar app khulle. 3 ta numbered card: (১) dokaner Google account button, (২) "এই ফোন কার?" naam chip (আব্বু / আম্মু / কর্মচারী ১ / + নতুন নাম) = device_name, ar tar niche role chip: মালিক / কর্মচারী (owner | staff) — design e nei, add korte hobe; naam chip theke default (আব্বু/আম্মু → মালিক, কর্মচারী → কর্মচারী) kintu bodlano jabe. Dutoi devices table e save, (৩) "এখন ক্যাশে কত টাকা?" opening cash, mic button ar note-count button. Niche boro "শুরু করুন". Opens from: first launch. Goes to: Main; note button → CashCount.
2.  Main.dc.html — বিক্রি (হোম). Bikri tab, default screen. Header: "আমার দোকান" + "শুনুন" (TTS) pill. Dark "হাতে ক্যাশ" card (→ Cash). 2 ta stat tile: আজ বিক্রি (green), আজ বাকি (orange). Majhe 172px 🎤 button (12px ring) + "চাপুন, বলুন", niche "লিখুন" button. Shesh 2 ta entry card (icon tile, naam, poriman, ৳, বাকি badge, ▶️). Bottom nav 3 tab: বিক্রি / মাল / বাকি. Opens from: Setup, bottom nav, Confirm, back from shob sub-screen.
3.  Listening.dc.html — শুনছি. Mic chapar por. Dark green full screen, 3-ring mic, "শুনছি…", sound bars, live transcript card ("চাল দুই কেজি"), boro "থামুন" button, ✕ (বাতিল). Opens from: Main mic (Baki/Stock er "বলুন" button theke-o). Goes to: Confirm (থামুন), Main (✕).
4.  Confirm.dc.html — নিশ্চিত করুন. Parser result dekhano. Back + "আবার শুনুন". Card: product icon tile (112px), naam, − poriman + stepper, boro ৳ dam (52px green). নগদ / বাকি toggle. Niche না (✕) ar হ্যাঁ (✓, 1.6× chowra). Opens from: Listening, Pick. Goes to: Main (হ্যাঁ = save, না = baad).
5.  Pick.dc.html — ছবি দেখে বেছে নিন / লিখুন. Type kora ba list theke bacha. Back + text input ("লিখে দিন…"), 3×2 product picture grid (selected = green border), poriman row + unit chip (কেজি / গ্রাম / টাকার), 3×4 Bangla number pad (১–৯, ½, ০, ⌫), "ঠিক আছে". Opens from: Main "লিখুন"; Confirm er field tap (plan: naam/poriman edit). Goes to: Confirm.
6.  Stock.dc.html — মাল tab. Header + শুনুন. 2-column product card grid: icon tile, naam, stock poriman, becha dam; kom stock hole orange border + alert badge. Niche blue "নতুন মাল বলুন" (mic). Bottom nav. Opens from: bottom nav. Card tap = TTS bole debe.
7.  Baki.dc.html — বাকি খাতা tab. Header + শুনুন. ক্রেতা / মহাজন toggle — MVP te মহাজন tab lukano thakbe (Phase 3), toggle ta-o dekhabe na; shudhu ক্রেতা list. Orange "মোট পাবো" total card. Customer list: initial avatar, naam, ৳ baki, ▶️. Niche orange "বাকি / জমা বলুন" (mic). Bottom nav. Opens from: bottom nav. Naam tap → Customer.
8.  Customer.dc.html — ক্রেতার হিসাব (e.g. করিম). Back (→ Baki), ফোন (tel:), শুনুন. Header card: avatar, naam, "পাবো ৳ ২,৩০০". জমা নিন (green) / বাকি দিন (orange) button. "হিসাব" ledger list: + (baki, orange) / − (joma, green) sign, ki, kobe, ৳, ▶️. Opens from: Baki list er naam.
9.  History.dc.html — আজকের খাতা (শুনে ঠিক করা). Voice reference + correction. Back + শুনুন. Filter chip: সব / বিক্রি / বাকি / খরচ. Entry row: ▶️ (audio), icon tile, title, poriman, ৳, edit (✎). Thik kora entry te blue border + "~~৩ কেজি~~ → ১ কেজি". Legend: "নীল দাগ = শুনে ঠিক করা হয়েছে". Opens from: Cash screen, ar Main er "আজ বিক্রি" tile (today's sales).
10. Cash.dc.html — আজকের ক্যাশ. Din sheshe cash milano (MVP). Back + শুনুন. Hisab card: গতকালের ক্যাশ + নগদ বিক্রি + বাকি জমা পেলাম − খরচ − মালিক নিল. Dark "হাতে থাকার কথা ৳" card. "আজকের খরচ" list (মাল কেনা নগদ, বিদ্যুৎ বিল, চা-নাস্তা) with ▶️. Design e "মালিক নিল" khoroch list e ache — MVP te eta alada row/line hobe ("মালিক নিল"), khoroch total e na. Niche খরচ বলুন (orange) / গুনে মিলান (green). Opens from: Main "হাতে ক্যাশ" card. Goes to: CashCount (গুনে মিলান), History, Listening (খরচ বলুন, tab = expense).
11. CashCount.dc.html — নোট গুনে মিলানো / "নোট গুনুন". Note row (১০০০ / ৫০০ / ২০০ / ১০০ / ৫০ / ২০ / ১০): rongin note chip, − count +, ৳ total. থাকার কথা vs গুনে পেলাম tile, orange status ("৳ ৫০ কম আছে"), "দিন শেষ করুন". Opens from: Cash "গুনে মিলান", Setup step ৩. Back → Cash.

Navigation: ekhono wire kora baki (design e link nei)
• Baki list er customer naam → Customer page.
• Cash er "গুনে মিলান" button → CashCount page.
• History: Cash screen theke ar Main er "আজ বিক্রি" tile theke (design e ei duita link nei, add korte hobe; Cash e ekta "আজকের খাতা" entry lagbe).
• Aro je gulo design e button ache kintu link nei: Main 🎤 → Listening; Main "লিখুন" → Pick; Stock "নতুন মাল বলুন" ar Baki "বাকি / জমা বলুন" → Listening; Customer "জমা নিন"/"বাকি দিন" → Listening/Pick.

Design er notun scope — decided (Nov 13): খরচ, opening cash ar Cash/CashCount MVP te (feature 7–9). মহাজন Phase 3: tab lukano, schema te party_type thakbe.

Design tokens
• Font: Hind Siliguri (Google Fonts) 400 / 500 / 600 / 700. Body 600–700 beshi, label 500.
• Font size (px): caption 15–16 · body 17–19 · label/button 20–22 · amount (list) 22–26 · heading 26–28 · prompt 30–36 · big amount 34–40 · hero dam 52.
• Colors:
  – Neutral: bg #F3F5F4 · surface #FFFFFF · ink #18201C · ink-2 #3D4842 · muted #4A5650 · border #C9D3CE · divider #E1E7E4 / #E6ECE9 · neutral tint #EDEFF2 · dark card #18201C (inner tile #2E3A34, muted text #D5DDD9).
  – Bikri / primary (green): #0F6B4F · dark #0A4D39 · tint #E3F1EB · mic ring #CFE7DD. Listening screen: bg #0A4D39, rings #0F5E46 / #137255, ✕ #136B51, sound bars #9FD3BF.
  – Baki / khoroch (orange): strong #B85C12 · ink #7A3A06 (hover #5A2A04) · tint #FBEADB · soft border #F0C9A4 · low-stock qty #9A4A0B.
  – Maal / correction (blue): #1A4F8C · tint #E4EDF8.
  – Product tile: চাল #F2EBD9 · ডাল #F6E3DA · তেল #FBF1CC · চিনি #EDEFF2 · ডিম #F5EEE3 · সাবান #E2EEF6.
  – Customer avatar: #5B4B8A · #1A4F8C · #0F6B4F · #8A3B5B.
  – Taka note chip (bg / edge): ১০০০ #EDE3F3/#9A7BB3 · ৫০০ #F6E6D6/#C99A6B · ২০০ #E2EFDF/#86AE7E · ১০০ #E4EDF8/#8AA9CF · ৫০ #F3E3E3/#C49595 · ২০ #E9F0E1/#9CB585 · ১০ #F5EEE3/#C2AA86.
• Spacing (px): screen side padding 16 (top 14–20, bottom 16–18) · gap 6 / 8 / 10 / 12 / 14 / 18 / 22 (beshi 10–12) · card padding 10–18.
• Radius (px): 8 note chip · 12 small button/chip · 14 icon button, input, tile · 16 nav tab · 18 card, chip · 20 big button · 22 section card · 24 hero card · 28 product hero tile · 999 pill/circle.
• Size (px): min touch 44 · standard icon button 52 · list tile/avatar 56 · stepper/segment 64 · nav tab 76 · big action 84–96 · mic 172 (+12 ring) · Listening mic 160/210/260.
• Icons: inline stroke SVG (24 viewBox, stroke 1.6–2.8, round cap/join), emoji na. Bottom nav: active tab = solid color (bikri green / maal blue / baki orange), baki tab gulo tint.
• Bangla digit shob jaygay (৳ ৮,২৩০), hajar er por comma.

Status
• Done: Phase 1 parser — src/parser/ (pure TS, no RN imports), `npm test` → 257 passing. Number words (১–৯৯, আধা/দেড়/আড়াই, সাড়ে/সোয়া/পৌনে, শ/হাজার/লাখ), units (কেজি, গ্রাম, লিটার, পিস/টা, প্যাকেট, ডজন, হালি, বস্তা, পোয়া), intents (bikri, kena, baki, joma, stock, lav). Plan er sob example test e ache.
• Done: UI design review — 11 screen ar design token "Screens" section e likha (code na).
• Done: parser e device role — ctx.deviceRole/deviceName; staff er "নিলাম" = expense "অগ্রিম বেতন". `npm test` → 309 passing.
• Done: parser e `owner_withdrawal` intent (`person`, `amount`, `note`; মালিক/আব্বু/আম্মু ba ctx.ownerNames + taka, ba "নিলাম" + taka). `npm test` → 295 passing.
• Done: parser e `expense` intent (`item` + `amount`; "খরচ" shobdo, ba ভাড়া/বিল/বেতন/নাস্তা/মালিক + taka, ba tab = expense). `npm test` → 279 passing.
• Done: Build step 1 — Expo SDK 58 dev build shell (src/app, expo-router), design token (src/theme/tokens.ts, Hind Siliguri embed), বিক্রি/মাল/বাকি tab bar + placeholder, SQLite schema v1 + migration (src/db, 22 test), app parser import kore (বিক্রি tab e "পার্সার পরীক্ষা" debug box ar DB status). `npm test` → 331 passing.
• Done: build step 2 (Pixel 7 e type kora path test hoyeche; voice path user er test baki) — 🎤 → শুনছি (bn-BD STT, audio phone e save) → নিশ্চিত করুন (TTS readback, হ্যাঁ/না bola ba button, poriman +/−, নগদ/বাকি, notun maal er dam) → sale save (baki hole ledger row-o). "লিখুন" type kora command-o eki confirm card e jay. Home e আজ বিক্রি/আজ বাকি ar shesh 3 ta entry (▶️). Pilot log screen: shob command, ki holo, ▶️, accuracy % (target 80%), JSON share. `npm test` → 389 passing.
• Done: multi-item sale + per-unit dam — parser items[] (unitPrice, priceUnit, total), confirm card e line list (± poriman, dam edit, ✕ bad, nicher মোট), bola dam stored dam theke 20% er beshi alada hole kamla highlight, TTS >4 line hole shudhu sonkha + mot. Schema v3: sales.basket_id, ledger.basket_id, voice_logs.final_json. `npm test` → 416 passing.
• Done: pre-pilot — dam er box bola jinish edit kore (mot ba "করে/প্রতি" hole per-unit; nicher chhoto lekha onnota), unit na mille kamla highlight ("তেল সাধারণত লিটারে — ঠিক আছে তো?"), schema v4 (sales.line_no, voice_logs.stt_ok), pilot log e "শোনা: ঠিক/ভুল" ar "পাইলট ডাটা মুছুন", build label (pilot log e; home e shudhu debug), release APK (`npm run apk`, Metro lage na). Pixel 7 e dekha hoyeche. `npm test` → 448 passing.
• Done: offline eval rule parser vs Gemini — `npm run eval:gemini` (scripts/eval-gemini.ts, Mac e, app e bundle hoy na; GEMINI_API_KEY lage, `--rule-only` chara). eval/fixtures.jsonl: 40 notun elomelo bakko + 10 ta test theke; eval/seed.json product/customer list. Result eval/results/ (git e nei). Rule parser: 86% (new 83%, tests 100%).
• Done: eval theke parser fix — ctx.productAliases (চাউল→চাল, পিয়াজ→পেঁয়াজ, লাক্স সাবান→সাবান), "<naam> <maal> <poriman> বাকি" = credit sale, "হাসান কে"/"সুমি আপু" ar "বাহান্ন" split fix; parser confidence (high/low + lowReasons + unconsumed) ar router (hybridParse: low hole LLM, fail hole rule). Eval e hybrid column, 429 e retryDelay, API error alada. `npm test` → 485 passing.
• Done: eval import — `npm run eval:import -- pilot.jsonl`: pilot log export (app er JSON ba JSONL) theke saved/saved_edited entry → fixture source "pilot" (transcript + confirm kora result; edit na kora field = parser er value, edit kora field = saved value). Duplicate (eki text + tab ba pilot id), শোনা ভুল ar cancelled bad; doubt thakle `review`. Notun maal/customer eval/seed.json e jog (`--no-seed` chara). Eval e "pilot" (held-out) ar "pilot edited" alada pass %. 503 o retry (2 s, 5 s, 10 s). Pilot export e id ar tab. `npm test` → 504 passing.
• Next: pilot er age "পাইলট ডাটা মুছুন" → dokane pilot (50–100 command) → log share → `npm run eval:import` → step 3 (Pick-by-picture) ar step 6 er parser fix (jana: "তিন তলার ভাড়াটিয়া" te "তিন" sonkha hoye jay; nogod bikri te customer naam dhore na).
• Decisions log:
  – Test: Jest + ts-jest.
  – "X চাল ১ কেজি বাকিতে নিল" = ekta `sale` with `credit: true`; app layer sale + baki duto row likhbe.
  – Kono intent keyword na thakle: khola tab er intent; tab na thakle sale. Ledger tab e keyword chara → `unknown` + missing ['intent'] (confirm card jiggesh korbe baki na joma).
  – "১০০ টাকার চিনি" → amount 100, quantity faka; poriman app hisab korbe becha dam theke.
  – Parser shudhu naam er text dey; DB match/alias Phase 2 te. Optional knownProducts/knownCustomers dile naam alada korte sahajjo kore.
  – Nov 13: din sheshe cash milano (Cash + CashCount) Phase 3 theke MVP te. খরচ ar opening cash-o MVP. Schema e expenses ar day_close table jog.
  – Nov 13: মহাজন Phase 3 thakbe; MVP te tab lukano, ledger.party_type schema te thakbe.
  – Nov 13: History khule Cash screen ar Main er "আজ বিক্রি" tile theke.
  – Parser: expense er naam `item` field e (product na). "দিল" (she/he dilo) + taka = joma; "দিলাম" + ভাড়া/বিল ityadi = expense. "আজকের খরচ কত" (expense query) ekhono nei — todo.
  – Nov 13: "মালিক" expense na — notun `owner_withdrawal` intent ar owner_withdrawals table. Expected cash theke kome, profit e na.
  – Nov 13: Lav er uttor = বিক্রি, মোট লাভ (gross), খরচ, আসল লাভ (net = gross − খরচ). Purchase ar owner_withdrawal lav e dhora hoy na.
  – Nov 13: prottek phone er role (owner | staff), devices table e device_name er sathe; Setup step ২ e set. First-person cash nea: owner → owner_withdrawal, staff → expense "অগ্রিম বেতন"; dutotei person = device_name.
  – Nov 13: role set na thakle first-person cash nea staff hishebe (expense "অগ্রিম বেতন") — lav theke lukano na thake.
  – Nov 13: Phase gulo incremental build order e (step 1–8); pilot shuru step 2 te.
  – Nov 13: Stack: Expo SDK 58 (RN 0.88), expo-router (src/app) JS tabs with custom tab bar, expo-sqlite, Hind Siliguri expo-font plugin diye embed (Android e family = file naam, weight onujayi alada family). android/ folder generate hoy (prebuild), git e nei.
  – Nov 13: DB: taka INTEGER poisha (৳1 = 100) e; poriman REAL product er unit e. Entry table (purchases, sales, ledger, expenses, owner_withdrawals, day_close) e UPDATE/DELETE trigger diye bondho; correction = notun row corrects_id soho, v_<table> view shudhu shesh version dekhay. Migration: PRAGMA user_version, prottek step transaction e.
  – Nov 13: Pilot log = voice_logs table (schema v2): source (voice/typed), alternatives, stt_error, outcome (saved / saved_edited / cancelled / unsupported / stt_error), edits (confirm card e ki bodlalo). Accuracy = edit chara saved ÷ (saved + edited + cancelled). Confirm theke kichu na kore chole gele = cancelled.
  – Nov 13: Step 2 te shudhu bikri save hoy; onno intent (baki, joma, khoroch…) parse hoy, log e "unsupported" hoy, save hoy na.
  – Nov 13: Notun maal: prothom bikri tei product toiri hoy (unit = bola unit, dam = bola mot dam ÷ poriman ba confirm card e likha dam). Kena na thakle sale.cost_known = 0 (lav hisab e alada dhorte hobe).
  – Nov 13: Ei phone er device_id/naam/role expo-sqlite kv-store e (sync hoy na); Setup na howa porjonto naam "এই ফোন", role nei (= staff).
  – Nov 13: Audio clip app er document folder e (cache na), jate 30 din porjonto thake.
  – Nov 13: Android e Bangla text auto-width box e shesh shobdo hariye jay ("আজ বাকি" → "আজ"), tai Txt default ek line (wrap prop diye beshi line). TextInput e paddingVertical 0, na hole ি er matha kete jay.
  – Nov 13: Sale = basket. Parser sale e shob somoy items[] dey (product, quantity, unitPrice, priceUnit, total); ek line hole top-level product/quantity/amount-o thake, beshi hole amount = basket mot (shob line e dam thakle). Line bhag: name / poriman / dam — ek line e prottek dhoron ekbar; abar ashle notun line. আর/এবং/সাথে/একই/একসাথে separator.
  – Nov 13: Save: prottek line ekta sales row, shob row e eki basket_id ar voice_log_id; বাকি hole ledger e ekta baki row = basket mot (basket_id soho). Pilot log e final_json = save hoya line gulo, edits = "items[1].quantity", "items[0].removed" ityadi.
  – Nov 13: Bola dam stored becha dam theke >20% alada hole confirm card e highlight (save atkay na).
  – Nov 13: Confirm card er dam box = je dam bola hoyeche: "২০০ টাকা" → line er mot, "২০০ টাকা করে/প্রতি কেজি" → per-unit. Kichu na bolle (DB dam ba notun maal) mot. Nicher chhoto lekha = onnota. ± korle per-unit dam thik thake (mot mode e mot scale hoy). Parser SaleItem.priceKind ('total' | 'unit') dey.
  – Nov 13: Unit na mille ("৫ কেজি তেল", তেল লিটারে) block na, kamla highlight; kg↔litre convert hoy na — bola unit ei dekhay, save e product er unit e 1:1 (5 kg → 5 litre; g/ml 1000 bhag), sales.spoken_unit = bola unit. Ek dhoroner unit (g→kg, dozen→piece) age moto convert hoy. 'unit_mismatch' problem ar nei.
  – Nov 13: Schema v4: sales.line_no (basket er bhitore 1, 2, 3; home list e ei kromey), voice_logs.stt_ok (pilot log e reviewer "শোনা ঠিক/ভুল" mark kore; STT vul ar parser vul alada gona jay).
  – Nov 13: "পাইলট ডাটা মুছুন" (pilot log er niche, confirm dialog): sob entry, maal, customer, voice log ar audio file muche; device thake. Append-only DELETE trigger ek transaction e drop kore abar toiri kora hoy. Shudhu pilot er jonno; sync (step 7) er age eta sorate hobe.
  – Nov 13: Pilot fixture = held-out score; parser rule likhte pilot fixture dekhe fix korle seta ar held-out thake na (tokhon notun pilot batch lagbe). Gemini ekhono shudhu eval e; router app e wire hoy na.
  – Nov 13: Gemini eval shudhu tulona (offline, Mac); app e LLM nei. Default model gemini-3.5-flash-lite; Gemini 3 e thinking puro bondho kora jay na, tai thinkingLevel "minimal" (2.x hole thinkingBudget 0).
  – Nov 13: Parser confidence = "low" jodi kono shobdo/sonkha kono rule e na lage (filler bad), maal knownProducts/alias e na thake, ba basket er line sonkha shondehojonok (stray dam bad, beshi line er kono line e poriman/dam nei), ba intent bujhi nai. Router (src/parser/router.ts) LLM ke function hishebe ney — parser pure thake; app e ekhono LLM nei, shudhu eval hybrid e use hoy.
  – Nov 13: Product alias parser e ctx.productAliases diye ashe (pore product_aliases table theke); alias naam known product hishebe gona hoy, output e asol naam.
  – Nov 13: "বাকি" + poriman (নিল chara-o) = credit sale; poriman chara "<naam> <taka> বাকি" = ledger baki.
  – Nov 13: Release APK: `npm run apk` (expo prebuild + gradle assembleRelease, debug key diye sign; ager dev build er upor install korle data thake). Build label = app.config.js e git commit + build time (expo-constants extra).
