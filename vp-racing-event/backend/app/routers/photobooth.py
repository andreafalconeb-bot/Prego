import base64

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

from ..services import style_service

router = APIRouter(prefix="/photobooth", tags=["photobooth"])


class TransformResponse(BaseModel):
    image_base64: str
    demo_mode: bool


@router.get("/styles")
def list_styles():
    return {"styles": list(style_service.STYLE_PROMPTS.keys())}


@router.post("/transform", response_model=TransformResponse)
async def transform(style: str, file: UploadFile = File(...)):
    image_bytes = await file.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="La imagen viene vacía")
    try:
        result_bytes, demo_mode = await style_service.transform(image_bytes, style)
    except style_service.StyleServiceError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return TransformResponse(
        image_base64=base64.b64encode(result_bytes).decode("ascii"), demo_mode=demo_mode
    )
