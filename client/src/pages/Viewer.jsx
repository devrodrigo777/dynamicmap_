import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, preload } from '../api.js';
import MapStage from '../components/MapStage.jsx';
import Icon from '../components/Icons.jsx';
import { useToast } from '../components/Toast.jsx';
import { bbox, centroid, pointsAttr } from '../geometry.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const LEAVE_MS = 240; // mantenha igual à duração do fade em .stage.is-leaving

export default function Viewer() {
  const toast = useToast();
  const stageRef = useRef(null);
  const cache = useRef(new Map());

  const [status, setStatus] = useState('loading'); // loading | ready | empty | error
  const [map, setMap] = useState(null);
  const [stack, setStack] = useState([]); // ancestrais: { id, name, box }
  const [intro, setIntro] = useState(null);
  const [phase, setPhase] = useState('idle'); // idle | zooming | leaving
  const [selected, setSelected] = useState(null);
  const [tip, setTip] = useState(null);
  const [fullscreen, setFullscreen] = useState(false);

  // Busca (e guarda em cache) a planta + a imagem já baixada.
  const fetchMap = useCallback((id) => {
    if (!cache.current.has(id)) {
      const p = (id === 'root' ? api.getRoot() : api.getMap(id)).then(async (m) => {
        if (m) await preload(m.image);
        return m;
      });
      p.catch(() => cache.current.delete(id));
      cache.current.set(id, p);
    }
    return cache.current.get(id);
  }, []);

  const loadRoot = useCallback(() => {
    setStatus('loading');
    cache.current.clear();
    fetchMap('root')
      .then((m) => {
        if (!m) return setStatus('empty');
        setMap(m);
        setStatus('ready');
      })
      .catch(() => setStatus('error'));
  }, [fetchMap]);

  useEffect(loadRoot, [loadRoot]);

  const openArea = async (area) => {
    if (phase !== 'idle') return;
    setTip(null);
    if (!area.target_map_id) {
      setSelected(area);
      return;
    }
    const box = bbox(area.points);
    setSelected(null);
    setPhase('zooming');
    try {
      // zoom na área e, em paralelo, carrega a imagem de detalhe
      const [next] = await Promise.all([
        fetchMap(area.target_map_id),
        stageRef.current.zoomToBox(box, { padding: 0.06 }),
      ]);
      if (!next) throw new Error('A imagem de detalhe não existe mais.');
      setPhase('leaving');
      await wait(LEAVE_MS);
      setStack((s) => [...s, { id: map.id, name: map.name, box }]);
      setIntro({ kind: 'in' });
      setMap(next);
      setPhase('idle');
    } catch (e) {
      setPhase('idle');
      stageRef.current?.fit();
      toast(e.message, 'error');
    }
  };

  const goBack = async (index) => {
    if (phase !== 'idle' || index < 0 || index >= stack.length) return;
    const entry = stack[index];
    setSelected(null);
    setTip(null);
    setPhase('leaving');
    try {
      const [prev] = await Promise.all([fetchMap(entry.id), wait(LEAVE_MS)]);
      if (!prev) throw new Error('A planta anterior não existe mais.');
      setStack(stack.slice(0, index));
      setIntro({ kind: 'out', box: entry.box });
      setMap(prev);
    } catch (e) {
      toast(e.message, 'error');
    }
    setPhase('idle');
  };

  // Esc: fecha o painel; depois volta um nível
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (selected) setSelected(null);
      else if (stack.length) goBack(stack.length - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = () =>
    document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();

  // ---------- estados vazios ----------
  if (status === 'loading') {
    return <div className="center-screen"><div className="spinner" role="status" aria-label="Carregando" /></div>;
  }
  if (status === 'error') {
    return (
      <div className="center-screen">
        <h1>Servidor indisponível</h1>
        <p>Não foi possível carregar o mapa. Verifique se o servidor está em execução.</p>
        <button className="btn primary" onClick={loadRoot}>Tentar novamente</button>
      </div>
    );
  }
  if (status === 'empty') {
    return (
      <div className="center-screen">
        <h1>Nenhuma planta cadastrada</h1>
        <p>Envie a imagem da planta da fábrica no painel admin para começar.</p>
        <Link className="btn primary" to="/admin">Abrir painel admin</Link>
      </div>
    );
  }

  const crumbs = [...stack.map((s, i) => ({ name: s.name, index: i })), { name: map.name, index: null }];

  const overlay = ({ k }) =>
    map.areas.map((a) => {
      const [cx, cy] = centroid(a.points, map.width, map.height);
      const cls = `area${a.target_map_id ? ' has-target' : ''}${selected?.id === a.id ? ' is-selected' : ''}`;
      return (
        <g
          key={a.id}
          className={cls}
          style={{ '--c': a.color, '--o': a.opacity }}
          onClick={() => openArea(a)}
          onPointerEnter={() => a.target_map_id && fetchMap(a.target_map_id)}
          onPointerMove={(e) => e.pointerType === 'mouse' && setTip({ x: e.clientX, y: e.clientY, area: a })}
          onPointerLeave={() => setTip(null)}
        >
          <polygon points={pointsAttr(a.points, map.width, map.height)} vectorEffect="non-scaling-stroke" />
          {a.show_label && a.name && (
            <text x={cx} y={cy} fontSize={14 / k} strokeWidth={3.5 / k}>{a.name}</text>
          )}
        </g>
      );
    });

  return (
    <div className="viewer">
      <header className="topbar">
        {stack.length > 0 && (
          <button className="btn icon" onClick={() => goBack(stack.length - 1)} aria-label="Voltar um nível">
            <Icon name="back" />
          </button>
        )}
        <nav className="crumbs" aria-label="Localização">
          {crumbs.map((c, i) => (
            <span key={i} className="crumb">
              {c.index === null ? (
                <h1>{c.name}</h1>
              ) : (
                <button onClick={() => goBack(c.index)}>{c.name}</button>
              )}
            </span>
          ))}
        </nav>
        <div className="spacer" />
        {document.fullscreenEnabled && (
          <button className="btn icon" onClick={toggleFullscreen} aria-label={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'}>
            <Icon name="full" />
          </button>
        )}
        <Link className="btn icon" to="/admin" aria-label="Painel admin"><Icon name="gear" /></Link>
      </header>

      <main className="viewer-body">
        <MapStage
          key={map.id}
          ref={stageRef}
          map={map}
          intro={intro}
          overlay={overlay}
          className={phase === 'leaving' ? 'is-leaving' : ''}
          onTap={() => setSelected(null)}
        />

        {selected && (
          <aside className="info" key={selected.id}>
            <button className="btn icon ghost info-close" onClick={() => setSelected(null)} aria-label="Fechar">
              <Icon name="close" />
            </button>
            <span className="swatch" style={{ background: selected.color }} />
            <h2>{selected.name || 'Área sem nome'}</h2>
            {selected.code && <p className="code">{selected.code}</p>}
            {selected.description && <p>{selected.description}</p>}
          </aside>
        )}
      </main>

      {tip && (
        <div className="tooltip" style={{ left: tip.x + 16, top: tip.y + 16 }}>
          <strong>{tip.area.name || 'Área sem nome'}</strong>
          {tip.area.target_map_id && <span>Clique para ver o detalhe</span>}
        </div>
      )}
    </div>
  );
}
