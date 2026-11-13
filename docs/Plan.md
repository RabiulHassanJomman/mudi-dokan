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
2.  🛒 Bikri: "চাল ২ কেজি" bolle stock kombe ar ajker bikri te jog hobe. "১০০ টাকার চিনি" bolleo hobe, app nije poriman hisab korbe.
3.  📒 Baki khata: "করিম ২০০ টাকা বাকি" ba "করিম ১০০ জমা" diye hisab rakha jabe. "করিম চাল ১ কেজি বাকিতে নিল" bolle eki sathe bikri ar baki dutoi hobe.
4.  Stock jana: "চাল কত আছে?" jiggesh korle app bole debe koto ache ar dam koto.
5.  💰 Lav hisab: prottek bikri te sei somoyer kena dam save hobe. "আজ লাভ কত?" jiggesh korle ajker bikri, kena khoroch ar lav bole debe.
6.  🎧 Voice reference: prottek voice command er audio save hobe, tar transcript ar je entry hoyeche tar sathe link kore. Itihas list e prottek entry te ▶️ button thakbe: shune naam, poriman ba dam er vul thik kora jabe. Thik korle original entry muchbe na; ekta correction entry hobe, ager ar porer dui hisab-i dekha jabe.
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
Table: products (naam, unit, stock, kena dam, becha dam), purchases (kena: poriman, kena dam), sales (poriman, becha dam, sei somoyer kena dam), customers (baki), ledger (baki/joma er itihas). Prottek row e id (UUID), device_id, updated_at thakbe sync er jonno.
voice_logs (audio file, transcript, kon phone, somoy). Prottek entry (purchase, sale, ledger) e voice_log_id thakbe; correction entry corrects_id diye ager entry ke point korbe.
product_aliases (alias → product): STT eki maal alada banane likhte pare ("পেঁয়াজ"/"পিঁয়াজ"); audio shune naam thik korle vul banan ta automatic alias hoye jabe. ledger e party_type (customer/supplier). Prottek entry te device_name (phone e ekbar set kora naam, jemon "Abbu", "Karmochari 1").
Phase
1.  Pilot (2–3 din): shudhu mic → text → parse prototype. Asol dokane bhir er moddhe 50–100 ta asol command test. 80% er kom thik hole command design bodlano (choto command, list theke beche newa). Sync ar audio er age eta.
2.  MVP: upore 6 ta feature, voice diye confirm, offline DB, multi-phone sync, voice e undo ("ভুল হয়েছে"/"বাতিল" bolle shesh entry correction diye ulte jabe), product naam alias, ar prottek entry te phone/karmochari er naam.
3.  Tarpor: supplier/mohajon er baki ("রহিম ট্রেডার্স থেকে ৫০ কেজি চাল বাকিতে কিনলাম"), din sheshe cash milano ("আজকের হিসাব" bolle bikri, baki, joma ar cash e koto thaka uchit bole debe), protidin raat e Drive e backup (Excel/JSON), masher hisab bole shonano, kom stock alert.
4.  Pore: barcode scan (ager POS kaj er sathe jora), customer ke SMS e baki mone koriye deoa.
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
3.  Malik ar karmochari er alada login lagbe? Karmochari ki kena dam ar lav dekhte parbe?Status
• Done: Phase 1 parser — src/parser/ (pure TS, no RN imports), `npm test` → 257 passing. Number words (১–৯৯, আধা/দেড়/আড়াই, সাড়ে/সোয়া/পৌনে, শ/হাজার/লাখ), units (কেজি, গ্রাম, লিটার, পিস/টা, প্যাকেট, ডজন, হালি, বস্তা, পোয়া), intents (bikri, kena, baki, joma, stock, lav). Plan er sob example test e ache.
• Next: pilot — asol dokane 50–100 ta command diye parser test, vul gulo test case banano.
• Decisions log:
  – Test: Jest + ts-jest.
  – "X চাল ১ কেজি বাকিতে নিল" = ekta `sale` with `credit: true`; app layer sale + baki duto row likhbe.
  – Kono intent keyword na thakle: khola tab er intent; tab na thakle sale. Ledger tab e keyword chara → `unknown` + missing ['intent'] (confirm card jiggesh korbe baki na joma).
  – "১০০ টাকার চিনি" → amount 100, quantity faka; poriman app hisab korbe becha dam theke.
  – Parser shudhu naam er text dey; DB match/alias Phase 2 te. Optional knownProducts/knownCustomers dile naam alada korte sahajjo kore.
