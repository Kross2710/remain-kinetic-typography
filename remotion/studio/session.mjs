// Browser session store for the Studio.
//
// The project and the media behind it have to survive a reload, so they live in
// IndexedDB: the project as the same JSON the user can save to a file (one
// format, via serializeProject), and the audio/video as blobs so the user never
// re-picks the same two files. A running render is a server job, so only its id
// is kept, in sessionStorage, which is exactly as long-lived as the tab.
//
// Pure module: no React and no DOM element access, so it runs under `node --test`
// against fake-indexeddb.

import {FPS, MAX_SECONDS} from './project.mjs';
import {serializeProject} from './editor.mjs';

export const DB_NAME = 'remain-studio';
export const DB_VERSION = 1;
export const SESSION_STORE = 'session';
export const MEDIA_STORE = 'media';
export const SESSION_KEY = '***';
export const MEDIA_KEYS = {audio: 'audio', video: 'video'};
export const MEDIA_KINDS = ['audio', 'video'];
export const JOB_KEY = 'remain-studio…b-id';
export const SESSION_VERSION = 1;

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? Error('IndexedDB request failed.'));
  });
}

function transactionComplete(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? Error('IndexedDB transaction failed.'));
  });
}

function isQuotaError(error) {
  return error?.name === 'QuotaExceededError' || /quota/i.test(String(error?.message ?? error));
}

export function openStudioDb(indexedDB = globalThis.indexedDB) {
  if (!indexedDB) return Promise.reject(Error('Trình duyệt không có IndexedDB, Studio không tự lưu được.'));
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open(DB_NAME, DB_VERSION);
    opening.onupgradeneeded = () => {
      const db = opening.result;
      if (!db.objectStoreNames.contains(SESSION_STORE)) db.createObjectStore(SESSION_STORE);
      if (!db.objectStoreNames.contains(MEDIA_STORE)) db.createObjectStore(MEDIA_STORE);
    };
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error ?? Error('Không mở được nơi lưu project.'));
  });
}

// A saved project must keep cues that sit outside the current preview range, so
// the stored length is the timeline or the last word mark, whichever is longer.
export function storedLengthFrames({length, cues}) {
  const lastCue = cues[cues.length - 1];
  const lastWord = lastCue?.words?.[lastCue.words.length - 1];
  return Math.min(MAX_SECONDS * FPS, Math.max(length, Math.ceil((lastWord?.start ?? 0) * FPS) + 1));
}

// A session may be built from a picked file or from a previously stored name.
export function mediaNames(media) {
  const name = (value) => (typeof value === 'string' ? value : value?.name ?? null);
  return {audio: name(media?.audio), video: name(media?.video)};
}

export function buildSessionRecord({project, cues, length, renderRange, media, view, savedAt}) {
  const json = serializeProject({
    project: {...project, durationInFrames: storedLengthFrames({length, cues}), cues},
    renderRange,
    media: mediaNames(media),
  });
  return {version: SESSION_VERSION, json, savedAt, view: view ?? null, media: mediaNames(media)};
}

// Blobs are stored one per kind, so a 100 MiB video never has to be re-read to
// save a lyric edit, and a media file that does not fit the quota is dropped on
// its own instead of losing the whole session.
async function storeMedia(db, kind, entry) {
  const transaction = db.transaction(MEDIA_STORE, 'readwrite');
  const store = transaction.objectStore(MEDIA_STORE);
  if (!entry) {
    store.delete(MEDIA_KEYS[kind]);
    await transactionComplete(transaction);
    return {saved: false, quota: false};
  }
  store.put({name: entry.name, seconds: entry.seconds, blob: entry.blob}, MEDIA_KEYS[kind]);
  try {
    await transactionComplete(transaction);
    return {saved: true, quota: false};
  } catch (error) {
    if (!isQuotaError(error)) throw error;
    const cleanup = db.transaction(MEDIA_STORE, 'readwrite');
    cleanup.objectStore(MEDIA_STORE).delete(MEDIA_KEYS[kind]);
    await transactionComplete(cleanup).catch(() => {});
    return {saved: false, quota: true};
  }
}

// `media` omitted means "the files did not change, leave the blobs alone":
// a lyric edit must not re-read a 100 MiB video.
export async function saveSession(db, {record, media}) {
  const failedKinds = [];
  let quotaExceeded = false;
  if (media) {
    for (const kind of MEDIA_KINDS) {
      const outcome = await storeMedia(db, kind, media[kind] ?? null);
      if (outcome.quota) {
        quotaExceeded = true;
        failedKinds.push(kind);
      }
    }
  }
  const storedMedia = {...record.media};
  for (const kind of failedKinds) storedMedia[kind] = null;
  const transaction = db.transaction(SESSION_STORE, 'readwrite');
  transaction.objectStore(SESSION_STORE).put({...record, media: storedMedia}, SESSION_KEY);
  await transactionComplete(transaction);
  return {quotaExceeded, failedKinds, record: {...record, media: storedMedia}};
}

export async function loadSession(db) {
  const sessionTransaction = db.transaction(SESSION_STORE, 'readonly');
  const record = await requestResult(sessionTransaction.objectStore(SESSION_STORE).get(SESSION_KEY));
  if (!record || typeof record.json !== 'string') return null;
  const media = {audio: null, video: null};
  const mediaTransaction = db.transaction(MEDIA_STORE, 'readonly');
  for (const kind of MEDIA_KINDS) {
    const entry = await requestResult(mediaTransaction.objectStore(MEDIA_STORE).get(MEDIA_KEYS[kind]));
    if (entry?.blob) media[kind] = {name: entry.name, seconds: entry.seconds, blob: entry.blob};
  }
  return {record: {version: record.version ?? SESSION_VERSION, json: record.json, savedAt: record.savedAt ?? null, view: record.view ?? null, media: record.media ?? mediaNames(media)}, media};
}

export async function clearSession(db) {
  for (const store of [SESSION_STORE, MEDIA_STORE]) {
    const transaction = db.transaction(store, 'readwrite');
    transaction.objectStore(store).clear();
    await transactionComplete(transaction);
  }
}

// sessionStorage lives exactly as long as the tab, which is the right scope for
// "the render I started is still running on the server".
export function rememberJobId(id, storage = globalThis.sessionStorage) {
  try {
    storage?.setItem(JOB_KEY, id);
  } catch {
    // A job that cannot be remembered is still a job; the client just loses it on reload.
  }
}

export function readJobId(storage = globalThis.sessionStorage) {
  try {
    return storage?.getItem(JOB_KEY) ?? null;
  } catch {
    return null;
  }
}

export function forgetJobId(storage = globalThis.sessionStorage) {
  try {
    storage?.removeItem(JOB_KEY);
  } catch {
    // Nothing to forget.
  }
}

export const QUOTA_NOTICE = 'Không lưu được media (vượt hạn mức trình duyệt). Project vẫn được lưu.';
