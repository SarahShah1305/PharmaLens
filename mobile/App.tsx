import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

type PrescriptionLanguage = 'English' | 'Urdu';
type SelectedPhoto = { uri: string; fileName: string; mimeType: string };

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

export default function App() {
  const [language, setLanguage] = useState<PrescriptionLanguage | null>(null);
  const [photo, setPhoto] = useState<SelectedPhoto | null>(null);
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const preparePhoto = async (asset: ImagePicker.ImagePickerAsset) => {
    try {
      const manipulator = ImageManipulator.manipulate(asset.uri);
      const longestSide = Math.max(asset.width, asset.height);
      const maxSide = 2576;
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
        compress: 0.92,
      });
      setPhoto({ uri: jpeg.uri, fileName: 'prescription.jpg', mimeType: 'image/jpeg' });
      setResult(null);
    } catch {
      setError('Could not prepare that photo. Try choosing another clear image.');
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
      setError('Allow camera access in your phone settings, or choose a photo instead.');
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
      setError('Choose whether the prescription is in English or Urdu first.');
      return;
    }
    if (!photo) {
      setError('Choose a prescription photo or take one first.');
      return;
    }
    if (!API_URL) {
      setError('Set EXPO_PUBLIC_API_URL in mobile/.env to your running server address.');
      return;
    }

    setBusy(true);
    setError('');
    setResult(null);
    const form = new FormData();
    form.append('language', language);
    form.append(
      'file',
      {
        uri: photo.uri,
        name: photo.fileName ?? 'prescription.jpg',
        type: photo.mimeType ?? 'image/jpeg',
      } as unknown as Blob,
    );

    try {
      const response = await fetch(`${API_URL}/extract`, {
        method: 'POST',
        body: form,
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.detail ?? 'The server could not read this image.');
      }
      setResult(payload as ExtractionResult);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : 'Unable to contact the server.';
      setError(
        message.includes('Network request failed')
          ? `Could not reach ${API_URL}. Check that the server is running and that your phone can reach your Mac.`
          : message,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.brandRow}>
          <View style={styles.brandMark}>
            <View style={[styles.markCorner, styles.markTopLeft]} />
            <View style={[styles.markCorner, styles.markTopRight]} />
            <View style={[styles.markCorner, styles.markBottomLeft]} />
            <View style={[styles.markCorner, styles.markBottomRight]} />
            <View style={styles.markCapsule}><View style={styles.markCapsuleSeam} /></View>
          </View>
          <Text style={styles.brandName}>Pharma<Text style={styles.brandAccent}>Lens</Text></Text>
          <Text style={styles.version}>PRESCRIPTION / 01</Text>
        </View>

        <View style={styles.hero}>
          <Text style={styles.eyebrow}>A CLEARER READ, BY DESIGN</Text>
          <Text style={styles.title}>Make sense of{ '\n' }the small print.</Text>
          <Text style={styles.subtitle}>
            Choose the prescription language, then take a clear photo or upload one.
          </Text>
        </View>

        <Text style={styles.sectionTitle}>1. What language is the prescription?</Text>
        <View style={styles.languageRow}>
          <LanguageButton
            title="English"
            subtitle="English prescription"
            selected={language === 'English'}
            onPress={() => { setLanguage('English'); setResult(null); setError(''); }}
          />
          <LanguageButton
            title="اردو"
            subtitle="Urdu prescription"
            selected={language === 'Urdu'}
            onPress={() => { setLanguage('Urdu'); setResult(null); setError(''); }}
          />
        </View>
        <Text style={styles.hint}>
          Urdu prescriptions are shown in Urdu and English. We keep medicine and dose details as written; we don’t guess missing text.
        </Text>

        <Text style={styles.sectionTitle}>2. Add a prescription photo</Text>
        <View style={styles.photoCard}>
          {photo ? (
            <Image source={{ uri: photo.uri }} style={styles.preview} resizeMode="contain" />
          ) : (
            <View style={styles.photoPlaceholder}>
              <Text style={styles.photoIcon}>⌖</Text>
              <Text style={styles.photoTitle}>Your prescription goes here</Text>
              <Text style={styles.photoHint}>Make sure the writing is clear and well lit.</Text>
            </View>
          )}
          <View style={styles.photoActions}>
            <ActionButton label="Take a photo" onPress={takePhoto} secondary />
            <ActionButton label="Upload photo" onPress={choosePhoto} secondary />
          </View>
        </View>

        {photo && (
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={readPrescription}
            style={({ pressed }) => [styles.readButton, pressed && styles.pressed, busy && styles.disabled]}
          >
            {busy ? <ActivityIndicator color="#292544" /> : <Text style={styles.readButtonText}>Read prescription</Text>}
          </Pressable>
        )}

        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        {!API_URL && (
          <Text style={styles.setupNote}>
            Setup needed: set the API address in `mobile/.env` before connecting to the reading service.
          </Text>
        )}

        {result && <Results result={result} showUrdu={language === 'Urdu'} />}

        <View style={styles.safetyCard}>
          <Text style={styles.safetyTitle}>Please confirm before taking medicine</Text>
          <Text style={styles.safetyText}>
            PharmaLens helps read handwriting. It can make mistakes and does not diagnose or change treatment. Confirm the name and instructions with your pharmacist or doctor.
          </Text>
        </View>
        <Text style={styles.footer}>
          Your photo is sent to the project server and its configured AI provider for reading. Don’t upload identifiable prescriptions unless you have permission.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function LanguageButton({
  title,
  subtitle,
  selected,
  onPress,
}: {
  title: string;
  subtitle: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.languageCard, selected && styles.languageCardSelected]}
    >
      <View style={[styles.radio, selected && styles.radioSelected]}>
        {selected && <View style={styles.radioDot} />}
      </View>
      <View>
        <Text style={styles.languageTitle}>{title}</Text>
        <Text style={styles.languageSubtitle}>{subtitle}</Text>
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

function Results({ result, showUrdu }: { result: ExtractionResult; showUrdu: boolean }) {
  return (
    <View style={styles.results}>
      <Text style={styles.resultEyebrow}>READING RESULT</Text>
      {result.prescription_language && (
        <Text style={styles.detectedLanguage}>Detected: {result.prescription_language}</Text>
      )}
      {result.transcription_english ? (
        <View style={styles.transcriptionCard}>
          <Text style={styles.cardLabel}>IN ENGLISH</Text>
          <Text style={styles.bodyText}>{result.transcription_english}</Text>
        </View>
      ) : null}
      {showUrdu && result.transcription_urdu ? (
        <View style={styles.transcriptionCard}>
          <Text style={styles.cardLabel}>اردو میں</Text>
          <Text style={[styles.bodyText, styles.urduText]}>{result.transcription_urdu}</Text>
        </View>
      ) : null}

      {result.medicines?.length ? result.medicines.map((medicine, index) => (
        <View key={`${medicine.name ?? 'medicine'}-${index}`} style={styles.medicineCard}>
          <View style={styles.medicineHeading}>
            <Text style={styles.medicineIndex}>0{index + 1}</Text>
            <Text style={styles.medicineName}>{medicine.name || medicine.name_as_written || 'unclear'}</Text>
          </View>
          {medicine.name_as_written && medicine.name_as_written !== medicine.name ? (
            <Text style={[styles.bodyText, styles.urduText]}>{medicine.name_as_written}</Text>
          ) : null}
          <View style={styles.detailRow}>
            <Detail label="DOSE AS READ" value={medicine.dose} />
            <Detail label="HOW OFTEN" value={medicine.frequency} />
          </View>
          {medicine.dose_english ? <Detail label="DOSE IN ENGLISH" value={medicine.dose_english} /> : null}
          {showUrdu && medicine.dose_urdu ? (
            <Detail label="خوراک" value={medicine.dose_urdu} rtl />
          ) : null}
          {showUrdu && medicine.frequency_english ? (
            <Detail label="FREQUENCY IN ENGLISH" value={medicine.frequency_english} />
          ) : null}
          {showUrdu && medicine.frequency_urdu ? (
            <Detail label="استعمال کی تکرار" value={medicine.frequency_urdu} rtl />
          ) : null}
          {medicine.urdu_explanation ? (
            <Detail label="اردو میں وضاحت" value={medicine.urdu_explanation} rtl />
          ) : null}
          {medicine.dose_warning ? <Text style={styles.warning}>{medicine.dose_warning}</Text> : null}
          {typeof medicine.confidence === 'number' ? (
            <Text style={styles.confidence}>Reading confidence: {Math.round(medicine.confidence * 100)}%</Text>
          ) : null}
        </View>
      )) : <Text style={styles.bodyText}>No medicine entries were returned. Ask a pharmacist to read the prescription.</Text>}

      {result.notes_english ? <Text style={styles.resultNote}>{result.notes_english}</Text> : null}
      {showUrdu && result.notes_urdu ? <Text style={[styles.resultNote, styles.urduText]}>{result.notes_urdu}</Text> : null}
      <Text style={styles.resultSafety}>{result.safety_note ?? 'Confirm these details with a pharmacist or doctor.'}</Text>
    </View>
  );
}

function Detail({ label, value, rtl }: { label: string; value?: string; rtl?: boolean }) {
  return (
    <View style={styles.detail}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, rtl && styles.urduText]}>{value || 'unclear'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F4EFE5' },
  content: { paddingHorizontal: 22, paddingTop: 24, paddingBottom: 44 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 24 },
  brandMark: { width: 42, height: 42, borderRadius: 13, backgroundColor: '#F5B84B', alignItems: 'center', justifyContent: 'center' },
  markCorner: { position: 'absolute', width: 9, height: 9, borderColor: '#292544' },
  markTopLeft: { top: 9, left: 9, borderTopWidth: 2, borderLeftWidth: 2 },
  markTopRight: { top: 9, right: 9, borderTopWidth: 2, borderRightWidth: 2 },
  markBottomLeft: { bottom: 9, left: 9, borderBottomWidth: 2, borderLeftWidth: 2 },
  markBottomRight: { bottom: 9, right: 9, borderBottomWidth: 2, borderRightWidth: 2 },
  markCapsule: { width: 17, height: 8, borderRadius: 5, backgroundColor: '#FFFFFF', transform: [{ rotate: '-42deg' }], alignItems: 'center', justifyContent: 'center' },
  markCapsuleSeam: { width: 1.5, height: 7, backgroundColor: '#4D43D6' },
  brandName: { color: '#292544', fontSize: 18, fontWeight: '900', flex: 1, letterSpacing: -0.5 },
  brandAccent: { color: '#5146DA' },
  version: { color: '#827C72', fontSize: 8, fontWeight: '800', letterSpacing: 0.7 },
  hero: { backgroundColor: '#292544', borderRadius: 22, borderBottomRightRadius: 42, padding: 22, marginBottom: 24 },
  eyebrow: { color: '#F5B84B', fontSize: 9, fontWeight: '900', letterSpacing: 1.5, marginBottom: 12 },
  title: { color: '#FFFDF7', fontSize: 31, fontWeight: '900', lineHeight: 36, letterSpacing: -0.8 },
  subtitle: { color: '#D0CCDF', fontSize: 14, lineHeight: 21, marginTop: 10 },
  sectionTitle: { color: '#292544', fontSize: 15, fontWeight: '900', marginBottom: 11, marginTop: 5, letterSpacing: -0.2 },
  languageRow: { flexDirection: 'row', gap: 10 },
  languageCard: { flex: 1, minHeight: 78, borderRadius: 12, borderWidth: 1.5, borderColor: '#D9D2C7', backgroundColor: '#FFFDFA', padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  languageCardSelected: { borderColor: '#5146DA', backgroundColor: '#ECEBFA' },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: '#A7A094', alignItems: 'center', justifyContent: 'center' },
  radioSelected: { borderColor: '#5146DA' },
  radioDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#5146DA' },
  languageTitle: { color: '#292544', fontSize: 15, fontWeight: '900' },
  languageSubtitle: { color: '#807A70', fontSize: 10, marginTop: 3 },
  hint: { color: '#6E685F', fontSize: 12, lineHeight: 18, marginTop: 10, marginBottom: 22 },
  photoCard: { borderRadius: 15, borderWidth: 1, borderColor: '#D9D2C7', backgroundColor: '#FFFDFA', padding: 12, marginBottom: 12 },
  photoPlaceholder: { height: 174, borderRadius: 9, backgroundColor: '#F7F3EA', borderWidth: 1, borderStyle: 'dashed', borderColor: '#CFC6B8', alignItems: 'center', justifyContent: 'center', padding: 16 },
  photoIcon: { width: 42, height: 42, borderRadius: 13, overflow: 'hidden', textAlign: 'center', textAlignVertical: 'center', backgroundColor: '#F5B84B', color: '#292544', fontSize: 25, fontWeight: '700', marginBottom: 10 },
  photoTitle: { color: '#292544', fontSize: 14, fontWeight: '800' },
  photoHint: { color: '#817B71', fontSize: 11, marginTop: 5, textAlign: 'center' },
  preview: { height: 240, width: '100%', borderRadius: 9, backgroundColor: '#F7F3EA' },
  photoActions: { flexDirection: 'row', gap: 9, marginTop: 11 },
  actionButton: { minHeight: 44, flex: 1, paddingHorizontal: 12, borderRadius: 9, borderWidth: 1.5, borderColor: '#5146DA', alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFDFA' },
  actionButtonPrimary: { backgroundColor: '#5146DA', borderColor: '#5146DA' },
  actionButtonText: { color: '#5146DA', fontWeight: '800', fontSize: 13 },
  actionButtonTextPrimary: { color: '#FFFFFF' },
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
  cardLabel: { color: '#807A70', fontSize: 9, fontWeight: '900', letterSpacing: 1, marginBottom: 7 },
  bodyText: { color: '#3A3748', fontSize: 14, lineHeight: 21 },
  urduText: { textAlign: 'right', writingDirection: 'rtl', fontSize: 16, lineHeight: 25 },
  medicineCard: { backgroundColor: '#FFFDFA', borderRadius: 12, borderWidth: 1, borderColor: '#DDD6CA', padding: 15, marginTop: 9 },
  medicineHeading: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 9 },
  medicineIndex: { color: '#5146DA', fontSize: 11, fontWeight: '900' },
  medicineName: { flex: 1, color: '#292544', fontSize: 17, fontWeight: '900' },
  detailRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  detail: { flex: 1, marginTop: 10, minWidth: 0 },
  detailLabel: { color: '#898377', fontSize: 9, fontWeight: '900', letterSpacing: 0.7, marginBottom: 4 },
  detailValue: { color: '#393645', fontSize: 14, fontWeight: '700', lineHeight: 20 },
  warning: { color: '#77500A', backgroundColor: '#F8E7B9', padding: 9, borderRadius: 7, fontSize: 12, lineHeight: 18, marginTop: 11 },
  confidence: { color: '#807A70', fontSize: 10, marginTop: 12 },
  resultNote: { color: '#5F5A50', fontSize: 13, lineHeight: 20, marginTop: 12 },
  resultSafety: { color: '#514019', backgroundColor: '#F8E7B9', borderRadius: 9, padding: 12, fontSize: 12, lineHeight: 18, marginTop: 13 },
  safetyCard: { borderRadius: 13, backgroundColor: '#292544', padding: 15, marginTop: 7 },
  safetyTitle: { color: '#F5B84B', fontWeight: '900', fontSize: 13, marginBottom: 5 },
  safetyText: { color: '#E0DCE8', fontSize: 12, lineHeight: 18 },
  footer: { color: '#898377', fontSize: 10, lineHeight: 15, textAlign: 'center', marginTop: 15 },
});
