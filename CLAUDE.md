# Mudi Dokan App
Voice-first Android app for grocery shopkeepers who can't type. Input = Bangla voice, output = big icons + TTS.
Plan: docs/PLAN.md (Status at top; read only the section you need; docs/archive/* only if I ask)

## Stack
React Native + Expo (dev build, not Expo Go), TypeScript strict, expo-speech-recognition (bn-BD), expo-speech, expo-sqlite. Sync: Firestore, event-based (stock = purchases − sales, never edit stock directly).

## Rules
- Every row: id (UUID), device_id, updated_at
- Never mutate/delete entries; corrections = new rows with corrects_id
- Nothing saved without confirmation (✅ / "হ্যাঁ" / না)
- Parser: pure TS, no RN imports, fully unit-tested
- UI in Bangla, touch targets ≥ 52px, 🔊 read-aloud on every screen
- DB changes = new migration appended to MIGRATIONS; never edit/renumber a shipped one. Add an upgrade test from the previous version with realistic rows.
- Branch: main only
- Never uninstall the app on the phone without asking. Update with `adb install -r`.

## Workflow
- One step at a time; do only what's asked, then stop.
- Tests first for logic (Jest; src/parser, src/domain, src/db).
- After each step: `npm test` + `npx tsc --noEmit` clean → `npm run apk` and run on Pixel 7 → update PLAN.md Status (done/unfinished/bugs/next) → commit → push → stop.
- If a decision changes (schema, library, approach), update PLAN.md and tell me.
- Edit CLAUDE.md only when I ask.

## Commands
- test: npm test | run: npx expo run:android
- release APK: npm run apk (signing, backup, eval: docs/RELEASE.md, read only when releasing)

## Small tasks
"small:" → edit code + related tests only. Commit only. No APK/phone/PLAN.md/push. Reply ≤5 lines.

Final report: ≤10 lines. What changed, what to test, blockers.