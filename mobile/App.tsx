import { StatusBar } from 'expo-status-bar';
import * as Speech from 'expo-speech';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useRouter } from 'expo-router';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Pressable,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { deleteHistoryItem, HistoryItem, HistoryResult, loadHistory, PrescriptionLanguage, saveHistory } from './history';
import { SelectedPhoto, updatePharmaLensSession, usePharmaLensSession } from './session';

type Medicine = {
  name?: string;
  name_as_written?: string;
  dose?: string;
  frequency?: string;
  dose_english?: string;
  dose_urdu?: string;
  frequency_english?: string;
  frequency_urdu?: string;
  urdu_explanation?: string;
  explanation?: string;
  explanation_language?: 'en' | 'ur';
  generic_name?: string;
  purpose_en?: string;
  purpose_ur?: string;
  explanation_source_title?: string;
  explanation_source_url?: string;
  dose_warning?: string;
  confidence?: number;
};

type ExtractionResult = {
  prescription_language?: string;
  transcription_english?: string;
  transcription_urdu?: string;
  medicines: Medicine[];
  notes_english?: string;
  notes_urdu?: string;
  safety_note?: string;
};

const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/$/, '');
const REQUEST_TIMEOUT_MS = 180_000;
type Screen = 'start' | 'language' | 'photo' | 'schedule' | 'result' | 'history';

export function PharmaLensScreen({ screen }: { screen: Screen }) {
  const router = useRouter();
  const shutterPlayer = useAudioPlayer(require('./assets/sounds/camera-shutter.wav'));
  const shutterStatus = useAudioPlayerStatus(shutterPlayer);
  const session = usePharmaLensSession();
  const [launching, setLaunching] = useState(false);
  const [shutterPending, setShutterPending] = useState(false);
  const capsuleRotation = useRef(new Animated.Value(0)).current;
  const snapProgress = useRef(new Animated.Value(0)).current;
  const { language, photo, busy, error, history, historyError, speakingKey } = session;
  const result = session.result as ExtractionResult | null;
  const showUrdu = language === 'Urdu' && (screen === 'schedule' || screen === 'result');
  const setLanguage = (value: PrescriptionLanguage | null) => updatePharmaLensSession({ language: value });
  const setPhoto = (value: SelectedPhoto | null) => updatePharmaLensSession({ photo: value });
  const setResult = (value: ExtractionResult | null) => updatePharmaLensSession({ result: value as HistoryResult | null });
  const setBusy = (value: boolean) => updatePharmaLensSession({ busy: value });
  const setError = (value: string) => updatePharmaLensSession({ error: value });
  const setHistory = (value: HistoryItem[] | ((current: HistoryItem[]) => HistoryItem[])) => updatePharmaLensSession((current) => ({ ...current, history: typeof value === 'function' ? value(current.history) : value }));
  const setHistoryError = (value: string) => updatePharmaLensSession({ historyError: value });
  const setSpeakingKey = (value: string | null | ((current: string | null) => string | null)) => updatePharmaLensSession((current) => ({ ...current, speakingKey: typeof value === 'function' ? value(current.speakingKey) : value }));

  useEffect(() => {
    void setAudioModeAsync({ playsInSilentMode: true }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (screen !== 'start' || launching) return;
    capsuleRotation.setValue(0);
    const spin = Animated.loop(Animated.timing(capsuleRotation, {
      toValue: 1,
      duration: 4200,
      useNativeDriver: true,
    }));
    spin.start();
    return () => spin.stop();
  }, [capsuleRotation, launching, screen]);

  const playShutterAndSnap = () => {
    shutterPlayer.volume = 1;
    shutterPlayer.seekTo(0);
    shutterPlayer.play();
    Animated.timing(snapProgress, { toValue: 1, duration: 115, useNativeDriver: true }).start(({ finished }) => {
      if (finished) router.push('/language');
      setLaunching(false);
      snapProgress.setValue(0);
    });
  };

  useEffect(() => {
    if (screen === 'start' && shutterPending && shutterStatus.isLoaded) {
      setShutterPending(false);
      playShutterAndSnap();
    }
  }, [screen, shutterPending, shutterStatus.isLoaded]);

  const continueFromStart = () => {
    if (launching) return;
    setLaunching(true);
    try {
      if (shutterStatus.isLoaded) playShutterAndSnap();
      else setShutterPending(true);
    } catch {
      // Keep the transition working if audio playback is unavailable.
      setShutterPending(false);
      setLaunching(false);
    }
  };

  const startReading = () => {
    if (!language) { setError('Choose English or Urdu to continue.'); return; }
    setError('');
    router.push('/photo');
  };

  useEffect(() => {
    let mounted = true;
    loadHistory()
      .then((items) => { if (mounted) setHistory(items); })
      .catch(() => { if (mounted) setHistoryError('Prescription history is unavailable on this device.'); });
    return () => {
      mounted = false;
      void Speech.stop();
    };
  }, []);

  const readAloud = async (key: string, text: string, languageCode: string) => {
    if (speakingKey === key) {
      await Speech.stop().catch(() => undefined);
      setSpeakingKey(null);
      return;
    }
    await Speech.stop().catch(() => undefined);
    setSpeakingKey(key);
    try {
      const voices = await Speech.getAvailableVoicesAsync() as Array<{ language: string; identifier: string; quality?: string }>;
      const requestedLanguage = languageCode.toLowerCase();
      const matchingVoice = voices
        .filter((voice) => voice.language.toLowerCase().startsWith(requestedLanguage.slice(0, 2)))
        .sort((a, b) => Number(b.quality === 'Enhanced') - Number(a.quality === 'Enhanced'))[0];
      const speechOptions = {
        language: matchingVoice?.language ?? languageCode,
        voice: matchingVoice?.identifier,
        rate: requestedLanguage.startsWith('ur') ? 0.78 : 0.9,
        onStopped: () => setSpeakingKey((active) => active === key ? null : active),
        onError: () => {
          void Speech.stop();
          setSpeakingKey((active) => active === key ? null : active);
          Alert.alert('Read aloud unavailable', 'Check that your phone has a speech voice for this language.');
        },
      };
      const utterances = (text.match(/[^.!?؟۔]+[.!?؟۔]?/gu) ?? [text]).map((part) => part.trim()).filter(Boolean);
      utterances.forEach((part, index) => {
        Speech.speak(part, {
          ...speechOptions,
          onDone: index === utterances.length - 1
            ? () => setSpeakingKey((active) => active === key ? null : active)
            : undefined,
        });
      });
    } catch {
      setSpeakingKey(null);
      Alert.alert('Read aloud unavailable', 'Could not load the speech voices on this phone.');
    }
  };

  useEffect(() => {
    void Speech.stop();
    setSpeakingKey(null);
  }, [screen]);

  const openHistoryItem = (item: HistoryItem) => {
    setLanguage(item.language);
    setPhoto(null);
    setResult(item.result as ExtractionResult);
    setError('');
    router.push('/result');
  };

  const removeHistoryItem = async (id: string) => {
    try {
      await deleteHistoryItem(id);
      setHistory((items) => items.filter((item) => item.id !== id));
    } catch {
      setHistoryError('Could not delete that saved prescription.');
    }
  };

  const preparePhoto = async (asset: ImagePicker.ImagePickerAsset) => {
    try {
      const manipulator = ImageManipulator.manipulate(asset.uri);
      const longestSide = Math.max(asset.width, asset.height);
      const maxSide = 1280;
      if (longestSide > maxSide) {
        const scale = maxSide / longestSide;
        manipulator.resize({
          width: Math.round(asset.width * scale),
          height: Math.round(asset.height * scale),
        });
      }
      const rendered = await manipulator.renderAsync();
      const jpeg = await rendered.saveAsync({
        format: SaveFormat.JPEG,
        compress: 0.8,
      });
      setPhoto({ uri: jpeg.uri, fileName: 'prescription.jpg', mimeType: 'image/jpeg' });
      setResult(null);
    } catch {
      setError(showUrdu ? 'تصویر تیار نہیں ہو سکی۔ کوئی دوسری واضح تصویر منتخب کریں۔' : 'Could not prepare that photo. Try choosing another clear image.');
    }
  };

  const choosePhoto = async () => {
    setError('');
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.9,
    });
    if (!picked.canceled && picked.assets[0]) {
      await preparePhoto(picked.assets[0]);
    }
  };

  const takePhoto = async () => {
    setError('');
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setError(showUrdu ? 'فون کی ترتیبات میں کیمرے کی اجازت دیں یا تصویر منتخب کریں۔' : 'Allow camera access in your phone settings, or choose a photo instead.');
      return;
    }
    const captured = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.9,
    });
    if (!captured.canceled && captured.assets[0]) {
      await preparePhoto(captured.assets[0]);
    }
  };

  const readPrescription = async () => {
    if (!language) {
      setError(showUrdu ? 'پہلے نسخے کی زبان منتخب کریں۔' : 'Choose whether the prescription is in English or Urdu first.');
      return;
    }
    if (!photo) {
      setError(showUrdu ? 'پہلے نسخے کی تصویر لیں یا منتخب کریں۔' : 'Choose a prescription photo or take one first.');
      return;
    }
    if (!API_URL) {
      setError(showUrdu ? 'موبائل کی .env فائل میں چلتے ہوئے سرور کا پتہ درج کریں۔' : 'Set EXPO_PUBLIC_API_URL in mobile/.env to your running server address.');
      return;
    }
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location.protocol === 'https:' && !API_URL.startsWith('https://')) {
      setError('The deployed website needs a public HTTPS API URL. Set EXPO_PUBLIC_API_URL in the web deployment settings, then redeploy the web app.');
      return;
    }

    setBusy(true);
    setError('');
    setResult(null);
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      let responseStatus: number;
      let responseBody: string;
      if (Platform.OS === 'web') {
        const controller = new AbortController();
        timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        const imageResponse = await fetch(photo.uri);
        const imageBlob = await imageResponse.blob();
        const form = new FormData();
        form.append('file', imageBlob, photo.fileName || 'prescription.jpg');
        form.append('language', language);
        const webResponse = await fetch(`${API_URL}/extract`, {
          method: 'POST',
          body: form,
          signal: controller.signal,
        });
        responseStatus = webResponse.status;
        responseBody = await webResponse.text();
      } else {
        const uploadTask = FileSystem.createUploadTask(`${API_URL}/extract`, photo.uri, {
          fieldName: 'file',
          mimeType: photo.mimeType,
          httpMethod: 'POST',
          uploadType: FileSystem.FileSystemUploadType.MULTIPART,
          parameters: { language },
        });
        const timeout = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            void uploadTask.cancelAsync().catch(() => undefined);
            reject(new Error('The request timed out after 3 minutes. Check that the API server is running and try again.'));
          }, REQUEST_TIMEOUT_MS);
        });
        const nativeResponse = await Promise.race([uploadTask.uploadAsync(), timeout]);
        if (!nativeResponse) throw new Error('The upload was cancelled. Please try again.');
        responseStatus = nativeResponse.status;
        responseBody = nativeResponse.body;
      }
      if (timeoutId) clearTimeout(timeoutId);
      let payload: ExtractionResult & { detail?: string };
      try {
        payload = JSON.parse(responseBody) as ExtractionResult & { detail?: string };
      } catch {
        const status = responseStatus ? ` (HTTP ${responseStatus})` : '';
        const body = responseBody.trim();
        const message = body && body !== 'Internal Server Error'
          ? body.slice(0, 240)
          : 'The API returned a non-JSON error. Check the API server terminal for the traceback.';
        throw new Error(`Server error${status}: ${message}`);
      }
      if (responseStatus < 200 || responseStatus >= 300) {
        throw new Error(payload.detail ?? `The server could not read this image (HTTP ${responseStatus}).`);
      }
      const reading = payload;
      setResult(reading);
      setHistoryError('');
      try {
        const saved = await saveHistory(language, reading as HistoryResult);
        setHistory((items) => [saved, ...items].slice(0, 30));
      } catch {
        setHistoryError('Reading succeeded, but this prescription could not be saved on the device.');
      }
      router.push('/result');
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : 'Unable to contact the server.';
      setError(
        showUrdu
          ? urduRequestError(message)
          : Platform.OS === 'web' && /network request failed|load failed|failed to fetch|networkerror/i.test(message)
            ? `Could not reach ${API_URL}. Check that it is a public HTTPS API URL and that the API allows requests from https://pharmalens.expo.app.`
            : message.includes('Network request failed')
              ? `Could not reach ${API_URL}. Check that the server is running and that your phone can reach your computer.`
              : message,
      );
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={[styles.content, screen === 'start' && styles.introContent]}>
        {screen !== 'start' && <View style={styles.brandRow}>
          <LogoMark large={false} rotation={capsuleRotation} snapProgress={snapProgress} />
          <Text style={styles.brandName}>Pharma<Text style={styles.brandAccent}>Lens</Text></Text>
          {screen !== 'history' && <Pressable accessibilityRole="button" onPress={() => { setError(''); router.push('/history'); }} style={styles.headerAction}>
            <Text style={styles.headerActionText}>History</Text>
          </Pressable>}
        </View>}

        {(screen === 'language' || screen === 'photo' || screen === 'result' || screen === 'schedule') && <ProgressSteps current={screen === 'language' ? 1 : screen === 'photo' ? 2 : screen === 'result' ? 3 : 4} />}

        {screen === 'start' && (
          <View style={styles.introScreen}>
            <Text style={styles.welcomeTitle}>Welcome to PharmaLens</Text>
            <Text style={styles.welcomeSubtitle}>A helpful guide to reading English and Urdu prescriptions.</Text>
            <View style={styles.largeLogoHalo}>
              <LogoMark large rotation={capsuleRotation} snapProgress={snapProgress} />
            </View>
            <Text style={styles.introDescription}>Understand medicine names and directions, one prescription at a time.</Text>
            <PrimaryButton label={launching ? 'Opening…' : 'Continue'} onPress={continueFromStart} disabled={launching} />
          </View>
        )}

        {screen === 'language' && (
          <>
            <View style={styles.pageHeading}>
              <Text style={styles.eyebrow}>START A READING</Text>
              <Text style={styles.pageTitle}>Choose the prescription language</Text>
              <Text style={styles.pageSubtitle}>We’ll use this to guide the reading and show the result clearly.</Text>
            </View>
            <View style={styles.languageStack}>
              <LanguageButton rtl={false} title="English" subtitle="The prescription is written in English" selected={language === 'English'} onPress={() => { setLanguage('English'); setResult(null); setError(''); }} />
              <LanguageButton rtl={false} title="اردو" subtitle="Prescription is written in Urdu" selected={language === 'Urdu'} onPress={() => { setLanguage('Urdu'); setResult(null); setError(''); }} />
            </View>
            <View style={styles.infoCard}>
              <Text style={styles.infoTitle}>Careful reading</Text>
              <Text style={styles.infoText}>We keep medicine names and doses as written. Anything unclear is marked for you to confirm.</Text>
            </View>
            {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
            <PrimaryButton label="Continue to photo" onPress={startReading} />
          </>
        )}

        {screen === 'photo' && (
          <>
            <View style={styles.pageHeading}>
              <Text style={styles.eyebrow}>STEP 2 OF 4 · PHOTO</Text>
              <Text style={styles.pageTitle}>Add a clear photo</Text>
              <Text style={styles.pageSubtitle}>Place the whole prescription in good light and keep the writing in focus.</Text>
            </View>
            <View style={styles.photoCard}>
              {photo ? <Image source={{ uri: photo.uri }} style={styles.preview} resizeMode="contain" /> : (
                <View style={styles.photoPlaceholder}>
                  <Text style={styles.photoIcon}>＋</Text>
                  <Text style={styles.photoTitle}>Your photo preview</Text>
                  <Text style={styles.photoHint}>Take a new photo or choose one from your phone.</Text>
                </View>
              )}
              <View style={styles.photoActions}>
                <ActionButton label="Take photo" onPress={takePhoto} secondary />
                <ActionButton label="Choose photo" onPress={choosePhoto} secondary />
              </View>
            </View>
            {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
            {!API_URL && <Text style={styles.setupNote}>Set the server address in mobile/.env before reading a prescription.</Text>}
            <PrimaryButton label={busy ? 'Reading prescription…' : 'Read prescription'} disabled={!photo || busy} loading={busy} onPress={readPrescription} />
            <Pressable accessibilityRole="button" onPress={() => { setError(''); router.back(); }} style={styles.backAction}>
              <Text style={styles.backActionText}>Back to language</Text>
            </Pressable>
            <SafetyNotice showUrdu={false} />
          </>
        )}

        {screen === 'schedule' && result && (
          <>
            <View style={styles.pageHeading}>
              <Text style={styles.eyebrow}>STEP 4 OF 4 · SCHEDULE</Text>
              <Text style={styles.pageTitle}>Daily schedule</Text>
              <Text style={styles.pageSubtitle}>Review the schedule preview based on the prescription.</Text>
            </View>
            <ScheduleSection medicines={result.medicines ?? []} showUrdu={showUrdu} />
            <PrimaryButton label="Read another prescription" onPress={() => { setPhoto(null); setResult(null); setLanguage(null); setError(''); router.dismissAll(); }} />
            <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.backAction}>
              <Text style={styles.backActionText}>Back to results</Text>
            </Pressable>
            <SafetyNotice showUrdu={false} />
          </>
        )}

        {screen === 'result' && result && (
          <>
            <View style={styles.pageHeading}>
              <Text style={styles.eyebrow}>STEP 3 OF 4 · READING COMPLETE</Text>
              <Text style={styles.pageTitle}>Your reading</Text>
              <Text style={styles.pageSubtitle}>Check every detail against the prescription before acting on it.</Text>
            </View>
            <Results result={result} showUrdu={showUrdu} speakingKey={speakingKey} onReadAloud={readAloud} />
            {historyError ? <Text style={styles.historyError}>{historyError}</Text> : null}
            <PrimaryButton label="Continue to daily schedule" onPress={() => router.push('/schedule')} />
            <Pressable accessibilityRole="button" onPress={() => { setPhoto(null); setResult(null); setError(''); router.dismissAll(); }} style={styles.backAction}>
              <Text style={styles.backActionText}>Read another prescription</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => { setResult(null); setError(''); router.dismissTo('/photo'); }} style={styles.backAction}>
              <Text style={styles.backActionText}>Use a different photo</Text>
            </Pressable>
            <SafetyNotice showUrdu={false} />
          </>
        )}

        {screen === 'history' && (
          <>
            <View style={styles.pageHeading}>
              <Text style={[styles.eyebrow, showUrdu && styles.urduText]}>{showUrdu ? 'اس فون پر' : 'ON THIS PHONE'}</Text>
              <Text style={[styles.pageTitle, showUrdu && styles.urduText]}>{showUrdu ? 'محفوظ قرأتیں' : 'Saved readings'}</Text>
              <Text style={[styles.pageSubtitle, showUrdu && styles.urduText]}>{showUrdu ? 'آپ کی سابقہ قرأتیں اسی فون پر محفوظ ہیں۔ نسخے کی تصاویر محفوظ نہیں کی جاتیں۔' : 'Your history stays on this device. Prescription photos are not saved.'}</Text>
            </View>
            <HistorySection items={history} error={historyError} showUrdu={showUrdu} onOpen={openHistoryItem} onDelete={removeHistoryItem} />
            <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.backAction}>
              <Text style={styles.backActionText}>{showUrdu ? 'واپس جائیں' : 'Back to start'}</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function LogoMark({
  large,
  rotation,
  snapProgress,
}: {
  large: boolean;
  rotation: Animated.Value;
  snapProgress: Animated.Value;
}) {
  const logoSize = large ? 220 : 42;
  const cornerSize = large ? 32 : 9;
  const inset = large ? 38 : 9;
  const stroke = large ? 4 : 2;
  const snapDistance = large ? 44 : 6;
  const spin = rotation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const scale = snapProgress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.84] });
  const inward = snapProgress.interpolate({ inputRange: [0, 1], outputRange: [0, snapDistance] });
  const pillStyle = [styles.markCapsule, large && styles.markCapsuleLarge, {
    transform: [{ rotate: '-42deg' }, { rotate: spin }, { scale }],
  }];

  return (
    <View style={[styles.brandMark, large && styles.brandMarkLarge, { width: logoSize, height: logoSize }]}>
      <Animated.View style={[styles.markCorner, { width: cornerSize, height: cornerSize, top: inset, left: inset, borderTopWidth: stroke, borderLeftWidth: stroke, transform: [{ translateX: inward }, { translateY: inward }] }]} />
      <Animated.View style={[styles.markCorner, { width: cornerSize, height: cornerSize, top: inset, right: inset, borderTopWidth: stroke, borderRightWidth: stroke, transform: [{ translateX: Animated.multiply(inward, -1) }, { translateY: inward }] }]} />
      <Animated.View style={[styles.markCorner, { width: cornerSize, height: cornerSize, bottom: inset, left: inset, borderBottomWidth: stroke, borderLeftWidth: stroke, transform: [{ translateX: inward }, { translateY: Animated.multiply(inward, -1) }] }]} />
      <Animated.View style={[styles.markCorner, { width: cornerSize, height: cornerSize, bottom: inset, right: inset, borderBottomWidth: stroke, borderRightWidth: stroke, transform: [{ translateX: Animated.multiply(inward, -1) }, { translateY: Animated.multiply(inward, -1) }] }]} />
      <Animated.View style={pillStyle}>
        <View style={[styles.markCapsuleSeam, large && styles.markCapsuleSeamLarge]} />
      </Animated.View>
    </View>
  );
}

function ProgressSteps({ current }: { current: number }) {
  const labels = ['Language', 'Photo', 'Results', 'Schedule'];
  return (
    <View accessibilityLabel={`Step ${current} of 4`} style={styles.progressWrap}>
      <View style={styles.progressRail}><View style={[styles.progressRailActive, { width: `${((current - 1) / 3) * 100}%` }]} /></View>
      {labels.map((label, index) => {
        const number = index + 1;
        const active = number === current;
        const complete = number < current;
        return (
          <View key={label} style={styles.progressItem}>
            <View style={[styles.progressDot, active && styles.progressDotActive, complete && styles.progressDotComplete]}>
              <Text style={[styles.progressNumber, (active || complete) && styles.progressNumberActive]}>{complete ? '✓' : number}</Text>
            </View>
            <Text style={[styles.progressLabel, active && styles.progressLabelActive]}>{label}</Text>
          </View>
        );
      })}
    </View>
  );
}

function PrimaryButton({ label, onPress, disabled, loading }: { label: string; onPress: () => void; disabled?: boolean; loading?: boolean }) {
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.primaryButton, disabled && styles.disabled, pressed && styles.pressed]}>
      {loading ? <ActivityIndicator color="#292544" /> : <Text style={styles.primaryButtonText}>{label}</Text>}
    </Pressable>
  );
}

function SafetyNotice({ showUrdu }: { showUrdu: boolean }) {
  return (
    <View style={styles.safetyCard}>
      <Text style={[styles.safetyTitle, showUrdu && styles.urduText]}>{showUrdu ? 'دوا لینے سے پہلے تصدیق کریں' : 'Confirm before taking medicine'}</Text>
      <Text style={[styles.safetyText, showUrdu && styles.urduText]}>{showUrdu ? 'فارما لینس تحریر غلط پڑھ سکتا ہے۔ یہ تشخیص یا علاج میں تبدیلی نہیں کرتا۔ دوا اور ہدایات کی تصدیق اپنے فارماسسٹ یا ڈاکٹر سے کریں۔' : 'PharmaLens can misread handwriting. It does not diagnose or change treatment. Confirm the medicine and instructions with your pharmacist or doctor.'}</Text>
    </View>
  );
}

function LanguageButton({
  title,
  subtitle,
  selected,
  rtl,
  onPress,
}: {
  title: string;
  subtitle: string;
  selected: boolean;
  rtl: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.languageCard, rtl && styles.languageCardRtl, selected && styles.languageCardSelected]}
    >
      <View style={[styles.radio, selected && styles.radioSelected]}>
        {selected && <View style={styles.radioDot} />}
      </View>
      <View style={styles.languageCopy}>
        <Text style={[styles.languageTitle, rtl && styles.urduText]}>{title}</Text>
        <Text style={[styles.languageSubtitle, rtl && styles.urduText]}>{subtitle}</Text>
      </View>
    </Pressable>
  );
}

function ActionButton({ label, onPress, secondary }: { label: string; onPress: () => void; secondary?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.actionButton, !secondary && styles.actionButtonPrimary, pressed && styles.pressed]}
    >
      <Text style={[styles.actionButtonText, !secondary && styles.actionButtonTextPrimary]}>{label}</Text>
    </Pressable>
  );
}

function Results({
  result,
  showUrdu,
  speakingKey,
  onReadAloud,
}: {
  result: ExtractionResult;
  showUrdu: boolean;
  speakingKey: string | null;
  onReadAloud: (key: string, text: string, languageCode: string) => void;
}) {
  return (
    <View style={styles.results}>
      <Text style={styles.resultEyebrow}>READING RESULT</Text>
      {result.prescription_language && !showUrdu && (
        <Text style={styles.detectedLanguage}>Detected: {result.prescription_language}</Text>
      )}
      {!showUrdu && result.transcription_english ? (
        <View style={styles.transcriptionCard}>
          <Text style={styles.cardLabel}>IN ENGLISH</Text>
          <Text style={styles.bodyText}>{result.transcription_english}</Text>
        </View>
      ) : null}

      {result.medicines?.length ? result.medicines.map((medicine, index) => {
        const lowConfidence = typeof medicine.confidence === 'number' && medicine.confidence < 0.6;
        const nameUnclear = isUnclear(medicine.name || medicine.name_as_written) || lowConfidence;
        const doseUnclear = isUnclear(showUrdu ? medicine.dose_urdu : medicine.dose) || lowConfidence;
        const frequencyUnclear = isUnclear(showUrdu ? medicine.frequency_urdu : medicine.frequency) || lowConfidence;
        const explanation = showUrdu
          ? medicine.purpose_ur || medicine.urdu_explanation || 'اس دوا کا عام استعمال دستیاب نہیں۔ اپنے فارماسسٹ یا ڈاکٹر سے پوچھیں۔'
          : medicine.purpose_en || medicine.explanation || 'A common-use description is unavailable. Ask your pharmacist or doctor.';
        const shownName = showUrdu ? medicine.name_as_written || 'غیر واضح' : medicine.name || medicine.name_as_written || 'unclear';
        const speechKey = `medicine-${index}`;
        const speechName = showUrdu
          ? medicine.name?.trim() && !isUnclear(medicine.name)
            ? medicine.name.trim()
            : 'Medicine name unclear'
          : medicine.name || medicine.name_as_written || 'unclear';
        const speechDose = showUrdu ? medicine.dose_urdu || 'خوراک غیر واضح' : medicine.dose || 'Dose unclear';
        const speechFrequency = showUrdu ? medicine.frequency_urdu || 'استعمال کی تکرار واضح نہیں' : medicine.frequency || 'Frequency unclear';
        const speechWarning = [
          showUrdu
            ? 'عام استعمال کی یہ وضاحت AI نے بنائی ہے اور اس کی تصدیق نہیں کی گئی۔'
            : 'This AI-generated common-use description is not verified.',
          medicine.dose_warning ? (showUrdu ? urduDoseWarning(medicine.dose_warning) : medicine.dose_warning) : '',
        ].filter(Boolean).join(' ');
        const speechConfidence = typeof medicine.confidence === 'number'
          ? (showUrdu ? `قرأت کا اعتماد ${Math.round(medicine.confidence * 100)} فیصد` : `Reading confidence ${Math.round(medicine.confidence * 100)} percent`)
          : '';
        const speechUnclear = nameUnclear || doseUnclear || frequencyUnclear
          ? (showUrdu ? 'کچھ معلومات واضح نہیں یا کم اعتماد کے ساتھ پڑھی گئی ہیں۔' : 'Some details are unclear or were read with low confidence.')
          : '';
        const speechCaution = showUrdu
          ? 'دوا لینے سے پہلے اپنے فارماسسٹ یا ڈاکٹر سے تصدیق کریں۔ فارما لینس تحریر غلط پڑھ سکتا ہے اور طبی مشورے کا متبادل نہیں ہے۔'
          : 'Confirm with your pharmacist or doctor. PharmaLens can misread handwriting and is not medical advice.';
        const speechPurpose = explanation;
        const speechText = showUrdu
          ? speechName
          : [speechName, `Dose: ${speechDose}`, `Frequency: ${speechFrequency}`, speechPurpose, speechWarning, speechConfidence, speechUnclear, speechCaution].filter(Boolean).join('. ');
        return (
        <View key={`${medicine.name ?? 'medicine'}-${index}`} style={styles.medicineCard}>
          <View style={[styles.medicineHeading, showUrdu && styles.rtlRow]}>
            <Text style={styles.medicineIndex}>{showUrdu ? `۰${index + 1}` : `0${index + 1}`}</Text>
            <Text style={[styles.medicineName, showUrdu && styles.urduText, nameUnclear && styles.unclearHighlight]}>{shownName}</Text>
          </View>
          {!showUrdu && medicine.name_as_written && medicine.name_as_written !== medicine.name ? (
            <Text style={[styles.bodyText, styles.urduText]}>{medicine.name_as_written}</Text>
          ) : null}
          <View style={[styles.detailRow, showUrdu && styles.rtlRow]}>
            <Detail label={showUrdu ? 'خوراک' : 'DOSE AS READ'} value={showUrdu ? medicine.dose_urdu : medicine.dose} uncertain={doseUnclear} rtl={showUrdu} showUrdu={showUrdu} />
            <Detail label={showUrdu ? 'استعمال کی تکرار' : 'HOW OFTEN'} value={showUrdu ? medicine.frequency_urdu : medicine.frequency} uncertain={frequencyUnclear} rtl={showUrdu} showUrdu={showUrdu} />
          </View>
          {!showUrdu && medicine.dose_english ? <Detail label="DOSE IN ENGLISH" value={medicine.dose_english} /> : null}
          {!showUrdu && medicine.frequency_english ? <Detail label="FREQUENCY" value={medicine.frequency_english} /> : null}
          <Detail label={showUrdu ? 'عام استعمال' : 'COMMON USE'} value={explanation} rtl={showUrdu} showUrdu={showUrdu} />
          {medicine.explanation_source_url ? <Pressable accessibilityRole="link" onPress={() => { void Linking.openURL(medicine.explanation_source_url!); }} style={styles.sourceLink}><Text style={styles.sourceLinkText}>{showUrdu ? `ماخذ: ${medicine.explanation_source_title || 'طبی حوالہ'}` : `Source: ${medicine.explanation_source_title || 'medical reference'}`}</Text></Pressable> : null}
          <Pressable
            accessibilityRole="button"
            onPress={() => onReadAloud(speechKey, speechText, 'en-US')}
            style={({ pressed }) => [styles.listenButton, pressed && styles.pressed]}
          >
            <Text style={styles.listenButtonText}>{speakingKey === speechKey ? 'Stop reading' : '🔊 Read this medicine box aloud'}</Text>
          </Pressable>
          <Text style={[styles.warning, showUrdu && styles.urduText]}>
            {showUrdu
              ? 'عام استعمال کی وضاحت AI نے بنائی ہے اور اس کی تصدیق نہیں کی گئی۔ دوا اور خوراک فارماسسٹ یا ڈاکٹر سے تصدیق کریں۔'
              : 'Common-use information is AI-generated and not verified. Confirm the medicine and dose with a pharmacist or doctor.'}
            {medicine.dose_warning ? ` ${showUrdu ? urduDoseWarning(medicine.dose_warning) : medicine.dose_warning}` : ''}
          </Text>
          {typeof medicine.confidence === 'number' ? (
            <Text style={[styles.confidence, showUrdu && styles.urduText]}>{showUrdu ? `قرأت کا اعتماد: ${Math.round(medicine.confidence * 100)}٪` : `Reading confidence: ${Math.round(medicine.confidence * 100)}%`}</Text>
          ) : null}
          {(nameUnclear || doseUnclear || frequencyUnclear) && (
            <Text style={[styles.unclearHint, showUrdu && styles.urduText]}>{showUrdu ? 'نمایاں کی گئی معلومات غیر واضح ہیں یا ان پر اعتماد کم ہے۔ فارماسسٹ سے تصدیق کریں۔' : 'Highlighted details are unclear or lower confidence. Ask your pharmacist to confirm them.'}</Text>
          )}
        </View>
        );
      }) : <Text style={styles.bodyText}>No medicine entries were returned. Ask a pharmacist to read the prescription.</Text>}

      {!showUrdu && result.notes_english ? <Text style={styles.resultNote}>{result.notes_english}</Text> : null}
    </View>
  );
}

function isUnclear(value?: string) {
  return !value?.trim() || /\b(?:unclear|unreadable|illegible)\b/i.test(value) || /(?:غیر واضح|واضح نہیں)/.test(value);
}

function urduRequestError(message: string) {
  if (/Network request failed|could not reach|connect/i.test(message)) return 'سرور سے رابطہ نہیں ہو سکا۔ سرور چلنے اور فون کے اسی وائی فائی سے منسلک ہونے کی تصدیق کریں۔';
  if (/timeout|timed out|longer than 60 seconds/i.test(message)) return 'درخواست کا وقت ختم ہو گیا۔ واضح اور چھوٹی تصویر سے دوبارہ کوشش کریں۔';
  if (/Gemini API error|Gemini/i.test(message)) return 'قرأت کی سروس جواب نہیں دے سکی۔ سرور کی ٹرمینل میں تفصیل دیکھیں اور دوبارہ کوشش کریں۔';
  if (/unreadable response|invalid JSON|unexpected result format/i.test(message)) return 'سرور سے درست جواب نہیں ملا۔ سرور کی ٹرمینل دیکھیں اور دوبارہ کوشش کریں۔';
  return 'نسخہ پڑھا نہیں جا سکا۔ دوبارہ کوشش کریں یا فارماسسٹ سے تصدیق کریں۔';
}

function urduDoseWarning(warning: string) {
  if (warning.includes('Dose is unclear')) return 'خوراک واضح نہیں؛ فارماسسٹ یا ڈاکٹر سے تصدیق کریں۔';
  if (warning.includes('multiple or ambiguous')) return 'خوراک کی ایک سے زیادہ یا مبہم مقدار درج ہے؛ فارماسسٹ یا ڈاکٹر سے تصدیق کریں۔';
  if (warning.includes('unusually large')) return 'یہ مقدار ایک خوراک کے لیے غیر معمولی طور پر زیادہ لگتی ہے؛ فارماسسٹ یا ڈاکٹر سے تصدیق کریں۔';
  return 'خوراک کی خودکار جانچ نہیں ہو سکی؛ فارماسسٹ یا ڈاکٹر سے تصدیق کریں۔';
}

function ScheduleSection({ medicines, showUrdu }: { medicines: Medicine[]; showUrdu: boolean }) {
  const schedule = buildReminderPlan(medicines, showUrdu);
  return (
    <View style={styles.scheduleSection}>
      <Text style={[styles.sectionTitle, showUrdu && styles.urduText]}>{showUrdu ? 'روزانہ کا شیڈول' : 'Daily schedule'}</Text>
      <View style={styles.scheduleCard}>
        {schedule.length ? schedule.map((entry, index) => (
          <View key={`${entry.label}-${entry.medicine}-${index}`} style={[styles.scheduleRow, showUrdu && styles.rtlRow]}>
            <Text style={[styles.scheduleTime, showUrdu && styles.urduText]}>{entry.label}</Text>
            <Text style={[styles.scheduleMedicine, showUrdu && styles.urduText]}>{entry.medicine}</Text>
            <Text style={[styles.scheduleDose, showUrdu && styles.urduText]}>{entry.dose}</Text>
          </View>
        )) : <Text style={[styles.scheduleEmpty, showUrdu && styles.urduText]}>{showUrdu ? 'نسخے میں اوقات واضح نہیں، اس لیے شیڈول نہیں بنایا گیا۔' : 'The frequency could not be read clearly, so no schedule preview is shown.'}</Text>}
        <Text style={[styles.scheduleHint, showUrdu && styles.urduText]}>
          {showUrdu
            ? 'یہ صرف نسخے سے بنائی گئی جھلک ہے، الارم یا خوراک کی ہدایت نہیں۔ دوا لینے سے پہلے فارماسسٹ سے تصدیق کریں۔'
            : 'This is only a preview based on the prescription. It is not an alarm or dosing instruction. Confirm with your pharmacist.'}
        </Text>
      </View>
    </View>
  );
}

function buildReminderPlan(medicines: Medicine[], showUrdu: boolean) {
  const plan: { label: string; medicine: string; dose: string }[] = [];
  for (const medicine of medicines) {
    const frequency = (medicine.frequency_english || medicine.frequency || '').trim();
    const displayFrequency = showUrdu ? (medicine.frequency_urdu || '') : (medicine.frequency_english || medicine.frequency || frequency);
    const lower = frequency.toLowerCase();
    const dose = showUrdu ? (medicine.dose_urdu || 'خوراک واضح نہیں') : (medicine.dose?.trim() || 'Dose unclear');
    const name = showUrdu ? (medicine.name_as_written?.trim() || 'غیر واضح') : (medicine.name?.trim() || medicine.name_as_written?.trim() || 'unclear');
    const slots =
      /\b(?:once\s+(?:a|per)\s+day|once\s+daily|one\s+time\s+(?:a|per)\s+day|one\s+time\s+daily|1\s*(?:time|x)\s+(?:a|per)\s+day|1\s*x\s*daily|od)\b/.test(lower) ? ['Morning']
      : /\b(?:twice\s+(?:a|per)\s+day|twice\s+daily|two\s+times\s+(?:a|per)\s+day|two\s+times\s+daily|2\s*(?:times|x)\s+(?:a|per)\s+day|2\s*x\s*daily|bid|bd)\b/.test(lower) ? ['Morning', 'Night']
      : /\b(?:thrice\s+(?:a|per)\s+day|thrice\s+daily|three\s+times\s+(?:a|per)\s+day|three\s+times\s+daily|3\s*(?:times|x)\s+(?:a|per)\s+day|3\s*x\s*daily|tid|tds)\b/.test(lower) ? ['Morning', 'Afternoon', 'Night']
      : /\b(?:four\s+times\s+(?:a|per)\s+day|four\s+times\s+daily|4\s*(?:times|x)\s+(?:a|per)\s+day|4\s*x\s*daily|qid|qds)\b/.test(lower) ? ['Morning', 'Noon', 'Evening', 'Night']
      : [];
    if (slots.length) {
      const urduLabels: Record<string, string> = { Morning: 'صبح', Afternoon: 'دوپہر', Noon: 'دوپہر', Evening: 'شام', Night: 'رات' };
      for (const slot of slots) {
        plan.push({ label: showUrdu ? urduLabels[slot] : slot, medicine: name, dose });
      }
    } else if (displayFrequency && !isUnclear(displayFrequency)) {
      plan.push({ label: showUrdu ? 'نسخے کے مطابق' : 'As written', medicine: name, dose: `${displayFrequency} · ${dose}` });
    }
  }
  return plan;
}

function Detail({ label, value, rtl, uncertain, showUrdu }: { label: string; value?: string; rtl?: boolean; uncertain?: boolean; showUrdu?: boolean }) {
  return (
    <View style={[styles.detail, rtl && styles.detailRtl]}>
      <Text style={[styles.detailLabel, rtl && styles.urduText]}>{label}</Text>
      <Text style={[styles.detailValue, rtl && styles.urduText, uncertain && styles.unclearHighlight]}>{value || (showUrdu ? 'غیر واضح' : 'unclear')}</Text>
    </View>
  );
}

function HistorySection({
  items,
  error,
  showUrdu,
  onOpen,
  onDelete,
}: {
  items: HistoryItem[];
  error: string;
  showUrdu: boolean;
  onOpen: (item: HistoryItem) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <View style={styles.historySection}>
      <Text style={[styles.sectionTitle, showUrdu && styles.urduText]}>{showUrdu ? 'اس فون پر محفوظ' : 'Saved on this phone'}</Text>
      <Text style={[styles.historyHint, showUrdu && styles.urduText]}>{showUrdu ? 'صرف قرأت محفوظ ہے۔ نسخے کی تصاویر فون پر محفوظ نہیں کی جاتیں۔' : 'Only the reading is saved here. Prescription photos are not stored.'}</Text>
      {error ? <Text style={[styles.historyError, showUrdu && styles.urduText]}>{showUrdu ? 'محفوظ قرأتوں کی فہرست دستیاب نہیں۔' : error}</Text> : null}
      {items.length === 0 ? (
        <Text style={[styles.historyEmpty, showUrdu && styles.urduText]}>{showUrdu ? 'آپ کی حالیہ قرأتیں یہاں دکھائی دیں گی۔' : 'Your recent readings will appear here.'}</Text>
      ) : items.map((item) => {
        const firstMedicine = item.result.medicines?.[0];
        const firstName = showUrdu ? firstMedicine?.name_as_written || firstMedicine?.name || 'نسخے کی قرأت' : firstMedicine?.name || 'Prescription reading';
        const count = item.result.medicines?.length ?? 0;
        return (
          <View key={item.id} style={styles.historyCard}>
            <View style={styles.historyInfo}>
              <Text style={[styles.historyName, showUrdu && styles.urduText]}>{firstName}</Text>
              <Text style={[styles.historyDate, showUrdu && styles.urduText]}>{showUrdu ? `${new Date(item.savedAt).toLocaleString('ur-PK')} · ${count.toLocaleString('ur-PK')} دوائیں` : `${new Date(item.savedAt).toLocaleString()} · ${count} medicine${count === 1 ? '' : 's'}`}</Text>
            </View>
            <Pressable accessibilityRole="button" onPress={() => onOpen(item)} style={styles.historyAction}>
              <Text style={styles.historyActionText}>{showUrdu ? 'کھولیں' : 'Open'}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => onDelete(item.id)} style={styles.historyDelete}>
              <Text style={styles.historyDeleteText}>{showUrdu ? 'حذف کریں' : 'Delete'}</Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F4EFE5' },
  content: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 36 },
  introContent: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 28, paddingTop: 24, paddingBottom: 30 },
  introScreen: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', width: '100%' },
  largeLogoHalo: { width: 260, height: 260, borderRadius: 130, backgroundColor: '#5146DA', alignItems: 'center', justifyContent: 'center', marginBottom: 28 },
  welcomeTitle: { color: '#292544', fontSize: 33, lineHeight: 40, fontWeight: '900', textAlign: 'center', letterSpacing: -0.7 },
  welcomeSubtitle: { color: '#6E685F', fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 8, marginBottom: 28, maxWidth: 310 },
  introDescription: { color: '#6E685F', fontSize: 13, lineHeight: 20, textAlign: 'center', marginBottom: 18, maxWidth: 310 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 18 },
  brandMark: { width: 42, height: 42, borderRadius: 13, backgroundColor: '#F5B84B', alignItems: 'center', justifyContent: 'center' },
  brandMarkLarge: { borderRadius: 46 },
  markCorner: { position: 'absolute', width: 9, height: 9, borderColor: '#292544' },
  markCapsule: { width: 17, height: 8, borderRadius: 5, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  markCapsuleLarge: { width: 82, height: 36, borderRadius: 20 },
  markCapsuleSeam: { width: 1.5, height: 7, backgroundColor: '#4D43D6' },
  markCapsuleSeamLarge: { width: 3, height: 31 },
  brandName: { color: '#292544', fontSize: 18, fontWeight: '900', flex: 1, letterSpacing: -0.5 },
  brandAccent: { color: '#5146DA' },
  headerAction: { paddingHorizontal: 13, paddingVertical: 9, borderRadius: 10, backgroundColor: '#FFFDFA', borderWidth: 1, borderColor: '#DDD6CA' },
  headerActionText: { color: '#5146DA', fontSize: 12, fontWeight: '800' },
  sectionTitle: { color: '#292544', fontSize: 16, fontWeight: '900', marginBottom: 10 },
  version: { color: '#827C72', fontSize: 8, fontWeight: '800', letterSpacing: 0.7 },
  progressWrap: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, marginBottom: 26, position: 'relative' },
  progressRail: { position: 'absolute', height: 2, backgroundColor: '#DDD6CA', left: '12.5%', right: '12.5%', top: 14, zIndex: 0 },
  progressRailActive: { height: 2, backgroundColor: '#5146DA' },
  progressItem: { flex: 1, alignItems: 'center', position: 'relative', zIndex: 1 },
  progressDot: { width: 29, height: 29, borderRadius: 15, borderWidth: 1.5, borderColor: '#CFC8BC', backgroundColor: '#F4EFE5', alignItems: 'center', justifyContent: 'center', zIndex: 2, elevation: 2 },
  progressDotActive: { borderColor: '#5146DA', backgroundColor: '#5146DA' },
  progressDotComplete: { borderColor: '#5146DA', backgroundColor: '#ECEBFA' },
  progressNumber: { color: '#827C72', fontSize: 11, fontWeight: '800' },
  progressNumberActive: { color: '#FFFFFF' },
  progressLabel: { color: '#827C72', fontSize: 10, fontWeight: '700', marginTop: 7 },
  progressLabelActive: { color: '#292544', fontWeight: '900' },
  pageHeading: { marginBottom: 21 },
  eyebrow: { color: '#5146DA', fontSize: 10, fontWeight: '900', letterSpacing: 1.2, marginBottom: 8 },
  pageTitle: { color: '#292544', fontSize: 27, lineHeight: 32, fontWeight: '900', letterSpacing: -0.6 },
  pageSubtitle: { color: '#6E685F', fontSize: 13, lineHeight: 19, marginTop: 8 },
  languageStack: { gap: 10 },
  languageCard: { minHeight: 72, borderRadius: 13, borderWidth: 1.5, borderColor: '#D9D2C7', backgroundColor: '#FFFDFA', padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  languageCardRtl: { flexDirection: 'row-reverse' },
  languageCardSelected: { borderColor: '#5146DA', backgroundColor: '#ECEBFA' },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: '#A7A094', alignItems: 'center', justifyContent: 'center' },
  radioSelected: { borderColor: '#5146DA' },
  radioDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#5146DA' },
  languageCopy: { flex: 1 },
  languageTitle: { color: '#292544', fontSize: 16, fontWeight: '900' },
  languageSubtitle: { color: '#716B62', fontSize: 11, marginTop: 4 },
  infoCard: { backgroundColor: '#ECEBFA', borderRadius: 12, padding: 14, marginTop: 16, marginBottom: 18 },
  infoTitle: { color: '#292544', fontSize: 12, fontWeight: '900', marginBottom: 5 },
  infoText: { color: '#514D61', fontSize: 12, lineHeight: 18 },
  hint: { color: '#6E685F', fontSize: 12, lineHeight: 18, marginTop: 10, marginBottom: 22 },
  photoCard: { borderRadius: 15, borderWidth: 1, borderColor: '#D9D2C7', backgroundColor: '#FFFDFA', padding: 12, marginBottom: 12 },
  photoPlaceholder: { height: 174, borderRadius: 9, backgroundColor: '#F7F3EA', borderWidth: 1, borderStyle: 'dashed', borderColor: '#CFC6B8', alignItems: 'center', justifyContent: 'center', padding: 16 },
  photoIcon: { width: 42, height: 42, borderRadius: 13, overflow: 'hidden', textAlign: 'center', textAlignVertical: 'center', backgroundColor: '#F5B84B', color: '#292544', fontSize: 25, fontWeight: '700', marginBottom: 10 },
  photoTitle: { color: '#292544', fontSize: 14, fontWeight: '800' },
  photoHint: { color: '#817B71', fontSize: 11, marginTop: 5, textAlign: 'center' },
  preview: { height: 240, width: '100%', borderRadius: 9, backgroundColor: '#F7F3EA' },
  photoActions: { flexDirection: 'row', gap: 9, marginTop: 11 },
  photoActionsRtl: { flexDirection: 'row-reverse' },
  actionButton: { minHeight: 44, flex: 1, paddingHorizontal: 12, borderRadius: 9, borderWidth: 1.5, borderColor: '#5146DA', alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFDFA' },
  actionButtonPrimary: { backgroundColor: '#5146DA', borderColor: '#5146DA' },
  actionButtonText: { color: '#5146DA', fontWeight: '800', fontSize: 13 },
  actionButtonTextPrimary: { color: '#FFFFFF' },
  primaryButton: { minHeight: 52, borderRadius: 12, backgroundColor: '#F5B84B', alignItems: 'center', justifyContent: 'center', marginTop: 4, marginBottom: 9, paddingHorizontal: 16 },
  primaryButtonText: { color: '#292544', fontSize: 15, fontWeight: '900' },
  backAction: { alignSelf: 'center', paddingVertical: 12, paddingHorizontal: 16, marginBottom: 16 },
  backActionText: { color: '#5146DA', fontSize: 13, fontWeight: '800' },
  readButton: { minHeight: 54, borderRadius: 11, backgroundColor: '#F5B84B', alignItems: 'center', justifyContent: 'center', marginBottom: 13 },
  readButtonText: { color: '#292544', fontSize: 15, fontWeight: '900' },
  pressed: { opacity: 0.78 },
  disabled: { opacity: 0.6 },
  error: { color: '#983D3C', backgroundColor: '#FBE9E4', borderRadius: 9, padding: 12, fontSize: 13, lineHeight: 19, marginBottom: 12 },
  setupNote: { color: '#67521C', backgroundColor: '#F8E7B9', borderRadius: 9, padding: 12, fontSize: 12, lineHeight: 18, marginBottom: 14 },
  results: { marginTop: 14, marginBottom: 18 },
  resultEyebrow: { color: '#5146DA', fontWeight: '900', fontSize: 10, letterSpacing: 1.4, marginBottom: 5 },
  detectedLanguage: { color: '#807A70', fontSize: 12, marginBottom: 10 },
  transcriptionCard: { backgroundColor: '#FFFDFA', borderRadius: 11, borderWidth: 1, borderColor: '#DDD6CA', padding: 14, marginBottom: 9 },
  transcriptionMissing: { color: '#6E685F', backgroundColor: '#FFFDFA', borderRadius: 10, padding: 13, fontSize: 13, lineHeight: 20 },
  cardLabel: { color: '#807A70', fontSize: 9, fontWeight: '900', letterSpacing: 1, marginBottom: 7 },
  bodyText: { color: '#3A3748', fontSize: 14, lineHeight: 21 },
  urduText: { textAlign: 'right', writingDirection: 'rtl', fontSize: 16, lineHeight: 25 },
  rtlRow: { flexDirection: 'row-reverse' },
  medicineCard: { backgroundColor: '#FFFDFA', borderRadius: 12, borderWidth: 1, borderColor: '#DDD6CA', padding: 15, marginTop: 9 },
  medicineHeading: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 9 },
  medicineIndex: { color: '#5146DA', fontSize: 11, fontWeight: '900' },
  medicineName: { flex: 1, color: '#292544', fontSize: 17, fontWeight: '900' },
  detailRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  detail: { flex: 1, marginTop: 10, minWidth: 0 },
  detailRtl: { alignItems: 'flex-end' },
  detailLabel: { color: '#898377', fontSize: 10, fontWeight: '800', marginBottom: 4 },
  detailValue: { color: '#393645', fontSize: 14, fontWeight: '700', lineHeight: 20 },
  warning: { color: '#77500A', backgroundColor: '#F8E7B9', padding: 9, borderRadius: 7, fontSize: 12, lineHeight: 18, marginTop: 11 },
  unclearHighlight: { color: '#5D4311', backgroundColor: '#F8E7B9', overflow: 'hidden', borderRadius: 4, paddingHorizontal: 3 },
  unclearHint: { color: '#77500A', fontSize: 11, lineHeight: 16, marginTop: 10 },
  confidence: { color: '#807A70', fontSize: 10, marginTop: 8 },
  listenButton: { alignSelf: 'flex-start', backgroundColor: '#ECEBFA', borderRadius: 8, paddingVertical: 9, paddingHorizontal: 12, marginTop: 10 },
  listenButtonText: { color: '#5146DA', fontSize: 12, fontWeight: '800' },
  scheduleCard: { backgroundColor: '#292544', borderRadius: 13, padding: 15, marginTop: 12, marginBottom: 8 },
  scheduleSection: { marginTop: 21, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#DDD6CA' },
  scheduleTitle: { color: '#F5B84B', fontSize: 14, fontWeight: '900', marginBottom: 8 },
  scheduleRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#514B68', gap: 8 },
  scheduleTime: { color: '#F5B84B', width: 76, fontSize: 12, fontWeight: '900' },
  scheduleMedicine: { flex: 1, color: '#FFFDF7', fontSize: 13, fontWeight: '800' },
  scheduleDose: { color: '#D0CCDF', fontSize: 11, textAlign: 'right', maxWidth: 120 },
  scheduleHint: { color: '#D0CCDF', fontSize: 10, lineHeight: 15, marginTop: 10 },
  scheduleEmpty: { color: '#FFFDF7', fontSize: 12, lineHeight: 19 },
  historySection: { marginTop: 8, marginBottom: 18 },
  historyHint: { color: '#6E685F', fontSize: 11, lineHeight: 16, marginTop: -5, marginBottom: 8 },
  historyEmpty: { color: '#807A70', backgroundColor: '#FFFDFA', borderRadius: 9, padding: 12, fontSize: 12 },
  historyError: { color: '#983D3C', backgroundColor: '#FBE9E4', borderRadius: 8, padding: 10, fontSize: 11, marginBottom: 8 },
  historyCard: { flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 10, borderWidth: 1, borderColor: '#DDD6CA', backgroundColor: '#FFFDFA', padding: 10, marginTop: 7 },
  historyInfo: { flex: 1, minWidth: 0 },
  historyName: { color: '#292544', fontSize: 12, fontWeight: '800' },
  historyDate: { color: '#807A70', fontSize: 9, marginTop: 4 },
  historyAction: { paddingVertical: 8, paddingHorizontal: 8 },
  historyActionText: { color: '#5146DA', fontSize: 11, fontWeight: '900' },
  historyDelete: { paddingVertical: 8, paddingHorizontal: 5 },
  historyDeleteText: { color: '#983D3C', fontSize: 10, fontWeight: '800' },
  resultNote: { color: '#5F5A50', fontSize: 13, lineHeight: 20, marginTop: 12 },
  sourceLink: { alignSelf: 'flex-start', marginTop: 8, paddingVertical: 3 },
  sourceLinkText: { color: '#5146DA', fontSize: 11, fontWeight: '800', textDecorationLine: 'underline' },
  safetyCard: { borderRadius: 13, backgroundColor: '#292544', padding: 15, marginTop: 16, marginBottom: 8 },
  safetyTitle: { color: '#F5B84B', fontWeight: '900', fontSize: 13, marginBottom: 5 },
  safetyText: { color: '#E0DCE8', fontSize: 12, lineHeight: 18 },
});
