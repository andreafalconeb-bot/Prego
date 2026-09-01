import { useRef, useState } from "react";

interface Props {
  photoDataUrl: string;
  capSrc: string;
}

/**
 * Compositing 100% en el cliente (sin backend, sin IA, gratis): el usuario
 * arrastra y escala la gorra sobre su propia foto con el mouse/dedo. Más
 * confiable para un evento en vivo que detección automática de cara (que
 * puede fallar con ángulos raros o mala luz).
 */
export default function CapOverlay({ photoDataUrl, capSrc }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const photoRef = useRef<HTMLImageElement>(null);
  const capImgRef = useRef<HTMLImageElement>(null);
  const [pos, setPos] = useState({ xFrac: 0.28, yFrac: 0.05 });
  const [widthFrac, setWidthFrac] = useState(0.45);
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(
    null,
  );

  function onPointerDown(event: React.PointerEvent) {
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    dragState.current = { startX: event.clientX, startY: event.clientY, origX: pos.xFrac, origY: pos.yFrac };
  }

  function onPointerMove(event: React.PointerEvent) {
    if (!dragState.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const dxFrac = (event.clientX - dragState.current.startX) / rect.width;
    const dyFrac = (event.clientY - dragState.current.startY) / rect.height;
    setPos({
      xFrac: Math.min(1, Math.max(-0.2, dragState.current.origX + dxFrac)),
      yFrac: Math.min(1, Math.max(-0.2, dragState.current.origY + dyFrac)),
    });
  }

  function onPointerUp() {
    dragState.current = null;
  }

  function download() {
    const photo = photoRef.current;
    const cap = capImgRef.current;
    if (!photo || !cap) return;
    const canvas = document.createElement("canvas");
    canvas.width = photo.naturalWidth;
    canvas.height = photo.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(photo, 0, 0);
    const capWidth = widthFrac * photo.naturalWidth;
    const capHeight = capWidth * (cap.naturalHeight / cap.naturalWidth);
    ctx.drawImage(cap, pos.xFrac * photo.naturalWidth, pos.yFrac * photo.naturalHeight, capWidth, capHeight);
    const link = document.createElement("a");
    link.download = "vp-racing-gorra.jpg";
    link.href = canvas.toDataURL("image/jpeg", 0.92);
    link.click();
  }

  return (
    <div className="cap-overlay">
      <div ref={containerRef} className="cap-overlay-canvas">
        <img ref={photoRef} src={photoDataUrl} alt="Tu foto" className="cap-overlay-photo" />
        <img
          ref={capImgRef}
          src={capSrc}
          alt="Gorra VP Racing"
          className="cap-overlay-cap"
          style={{
            left: `${pos.xFrac * 100}%`,
            top: `${pos.yFrac * 100}%`,
            width: `${widthFrac * 100}%`,
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        />
      </div>
      <label className="hint">
        Tamaño de la gorra
        <input
          type="range"
          min={0.15}
          max={0.9}
          step={0.01}
          value={widthFrac}
          onChange={(event) => setWidthFrac(Number(event.target.value))}
        />
      </label>
      <p className="hint">Arrastrá la gorra para ubicarla sobre tu cabeza.</p>
      <button type="button" className="primary-button" onClick={download}>
        Descargar foto con gorra
      </button>
    </div>
  );
}
