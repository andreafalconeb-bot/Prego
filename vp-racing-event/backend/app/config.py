from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./vp_racing_event.db"

    # Hugging Face free-tier Inference API. Sin token, el fotobooth de
    # estilos IA responde en modo demo (devuelve la foto original) para que
    # el resto del flujo se pueda probar sin costo y sin necesidad de darse
    # de alta en nada.
    hf_token: str | None = None
    hf_img2img_model: str = "timbrooks/instruct-pix2pix"


settings = Settings()
