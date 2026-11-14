# Mudi Dokan App
Voice-first Android app for grocery shopkeepers who can't or won't type.
Input = Bangla voice, output = big icons + TTS. Full plan: @docs/PLAN.md

## Stack
- React Native + Expo (dev build, NOT Expo Go), TypeScript strict
- expo-speech-recognition (bn-BD), expo-speech, expo-sqlite
- Sync: Firestore (event-based, never edit stock directly: stock = purchases − sales)

## Rules
- Every row: id (UUID), device_id, updated_at
- Never mutate/delete entries; corrections are new rows with corrects_id
- Nothing is saved without user confirmation (✅ or "হ্যাঁ")
- Parser is pure TS, no RN imports, fully unit-tested
- UI strings in Bangla script

## Workflow
- After finishing a task, update the "Status" section in docs/PLAN.md
  (done / in progress / next). Keep it short.
- If a decision changes (schema, library, approach), update docs/PLAN.md
  and tell me what changed.
- Only edit CLAUDE.md when I ask.

## Ground rules for every remaining build step
- One step at a time. Do only the step asked for; when it is done, stop and wait.
- Tests first for logic (pure TS in src/parser, src/domain, src/db; Jest). Follow
  docs/PLAN.md › Screens and the design link there.
- Every DB change is a NEW migration (append to MIGRATIONS; never edit a shipped one).
  Never break existing pilot data on the shop phone: add an upgrade test from the
  previous version with real-looking rows.
- Release APKs only via `npm run apk` (release key, see Commands). Install as an update
  (`adb install -r`); never uninstall the app on the phone (= data loss) without asking.
- Bangla UI, big touch targets (≥ 52 px), 🔊 read-aloud on every screen, confirm before
  every save (হ্যাঁ/না by voice or button).
- After each step, in this order: `npm test` + `npx tsc --noEmit` clean → build the
  release APK and run it on my phone (Pixel 7) → update docs/PLAN.md Status (done,
  unfinished, known bugs, next) → commit → push → stop.

## Status
Lives in docs/PLAN.md › Status (done / unfinished / known bugs / next) and its
Decisions log. Read it first.

## Commands
- test: npm test
- run: npx expo run:android
- release APK (no Metro, for the shop phone): npm run apk
  → android/app/build/outputs/apk/release/app-release.apk; update with `adb install -r <apk>`
- Release signing: dedicated key, NOT the debug key (plugins/withReleaseSigning.js).
  - Keystore: ~/.mudi-dokan/keys/mudi-dokan-release.jks (outside the repo), alias
    mudi-dokan-release, SHA-256 D0:B0:99:12:…:C8:89.
  - Path/alias/passwords: MUDI_RELEASE_STORE_FILE, MUDI_RELEASE_STORE_PASSWORD,
    MUDI_RELEASE_KEY_ALIAS, MUDI_RELEASE_KEY_PASSWORD in ~/.gradle/gradle.properties
    (or env). Never commit them. Without them the release build fails (no debug fallback).
  - Every future APK must use this same key, or Android refuses the update and the only way
    in is uninstall = all shop data on the phone lost.
  - BACKUP (do once, and after any change): copy the .jks AND the 4 MUDI_RELEASE_* lines
    to two places off this Mac (password manager + encrypted USB/drive). Losing either
    = no more updates for installed phones.
  - Dev builds (npx expo run:android) are debug-signed: they can't install over the
    release app without uninstalling it first.
- eval (Mac only): npm run eval:gemini [-- --rule-only]; pilot log → fixtures:
  npm run eval:import -- pilot.jsonl

