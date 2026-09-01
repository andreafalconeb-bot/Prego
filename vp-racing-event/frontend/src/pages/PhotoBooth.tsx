import { useState } from "react";
import CameraCapture from "../components/CameraCapture";
import CapOverlay from "../components/CapOverlay";
import { transformPhoto } from "../api";

const STYLES: { key: string; label: string }[] = [
  { key: "caricatura", label: "Caricatura" },
  { key: "manga", label: "Manga" },
  { key: "cartoon", label: "Dibujo animado" },
  { key: "cientifico_vp_racing", label: "Científico loco VP Racing" },
];

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(",");
  const mime = header.match(/data:(.*);base64/)?.[1] ?? "image/jpeg";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export default function PhotoBooth() {
  const [photo, setPhoto] = useState<string | null>(null);
  const [loadingStyle, setLoadingStyle] = useState<string | null>(null);
  const [result, setResult] = useState<{ image: string; demoMode: boolean; style: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  async function applyStyle(styleKey: string) {
    if (!photo) return;
    setLoadingStyle(styleKey);
    setError(null);
    try {
      const response = await transformPhoto(styleKey, dataUrlToBlob(photo));
      setResult({
        image: `data:image/jpeg;base64,${response.image_base64}`,
        demoMode: response.demo_mode,
        style: styleKey,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error transformando la foto");
    } finally {
      setLoadingStyle(null);
    }
  }

  return (
    <div className="page">
      <h1>Fotobooth VP Racing</h1>

      {!photo && <CameraCapture onCapture={setPhoto} />}

      {photo && (
        <>
          <button type="button" className="link-button" onClick={() => { setPhoto(null); setResult(null); }}>
            ← Sacar otra foto
          </button>

          <section>
            <h2>Gorra VP Racing (gratis, al instante)</h2>
            <CapOverlay photoDataUrl={photo} capSrc="/cap-placeholder.svg" />
            <p className="hint">
              El PNG de esta gorra es un placeholder genérico. Reemplazalo por el asset real con
              el logo VP Racing en <code>public/cap-placeholder.svg</code> (o cambiá la ruta en
              este componente por un <code>.png</code> con transparencia).
            </p>
          </section>

          <section>
            <h2>Estilos con IA</h2>
            <div className="style-buttons">
              {STYLES.map((style) => (
                <button
                  key={style.key}
                  type="button"
                  className="primary-button"
                  disabled={loadingStyle !== null}
                  onClick={() => applyStyle(style.key)}
                >
                  {loadingStyle === style.key ? "Generando…" : style.label}
                </button>
              ))}
            </div>
            {error && <p className="error">{error}</p>}
            {result && (
              <div className="result">
                {result.demoMode && (
                  <p className="hint">
                    Modo demo: no hay HF_TOKEN configurado en el backend, así que se muestra la
                    foto original sin estilizar. Configurá un token gratuito de Hugging Face para
                    ver la transformación real (ver README).
                  </p>
                )}
                <img src={result.image} alt={`Resultado ${result.style}`} className="result-image" />
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
