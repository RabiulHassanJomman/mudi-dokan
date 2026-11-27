/** 🎤 anywhere: the keyboard screen (Ridmik voice typing → fixed formats). */
import type { Href } from 'expo-router';

import { voiceRoute, type Carry, type VoiceTab } from '../domain/keyboard';
import { nav } from './nav';

/** Route params are plain strings; VoiceRoute's are typed (and unit-tested) in the domain. */
export const voiceTarget = (tab: VoiceTab, carry: Carry = {}): Href => voiceRoute(tab, carry) as unknown as Href;
export const openVoice = (tab: VoiceTab, carry: Carry = {}) => nav.push(voiceTarget(tab, carry));
