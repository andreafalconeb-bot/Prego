"""Transformación de fotos con IA para el fotobooth.

Con HF_TOKEN configurado (gratis, se consigue en huggingface.co/settings/tokens
sin tarjeta) llama al free tier de la Inference API de Hugging Face. Sin
token, devuelve la imagen original sin tocar y marca `demo_mode=True` en la
respuesta, para poder probar todo el flujo (subir foto, elegir estilo,
descargar resultado) sin gastar nada ni pedir alta a nadie.

Aviso honesto: el free tier con img2img genérico da un resultado estilizado
pero NO preserva la identidad facial con precisión (no es face-swap real).
Para fusionar la cara del participante con el personaje científico loco de
VP Racing manteniendo el parecido, hace falta un pipeline con
InstantID/IP-Adapter (disponible pago en fal.ai o Replicate, o self-hosted
con GPU) — no está disponible en el free tier serverless de HF.
"""

from __future__ import annotations

import httpx

from ..config import settings

STYLE_PROMPTS = {
    "caricatura": "turn this into a fun exaggerated caricature drawing, bold ink lines, vivid colors",
    "manga": "turn this into a black and white manga panel illustration, screentone shading",
    "cartoon": "turn this into a colorful cartoon character illustration, clean vector lines",
    "cientifico_vp_racing": (
        "turn this into a mad scientist racing character illustration, VP Racing garage lab "
        "background, safety goggles, energetic pose"
    ),
}


class StyleServiceError(RuntimeError):
    pass


async def transform(image_bytes: bytes, style: str) -> tuple[bytes, bool]:
    """Devuelve (imagen_resultante_bytes, demo_mode)."""
    if style not in STYLE_PROMPTS:
        raise StyleServiceError(f"Estilo desconocido: {style}")

    if not settings.hf_token:
        return image_bytes, True

    url = f"https://api-inference.huggingface.co/models/{settings.hf_img2img_model}"
    headers = {"Authorization": f"Bearer {settings.hf_token}"}

    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post(
            url,
            headers=headers,
            files={"image": ("photo.jpg", image_bytes, "image/jpeg")},
            data={"prompt": STYLE_PROMPTS[style]},
        )

    if response.status_code == 503:
        raise StyleServiceError(
            "El modelo gratuito está cargando en los servidores de Hugging Face "
            "(pasa la primera vez que se usa). Probá de nuevo en unos 20-30 segundos."
        )
    if response.status_code != 200:
        raise StyleServiceError(
            f"Hugging Face devolvió un error ({response.status_code}): {response.text[:300]}"
        )

    return response.content, False
