import { useSyncExternalStore } from 'react';
import { HistoryItem, HistoryResult, PrescriptionLanguage } from './history';

export type SelectedPhoto = { uri: string; fileName: string; mimeType: string };

export type PharmaLensSession = {
  language: PrescriptionLanguage | null;
  photo: SelectedPhoto | null;
  result: HistoryResult | null;
  busy: boolean;
  error: string;
  history: HistoryItem[];
  historyError: string;
  speakingKey: string | null;
};

let session: PharmaLensSession = {
  language: null,
  photo: null,
  result: null,
  busy: false,
  error: '',
  history: [],
  historyError: '',
  speakingKey: null,
};

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return session;
}

export function usePharmaLensSession() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function updatePharmaLensSession(update: Partial<PharmaLensSession> | ((current: PharmaLensSession) => PharmaLensSession)) {
  session = typeof update === 'function' ? update(session) : { ...session, ...update };
  listeners.forEach((listener) => listener());
}
