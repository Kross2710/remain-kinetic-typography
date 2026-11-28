import {useEffect, useRef, useState} from 'react';
import type {CSSProperties, KeyboardEvent, PointerEvent} from 'react';
import {
  isValidPerspectiveCorners, movePerspectiveCorners, perspectiveMatrix3d,
  rotatePerspectiveCorners, setPerspectiveCorner,
} from '../perspective.mjs';
import type {PerspectiveCornerIndex, PerspectiveCorners, PerspectivePoint} from '../perspective.mjs';

export type PerspectiveEditorProps = {
  /** Committed corners only. Key the editor by clip ID when switching clips. */
  corners: PerspectiveCorners;
  /** Valid transient preview; null clears the draft at the end of a gesture. */
  onChange?: (corners: PerspectiveCorners | null) => void;
  /** Called once for a changed, valid release or keyboard nudge. The parent owns reset and history. */
  onCommit: (corners: PerspectiveCorners) => void;
  /** True while the pointer requests an invalid quad, false when it recovers or ends. */
  onInvalid?: (invalid: boolean) => void;
};

type Handle = 'move' | 'rotate' | PerspectiveCornerIndex;
type Gesture = {
  handle: Handle;
  id: number;
  start: PerspectivePoint;
  bounds: DOMRect;
  corners: PerspectiveCorners;
  preview: PerspectiveCorners | null;
  invalid: boolean;
  onChange: PerspectiveEditorProps['onChange'];
  onInvalid: PerspectiveEditorProps['onInvalid'];
  onCommit: PerspectiveEditorProps['onCommit'];
};

const indices = [0, 1, 2, 3] as const;
const labels = ['Góc trên trái', 'Góc trên phải', 'Góc dưới phải', 'Góc dưới trái'] as const;
const centerOf = (corners: PerspectiveCorners) => corners.reduce(({x, y}, p) => ({x: x + p.x / 4, y: y + p.y / 4}), {x: 0, y: 0});
const sameCorners = (a: PerspectiveCorners, b: PerspectiveCorners) => a.every(({x, y}, i) => x === b[i].x && y === b[i].y);
const pointer = (event: PointerEvent): PerspectivePoint => ({x: event.clientX, y: event.clientY});
const handleStyle: CSSProperties = {position: 'absolute', width: 44, height: 44, borderRadius: '50%',
  transform: 'translate(-50%, -50%)', padding: 0, border: 0, background: 'transparent',
  display: 'grid', placeItems: 'center', pointerEvents: 'auto', touchAction: 'none'};

function translateHandle(corners: PerspectiveCorners, handle: Exclude<Handle, 'rotate'>, dx: number, dy: number) {
  if (handle === 'move') return movePerspectiveCorners(corners, dx, dy);
  const from = corners[handle];
  return setPerspectiveCorner(corners, handle, {x: from.x + dx, y: from.y + dy});
}

function sample({handle, start, bounds, corners}: Gesture, {x, y}: PerspectivePoint) {
  if (x === start.x && y === start.y) return corners;
  const {width, height, left, top} = bounds;
  let next;
  if (handle === 'rotate') {
    const mid = centerOf(corners);
    const cx = left + mid.x * width, cy = top + mid.y * height;
    if (x === cx && y === cy) return null; // No angle at the pivot.
    const angle = Math.atan2(y - cy, x - cx) - Math.atan2(start.y - cy, start.x - cx);
    next = rotatePerspectiveCorners(corners, Math.atan2(Math.sin(angle), Math.cos(angle)), width, height);
  } else {
    next = translateHandle(corners, handle, (x - start.x) / width, (y - start.y) / height);
  }
  return next && perspectiveMatrix3d(next, width, height) ? next : null;
}

function clearPreview(gesture: Gesture) {
  if (gesture.preview) gesture.onChange?.(null);
  if (gesture.invalid) gesture.onInvalid?.(false);
}

/** Mount inside an untransformed, position:relative parent sized to the visible preview. */
export function PerspectiveEditor({corners, onChange, onCommit, onInvalid}: PerspectiveEditorProps) {
  const root = useRef<HTMLDivElement>(null);
  const active = useRef<Gesture | null>(null);
  const [preview, setPreview] = useState<PerspectiveCorners | null>(null);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => () => {
    if (active.current) clearPreview(active.current);
    active.current = null;
  }, []);

  const start = (event: PointerEvent<HTMLButtonElement>, handle: Handle) => {
    const element = root.current;
    if (!element || active.current || !event.isPrimary || event.button !== 0) return;
    const bounds = element.getBoundingClientRect();
    if (!(bounds.width > 0 && bounds.height > 0) || !isValidPerspectiveCorners(corners)) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus({preventScroll: true});
    element.setPointerCapture(event.pointerId);
    active.current = {handle, id: event.pointerId, start: pointer(event), bounds, corners,
      preview: null, invalid: false, onChange, onInvalid, onCommit};
  };

  const move = (event: PointerEvent<HTMLDivElement>) => {
    const gesture = active.current;
    if (!gesture || gesture.id !== event.pointerId) return;
    event.stopPropagation();
    const next = sample(gesture, pointer(event));
    const rejected = next === null;
    if (gesture.invalid !== rejected) {
      gesture.invalid = rejected;
      setInvalid(rejected);
      gesture.onInvalid?.(rejected);
    }
    // Hold the last valid preview while crossing a boundary.
    if (next && !sameCorners(next, gesture.preview ?? gesture.corners)) {
      gesture.preview = next;
      setPreview(next);
      gesture.onChange?.(next);
    }
  };

  const finish = (gesture: Gesture, end?: PerspectivePoint) => {
    active.current = null;
    const element = root.current;
    if (element?.hasPointerCapture(gesture.id)) element.releasePointerCapture(gesture.id);
    const next = end && sample(gesture, end);
    if (next && !sameCorners(next, gesture.corners)) gesture.onCommit(next);
    setPreview(null);
    setInvalid(false);
    clearPreview(gesture);
  };

  const finishPointer = (event: PointerEvent<HTMLDivElement>, save: boolean) => {
    const gesture = active.current;
    if (!gesture || gesture.id !== event.pointerId) return;
    event.stopPropagation();
    finish(gesture, save ? pointer(event) : undefined);
  };

  const keyDown = (event: KeyboardEvent<HTMLButtonElement>, handle: Handle) => {
    if (event.key === 'Escape' && active.current) {
      event.preventDefault();
      event.stopPropagation();
      finish(active.current);
      return;
    }
    const dx = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    const dy = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    const bounds = root.current?.getBoundingClientRect();
    if ((!dx && !dy) || !bounds || !(bounds.width > 0 && bounds.height > 0) || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    event.stopPropagation();
    if (active.current) return;
    const step = event.shiftKey ? 10 : 1;
    const next = handle === 'rotate'
      ? rotatePerspectiveCorners(corners, (dx + dy) * step * Math.PI / 180, bounds.width, bounds.height)
      : translateHandle(corners, handle, step * dx / bounds.width, step * dy / bounds.height);
    if (next && !sameCorners(next, corners) && perspectiveMatrix3d(next, bounds.width, bounds.height)) onCommit(next);
  };

  if (!isValidPerspectiveCorners(corners)) return null;
  const shown = preview ?? corners;
  const mid = centerOf(shown);
  const top = {x: shown[0].x / 2 + shown[1].x / 2, y: shown[0].y / 2 + shown[1].y / 2};
  const rotate = {x: mid.x / 2 + top.x / 2, y: mid.y / 2 + top.y / 2};
  const accent = invalid ? '#fb7185' : '#67e8f9';
  const drawHandle = (handle: Handle, point: PerspectivePoint, label: string, symbol?: string) =>
    <button key={handle} type="button" aria-label={label} title={label}
      aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
      style={{...handleStyle, left: `${100 * point.x}%`, top: `${100 * point.y}%`, cursor: handle === 'rotate' ? 'grab' : 'move'}}
      onPointerDown={event => start(event, handle)} onKeyDown={event => keyDown(event, handle)}>
      <span aria-hidden="true" style={{width: symbol ? 24 : 12, height: symbol ? 24 : 12,
        color: accent, border: `2px solid ${accent}`, borderRadius: symbol ? '50%' : 2, boxSizing: 'border-box',
        background: '#101018', display: 'grid', placeItems: 'center', font: '14px/1 sans-serif', pointerEvents: 'none'}}>{symbol}</span>
    </button>;

  return <div ref={root} role="group" aria-label="Chỉnh phối cảnh video" onClick={event => event.stopPropagation()}
    onPointerMove={move} onPointerUp={event => finishPointer(event, true)}
    onPointerCancel={event => finishPointer(event, false)} onLostPointerCapture={event => finishPointer(event, false)}
    style={{position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none', userSelect: 'none'}}>
    <svg aria-hidden="true" width="100%" height="100%" viewBox="0 0 1 1" preserveAspectRatio="none"
      style={{position: 'absolute', inset: 0, overflow: 'visible'}}>
      <polygon points={shown.map(({x, y}) => `${x},${y}`).join(' ')} stroke={accent} strokeWidth={1.5}
        fill="none" vectorEffect="non-scaling-stroke" />
      <line x1={mid.x} y1={mid.y} x2={rotate.x} y2={rotate.y} stroke={accent} strokeWidth={1}
        vectorEffect="non-scaling-stroke" />
    </svg>
    {drawHandle('move', mid, 'Di chuyển khung', '✥')}
    {drawHandle('rotate', rotate, 'Xoay khung', '↻')}
    {indices.map(i => drawHandle(i, shown[i], labels[i]))}
  </div>;
}
