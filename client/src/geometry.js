export const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

export const bbox = (points) => {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
};

export const pointsAttr = (points, w, h) => points.map(([x, y]) => `${x * w},${y * h}`).join(' ');

// Centroide de polígono (em pixels); cai para a média dos vértices se a área for ~0.
export function centroid(points, w, h) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % points.length];
    const f = x0 * y1 - x1 * y0;
    a += f;
    cx += (x0 + x1) * f;
    cy += (y0 + y1) * f;
  }
  if (Math.abs(a) < 1e-9) {
    const n = points.length;
    return [(points.reduce((s, p) => s + p[0], 0) / n) * w, (points.reduce((s, p) => s + p[1], 0) / n) * h];
  }
  return [(cx / (3 * a)) * w, (cy / (3 * a)) * h];
}

export const rectPoints = (a, b) => {
  const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]);
  const y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
};
