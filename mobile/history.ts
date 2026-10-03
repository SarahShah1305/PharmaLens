import AsyncStorage from '@react-native-async-storage/async-storage';

export type PrescriptionLanguage = 'English' | 'Urdu';

export type HistoryResult = {
  medicines?: { name?: string; name_as_written?: string; dose?: string; frequency?: string }[];
  transcription_english?: string;
  transcription_urdu?: string;
  [key: string]: unknown;
};

export type HistoryItem = {
  id: string;
  savedAt: string;
  language: PrescriptionLanguage;
  result: HistoryResult;
};

const HISTORY_KEY = 'pharmalens.prescription-history.v1';
const MAX_HISTORY_ITEMS = 30;

export async function loadHistory(): Promise<HistoryItem[]> {
  const stored = await AsyncStorage.getItem(HISTORY_KEY);
  if (!stored) return [];
  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? (parsed as HistoryItem[]).slice(0, MAX_HISTORY_ITEMS) : [];
  } catch {
    return [];
  }
}

export async function saveHistory(
  language: PrescriptionLanguage,
  result: HistoryResult,
): Promise<HistoryItem> {
  const item: HistoryItem = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    savedAt: new Date().toISOString(),
    language,
    result,
  };
  const previous = await loadHistory();
  await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify([item, ...previous].slice(0, MAX_HISTORY_ITEMS)));
  return item;
}

export async function deleteHistoryItem(id: string): Promise<void> {
  const remaining = (await loadHistory()).filter((item) => item.id !== id);
  await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(remaining));
}
