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

// A browser that runs out of storage must still keep the project, so the quota
// path is exercised with a store that refuses one specific blob.
function quotaDb({quotaKeys = []} = {}) {
  const stores = {session: new Map(), media: new Map()};
  return {
    stores,
    transaction(name) {
      const transaction = {error: null};
      transaction.objectStore = () => ({
        put: (value, key) => {
          const request = {};
          if (name === 'media' && quotaKeys.includes(key)) {
            Promise.resolve().then(() => {
              const error = Error('QuotaExceededError');
              error.name = 'QuotaExceededError';
              transaction.error = error;
              transaction.onabort?.();
            });
          } else {
            Promise.resolve().then(() => {
              stores[name].set(key, value);
              transaction.oncomplete?.();
            });
          }
          return request;
        },
        delete: (key) => {
          Promise.resolve().then(() => {
            stores[name].delete(key);
            transaction.oncomplete?.();
          });
          return {};
        },
        get: (key) => {
          const request = {};
          Promise.resolve().then(() => {
            request.result = stores[name].get(key);
            request.onsuccess?.();
          });
          return request;
        },
      });
      return transaction;
    },
  };
}

test('a quota failure drops only the media and still saves the project', async () => {
  const db = quotaDb({quotaKeys: ['video']});
  const record = session.buildSessionRecord({
    project: projectObject(cues()),
    cues: cues(),
    length: 300,
    media: {audio: {name: 'nhac.mp3', seconds: 12}, video: {name: 'nen.mp4', seconds: 9}},
  });
  const outcome = await session.saveSession(db, {
    record,
    media: {audio: {name: 'nhac.mp3', seconds: 12, blob: blob('audio-bytes')}, video: {name: 'nen.mp4', seconds: 9, blob: blob('too-big')}},
  });
  assert.equal(outcome.quotaExceeded, true);
  assert.deepEqual(outcome.failedKinds, ['video']);
  assert.deepEqual(outcome.record.media, {audio: 'nhac.mp3', video: null}, 'the saved project must not claim a video that was never stored');
  assert.ok(db.stores.session.get(session.SESSION_KEY), 'the project itself must survive a quota failure');
  assert.equal(db.stores.media.get('video'), undefined);
  assert.equal(db.stores.media.get('audio').name, 'nhac.mp3');
});

test('a quota-saved session still restores its project', async () => {
  const db = quotaDb({quotaKeys: ['video']});
  const record = session.buildSessionRecord({project: projectObject(cues()), cues: cues(), length: 300, media: {audio: {name: 'nhac.mp3', seconds: 12}, video: {name: 'nen.mp4', seconds: 9}}});
  await session.saveSession(db, {record, media: {audio: {name: 'nhac.mp3', seconds: 12, blob: blob('audio-bytes')}, video: {name: 'nen.mp4', seconds: 9, blob: blob('too-big')}}});
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
