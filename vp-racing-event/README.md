# Torneo + Fotobooth VP Racing

Prueba de concepto para un evento privado: torneo 1v1 de 12 participantes
(gana el tiempo más rápido, avanza a la siguiente ronda) + fotobooth con
gorra VP Racing y estilos con IA (caricatura, manga, dibujo animado,
"científico loco" VP Racing).

Proyecto completamente aislado del resto de este repositorio (que es un
sistema de reconocimiento de placas para estacionamiento, sin relación
alguna con esto) — no comparte código, dependencias ni base de datos con
`backend/` ni `frontend/` en la raíz del repo.

## Estado honesto de lo implementado

**Torneo:** funcional de punta a punta. Arma el bracket automáticamente
para 12 participantes (o cualquier cantidad ≥ 2, completando con pases
directos si no es potencia de 2), carga manual de tiempos por duelo,
avance automático del más rápido, corona campeón. Probado con tests
automáticos (`pytest`) y en el navegador.

**Fotobooth — gorra:** funcional y gratis al 100%, sin IA. Es compositing
simple en el navegador: arrastrás y escalás la gorra sobre tu propia foto.
La imagen de la gorra en `frontend/public/cap-placeholder.svg` es un
**placeholder genérico sin marca** — hay que reemplazarla por el asset real
con el logo de VP Racing (PNG con transparencia, recomendado) antes del
evento.

**Fotobooth — estilos con IA (caricatura, manga, cartoon, personaje VP
Racing):** el flujo completo funciona, pero con una limitación real que no
conviene minimizar:

- **Sin `HF_TOKEN` configurado:** modo demo — devuelve la foto original sin
  transformar. Sirve para probar todo el flujo (subir foto, elegir estilo,
  ver/descargar resultado) sin gastar nada.
- **Con `HF_TOKEN` gratuito de Hugging Face:** aplica una transformación de
  estilo real vía su Inference API (free tier), pero con un modelo
  genérico de img2img — da un resultado estilizado, **no preserva bien el
  parecido facial**. Para "poner tu cara" en el personaje científico de VP
  Racing con verdadero parecido, hace falta un pipeline de identidad
  (InstantID / IP-Adapter FaceID), que el free tier serverless de HF no
  ofrece. Eso requiere una API paga (fal.ai o Replicate, ~$0.02–0.08 por
  imagen) o un GPU propio/alquilado. Con 12 participantes × 4 estilos = 48
  imágenes, el costo total con API paga es de aproximadamente **US$1 a
  US$4**.
- El free tier de HF también es lento/inestable en el primer uso de cada
  modelo (puede tardar ~20-30s en "despertar") — para el evento en vivo,
  conviene testear con anticipación o pasar a la API paga.

## Cómo correrlo

### Backend

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
cp .env.example .env   # opcional: completar HF_TOKEN para estilos IA reales
.venv/bin/uvicorn app.main:app --reload --port 8000
```

Tests: `.venv/bin/python -m pytest tests/ -v`

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Por defecto apunta a `http://localhost:8000` (backend). Para otro host,
crear `frontend/.env` con `VITE_API_URL=http://tu-backend:8000`.

## Siguientes pasos sugeridos

1. Reemplazar `cap-placeholder.svg` por el PNG real de la gorra VP Racing.
2. Decidir: ¿free tier de HF para probar, o pasar directo a fal.ai/Replicate
   con InstantID para que el "científico loco" realmente se parezca a cada
   participante? (la app ya está lista para cualquiera de los dos —
   `backend/app/services/style_service.py` es el único lugar a tocar).
3. Antes del evento: probar con una foto real, en la red/lugar donde se va
   a usar, para confirmar tiempos de respuesta.
