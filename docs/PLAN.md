Mudi Dokan App — Plan
Full history (decision log, step-by-step notes, old designs, design tokens, Gemini notes): docs/archive/plan-history.md

Status
• Done: steps 1–5, 7, 8 (shell, voice→confirm→save, Pick, stock/baki/customer, cash/history/undo, multi-phone sync, Drive audio + backup). Gemini-only voice engine with offline queue, মুছুন (voided/archived), সব তথ্য মুছুন, ক্রেতা import, Noto digit font.
• Last build: release APK (built Nov 15, installed on Pixel 7; has home detail sheet, live-text fix, বিরতি/চালিয়ে যান on Listening, spinner while Gemini thinks). Hidden voice-test screen (⚙ › version long-press › 🔊) lists Bangla TTS voices; on-device voices are robotic; Gemini TTS "Fenrir" chosen from samples, not built in yet. `npm test` → 1081 passing. firestore.rules deployed (Nov 15).
• Unfinished: pause/resume not yet tested on the phone (Android 13+ joins one WAV per resume; recognizer may still end by itself after a few quiet seconds); real Bangla voice not yet tested for baki/joma/khoroch/kena, step-5 voice queries, queue review; cloud "wipe all phones" not tested on real Firestore; background backup at night not seen running; restore not tried on phone. Fenrir TTS not integrated (plan: cache clips, speak with robotic voice first if not cached, never wait on network).
• Known bugs: "তিন তলার" parsed as number; বস্তা-type units stored 1:1; two customers with same name can't be split; deep-link tap right after launch can crash (adb only); both phones take nightly backup.
• Next: find where command latency comes from (debug log ms; each prompt ≈1.8k tokens, 12 examples; Gemini 3.5 caches repeated prefixes by itself, no request field needed); then Fenrir TTS.

Rules that still matter
• Every row: id (UUID), device_id, updated_at. Money = INTEGER poisha. Quantity REAL in product unit.
• Entry tables (purchases, sales, ledger, expenses, owner_withdrawals, day_close) are append-only (UPDATE/DELETE triggers). Correction = new row with corrects_id; delete = voided correction. v_ views show the latest, non-voided version. Customers/products are archived, never deleted.
• Stock = purchases − sales; balance and cash are computed, never stored or synced.
• Nothing saves without confirmation (✅ / "হ্যাঁ"). Bangla UI, targets ≥ 52 px, 🔊 on every screen.
• Engine: Gemini only (clip → Gemini → confirm card). No Android STT. Rule parser (pure TS, no RN imports, unit-tested) only handles typed text and হ্যাঁ/না. Offline/429/error → understand_queue, reviewed later. Key is in the APK (EXPO_PUBLIC_GEMINI_KEY): billing stays off; real release needs a proxy.
• Sync: SQLite is truth, Firestore only transport at shops/{uid}/{table}/{rowId}. Entries = UUID union; mutable tables = LWW by updated_at. Merge duplicates via merged_into + alias + correction. Daily write cap 18K.
• Migrations: one append-only MIGRATIONS list (now v14, verified from SCHEMA_VERSION); never edit a shipped one; add an upgrade test with real-looking rows.
• Release: `npm run apk` only, dedicated release key (~/.mudi-dokan/keys, MUDI_RELEASE_* in ~/.gradle/gradle.properties), install with `adb install -r`, never uninstall. Keep key backups off this Mac.
• Branch: main only.

Screens
1. Setup — Google sign-in (optional), your name, role মালিক/কর্মচারী, opening cash.
2. Main (বিক্রি) — হাতে ক্যাশ card, আজ বিক্রি / আজ বাকি tiles, big 🎤, লিখুন, last entries, waiting-queue banner.
3. Listening — recording, live level, থামুন, ✕.
4. Confirm — readback card with ± quantity, price, নগদ/বাকি, ক্রেতা, হ্যাঁ/না, 🔊.
5. Pick — pictures grid, search, number pad, unit chips; typed/fallback entry.
6. Stock (মাল) — product grid, low-stock marker, নতুন মাল বলুন, 🗑 archive.
7. Baki — customer list, মোট পাবো, বাকি/জমা বলুন.
8. Customer — balance, জমা নিন/বাকি দিন, ledger, phone, note, 🗑.
9. History — day entries, filters, ▶️ clip, ✏️ correct, 🗑 void, show-voided toggle.
10. Cash — expected cash, today's expenses, খরচ বলুন, গুনে মিলান.
11. CashCount — note counter, কম/বেশি, দিন শেষ করুন.
12. Settings (⚙) — shop info, customer import, sync status, Drive, backup/restore, সব তথ্য মুছুন, hidden debug log.
13. Merge ("এই দুইটা কি একই?") and queue review (অপেক্ষার হিসাব মিলিয়ে নিন).

Open questions / before wider release
• Move Gemini key behind a server proxy (Firebase Function); APK key is extractable.
• Tell shopkeepers audio goes to Google; check Gemini free-tier rate limits at real volume.
• Test on a phone with real Bangla speech in a noisy shop; target ≥ 80% correct without edits.
• Does staff need a separate login or hidden cost/profit? (devices.role exists.)
• Import the old POS 226-product Excel catalog? Barcode now or later?
• Clear test data (Test Dokan, করিম, চাল) and set real opening cash before pilot.
• Fix: both phones backing up nightly; Drive folder duplicates on first run from two phones.
• Later: supplier/মহাজন baki, monthly profit, per-product low-stock limit, calendar in History, setup note-count button.
