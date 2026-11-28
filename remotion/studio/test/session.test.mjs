import {test} from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';

const session = await import('../session.mjs');
const editor = await import('../editor.mjs');
const project = await import('../project.mjs');

const cues = () => project.importLyrics('[00:00.00]Một nhịp thở\n[00:05.00]Rồi chữ bắt đầu', 10);
const projectObject = (list, durationInFrames = 300) => ({
  width: 720,
  height: 1280,
  durationInFrames,
  cues: list,
  effect: undefined,
  sections: [],
  showSections: false,
});
const blob = (text) => new Blob([text]);

// A factory per test keeps one session from leaking into the next test.
async function freshDb() {
  return session.openStudioDb(new IDBFactory());
}

test('a fresh browser has no session to restore', async () => {
  const db = await freshDb();
  assert.equal(await session.loadSession(db), null);
});

test('a saved session restores the project and the media blobs', async () => {
  const db = await freshDb();
  const marked = project.setWordStart(cues(), 0, 1, 1.5, 10);
  const record = session.buildSessionRecord({
    project: projectObject(cues()),
    cues: marked,
    length: 300,
    renderRange: {startFrame: 30, endFrame: 90},
    media: {audio: {name: 'nhac.mp3', seconds: 12}, video: {name: 'nen.mp4', seconds: 9}},
    view: {pxPerSec: 12, scrollX: 4},
    savedAt: 1700000000000,
  });
  const outcome = await session.saveSession(db, {
    record,
    media: {audio: {name: 'nhac.mp3', seconds: 12, blob: blob('audio-bytes')}, video: {name: 'nen.mp4', seconds: 9, blob: blob('video-bytes')}},
  });
  assert.deepEqual(outcome.failedKinds, []);
  assert.equal(outcome.quotaExceeded, false);

  const restored = await session.loadSession(db);
  const loaded = editor.parseProjectFile(restored.record.json);
  assert.equal(loaded.width, 720);
  assert.equal(loaded.durationInFrames, 300);
  assert.deepEqual(loaded.renderRange, {startFrame: 30, endFrame: 90});
  assert.equal(loaded.cues[0].words[1].start, 1.5);
  assert.equal(loaded.cues[0].words[1].confirmed, true, 'confirmed marks must survive the session store');
  assert.deepEqual(restored.record.view, {pxPerSec: 12, scrollX: 4});
  assert.equal(restored.record.savedAt, 1700000000000);
  assert.equal(restored.media.audio.name, 'nhac.mp3');
  assert.equal(restored.media.audio.seconds, 12);
  assert.equal(await restored.media.audio.blob.text(), 'audio-bytes');
  assert.equal(await restored.media.video.blob.text(), 'video-bytes');
});

test('saving a lyric edit leaves the stored media blobs untouched', async () => {
  const db = await freshDb();
  const base = session.buildSessionRecord({project: projectObject(cues()), cues: cues(), length: 300, media: {audio: {name: 'nhac.mp3', seconds: 12}}});
  await session.saveSession(db, {record: base, media: {audio: {name: 'nhac.mp3', seconds: 12, blob: blob('audio-bytes')}, video: null}});

  const edited = project.setWordStart(cues(), 0, 2, 2.5, 10);
  const second = session.buildSessionRecord({project: projectObject(cues()), cues: edited, length: 300, media: {audio: {name: 'nhac.mp3', seconds: 12}}});
  await session.saveSession(db, {record: second});

  const restored = await session.loadSession(db);
  assert.equal(editor.parseProjectFile(restored.record.json).cues[0].words[2].start, 2.5);
  assert.equal(await restored.media.audio.blob.text(), 'audio-bytes', 'a project-only save must not drop the audio blob');
  assert.equal(restored.media.video, null);
});

test('removing a media file removes its blob from the session', async () => {
  const db = await freshDb();
  const record = session.buildSessionRecord({project: projectObject(cues()), cues: cues(), length: 300, media: {audio: {name: 'nhac.mp3', seconds: 12}}});
  await session.saveSession(db, {record, media: {audio: {name: 'nhac.mp3', seconds: 12, blob: blob('audio-bytes')}}});
  await session.saveSession(db, {record: session.buildSessionRecord({project: projectObject(cues()), cues: cues(), length: 300, media: {}}), media: {}});
  const restored = await session.loadSession(db);
  assert.equal(restored.media.audio, null);
  assert.deepEqual(restored.record.media, {audio: null, video: null});
});

test('a session record keeps cues that sit outside the preview range', async () => {
  const long = project.importLyrics('[00:00.00]Một nhịp thở\n[00:40.00]Dòng nằm ngoài đoạn xem', 60);
  const record = session.buildSessionRecord({project: projectObject(cues(), 300), cues: long, length: 300, media: {}});
  const loaded = editor.parseProjectFile(record.json);
  assert.ok(loaded.durationInFrames >= 41 * project.FPS, 'stored length must reach the last word mark');
  assert.equal(loaded.cues.length, 2);
  assert.equal(session.storedLengthFrames({length: 300, cues: []}), 300);
  assert.equal(session.storedLengthFrames({length: project.MAX_SECONDS * project.FPS, cues: long}), project.MAX_SECONDS * project.FPS);
});

test('clearSession wipes the project and the media', async () => {
  const db = await freshDb();
  const record = session.buildSessionRecord({project: projectObject(cues()), cues: cues(), length: 300, media: {audio: {name: 'nhac.mp3', seconds: 12}}});
  await session.saveSession(db, {record, media: {audio: {name: 'nhac.mp3', seconds: 12, blob: blob('audio-bytes')}}});
  await session.clearSession(db);
  assert.equal(await session.loadSession(db), null);
});

const source = (text, version) => ({name:'same.mp4', seconds:2, blob:blob(text), version});
const clip = (mediaId, id=mediaId) => ({id, mediaId, name:'same.mp4', sourceFrames:60, inFrame:0, outFrame:30, muted:true});
const videoRecord = videoTrack => session.buildSessionRecord({
  project:{...projectObject([]), videoTrack}, cues:[], length:Math.max(1,videoTrack.length*30),
});
const storedKeys = db => new Promise((resolve,reject) => {
  const request = db.transaction(session.MEDIA_STORE).objectStore(session.MEDIA_STORE).getAllKeys();
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

test('clips with identical filenames load by source id; split segments share the blob', async () => {
  const db = await freshDb();
  const clips = {a:source('first','v1'), b:source('second','v2')};
  await session.saveSession(db, {record:videoRecord([clip('a'), clip('a','split'), clip('b')]), clips});
  const loaded = (await session.loadSession(db)).clips;
  assert.equal(await loaded.a.blob.text(), 'first');
  assert.equal(await loaded.b.blob.text(), 'second');
  assert.deepEqual(await storedKeys(db), ['clip:a','clip:b']);
  await session.saveSession(db, {record:videoRecord([clip('a','split')]), clips});
  assert.deepEqual(await storedKeys(db), ['clip:a']);
});

test('a failed replacement leaves the last committed project and its blobs intact', async () => {
  const db = await freshDb();
  const old = videoRecord([clip('old')]);
  await session.saveSession(db, {record:old, clips:{old:source('old','v1')}});
  const rejecting = overridePuts(db, (store) => {
    if (store === session.SESSION_STORE) throw new DOMException('write failed','UnknownError');
  });
  await assert.rejects(session.saveSession(rejecting, {record:videoRecord([clip('new')]), clips:{new:source('new','v2')}}), {name:'UnknownError'});
  const loaded = await session.loadSession(db);
  assert.equal(loaded.record.json, old.json);
  assert.equal(await loaded.clips.old.blob.text(), 'old');
  assert.deepEqual(await storedKeys(db), ['clip:old']);
});

test('concurrent tabs restore coherent snapshots when relinking the same logical id', async () => {
  const factory = new IDBFactory();
  const firstDb = await session.openStudioDb(factory);
  const secondDb = await session.openStudioDb(factory);
  const first = videoRecord([clip('a'),clip('b')]);
  const second = videoRecord([clip('a')]);
  await session.saveSession(firstDb, {record:first, clips:{a:source('first','v1'), b:source('extra','v2')}});
  const before = session.loadSession(firstDb);
  const replace = session.saveSession(secondDb, {record:second, clips:{a:source('relinked','v3')}});
  const after = session.loadSession(firstDb);
  const [old,,recent] = await Promise.all([before,replace,after]);
  assert.equal(old.record.json, first.json);
  assert.equal(await old.clips.a.blob.text(), 'first');
  assert.equal(await old.clips.b.blob.text(), 'extra');
  assert.equal(recent.record.json, second.json);
  assert.equal(await recent.clips.a.blob.text(), 'relinked');
  assert.deepEqual(await storedKeys(firstDb), ['clip:a']);
});

test('reload reaps legacy orphans without loading or deleting saved attachments', async () => {
  const db = await freshDb();
  const record = videoRecord([clip('used')]);
  await session.saveSession(db, {record, clips:{used:source('keep','v1')}});
  await new Promise((resolve,reject) => {
    const tx = db.transaction(session.MEDIA_STORE, 'readwrite');
    tx.objectStore(session.MEDIA_STORE).put(source('interrupted'), 'clip:orphan');
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error);
  });
  const loaded = await session.loadSession(db, {pruneLegacyOrphans:true});
  assert.equal(loaded.record.json, record.json);
  assert.equal(await loaded.clips.used.blob.text(), 'keep');
  assert.deepEqual(await storedKeys(db), ['clip:used']);
});

test('a quota retry cannot overwrite a save that won in another tab', async () => {
  const factory = new IDBFactory();
  const firstDb = await session.openStudioDb(factory);
  const secondDb = await session.openStudioDb(factory);
  const winner = videoRecord([clip('winner')]);
  let pending;
  const failing = overridePuts(firstDb, store => {
    if (store !== session.SESSION_STORE) return;
    pending = session.saveSession(secondDb, {record:winner, clips:{winner:source('winner','v1')}});
    throw new DOMException('quota at commit','QuotaExceededError');
  });
  const loser = videoRecord([clip('loser')]);
  const outcome = await session.saveSession(failing, {record:loser, clips:{loser:source('loser','v2')}});
  await pending;
  assert.equal(outcome.committed,false);
  const loaded = await session.loadSession(firstDb);
  assert.equal(loaded.record.json,winner.json);
  assert.deepEqual(await storedKeys(firstDb),['clip:winner']);
});

test('session envelope keeps markers past the preview duration', () => {
  const record = session.buildSessionRecord({project:{...projectObject([]), sections:[{kind:'chorus',start:40}]}, cues:[], length:60});
  assert.deepEqual(editor.parseProjectFile(record.json).sections, [{kind:'chorus',start:40}]);
});

// Inject the failing request while keeping real fake-indexeddb transactions.
function overridePuts(db, beforePut) {
  return {
    transaction(...args) {
      const transaction = db.transaction(...args);
      const objectStore = transaction.objectStore.bind(transaction);
      transaction.objectStore = name => {
        const store = objectStore(name);
        const put = store.put.bind(store);
        store.put = (value,key) => { beforePut(name,key); return put(value,key); };
        return store;
      };
      return transaction;
    },
  };
}

test('a quota failure drops only the media and still saves the project', async () => {
  const db = await freshDb();
  const quota = overridePuts(db, (store,key) => {
    if (store === session.MEDIA_STORE && key === 'video') throw new DOMException('quota','QuotaExceededError');
  });
  const record = session.buildSessionRecord({
    project: projectObject(cues()),
    cues: cues(),
    length: 300,
    media: {audio: {name: 'nhac.mp3', seconds: 12}, video: {name: 'nen.mp4', seconds: 9}},
  });
  const outcome = await session.saveSession(quota, {
    record,
    media: {audio: {name: 'nhac.mp3', seconds: 12, blob: blob('audio-bytes')}, video: {name: 'nen.mp4', seconds: 9, blob: blob('too-big')}},
  });
  assert.equal(outcome.quotaExceeded, true);
  assert.deepEqual(outcome.failedKinds, ['video']);
  assert.deepEqual(outcome.record.media, {audio: 'nhac.mp3', video: null}, 'the saved project must not claim a video that was never stored');
  const loaded = await session.loadSession(db);
  assert.equal(loaded.record.json, record.json, 'the project itself must survive a quota failure');
  assert.equal(loaded.media.video, null);
  assert.equal(loaded.media.audio.name, 'nhac.mp3');
});

test('a quota-saved session still restores its project', async () => {
  const db = await freshDb();
  const quota = overridePuts(db, (store,key) => {
    if (store === session.MEDIA_STORE && key === 'video') throw new DOMException('quota','QuotaExceededError');
  });
  const record = session.buildSessionRecord({project: projectObject(cues()), cues: cues(), length: 300, media: {audio: {name: 'nhac.mp3', seconds: 12}, video: {name: 'nen.mp4', seconds: 9}}});
  await session.saveSession(quota, {record, media: {audio: {name: 'nhac.mp3', seconds: 12, blob: blob('audio-bytes')}, video: {name: 'nen.mp4', seconds: 9, blob: blob('too-big')}}});
  const restored = await session.loadSession(db);
  assert.equal(restored.media.audio.name, 'nhac.mp3');
  assert.equal(restored.media.video, null);
  assert.equal(editor.parseProjectFile(restored.record.json).cues.length, 2);
});

test('the running job id lives in sessionStorage scope', () => {
  const store = new Map();
  const storage = {setItem: (k, v) => store.set(k, v), getItem: (k) => store.get(k) ?? null, removeItem: (k) => store.delete(k)};
  assert.equal(session.readJobId(storage), null);
  session.rememberJobId('job-1', storage);
  assert.equal(session.readJobId(storage), 'job-1');
  session.forgetJobId(storage);
  assert.equal(session.readJobId(storage), null);
});

test('a storage that is unavailable cannot break the client', () => {
  const throwing = {setItem: () => {throw Error('blocked');}, getItem: () => {throw Error('blocked');}, removeItem: () => {throw Error('blocked');}};
  assert.doesNotThrow(() => session.rememberJobId('job-1', throwing));
  assert.equal(session.readJobId(throwing), null);
  assert.doesNotThrow(() => session.forgetJobId(throwing));
  assert.doesNotThrow(() => session.rememberJobId('job-1', undefined));
});
