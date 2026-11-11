import { forwardRef, useImperativeHandle, useLayoutEffect } from 'react';
import usePanZoom from '../hooks/usePanZoom.js';
import Icon from './Icons.jsx';

/**
 * Imagem + camada SVG de áreas, com pan/zoom.
 *  - overlay({ k }) devolve o SVG a desenhar por cima (coordenadas em px da imagem)
 *  - intro: { kind: 'in' } (entra com fade) | { kind: 'out', box } (afasta a partir da área)
 *  - ref expõe: fit, zoomToBox, zoomBy, clientToContent, view
 */
const MapStage = forwardRef(function MapStage(
  { map, overlay, intro, onTap, onHover, className = '', controls = true },
  ref,
) {
  const pz = usePanZoom({ width: map.width, height: map.height, onTap, onHover });
  useImperativeHandle(ref, () => pz);

  useLayoutEffect(() => {
    if (intro?.box) pz.introFromBox(intro.box);
    else pz.fit(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const { x, y, k } = pz.view;
  const transition =
    pz.mode === 'smooth' ? 'transform var(--glide) var(--ease)'
    : pz.mode === 'fast' ? 'transform 140ms ease-out'
    : 'none';

  return (
    <div
      ref={pz.containerRef}
      className={`stage ${pz.dragging ? 'is-dragging' : ''} ${className}`}
      {...pz.handlers}
    >
      <div className={`stage-fx ${intro?.kind === 'in' ? 'fx-in' : 'fx-fade'}`}>
        <div
          className="stage-content"
          style={{
            width: map.width,
            height: map.height,
            transform: `translate3d(${x}px, ${y}px, 0) scale(${k})`,
            transition,
          }}
        >
          <img src={map.image} width={map.width} height={map.height} alt={map.name} draggable={false} />
          <svg className="stage-overlay" viewBox={`0 0 ${map.width} ${map.height}`} width={map.width} height={map.height}>
            {overlay?.({ k })}
          </svg>
        </div>
      </div>

      {controls && (
        <div className="stage-controls" onPointerDown={(e) => e.stopPropagation()}>
          <button className="btn icon" onClick={() => pz.zoomBy(1.6)} aria-label="Aproximar"><Icon name="plus" /></button>
          <button className="btn icon" onClick={() => pz.zoomBy(1 / 1.6)} aria-label="Afastar"><Icon name="minus" /></button>
          <button className="btn icon" onClick={() => pz.fit(true)} aria-label="Enquadrar planta"><Icon name="fit" /></button>
        </div>
      )}
    </div>
  );
});

export default MapStage;
