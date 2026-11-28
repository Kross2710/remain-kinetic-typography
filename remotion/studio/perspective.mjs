export function defaultPerspectiveCorners() {
  return [{x: 0, y: 0}, {x: 1, y: 0}, {x: 1, y: 1}, {x: 0, y: 1}];
}

// Clockwise in screen coordinates. Strictly positive turns exclude straight
// edges, repeated corners, concavities and self-intersections.
export function isValidPerspectiveCorners(corners) {
  if (!Array.isArray(corners) || corners.length !== 4) return false;
  for (const point of corners) {
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return false;
  }
  for (let i = 0; i < 4; i++) {
    const a = corners[i], b = corners[(i + 1) % 4], c = corners[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (!Number.isFinite(cross) || cross <= 0) return false;
  }
  return true;
}

const validSize = (width, height) => Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0;

export function perspectiveMatrix3d(corners, width, height) {
  if (!isValidPerspectiveCorners(corners) || !validSize(width, height)) return null;
  const [p0, p1, p2, p3] = corners;
  // For normalized source (u,v), the homogeneous denominator is 1+g*u+h*v.
  // Solve g,h from the bottom-right constraint after fixing the other corners.
  const ax = p2.x - p1.x, ay = p2.y - p1.y;
  const bx = p2.x - p3.x, by = p2.y - p3.y;
  const dx = (p3.x - p0.x) - ax, dy = (p3.y - p0.y) - ay;
  const det = ax * by - ay * bx;
  const g = (dx * by - dy * bx) / det;
  const h = (ax * dy - ay * dx) / det;
  if (![1 + g, 1 + h, 1 + g + h].every(w => w > 0)) return null;
  // Conjugate the normalized mapping by the pixel scale; CSS is column-major.
  const values = [
    (p1.x - p0.x) + g * p1.x, ((p1.y - p0.y) + g * p1.y) * (height / width), 0, g / width,
    ((p3.x - p0.x) + h * p3.x) * (width / height), (p3.y - p0.y) + h * p3.y, 0, h / height,
    0, 0, 1, 0,
    p0.x * width, p0.y * height, 0, 1,
  ];
  return values.every(Number.isFinite) ? `matrix3d(${values.join(', ')})` : null;
}

export function movePerspectiveCorners(corners, dx, dy) {
  if (!isValidPerspectiveCorners(corners) || !Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  const next = corners.map(({x, y}) => ({x: x + dx, y: y + dy}));
  return isValidPerspectiveCorners(next) ? next : null;
}

export function rotatePerspectiveCorners(corners, radians, width, height) {
  if (!isValidPerspectiveCorners(corners) || !validSize(width, height) || !Number.isFinite(radians)) return null;
  if (radians === 0) return corners;
  const center = corners.reduce((mid, {x, y}) => ({x: mid.x + x / 4, y: mid.y + y / 4}), {x: 0, y: 0});
  const cos = Math.cos(radians), sin = Math.sin(radians);
  const next = corners.map(({x, y}) => {
    const px = (x - center.x) * width, py = (y - center.y) * height;
    return {x: center.x + (px * cos - py * sin) / width, y: center.y + (px * sin + py * cos) / height};
  });
  return isValidPerspectiveCorners(next) ? next : null;
}

export function setPerspectiveCorner(corners, index, point) {
  if (!isValidPerspectiveCorners(corners) || !Number.isInteger(index) || index < 0 || index > 3) return null;
  const next = corners.map((corner, i) => i === index ? point : corner);
  return isValidPerspectiveCorners(next) ? next : null;
}
