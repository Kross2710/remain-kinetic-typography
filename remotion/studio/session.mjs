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

const clipMediaPrefix = 'clip:';
const stores = [SESSION_STORE, MEDIA_STORE];
const isClipKey = key => typeof key === 'string' && key.startsWith(clipMediaPrefix);
const clipIds = record => new Set((JSON.parse(record.json).videoTrack ?? []).map(clip => clip.mediaId));

// Request-level quota errors can be handled without aborting the whole save.
async function putMedia(store, key, entry) {
  try {
    return await new Promise(resolve => {
      const request = store.put(entry, key);
      request.onsuccess = () => resolve(true);
      request.onerror = event => {
        if (isQuotaError(request.error)) event.preventDefault();
        resolve(false); // non-quota errors still abort the transaction
      };
    });
  } catch (error) {
    if (!isQuotaError(error)) throw error;
    return false;
  }
}

// IndexedDB owns exactly one durable snapshot, while each tab owns its live
// current/Undo/Redo Files. Never publish blobs separately from their project:
// a reader in another tab observes either the complete old save or the new one.
// Each writer can re-publish its own live Files even if another tab saved first.
export async function saveSession(db, {record, media, clips = {}, expectedWriteId}) {
  const attachments = new Map([...clipIds(record)].map(id => [clipMediaPrefix + id, Object.prototype.hasOwnProperty.call(clips, id) ? clips[id] : null]));
  if (media) for (const kind of MEDIA_KINDS) attachments.set(MEDIA_KEYS[kind], media[kind] ?? null);
  const writeId = Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-');
  let replaced;
  const write = async (metadataOnly = false) => {
    const transaction = db.transaction(stores, 'readwrite');
    const complete = transactionComplete(transaction);
    // Request failures and transaction aborts are separate promises.
    void complete.catch(() => {});
    try {
      const projects = transaction.objectStore(SESSION_STORE);
      const blobs = transaction.objectStore(MEDIA_STORE);
      const previous = await requestResult(projects.get(SESSION_KEY));
      const previousId = previous?.writeId ?? null;
      const expected = metadataOnly ? replaced : expectedWriteId;
      if (expected !== undefined && previousId !== expected) {
        // Another save won before this view-only update or quota retry.
        await complete;
        return {committed: false, writeId: previousId, quotaExceeded: metadataOnly, failedKinds: [], record};
      }
      replaced = previousId;
      const versions = new Map(Object.entries(previous?.attachmentVersions ?? {}));
      const storedMedia = {...record.media};
      const failedKinds = [];
      let quotaExceeded = metadataOnly;
      for (const key of await requestResult(blobs.getAllKeys())) {
        if (isClipKey(key) && !attachments.get(key)) {
          blobs.delete(key);
          versions.delete(key);
        }
      }
      for (const [key, entry] of attachments) {
        if (entry?.version && versions.get(key) === entry.version) continue;
        if (entry && !metadataOnly && await putMedia(blobs, key, entry)) {
          if (entry.version) versions.set(key, entry.version);
          else versions.delete(key);
          continue;
        }
        if (entry) {
          quotaExceeded = true;
          if (MEDIA_KINDS.includes(key)) {
            failedKinds.push(key);
            storedMedia[key] = null;
          }
        }
        // Never leave a different tab's blob under the same logical media id.
        blobs.delete(key);
        versions.delete(key);
      }
      const result = {...record, media: storedMedia};
      projects.put({...result, writeId, attachmentVersions: Object.fromEntries(versions)}, SESSION_KEY);
      await complete;
      return {committed: true, writeId, quotaExceeded, failedKinds, record: result};
    } catch (error) {
      try { transaction.abort(); } catch { /* already finished */ }
      throw await complete.then(() => error, failure => isQuotaError(failure) ? failure : error);
    }
  };
  try {
    return await write();
  } catch (error) {
    // Some browsers report quota at commit, not at the individual put.
    if (!isQuotaError(error)) throw error;
    return write(true);
  }
}

export async function loadSession(db, {pruneLegacyOrphans = false} = {}) {
  const transaction = db.transaction(stores, pruneLegacyOrphans ? 'readwrite' : 'readonly');
  const complete = transactionComplete(transaction);
  void complete.catch(() => {});
  const record = await requestResult(transaction.objectStore(SESSION_STORE).get(SESSION_KEY));
  const blobs = transaction.objectStore(MEDIA_STORE);
  const hasRecord = typeof record?.json === 'string';
  const ids = hasRecord ? clipIds(record) : new Set();
  // Older versions wrote clip blobs before saving a project. Reap those old
  // orphans without using another tab's (or our own) in-memory project state.
  if (pruneLegacyOrphans) {
    for (const key of await requestResult(blobs.getAllKeys())) {
      if (isClipKey(key) && !ids.has(key.slice(clipMediaPrefix.length))) blobs.delete(key);
    }
  }
  if (!hasRecord) { await complete; return null; }
  const [legacy, clips] = await Promise.all([
    Promise.all(MEDIA_KINDS.map(async kind => [kind, (await requestResult(blobs.get(MEDIA_KEYS[kind]))) ?? null])),
    Promise.all(Array.from(ids, async id => [id, await requestResult(blobs.get(clipMediaPrefix + id))])),
  ]);
  await complete;
  const media = Object.fromEntries(legacy);
  return {record: {version: record.version ?? SESSION_VERSION, json: record.json, savedAt: record.savedAt ?? null, view: record.view ?? null, media: record.media ?? mediaNames(media)}, media,
    clips: Object.fromEntries(clips.filter(([,entry]) => entry?.blob)), writeId: record.writeId ?? null};
}

export async function clearSession(db) {
  const transaction = db.transaction(stores, 'readwrite');
  for (const store of stores) transaction.objectStore(store).clear();
  await transactionComplete(transaction);
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
