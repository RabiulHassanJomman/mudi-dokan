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

## Status
- Phase: 1 (parser)
- Done: —
- Next: number words, units
- Decisions log:

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

