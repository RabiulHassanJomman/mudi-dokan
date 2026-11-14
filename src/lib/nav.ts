/**
 * The app's navigation: expo-router's `router` behind the not-ready queue (navQueue.ts),
 * so a tap before the root navigator is mounted waits instead of crashing the app.
 * Use `nav.push/replace/back/canGoBack` instead of `router.*`.
 */
import { router } from 'expo-router';

import { createNavQueue } from './navQueue';

export const nav = createNavQueue(router);
