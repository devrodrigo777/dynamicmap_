import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import MapStage from './MapStage.jsx';
import Icon from './Icons.jsx';
import { useToast } from './Toast.jsx';
import { centroid, clamp, pointsAttr, rectPoints } from '../geometry.js';

const COLORS = ['#2B5C8F', '#E4572E', '#2E8B6B', '#B8860B', '#7B4FA3', '#C23B6B'];
const coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
let seq = 0;
const newUid = () => `n${++seq}`;
const withUid = (a) => ({ ...a, uid: `a${a.id}` });

export default function Editor({ mapId, maps, onChanged, onDirty, onDeleted, onOpenMap }) {
  const toast = useToast();
  const stageRef = useRef(null);
  const imgInput = useRef(null);

  const [map, setMap] = useState(null);
  const [areas, setAreas] = useState([]);
  const [sel, setSel] = useState(null);
  const [tool, setTool] = useState('select'); // select | polygon | rect
  const [draft, setDraft] = useState([]); // pontos normalizados em desenho
  const [hover, setHover] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');

  const mark = useCallback(() => { setDirty(true); onDirty(true); }, [onDirty]);
  const clean = useCallback(() => { setDirty(false); onDirty(false); }, [onDirty]);

  const load = useCallback(async () => {
    try {
      const m = await api.getMap(mapId);
      setMap(m);
      setName(m.name);
      setAreas(m.areas.map(withUid));
      clean();
    } catch (e) {
      toast(e.message, 'error');
    }
  }, [mapId, clean, toast]);

  useEffect(() => { load(); }, [load]);

  const selArea = areas.find((a) => a.uid === sel) || null;
  const norm = (p) => ({ x: clamp(p.x / map.width, 0, 1), y: clamp(p.y / map.height, 0, 1) });

  // ---------- criar / editar áreas ----------
  const addArea = (points) => {
    const uid = newUid();
    setAreas((list) => [...list, {
      uid, id: null, name: `Área ${list.length + 1}`, code: '', description: '', points,
      color: COLORS[list.length % COLORS.length], opacity: 0.25, show_label: true, target_map_id: null,
    }]);
    setSel(uid);
    setDraft([]);
    setHover(null);
    setTool('select');
    mark();
  };

  const patchArea = (uid, patch) => { setAreas((l) => l.map((a) => (a.uid === uid ? { ...a, ...patch } : a))); mark(); };
  const removeArea = (uid) => { setAreas((l) => l.filter((a) => a.uid !== uid)); setSel(null); mark(); };

  const finishPolygon = () => {
    if (draft.length >= 3) addArea(draft);
    else toast('Marque pelo menos 3 pontos para fechar a área.', 'error');
  };

  const cancelDraft = () => { setDraft([]); setHover(null); };
  const chooseTool = (t) => { setTool(t); cancelDraft(); if (t !== 'select') setSel(null); };

  const onTap = (pt) => {
    if (tool === 'select') return setSel(null);
    const p = norm(pt);
    if (tool === 'polygon') {
      if (draft.length >= 3) {
        const [fx, fy] = draft[0];
        const d = Math.hypot((fx - p.x) * map.width, (fy - p.y) * map.height) * stageRef.current.view.k;
        if (d < 18) return finishPolygon(); // toque no primeiro ponto fecha o polígono
      }
      setDraft((d) => [...d, [p.x, p.y]]);
    } else if (tool === 'rect') {
      if (!draft.length) return setDraft([[p.x, p.y]]);
      const pts = rectPoints(draft[0], [p.x, p.y]);
      const w = (pts[1][0] - pts[0][0]) * map.width;
      const h = (pts[2][1] - pts[0][1]) * map.height;
      if (w < 4 || h < 4) return toast('Retângulo muito pequeno.', 'error');
      addArea(pts);
    }
  };

  // ---------- arrastar vértices / mover área ----------
  const drag = (e, onMove) => {
    e.stopPropagation();
    e.preventDefault();
    const id = e.pointerId;
    const start = stageRef.current.clientToContent(e.clientX, e.clientY);
    const move = (ev) => ev.pointerId === id && onMove(stageRef.current.clientToContent(ev.clientX, ev.clientY), start);
    const up = (ev) => {
      if (ev.pointerId !== id) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const setPoint = (uid, i, p) => {
    const n = norm(p);
    setAreas((l) => l.map((a) => (a.uid !== uid ? a : { ...a, points: a.points.map((pt, j) => (j === i ? [n.x, n.y] : pt)) })));
    mark();
  };

  const startVertex = (e, uid, i) => drag(e, (p) => setPoint(uid, i, p));

  const startInsert = (e, a, i) => {
    const q = a.points[(i + 1) % a.points.length];
    const mid = [(a.points[i][0] + q[0]) / 2, (a.points[i][1] + q[1]) / 2];
    setAreas((l) => l.map((x) => (x.uid !== a.uid ? x : { ...x, points: [...x.points.slice(0, i + 1), mid, ...x.points.slice(i + 1)] })));
    mark();
    drag(e, (p) => setPoint(a.uid, i + 1, p));
  };

  const removeVertex = (uid, i) => {
    setAreas((l) => l.map((a) => (a.uid !== uid || a.points.length <= 3 ? a : { ...a, points: a.points.filter((_, j) => j !== i) })));
    mark();
  };

  const startMove = (e, a) => {
    const snap = a.points;
    const xs = snap.map((p) => p[0]);
    const ys = snap.map((p) => p[1]);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    drag(e, (p, s) => {
      const dx = clamp((p.x - s.x) / map.width, -minX, 1 - maxX);
      const dy = clamp((p.y - s.y) / map.height, -minY, 1 - maxY);
      setAreas((l) => l.map((x) => (x.uid !== a.uid ? x : { ...x, points: snap.map(([px, py]) => [px + dx, py + dy]) })));
      mark();
    });
  };

  // ---------- teclado ----------
  useEffect(() => {
    const onKey = (e) => {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.key === 'Escape') {
        if (draft.length) cancelDraft();
        else if (tool !== 'select') setTool('select');
        else setSel(null);
      } else if (e.key === 'Enter' && tool === 'polygon' && draft.length >= 3) {
        finishPolygon();
      } else if (e.key === 'Backspace' && draft.length) {
        setDraft((d) => d.slice(0, -1));
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && sel && !draft.length) {
        removeArea(sel);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---------- persistência ----------
  const save = async () => {
    setSaving(true);
    try {
      const idx = areas.findIndex((a) => a.uid === sel);
      const saved = await api.saveAreas(mapId, areas.map(({ uid, ...a }) => a));
      setMap(saved);
      const list = saved.areas.map(withUid);
      setAreas(list);
      setSel(list[idx]?.uid ?? null);
      clean();
      onChanged();
      toast('Alterações salvas.');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const renameMap = async () => {
    const n = name.trim();
    if (!n || n === map.name) return setName(map.name);
    try { setMap({ ...map, ...(await api.patchMap(mapId, { name: n })), areas: map.areas }); onChanged(); } catch (e) { toast(e.message, 'error'); }
  };

  const makeRoot = async () => {
    try { await api.patchMap(mapId, { is_root: true }); setMap((m) => ({ ...m, is_root: true })); onChanged(); toast('Esta planta agora é a tela inicial.'); } catch (e) { toast(e.message, 'error'); }
  };

  const replaceImage = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (dirty && !window.confirm('Salve ou descarte as alterações antes? Trocar a imagem recarrega a planta. Continuar?')) return;
    try {
      await api.replaceImage(mapId, file);
      await load();
      onChanged();
      toast('Imagem substituída. As áreas foram mantidas na mesma posição relativa.');
    } catch (err) { toast(err.message, 'error'); }
  };

  const deleteMap = async () => {
    if (!window.confirm(`Excluir a planta "${map.name}" e todas as suas áreas? Áreas de outras plantas que abrem esta imagem perdem o vínculo.`)) return;
    try { await api.deleteMap(mapId); onDeleted(); toast('Planta excluída.'); } catch (e) { toast(e.message, 'error'); }
  };

  if (!map) return <div className="center-screen inline"><div className="spinner" /></div>;

  // ---------- desenho ----------
  const r = (coarse ? 13 : 8);
  const overlay = ({ k }) => (
    <>
      {areas.map((a) => {
        const isSel = a.uid === sel;
        const [cx, cy] = centroid(a.points, map.width, map.height);
        return (
          <g
            key={a.uid}
            className={`area${isSel ? ' is-selected' : ''}${tool !== 'select' ? ' is-passive' : ''}${a.target_map_id ? ' has-target' : ''}`}
            style={{ '--c': a.color, '--o': a.opacity }}
          >
            <polygon
              points={pointsAttr(a.points, map.width, map.height)}
              vectorEffect="non-scaling-stroke"
              onClick={() => tool === 'select' && setSel(a.uid)}
              onPointerDown={isSel && tool === 'select' ? (e) => startMove(e, a) : undefined}
            />
            {a.show_label && a.name && <text x={cx} y={cy} fontSize={14 / k} strokeWidth={3.5 / k}>{a.name}</text>}
          </g>
        );
      })}

      {selArea && tool === 'select' && (
        <g>
          {selArea.points.map((p, i) => {
            const q = selArea.points[(i + 1) % selArea.points.length];
            return (
              <circle key={`m${i}`} className="handle mid" cx={((p[0] + q[0]) / 2) * map.width} cy={((p[1] + q[1]) / 2) * map.height}
                r={(r * 0.65) / k} strokeWidth={1.5 / k} onPointerDown={(e) => startInsert(e, selArea, i)} />
            );
          })}
          {selArea.points.map((p, i) => (
            <circle key={`v${i}`} className="handle vertex" cx={p[0] * map.width} cy={p[1] * map.height}
              r={r / k} strokeWidth={2 / k}
              onPointerDown={(e) => startVertex(e, selArea.uid, i)} onDoubleClick={() => removeVertex(selArea.uid, i)} />
          ))}
        </g>
      )}

      {draft.length > 0 && (() => {
        const live = hover ? [...draft, [hover.x, hover.y]] : draft;
        const pts = tool === 'rect' && hover ? rectPoints(draft[0], [hover.x, hover.y]) : live;
        return (
          <g className="draft">
            {tool === 'rect' && hover
              ? <polygon points={pointsAttr(pts, map.width, map.height)} vectorEffect="non-scaling-stroke" />
              : <polyline points={pointsAttr(pts, map.width, map.height)} vectorEffect="non-scaling-stroke" />}
            {draft.map((p, i) => (
              <circle key={i} className={`handle vertex${i === 0 && draft.length >= 3 && tool === 'polygon' ? ' close' : ''}`}
                cx={p[0] * map.width} cy={p[1] * map.height} r={(i === 0 ? r * 1.2 : r * 0.8) / k} strokeWidth={2 / k} style={{ pointerEvents: 'none' }} />
            ))}
          </g>
        );
      })()}
    </>
  );

  const hint =
    tool === 'polygon' ? (draft.length < 3 ? 'Toque na planta para marcar os cantos da área.' : 'Continue marcando ou toque no primeiro ponto para fechar.')
    : tool === 'rect' ? (draft.length ? 'Toque no canto oposto.' : 'Toque no primeiro canto do retângulo.')
    : selArea ? 'Arraste os pontos para ajustar. Arraste os pontos claros para criar novos cantos.'
    : 'Toque em uma área para editar, ou escolha uma ferramenta de desenho.';

  const otherMaps = maps.filter((m) => m.id !== mapId);

  return (
    <div className="editor">
      <div className="ed-toolbar">
        <div className="seg" role="group" aria-label="Ferramentas">
          <button className={`btn ${tool === 'select' ? 'active' : ''}`} onClick={() => chooseTool('select')}><Icon name="cursor" /><span>Selecionar</span></button>
          <button className={`btn ${tool === 'polygon' ? 'active' : ''}`} onClick={() => chooseTool('polygon')}><Icon name="polygon" /><span>Polígono</span></button>
          <button className={`btn ${tool === 'rect' ? 'active' : ''}`} onClick={() => chooseTool('rect')}><Icon name="square" /><span>Retângulo</span></button>
        </div>
        {tool === 'polygon' && draft.length > 0 && (
          <>
            <button className="btn primary" onClick={finishPolygon} disabled={draft.length < 3}><Icon name="check" /><span>Concluir</span></button>
            <button className="btn" onClick={cancelDraft}><Icon name="close" /><span>Cancelar</span></button>
          </>
        )}
        <div className="spacer" />
        {dirty && <span className="dirty">Alterações não salvas</span>}
        <button className="btn primary" onClick={save} disabled={!dirty || saving}><Icon name="save" /><span>{saving ? 'Salvando…' : 'Salvar'}</span></button>
      </div>

      <div className="ed-body">
        <div className="ed-canvas">
          <MapStage
            key={map.image}
            ref={stageRef}
            map={map}
            overlay={overlay}
            onTap={onTap}
            onHover={tool !== 'select' && draft.length ? setHover : undefined}
            className={tool !== 'select' ? 'is-drawing' : ''}
          />
          <p className="canvas-hint">{hint}</p>
        </div>

        <aside className="inspector">
          <section className="panel">
            <h2>Planta</h2>
            <label className="field">Nome
              <input value={name} onChange={(e) => setName(e.target.value)} onBlur={renameMap} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
            </label>
            <div className="row">
              <input ref={imgInput} type="file" hidden accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif" onChange={replaceImage} />
              <button className="btn" onClick={() => imgInput.current.click()}><Icon name="swap" /> Trocar imagem</button>
              <button className="btn" onClick={makeRoot} disabled={map.is_root}><Icon name="star" /> {map.is_root ? 'Tela inicial' : 'Definir como inicial'}</button>
              <button className="btn danger" onClick={deleteMap}><Icon name="trash" /> Excluir</button>
            </div>
            <p className="muted">{map.width} × {map.height} px</p>
          </section>

          <section className="panel">
            <h2>Áreas ({areas.length})</h2>
            {areas.length === 0 && <p className="muted">Nenhuma área ainda. Use Polígono ou Retângulo para desenhar a primeira.</p>}
            <ul className="area-list">
              {areas.map((a) => (
                <li key={a.uid}>
                  <button className={a.uid === sel ? 'active' : ''} onClick={() => { chooseTool('select'); setSel(a.uid); }}>
                    <span className="swatch" style={{ background: a.color }} />
                    <span>{a.name || 'Sem nome'}</span>
                    {a.target_map_id && <Icon name="open" size={15} />}
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {selArea && (
            <section className="panel" key={selArea.uid}>
              <h2>Área selecionada</h2>
              <label className="field">Nome
                <input value={selArea.name} onChange={(e) => patchArea(selArea.uid, { name: e.target.value })} />
              </label>
              <label className="field">Código
                <input value={selArea.code} placeholder="Ex.: PRD-01" onChange={(e) => patchArea(selArea.uid, { code: e.target.value })} />
                <small>Será usado para ligar esta área a planilhas e métricas.</small>
              </label>
              <label className="field">Descrição
                <textarea rows={3} value={selArea.description} onChange={(e) => patchArea(selArea.uid, { description: e.target.value })} />
              </label>
              <label className="field">Ao clicar, abrir
                <select value={selArea.target_map_id ?? ''} onChange={(e) => patchArea(selArea.uid, { target_map_id: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">Apenas mostrar informações</option>
                  {otherMaps.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                {otherMaps.length === 0 && <small>Envie outra imagem para usá-la como detalhe.</small>}
              </label>
              {selArea.target_map_id && (
                <button className="btn" onClick={() => onOpenMap(selArea.target_map_id)}><Icon name="open" /> Editar imagem de detalhe</button>
              )}
              <div className="row">
                <label className="field color">Cor
                  <input type="color" value={selArea.color} onChange={(e) => patchArea(selArea.uid, { color: e.target.value })} />
                </label>
                <label className="field grow">Opacidade ({Math.round(selArea.opacity * 100)}%)
                  <input type="range" min="0" max="0.8" step="0.05" value={selArea.opacity} onChange={(e) => patchArea(selArea.uid, { opacity: Number(e.target.value) })} />
                </label>
              </div>
              <label className="check">
                <input type="checkbox" checked={selArea.show_label} onChange={(e) => patchArea(selArea.uid, { show_label: e.target.checked })} />
                Mostrar o nome sobre a área
              </label>
              <button className="btn danger" onClick={() => removeArea(selArea.uid)}><Icon name="trash" /> Excluir área</button>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
