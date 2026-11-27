Mudi Dokan App — Plan
Full history (decision log, step-by-step notes, old designs, design tokens, Gemini notes): docs/archive/plan-history.md

Status
• Done: steps 1–5, 7, 8 (shell, voice→confirm→save, Pick, stock/baki/customer, cash/history/undo, multi-phone sync, Drive audio + backup). Gemini-only voice engine with offline queue, মুছুন (voided/archived), সব তথ্য মুছুন, ক্রেতা import, Noto digit font.
• Previous build: release APK (built Nov 15, installed on Pixel 7; has home detail sheet, live-text fix, বিরতি/চালিয়ে যান on Listening, spinner while Gemini thinks). Hidden voice-test screen (⚙ › version long-press › 🔊) lists Bangla TTS voices; on-device voices are robotic; Gemini TTS "Fenrir" chosen from samples, not built in yet. `npm test` → 1081 passing. firestore.rules deployed (Nov 15).
• Unfinished: pause/resume not yet tested on the phone (Android 13+ joins one WAV per resume; recognizer may still end by itself after a few quiet seconds); real Bangla voice not yet tested for baki/joma/khoroch/kena, step-5 voice queries, queue review; cloud "wipe all phones" not tested on real Firestore; background backup at night not seen running; restore not tried on phone. Fenrir TTS not integrated (plan: cache clips, speak with robotic voice first if not cached, never wait on network).
• Known bugs: right after `adb install -r` + launch no button opens any screen until the app is force-stopped and opened again (nav queue never ready?); seen on v0.1.64 and again on v0.1.71 (Nov 27); "তিন তলার" parsed as number; বস্তা-type units stored 1:1; two customers with same name can't be split; deep-link tap right after launch can crash (adb only); both phones take nightly backup.
• Android parsing A1 done (Nov 27): src/parser/fixed.ts (parseFixed), not wired into the app yet; `npm test` → 1125 passing. No APK built or run for A1: .env (Gemini key) is missing on this Mac and no phone was connected.
• Android parsing A2 done (Nov 27): v15, goods sale + money-only purchase drafts, save and ✏️ logic; `npm test` → 1138 passing. No screen creates them yet. No APK or phone run (same reason as A1), so the v15 upgrade is untested on the phone.
• Android parsing A3 done (Nov 27): confirm card (নগদ goods sale, goods edit, money-only কেনা), ✏️, মাল "খরচ ৳"; the card parses voice logs with engine android. `npm test` → 1147 passing; release APK builds but was not installed (no .env, so no Gemini key). Screens not seen on the phone; nothing creates android logs until A4.
• Android parsing A4 done (Nov 27): ⚙ কথা বোঝার উপায় (কিবোর্ডে বলা default / Gemini, shown only with a key); 🎤 opens the বলুন screen (src/app/say.tsx: example, big text box, keyboard up, মুছুন, হয়ে গেছে); missing parts said, text kept; খরচ in Android mode = number pad; হ্যাঁ/না by buttons only in Android mode. `npm test` → 1164 passing; installed on Pixel 7 (Nov 27, v0.1.60, no Gemini key, no .env): v15 upgrade ran, old data shown, বলুন screen opens with Ridmik up and buttons above it; the what-is-missing warning shows above the text box, so the keyboard can't cover it (checked on the phone). Unfinished: no command spoken with Ridmik and saved yet.
• বাকি without goods ("সাজু বাকি ১০০ টাকা") allowed (Nov 27): `npm test` → 1167 passing. Installed on Pixel 7 (v0.1.64): "সাজু বাকি 100 টাকা" opens the বাকি card (সাজু, ৳ ১০০, goods empty); tested with না, nothing saved.
• নগদ বিক্রি without goods allowed (Nov 27): `npm test` → 1170 passing. Installed with the next build.
• Spelling fixes + customer matching (Nov 27): src/parser/spelling.ts (বাকে→বাকি, নগত→নগদ, টেকা/তাকা→টাকা, নিসে→নিয়েছে …, add more there); the heard name is matched to the imported customer list (domain/keyboard.matchCustomer: alias, exact, without -র/-ের/-কে, same sound, one clearly closest spelling; else the card asks). `npm test` → 1209 passing. Installed on Pixel 7 (v0.1.67): "শানি বাকে 100 টেকা" → বাকি, সানি, ৳ ১০০; "নগত 100 টাকা" → নগদ বিক্রি ৳ ১০০ without goods (both cancelled with না, nothing saved).
• More spelling fixes (Nov 27): ~70 more variants in src/parser/spelling.ts (বাখী/বাখিতে, ধাড়, নকত/নগতে, সোধ/পরিসোধ, টাখা/টাহার/টেকায়, বিকরী, কিনসি/আনসি, নিয়েসে/দিয়েচে/হইসে, আইজ, আফা/মিঞা). Real words (জামা, জুমা, কিনা, কেননা, নিচে) are left alone. `npm test` → 1238 passing. Not built or installed yet.
• Gemini removed (Nov 27, decision changed): no Gemini engine, setting, Listening screen, waiting queue / অপেক্ষার হিসাব review, customer-import tidy-up, eval script or APK key check. 🎤 always opens the বলুন screen (Ridmik); হ্যাঁ/না by buttons only on every card. DB columns and understand_queue stay (migrations are append-only); clips waiting there from before are no longer understood. `npm test` → 1152 passing. Installed on Pixel 7 (v0.1.70, `adb install -r`, data kept): home opens with old data and no queue card; 🎤 opens বলুন with the keyboard up.
• Big 🎤 listens directly in Bangla (Nov 27): Ridmik's mic was found to use Android's speech recognizer (Google's on the Pixel 7: logcat callingApp ridmik.keyboard → GoogleTTSRecognitionService; its APK calls createSpeechRecognizer with bn-BD), so বলুন now starts the same recognizer itself (expo-speech-recognition, bn-BD, live text, no clip). When the speaker stops, the text goes to the confirm card; missing parts are said and the text stays; 🎤 again adds to it; tapping the box still opens the keyboard (Ridmik). Needs internet: Google has no offline bn-BD pack on the Pixel 7. `npm test` → 1157 passing. Installed on Pixel 7 (v0.1.71): listening starts in bn-BD, silence → "কিছু শুনিনি…" after ~5 s. Real Bangla speech not tried yet.
• Next: A5 (real speech with Ridmik in the shop; new misspellings go into spelling.ts). After Android parsing: Fenrir TTS.

Android parsing (decided Nov 27; A1–A4 built; the only engine since Gemini was removed Nov 27)
Flow (changed again Nov 27): 🎤 → বলুন listens at once with the phone's recognizer in bn-BD (the same Google recognizer Ridmik's mic uses) → text box → when speech ends, fixed-format parser → confirm card → হ্যাঁ/না buttons. Ridmik's keyboard mic still works by tapping the text box. No Gemini call, no audio clip (no ▶️, no Drive upload for these).
Gemini: removed (Nov 27).

Formats (the keyword picks the type; amount = number before টাকা; one total for all goods, no quantity or unit price)
• বাকি: "সাজু বাকি নিয়েছে আদা, চাল, আটা ১০০ টাকা" → customer (required), goods, total. Goods may be left out: "সাজু বাকি ১০০ টাকা" (Nov 27). Saved: ledger baki, note = goods or none (v14).
• নগদ: "নগদ বিক্রি আদা, চাল ১০০ টাকা" → goods, total, customer optional. Goods may be left out: "নগদ বিক্রি ১০০ টাকা" (Nov 27), listed as "নগদ বিক্রি". Saved: one sales row (see Data).
• কেনা: "১০০০ টাকার আলু কেনা হয়েছে" → one product, money spent. Saved: purchases row, quantity 0, paid from cash.
• জমা: "সাজু ৫০ টাকা জমা দিয়েছে" → customer, amount. Saved: ledger joma.
• Missing field, two type keywords or no match: show what was heard and understood, say what is missing (🔊), ask again. Nothing saved.

Data
• Stock is a record of money spent for spoken কেনা: no quantity, sales never reduce it. Pick and typed entries (and old Gemini ones) keep stock = purchases − sales.
• v15 (new migration): sales.note (goods text); remake v_sales (and v_stock). A নগদ sale uses one fixed hidden product (fixed id, archived, "খুচরা মাল"), quantity 1, cost_known 0. So cash, history, undo, sync, backup work without a new table or firestore.rules change.
• A product first bought money-only gets unit পিস (no unit was said).
• Quantity 0 purchase: মাল screen shows টাকা spent (not "শেষ"), history and ✏️ show and edit the total only, average cost ignores it (already filters quantity > 0).
• Unchanged behaviour: a goods-only বাকি counts in আজ বাকি, not in আজ বিক্রি.

Build steps (one at a time; each: tests first, test + tsc, APK on Pixel 7, Status, commit, push, stop)
• A1 Parser: src/parser/fixed.ts, pure TS; parseCommand untouched. Tests: the four examples, বাকী, number words, Bangla/ASCII digits, honorifics, multi-word product names, each missing field, conflicting keywords.
• A2 Data: v15 + upgrade test from v14 with real-looking rows; drafts and save for নগদ goods sale and amount-only purchase; cash, profit, stock, history, void and sync tests.
• A3 Screens: confirm card (readback, edit goods/amount/customer), history, ✏️, মাল.
• A4 Switch + keyboard entry: setting (default Android); 🎤 in Android mode opens a big text box, focused, keyboard up (the user taps Ridmik's mic once: an app can't press it), example sentence shown and 🔊; big "হয়ে গেছে" button → voice_logs (engine 'android', source voice, no clip) → confirm card. Unclear → ask-again with what was understood, text kept to fix. হ্যাঁ/না by buttons only in Android mode. Works without a Gemini key.
• A5 Real speech with Ridmik on the Pixel 7 in the shop: how Ridmik writes numbers (digits or words), names, commas; add failures as fixtures.

Risks / to confirm
• Name matching can pick the wrong person when a new customer's name is one letter off an existing one (রাজু → সাজু if only সাজু is listed); the card shows the name, and the user can change it.
• Ridmik may give no commas: goods are split using known product names and aliases, else kept as spoken.
• Spoken entry does not handle questions, খরচ, মালিক নিল or voice undo (the four formats only). Pick and typing still do.

Rules that still matter
• Every row: id (UUID), device_id, updated_at. Money = INTEGER poisha. Quantity REAL in product unit.
• Entry tables (purchases, sales, ledger, expenses, owner_withdrawals, day_close) are append-only (UPDATE/DELETE triggers). Correction = new row with corrects_id; delete = voided correction. v_ views show the latest, non-voided version. Customers/products are archived, never deleted.
• Stock = purchases − sales; balance and cash are computed, never stored or synced.
• Nothing saves without confirmation (✅ / "হ্যাঁ"). Bangla UI, targets ≥ 52 px, 🔊 on every screen.
• Engine: Ridmik keyboard text → fixed formats (section above); works offline, no key. Rule parser (pure TS, no RN imports, unit-tested) handles typed text. Gemini removed Nov 27.
• Sync: SQLite is truth, Firestore only transport at shops/{uid}/{table}/{rowId}. Entries = UUID union; mutable tables = LWW by updated_at. Merge duplicates via merged_into + alias + correction. Daily write cap 18K.
• Migrations: one append-only MIGRATIONS list (now v15, verified from SCHEMA_VERSION); never edit a shipped one; add an upgrade test with real-looking rows.
• Release: `npm run apk` only, dedicated release key (~/.mudi-dokan/keys, MUDI_RELEASE_* in ~/.gradle/gradle.properties), install with `adb install -r`, never uninstall. Keep key backups off this Mac.
• Branch: main only.

Screens
1. Setup — Google sign-in (optional), your name, role মালিক/কর্মচারী, opening cash.
2. Main (বিক্রি) — হাতে ক্যাশ card, আজ বিক্রি / আজ বাকি tiles, big 🎤, লিখুন, last entries.
3. বলুন — example, big text box with Ridmik up, মুছুন, হয়ে গেছে.
4. Confirm — readback card with ± quantity, price, নগদ/বাকি, ক্রেতা, হ্যাঁ/না buttons, 🔊.
5. Pick — pictures grid, search, number pad, unit chips; typed/fallback entry.
6. Stock (মাল) — product grid, low-stock marker, নতুন মাল বলুন, 🗑 archive.
7. Baki — customer list, মোট পাবো, বাকি/জমা বলুন.
8. Customer — balance, জমা নিন/বাকি দিন, ledger, phone, note, 🗑.
9. History — day entries, filters, ▶️ clip, ✏️ correct, 🗑 void, show-voided toggle.
10. Cash — expected cash, today's expenses, খরচ বলুন, গুনে মিলান.
11. CashCount — note counter, কম/বেশি, দিন শেষ করুন.
12. Settings (⚙) — shop info, customer import, sync status, Drive, backup/restore, সব তথ্য মুছুন, hidden debug log.
13. Merge ("এই দুইটা কি একই?").

Open questions / before wider release
• Test on a phone with real Bangla speech in a noisy shop; target ≥ 80% correct without edits.
• Does staff need a separate login or hidden cost/profit? (devices.role exists.)
• Import the old POS 226-product Excel catalog? Barcode now or later?
• Clear test data (Test Dokan, করিম, চাল) and set real opening cash before pilot.
• Fix: both phones backing up nightly; Drive folder duplicates on first run from two phones.
• Later: supplier/মহাজন baki, monthly profit, per-product low-stock limit, calendar in History, setup note-count button.
