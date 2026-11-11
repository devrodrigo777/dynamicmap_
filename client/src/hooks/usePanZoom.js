import { useCallback, useEffect, useRef, useState } from 'react';

// Pan + zoom com mouse (arrastar/roda), toque (1 dedo arrasta, 2 dedos pinça)
// e animações programáticas (zoomToBox/fit). O conteúdo tem o tamanho real da
// imagem (px) e é transformado por translate + scale.

export const GLIDE_MS = 700; // mantenha igual a --glide no CSS
const MAX_ZOOM = 14; // relativo ao enquadramento da imagem inteira
const TAP_SLOP = 6; // px de movimento tolerado para ainda contar como "toque"
const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export default function usePanZoom({ width, height, onTap, onHover }) {
  const containerRef = useRef(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [mode, setMode] = useState('none'); // none | fast | smooth (tipo de transição CSS)
  const [dragging, setDragging] = useState(false);

  const viewRef = useRef(view);
  const size = useRef({ w: 0, h: 0 });
  const fitK = useRef(1);
  const interacted = useRef(false);
  const pointers = useRef(new Map());
  const gesture = useRef(null);
  const timer = useRef(null);
  const cb = useRef({});
  cb.current = { onTap, onHover };

  const apply = useCallback((v, m = 'none') => {
    viewRef.current = v;
    setMode(m);
    setView(v);
  }, []);

  const measure = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    size.current = { w: r.width, h: r.height };
    const pad = Math.min(32, r.width * 0.04);
    fitK.current = Math.max(0.0001, Math.min((r.width - pad * 2) / width, (r.height - pad * 2) / height));
  }, [width, height]);

  const clampK = (k) => Math.min(Math.max(k, fitK.current * 0.6), fitK.current * MAX_ZOOM);

  const clampView = (v) => {
    const { w: cw, h: ch } = size.current;
    const slack = 60;
    const fit = (val, c, s) =>
      s <= c ? Math.min(Math.max(val, 0), c - s) : Math.min(Math.max(val, c - s - slack), slack);
    return { k: v.k, x: fit(v.x, cw, width * v.k), y: fit(v.y, ch, height * v.k) };
  };

  const fitView = () => {
    const { w: cw, h: ch } = size.current;
    const k = fitK.current;
    return { k, x: (cw - width * k) / 2, y: (ch - height * k) / 2 };
  };

  const boxView = (box, padding = 0.12) => {
    const { w: cw, h: ch } = size.current;
    const bw = Math.max((box.x1 - box.x0) * width, 1);
    const bh = Math.max((box.y1 - box.y0) * height, 1);
    const k = clampK(Math.min(cw / (bw * (1 + padding * 2)), ch / (bh * (1 + padding * 2))));
    const cx = ((box.x0 + box.x1) / 2) * width;
    const cy = ((box.y0 + box.y1) / 2) * height;
    return { k, x: cw / 2 - cx * k, y: ch / 2 - cy * k };
  };

  const toLocal = (cx, cy) => {
    const r = containerRef.current.getBoundingClientRect();
    return { x: cx - r.left, y: cy - r.top };
  };

  // coordenadas da tela -> pixels da imagem
  const clientToContent = useCallback((cx, cy) => {
    const l = toLocal(cx, cy);
    const v = viewRef.current;
    return { x: (l.x - v.x) / v.k, y: (l.y - v.y) / v.k };
  }, []);

  // Animação suave até uma visão; a promessa resolve quando termina.
  const glide = useCallback((v) => {
    clearTimeout(timer.current);
    interacted.current = true;
    const instant = reduceMotion();
    apply(clampView(v), instant ? 'none' : 'smooth');
    return new Promise((resolve) => {
      timer.current = setTimeout(resolve, instant ? 0 : GLIDE_MS);
    });
  }, [width, height]); // eslint-disable-line react-hooks/exhaustive-deps

  const zoomAt = (cx, cy, factor, m) => {
    const v = viewRef.current;
    const k = clampK(v.k * factor);
    const r = k / v.k;
    interacted.current = true;
    apply(clampView({ k, x: cx - (cx - v.x) * r, y: cy - (cy - v.y) * r }), m);
  };

  // ----- API imperativa -----
  const fit = useCallback((animated = true) => {
    measure();
    interacted.current = false;
    if (animated) glide(fitView());
    else apply(fitView());
    interacted.current = false;
  }, [measure, glide]); // eslint-disable-line react-hooks/exhaustive-deps

  const zoomToBox = useCallback((box, { padding = 0.12 } = {}) => glide(boxView(box, padding)), [glide]); // eslint-disable-line react-hooks/exhaustive-deps

  const zoomBy = useCallback((factor) => {
    const { w, h } = size.current;
    const v = viewRef.current;
    const k = clampK(v.k * factor);
    const r = k / v.k;
    return glide({ k, x: w / 2 - (w / 2 - v.x) * r, y: h / 2 - (h / 2 - v.y) * r });
  }, [glide]); // eslint-disable-line react-hooks/exhaustive-deps

  // Começa já ampliado numa região e "afasta" até o enquadramento (usado ao voltar).
  const introFromBox = useCallback((box) => {
    measure();
    apply(boxView(box, 0.35));
    requestAnimationFrame(() => requestAnimationFrame(() => {
      glide(fitView());
      interacted.current = false;
    }));
  }, [measure, glide]); // eslint-disable-line react-hooks/exhaustive-deps

  // ----- eventos de ponteiro -----
  const startPinch = () => {
    const [a, b] = [...pointers.current.values()];
    gesture.current = {
      type: 'pinch',
      dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      center: toLocal((a.x + b.x) / 2, (a.y + b.y) / 2),
      v: viewRef.current,
      moved: true,
    };
    setDragging(true);
    for (const id of pointers.current.keys()) {
      try { containerRef.current.setPointerCapture(id); } catch { /* ok */ }
    }
  };

  const onPointerDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    clearTimeout(timer.current);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      gesture.current = { type: 'pan', sx: e.clientX, sy: e.clientY, v: viewRef.current, moved: false };
    } else if (pointers.current.size === 2) {
      startPinch();
    }
  };

  const onPointerMove = (e) => {
    const p = pointers.current.get(e.pointerId);
    if (!p) {
      if (e.pointerType === 'mouse') cb.current.onHover?.(clientToContent(e.clientX, e.clientY));
      return;
    }
    p.x = e.clientX;
    p.y = e.clientY;
    const g = gesture.current;
    if (!g) return;

    if (g.type === 'pan' && pointers.current.size === 1) {
      const dx = e.clientX - g.sx;
      const dy = e.clientY - g.sy;
      if (!g.moved) {
        if (Math.hypot(dx, dy) < TAP_SLOP) return;
        g.moved = true;
        interacted.current = true;
        try { containerRef.current.setPointerCapture(e.pointerId); } catch { /* ok */ }
        setDragging(true);
      }
      apply(clampView({ k: g.v.k, x: g.v.x + dx, y: g.v.y + dy }));
    } else if (g.type === 'pinch' && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const c = toLocal((a.x + b.x) / 2, (a.y + b.y) / 2);
      const k = clampK(g.v.k * (dist / g.dist));
      // mantém o ponto da imagem que estava sob os dedos sob os dedos
      const px = (g.center.x - g.v.x) / g.v.k;
      const py = (g.center.y - g.v.y) / g.v.k;
      interacted.current = true;
      apply(clampView({ k, x: c.x - px * k, y: c.y - py * k }));
    }
  };

  const onPointerUp = (e) => {
    const had = pointers.current.get(e.pointerId);
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (e.type === 'pointerup' && had && g?.type === 'pan' && !g.moved) {
      cb.current.onTap?.(clientToContent(e.clientX, e.clientY), e);
    }
    if (pointers.current.size === 1 && g?.type === 'pinch') {
      const [r] = [...pointers.current.values()];
      gesture.current = { type: 'pan', sx: r.x, sy: r.y, v: viewRef.current, moved: true };
    } else if (pointers.current.size === 0) {
      gesture.current = null;
      setDragging(false);
    }
  };

  // roda do mouse / trackpad (precisa de listener nativo não-passivo)
  useEffect(() => {
    const el = containerRef.current;
    const onWheel = (e) => {
      e.preventDefault();
      const l = toLocal(e.clientX, e.clientY);
      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : 1);
      zoomAt(l.x, l.y, Math.exp(-delta * (e.ctrlKey ? 0.01 : 0.0015)), 'fast');
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [width, height]); // eslint-disable-line react-hooks/exhaustive-deps

  // acompanha o tamanho da janela (rotação do tablet, redimensionar etc.)
  useEffect(() => {
    const el = containerRef.current;
    const ro = new ResizeObserver(() => {
      measure();
      if (!interacted.current) apply(fitView());
      else apply(clampView(viewRef.current));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => clearTimeout(timer.current), []);

  return {
    containerRef,
    view,
    mode,
    dragging,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
    fit,
    zoomToBox,
    zoomBy,
    introFromBox,
    clientToContent,
  };
}
