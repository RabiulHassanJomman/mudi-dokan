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

