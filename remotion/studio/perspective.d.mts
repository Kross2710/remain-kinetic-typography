export type PerspectivePoint = {x: number; y: number};
/** Normalized frame coordinates; may extend outside [0, 1]. Source order is TL, TR, BR, BL. */
export type PerspectiveCorners = [PerspectivePoint, PerspectivePoint, PerspectivePoint, PerspectivePoint];
export type PerspectiveCornerIndex = 0 | 1 | 2 | 3;

export function defaultPerspectiveCorners(): PerspectiveCorners;
export function isValidPerspectiveCorners(corners: unknown): corners is PerspectiveCorners;
/** Transform a full width × height source rectangle; use CSS transform-origin: 0 0. */
export function perspectiveMatrix3d(corners: unknown, width: number, height: number): string | null;
/** Translate by normalized frame units. */
export function movePerspectiveCorners(corners: PerspectiveCorners, dx: number, dy: number): PerspectiveCorners | null;
/** Rotate clockwise about the mean corner position, in pixel space. */
export function rotatePerspectiveCorners(corners: PerspectiveCorners, radians: number, width: number, height: number): PerspectiveCorners | null;
export function setPerspectiveCorner(corners: PerspectiveCorners, index: PerspectiveCornerIndex, point: PerspectivePoint): PerspectiveCorners | null;
