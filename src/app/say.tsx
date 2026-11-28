import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { File, Paths } from 'expo-file-system';
import { createAudioPlayer, useAudioPlayer } from 'expo-audio';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';

import { Icon } from '../components/Icon';
import { ScreenHeader } from '../components/ScreenHeader';
import { Txt } from '../components/Txt';
import { createVoiceLog, customerAliasMap, customerByName, knownNames, productAliasMap, setOutcome, setParsed } from '../db/repo';
import { writer } from '../device';
import { fixedAsParsed } from '../domain/entry';
import { joinWav } from '../domain/wav';
import { within } from '../domain/within';
import { EXAMPLE_BN, clipUri, examplesSpeech, sayExamples, customerLookup, fixedProblemWords, heardErrorWords, joinPieces, readKeyboardText } from '../domain/keyboard';
import { OFFLINE_NOTHING_WORDS, OFFLINE_SAVED_WORDS, OFFLINE_START_WORDS, OFFLINE_UNSUPPORTED_WORDS, RECORD_LIMITS, isNetworkError } from '../domain/offline';
import { queueClip } from '../db/understand';
import { canRecordWav, recordWav, stopWav } from '../../modules/audio-compress';
import { CAN_READ_LATER, checkOnline, queueChanged, setMicBusy } from '../lib/understand';
import { nav } from '../lib/nav';
import { speak, stopSpeaking } from '../lib/speak';
import { colors, fonts, fontSize, radius, spacing } from '../theme/tokens';

type Tab = keyof typeof EXAMPLE_BN;

/**
 * বলুন: opens listening in Bangla (the phone's own recognizer, bn-BD: on most phones Google's,
 * the same one the Ridmik keyboard's mic uses). When the speaker stops, the text goes to the
 * confirm card; if something is missing it is said, and the text stays to see or fix by
 * keyboard (the clip is kept for it). 🎤 starts over (clears the text and its clip). Tapping the text box opens the keyboard
 * (Ridmik's mic still works there). A two-note chime says the mic is open. বিরতি stops listening without
 * going to the card; চালিয়ে যান listens on and adds to the same text (the parts' WAVs are joined).
 * The clip (WAV, Android 13+) goes with the voice log → Drive; a command not understood
 * keeps none. Cancelled ones are dropped by the upload queue and deleted by retention.
 */
export default function SayScreen() {
  const db = useSQLiteContext();
  const { tab: tabParam = 'sale', customer, kind } = useLocalSearchParams<{ tab?: string; customer?: string; kind?: string }>();
  const tab: Tab = tabParam === 'purchase' || tabParam === 'ledger' ? tabParam : 'sale';
  /** Any tab, no customer chosen: a name alone ("সাজুর হিসাব") opens that customer's হিসাব. */
  const canLookup = !customer;
  const examples = sayExamples(tab, { lookup: canLookup });
  const [text, setText] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  /** বিরতি: stopped, the text kept, not sent; চালিয়ে যান listens on. */
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  /**
   * Offline 🎤: no internet, so the sentence is recorded (own WAV recorder) and read later.
   * 'telling' = saying "ইন্টারনেট নেই…" before the chime; 'recording' = the mic is open.
   */
  const [offline, setOffline] = useState<null | 'telling' | 'recording'>(null);
  const offlineRef = useRef(false);
  /** The saved-for-later words go on after this screen closes. */
  const keepSpeaking = useRef(false);
  /** Final pieces from before this listen (চালিয়ে যান): "nothing heard yet" counts only this listen's. */
  const piecesBefore = useRef(0);
  const beep = useAudioPlayer(BEEP);
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);
  const listeningRef = useRef(false);
  /** Between the tap and start(): a second call must not start the recognizer again (it cuts off the first). */
  const starting = useRef(false);
  /** Silent restarts after nothing was heard (recording mode gives up after ~2 s of silence). */
  const quietRetries = useRef(0);
  /**
   * This listen's final pieces. While recording, Google sends each stretch between pauses as its
   * own final result ("শোয়েব ভাই বাকি নিল" … "দেড় হাজার টাকা"); the sentence is all of them,
   * sent to the card when listening ends.
   */
  const pieces = useRef<string[]>([]);
  const leaving = useRef(false);
  /**
   * This sentence's recordings, one per listen (more after চালিয়ে যান): each file (known at start),
   * whether the recorder has closed it, waiters for that. The last one is the listen going on.
   */
  const clips = useRef<NonNullable<Clip>[]>([]);

  const intro = `${customer ? `${customer}। ` : ''}মাইক চেপে বলুন। ${examplesSpeech(examples)}`;

  const showProblem = useCallback((words: string) => {
    setProblem(words);
    scroll.current?.scrollTo({ y: 0, animated: true });
    if (words) void speak(words);
  }, []);

  const listen = useCallback(async (why: string) => {
    console.log(`MUDI_SAY listen ${why}${listeningRef.current || starting.current ? ' (already on)' : ''}`);
    if (listeningRef.current || starting.current || leaving.current) return;
    if (why !== 'quiet') quietRetries.current = 0;
    starting.current = true;
    try {
      // no internet: record now, read later (a quiet restart or চালিয়ে যান keeps the live way)
      if ((why === 'open' || why === 'tap') && !(await checkOnline())) {
        if (canRecordLater()) {
          starting.current = false;
          await recordOffline();
        } else {
          showProblem(OFFLINE_UNSUPPORTED_WORDS);
        }
        return;
      }
      // the mic is open after the beep (not on the quiet restarts): start speaking then
      if (why !== 'quiet') await playBeep();
      await startListening(why === 'quiet' ? 'retry' : why === 'resume' ? 'more' : 'fresh');
    } finally {
      starting.current = false;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // the mic closed (card, বিরতি, or gave up; not the quiet restarts, which stay listening): the falling chime
  const wasListening = useRef(false);
  useEffect(() => {
    if (wasListening.current && !listening) playEndChime();
    wasListening.current = listening;
  }, [listening]);

  async function playBeep() {
    try {
      stopSpeaking();
      beep.seekTo(0);
      beep.play();
      await new Promise((r) => setTimeout(r, BEEP_MS));
    } catch {
      // no beep: listen anyway
    }
  }

  /** fresh = a new sentence; more = চালিয়ে যান (keep the text and parts); retry = quiet restart (its silent part goes). */
  async function startListening(mode: 'fresh' | 'more' | 'retry') {
    stopSpeaking();
    input.current?.blur();
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) {
      showProblem(heardErrorWords('not-allowed'));
      return;
    }
    if (leaving.current) return;
    if (mode === 'fresh') {
      // a new try starts clean: the old text and its clips go
      clips.current.forEach(dropClip);
      clips.current = [];
      setText('');
      pieces.current = [];
    } else if (mode === 'retry') {
      // the quiet part heard nothing: its file goes, the earlier parts stay
      dropClip(clips.current.pop() ?? null);
    }
    piecesBefore.current = pieces.current.length;
    pausedRef.current = false;
    setPaused(false);
    const name = `voice_${Date.now()}.wav`;
    // the library writes it at file:// + folder + name; Android 12 and older record nothing
    clips.current.push({ uri: CAN_RECORD ? clipUri(Paths.document.uri, name) : null, ended: false, waiters: [] });
    setProblem('');
    listeningRef.current = true;
    setListening(true);
    ExpoSpeechRecognitionModule.start({
      lang: 'bn-BD',
      interimResults: true,
      maxAlternatives: 1,
      continuous: false,
      // Android 13+ only; older phones give no file (the entry is kept without a clip)
      ...(CAN_RECORD ? { recordingOptions: { persist: true, outputDirectory: Paths.document.uri, outputFileName: name } } : {}),
    });
  }

  const stopListening = useCallback(() => {
    if (!listeningRef.current) return;
    ExpoSpeechRecognitionModule.stop();
  }, []);

  /** বিরতি: stop listening; the text stays and nothing goes to the card ('end' sees pausedRef). */
  const pause = () => {
    if (!listeningRef.current) return;
    pausedRef.current = true;
    setPaused(true);
    ExpoSpeechRecognitionModule.stop();
  };

  useSpeechRecognitionEvent('result', (e) => {
    if (!listeningRef.current) return;
    const heard = (e.results[0]?.transcript ?? '').trim();
    if (e.isFinal) {
      if (heard) pieces.current.push(heard);
      const said = joinPieces(pieces.current);
      setText(said);
      // complete already: to the card now, no wait for the end of listening (~2 s); else wait for the rest
      if (said && !pausedRef.current && !fixedProblemWords(readKeyboardText(said, {}, { customer }, {}))) {
        listeningRef.current = false;
        setListening(false);
        pieces.current = [];
        ExpoSpeechRecognitionModule.stop();
        void done(said);
      }
    } else {
      setText(joinPieces(pieces.current, heard));
    }
  });
  useSpeechRecognitionEvent('audioend', (e) => {
    // the recorder closes the parts in order
    const c = clips.current.find((x) => !x.ended);
    if (!c) return;
    c.uri = e.uri ?? c.uri;
    c.ended = true;
    for (const w of c.waiters.splice(0)) w();
  });
  useSpeechRecognitionEvent('error', (e) => {
    if (!listeningRef.current) return;
    // বিরতি: 'end' keeps the text
    if (pausedRef.current) return;
    // something was heard in this listen: 'end' sends it
    if (pieces.current.length > piecesBefore.current) return;
    listeningRef.current = false;
    // nothing said yet: listen again quietly, so a slow start still works
    if (e.error === 'no-speech' && quietRetries.current < QUIET_RETRIES && !leaving.current) {
      quietRetries.current++;
      setTimeout(() => void listen('quiet'), 50);
      return;
    }
    setListening(false);
    // the internet went (or Google can't be reached) before anything was heard: record instead
    if (isNetworkError(e.error) && !pieces.current.length && canRecordLater() && !leaving.current) {
      dropClip(clips.current.pop() ?? null);
      void recordOffline();
      return;
    }
    // after চালিয়ে যান nothing more was said: back to বিরতি, the earlier text kept
    if (pieces.current.length) {
      dropClip(clips.current.pop() ?? null);
      pausedRef.current = true;
      setPaused(true);
      return;
    }
    showProblem(heardErrorWords(e.error));
  });
  useSpeechRecognitionEvent('end', () => {
    const wasOn = listeningRef.current;
    listeningRef.current = false;
    setListening(false);
    const said = joinPieces(pieces.current);
    // বিরতি: keep the pieces for চালিয়ে যান, nothing goes to the card
    if (pausedRef.current) {
      setText(said);
      return;
    }
    // listening is over: the whole sentence goes to the card
    pieces.current = [];
    if (wasOn && said) void done(said);
  });

  useEffect(() => {
    // this screen has the mic: no clip is read in the background meanwhile
    setMicBusy(true);
    // a moment after the screen opens, so the tap that opened it isn't heard
    const t = setTimeout(() => void listen('open'), 300);
    return () => {
      leaving.current = true;
      clearTimeout(t);
      if (listeningRef.current) ExpoSpeechRecognitionModule.abort();
      if (offlineRef.current) stopWav();
      setMicBusy(false);
      if (!keepSpeaking.current) stopSpeaking();
      // left without a saved command: the clips aren't kept (ones handed to a log are gone from here)
      clips.current.forEach(dropClip);
      clips.current = [];
    };
  }, [listen]);

  async function done(said = text.trim()) {
    if (busy) return;
    stopListening();
    if (!said) {
      showProblem('কিছু লেখা হয়নি। মাইক চেপে বলুন।');
      return;
    }
    setBusy(true);
    try {
      const names = await knownNames(db);
      const aliases = await customerAliasMap(db);
      const cmd = readKeyboardText(
        said,
        { knownProducts: names.products, knownCustomers: [...names.customers, ...Object.keys(aliases)], productAliases: await productAliasMap(db) },
        { customer },
        aliases,
      );
      const w = writer();
      const words = fixedProblemWords(cmd);
      // only a command that goes to the card keeps its clip; no wait for the recorder to close the
      // file (that took ~1.7 s): the card doesn't need it, and the upload waits QUEUE_DELAY_MS
      const audioPath = words ? null : oneClip();
      const logId = await createVoiceLog(db, w, { transcript: said, source: 'voice', contextTab: tabParam, audioPath });
      const lookup = words && canLookup ? customerLookup(said, names.customers, aliases) : null;
      const found = lookup ? await customerByName(db, lookup) : null;
      if (found) {
        // not an entry: show (and read) that customer's summary; kept in the debug log
        await setOutcome(db, w, logId, 'unsupported', { intent: 'customer_history_query' });
        leaving.current = true;
        stopSpeaking();
        nav.replace({ pathname: '/customer/[id]', params: { id: found.id, summary: '1' } });
        return;
      }
      if (words) {
        // the clip stays until a new try or leaving: fixed by keyboard, it still goes with the entry
        // kept in the debug log: what was heard and what was missing
        await setParsed(db, w, logId, fixedAsParsed(cmd));
        await setOutcome(db, w, logId, 'unsupported');
        showProblem(words);
        return;
      }
      leaving.current = true;
      stopSpeaking();
      nav.replace({ pathname: '/confirm', params: { logId, tab: tabParam, ...(customer ? { customer } : {}), ...(kind ? { kind } : {}) } });
    } catch (e) {
      console.warn('voice entry failed', e);
      showProblem('রাখা গেল না। আবার চাপুন।');
    } finally {
      setBusy(false);
    }
  }

  /**
   * The sentence's recording for its log (the log owns it then): the first part's file, at once (the
   * card doesn't need it; the upload waits QUEUE_DELAY_MS, 2 min). Parts from চালিয়ে যান are joined
   * into that file in the background, after the card has opened.
   */
  function oneClip(): string | null {
    const parts = clips.current.filter((c) => c.uri);
    clips.current = [];
    const first = parts[0];
    if (!first?.uri) return null;
    if (parts.length > 1) void joinParts(parts, first.uri);
    return first.uri;
  }

  /**
   * Waits until each part's file is closed, joins them into the first. Runs on after this screen has
   * gone, so it listens for the recorder itself (the screen's 'audioend' handler goes with the screen).
   */
  async function joinParts(parts: NonNullable<Clip>[], into: string) {
    const sub = ExpoSpeechRecognitionModule.addListener('audioend', (e) => {
      const c = parts.find((x) => !x.ended);
      if (!c) return;
      c.uri = e.uri ?? c.uri;
      c.ended = true;
      for (const w of c.waiters.splice(0)) w();
    });
    try {
      const closed = Promise.all(parts.map((c) => (c.ended ? null : new Promise<void>((r) => c.waiters.push(r)))));
      // after a stop, Google sometimes never ends its segmented session, so the recorder never closes
      // the last file: abort ends it, and the file is closed then
      if (!(await within(closed, CLOSE_WAIT_MS))) {
        console.log('MUDI_SAY recorder still open: abort');
        ExpoSpeechRecognitionModule.abort();
        await within(closed, CLOSE_WAIT_MS);
      }
      // a part still open has no proper file: it is left out of the join
      const ready = parts.filter((c) => c.ended);
      if (!ready.length) return;
      const bytes = await Promise.all(ready.map((c) => new File(c.uri!).bytes().catch(() => new Uint8Array())));
      const joined = joinWav(bytes);
      if (joined) new File(into).write(joined);
      for (const c of parts.slice(1)) dropClip(c);
    } catch (e) {
      console.warn('joining the recording failed', e);
    } finally {
      sub.remove();
    }
  }

  /**
   * No internet: "ইন্টারনেট নেই…", the chime, then the own recorder (16 kHz WAV) until quiet after
   * speech, nothing said, or শেষ. Heard → queued with the time speaking started (customer and kind
   * from a customer's screen), read when the internet is back, confirmed from the home card.
   */
  async function recordOffline() {
    if (offlineRef.current || leaving.current) return;
    offlineRef.current = true;
    setOffline('telling');
    setProblem('');
    setText('');
    pieces.current = [];
    clips.current.forEach(dropClip);
    clips.current = [];
    try {
      await speak(OFFLINE_START_WORDS);
      if (leaving.current) return;
      await playBeep();
      if (leaving.current) return;
      setOffline('recording');
      const uri = clipUri(Paths.document.uri, `offline_${Date.now()}.wav`);
      const r = await recordWav(uri, RECORD_LIMITS);
      playEndChime();
      if (leaving.current || !r.heard) {
        dropClip({ uri: r.uri, ended: true, waiters: [] });
        if (!leaving.current) showProblem(OFFLINE_NOTHING_WORDS);
        return;
      }
      await queueClip(db, writer(), { audioPath: r.uri, tab: tabParam, customer: customer ?? null, kind: kind ?? null, at: r.startedAt });
      queueChanged();
      leaving.current = true;
      keepSpeaking.current = true;
      void speak(OFFLINE_SAVED_WORDS);
      if (nav.canGoBack()) nav.back();
      else nav.replace('/');
    } catch (e) {
      console.warn('offline recording failed', e);
      if (!leaving.current) showProblem('রেকর্ড করা গেল না। আবার চাপুন।');
    } finally {
      offlineRef.current = false;
      if (!leaving.current) setOffline(null);
    }
  }

  const clear = () => {
    stopListening();
    pausedRef.current = false;
    setPaused(false);
    pieces.current = [];
    clips.current.forEach(dropClip);
    clips.current = [];
    setText('');
    setProblem('');
  };

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <View style={styles.top}>
          <Pressable accessibilityRole="button" accessibilityLabel="ফিরে যান" onPress={() => nav.back()} style={styles.back}>
            <Icon name="back" size={26} color={colors.ink} strokeWidth={2.2} />
          </Pressable>
          <View style={styles.flex}>
            <ScreenHeader
              title={customer ? `${customer}` : 'বলুন'}
              onListen={() => {
                stopListening();
                void speak(intro);
              }}
            />
          </View>
        </View>

        <ScrollView ref={scroll} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <View style={styles.example}>
            <View style={styles.exampleHead}>
              <Icon name="mic" size={22} color={colors.saleDark} />
              <Txt size={fontSize.body} weight="bold" color={colors.saleDark}>
                এভাবে বলুন:
              </Txt>
            </View>
            {examples.map((ex) => (
              <View key={ex.text} accessible accessibilityLabel={`${ex.label}: ${ex.text}`} style={styles.exampleItem}>
                <View style={styles.exampleLabel}>
                  <Txt size={fontSize.caption} weight="bold" color={colors.onColor}>
                    {ex.label}
                  </Txt>
                </View>
                <Txt wrap size={fontSize.label} weight="semibold">
                  {`“${ex.text}”`}
                </Txt>
              </View>
            ))}
          </View>

          {offline && (
            <View accessibilityLiveRegion="polite" style={styles.offline}>
              <Txt wrap size={fontSize.label} weight="bold" color={colors.onColor}>
                {offline === 'recording' ? 'ইন্টারনেট নেই। রেকর্ড হচ্ছে, বলুন…' : 'ইন্টারনেট নেই। টুং শব্দের পর বলুন।'}
              </Txt>
              <Txt wrap size={fontSize.caption} weight="semibold" color={colors.onDarkMuted}>
                রেখে দেব, ইন্টারনেট এলে বুঝে নেব। পরে বিক্রি পাতায় অপেক্ষার হিসাব থেকে হ্যাঁ দিন।
              </Txt>
            </View>
          )}
          {/* above the text box: below it the keyboard would cover it */}
          {!!problem && (
            <View accessibilityLiveRegion="polite" style={styles.problem}>
              <Txt wrap size={fontSize.label} weight="bold" color={colors.bakiInk}>
                {problem}
              </Txt>
            </View>
          )}
          <TextInput
            ref={input}
            value={text}
            onFocus={stopListening}
            onChangeText={(t) => {
              setText(t);
              if (problem) setProblem('');
            }}
            multiline
            accessibilityLabel="যা বললেন"
            placeholder={offline === 'recording' ? 'রেকর্ড হচ্ছে… (ইন্টারনেট এলে লেখা আসবে)' : listening ? 'শুনছি… বলুন' : 'এখানে লেখা আসবে…'}
            editable={!offline}
            placeholderTextColor={listening ? colors.saleDark : colors.muted}
            style={[styles.input, listening && styles.inputListening, !!problem && styles.inputWarn]}
          />
        </ScrollView>

        <View style={styles.actions}>
          {listening && (
            <Pressable accessibilityRole="button" accessibilityLabel="বিরতি" onPress={pause} style={({ pressed }) => [styles.pause, pressed && styles.pressed]}>
              <Icon name="pause" size={30} color={colors.ink} />
              <Txt size={fontSize.caption} weight="bold">
                বিরতি
              </Txt>
            </Pressable>
          )}
          {!!text && !listening && (
            <Pressable accessibilityRole="button" accessibilityLabel="মুছে আবার বলুন" onPress={clear} style={({ pressed }) => [styles.clear, pressed && styles.pressed]}>
              <Icon name="close" size={30} color={colors.ink} strokeWidth={2.6} />
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={offline ? 'শেষ' : listening ? 'থামুন' : paused ? 'চালিয়ে যান' : 'মাইক চেপে বলুন'}
            onPress={() => (offline ? stopWav() : listening ? stopListening() : void listen(paused ? 'resume' : 'tap'))}
            style={({ pressed }) => [styles.mic, (listening || offline === 'recording') && styles.micOn, pressed && styles.pressed]}
          >
            <Icon name={offline ? 'check' : paused && !listening ? 'play' : 'mic'} size={paused && !listening && !offline ? 28 : 34} color={listening || offline === 'recording' ? colors.onColor : colors.saleDark} strokeWidth={2.4} />
            <Txt size={paused && !listening && !offline ? fontSize.label : fontSize.button} weight="bold" color={listening || offline === 'recording' ? colors.onColor : colors.saleDark}>
              {offline ? 'শেষ' : listening ? 'থামুন' : paused ? 'চালিয়ে যান' : 'বলুন'}
            </Txt>
          </Pressable>
          {!!text && !listening && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="হয়ে গেছে"
              accessibilityState={{ disabled: busy }}
              onPress={() => void done()}
              style={({ pressed }) => [styles.done, busy && styles.disabled, pressed && styles.pressed]}
            >
              <Icon name="check" size={36} color={colors.onColor} strokeWidth={2.8} />
              <Txt size={fontSize.button} weight="bold" color={colors.onColor}>
                {busy ? 'দেখছি…' : 'হয়ে গেছে'}
              </Txt>
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', paddingLeft: spacing.screen },
  back: { width: 52, height: 52, borderRadius: radius.pill, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', marginTop: spacing.screenTop },
  body: { paddingHorizontal: spacing.screen, gap: spacing.md, paddingBottom: spacing.md },
  example: { backgroundColor: colors.saleTint, borderRadius: radius.card, padding: spacing.lg, gap: spacing.md },
  exampleItem: { gap: 4, alignItems: 'flex-start' },
  exampleLabel: { backgroundColor: colors.saleDark, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  exampleHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  input: {
    minHeight: 150,
    borderWidth: 3,
    borderColor: colors.border,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    textAlignVertical: 'top',
    fontFamily: fonts.bold,
    fontSize: fontSize.heading,
    color: colors.ink,
  },
  inputListening: { borderColor: colors.sale },
  inputWarn: { borderColor: colors.baki },
  problem: { backgroundColor: colors.bakiTint, borderRadius: radius.card, padding: spacing.lg },
  offline: { backgroundColor: colors.dark, borderRadius: radius.card, padding: spacing.lg, gap: 4 },
  actions: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.screen, paddingVertical: spacing.sm },
  clear: {
    width: 72,
    height: 72,
    borderRadius: radius.button,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mic: {
    flex: 1,
    height: 72,
    borderRadius: radius.button,
    backgroundColor: colors.saleTint,
    borderWidth: 2,
    borderColor: colors.sale,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  pause: { width: 72, height: 72, borderRadius: radius.button, backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  micOn: { backgroundColor: colors.baki, borderColor: colors.baki },
  done: { flex: 1, height: 72, borderRadius: radius.button, backgroundColor: colors.sale, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
});

/**
 * While recording, the library ends a listen after 2 s of silence, also before any speech
 * (overriding it made Google miss speech): nothing heard → listen again quietly, this many times.
 */
const QUIET_RETRIES = 3;

/** "Speak now": a soft two-note rising chime (scripts/make-chimes.py) before each listen (not the quiet restarts), which starts when it is over. */
const BEEP = require('../../assets/sounds/chime.wav') as number; // eslint-disable-line @typescript-eslint/no-require-imports
const BEEP_MS = 330;
/** "Done listening": the same chime falling. Kept outside the screen, so it plays on while the card opens. */
const END_CHIME = require('../../assets/sounds/chime-end.wav') as number; // eslint-disable-line @typescript-eslint/no-require-imports
let endPlayer: ReturnType<typeof createAudioPlayer> | null = null;
/** Record now, read later: Android 13+ (reads a file) with the native recorder in the APK. */
const canRecordLater = () => CAN_READ_LATER && canRecordWav();

function playEndChime() {
  try {
    endPlayer ??= createAudioPlayer(END_CHIME);
    endPlayer.seekTo(0);
    endPlayer.play();
  } catch {
    // no chime: nothing else changes
  }
}
/** How long to wait for the recorder to close a part's file before aborting (and again after). */
const CLOSE_WAIT_MS = 1500;

type Clip = { uri: string | null; ended: boolean; waiters: (() => void)[] } | null;

/** Recording while recognizing needs Android 13+. */
const CAN_RECORD = Platform.OS === 'android' && Number(Platform.Version) >= 33;

/** Delete a recording nobody keeps (now, or when the recorder closes it). */
function dropClip(c: Clip): void {
  if (!c) return;
  const del = () => {
    if (!c.uri) return;
    try {
      new File(c.uri).delete();
    } catch {
      // already gone
    }
  };
  if (c.ended) del();
  else c.waiters.push(del);
}
