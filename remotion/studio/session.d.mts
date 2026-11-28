import type {Cue, Project, RenderRange} from './project.mjs';
import type {View} from './editor.mjs';

export type MediaKind = 'audio' | 'video';
export type MediaRef = {name: string; seconds: number};
export type StoredMedia = MediaRef & {blob: Blob; version?: string};
export type MediaInput = Partial<Record<MediaKind, StoredMedia | null>> | null | undefined;
// The record mirrors the project file: media is recorded by name only, the
// blobs live beside it in the media store.
export type MediaSnapshot = {audio: string | null; video: string | null};
export type SessionRecord = {version: number; json: string; savedAt: number | null; view: View | null; media: MediaSnapshot};
export type SessionSnapshot = {record: SessionRecord; media: {audio: StoredMedia | null; video: StoredMedia | null}; clips: Record<string, StoredMedia>; writeId: string | null};
export type SaveOutcome = {committed: boolean; writeId: string | null; quotaExceeded: boolean; failedKinds: MediaKind[]; record: SessionRecord};

export const DB_NAME: string;
export const DB_VERSION: number;
export const SESSION_STORE: string;
export const MEDIA_STORE: string;
export const SESSION_KEY: string;
export const MEDIA_KEYS: Record<MediaKind, string>;
export const MEDIA_KINDS: MediaKind[];
export const JOB_KEY: string;
export const SESSION_VERSION: number;
export const QUOTA_NOTICE: string;

export function openStudioDb(indexedDB?: IDBFactory): Promise<IDBDatabase>;
export function storedLengthFrames({length, cues}: {length: number; cues: Cue[]}): number;
export type MediaSource = MediaRef | string | null;
export function mediaNames(media: Partial<Record<MediaKind, MediaSource>> | null | undefined): MediaSnapshot;
export function buildSessionRecord({project, cues, length, renderRange, media, view, savedAt}: {project: Project; cues: Cue[]; length: number; renderRange?: RenderRange | null; media?: Partial<Record<MediaKind, MediaSource>> | null; view?: View | null; savedAt?: number | null}): SessionRecord;
export function saveSession(db: IDBDatabase, {record, media, clips, expectedWriteId}: {record: SessionRecord; media?: MediaInput; clips?: Record<string, StoredMedia>; expectedWriteId?: string | null}): Promise<SaveOutcome>;
export function loadSession(db: IDBDatabase, options?: {pruneLegacyOrphans?: boolean}): Promise<SessionSnapshot | null>;
export function clearSession(db: IDBDatabase): Promise<void>;
export function rememberJobId(id: string, storage?: Storage): void;
export function readJobId(storage?: Storage): string | null;
export function forgetJobId(storage?: Storage): void;
