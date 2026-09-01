from pydantic import BaseModel, Field, field_validator


class CreateTournamentRequest(BaseModel):
    name: str = "Torneo VP Racing"
    participant_names: list[str] = Field(min_length=2)

    @field_validator("participant_names")
    @classmethod
    def strip_and_check(cls, value: list[str]) -> list[str]:
        cleaned = [name.strip() for name in value]
        if any(not name for name in cleaned):
            raise ValueError("Ningún nombre de participante puede estar vacío")
        return cleaned


class ParticipantOut(BaseModel):
    id: int
    name: str

    class Config:
        from_attributes = True


class MatchOut(BaseModel):
    id: int
    round_number: int
    match_index: int
    participant1: ParticipantOut | None
    participant2: ParticipantOut | None
    time1_seconds: float | None
    time2_seconds: float | None
    winner: ParticipantOut | None
    is_bye: bool

    class Config:
        from_attributes = True


class TournamentOut(BaseModel):
    id: int
    name: str
    participants: list[ParticipantOut]
    matches: list[MatchOut]

    class Config:
        from_attributes = True


class RecordResultRequest(BaseModel):
    time1_seconds: float
    time2_seconds: float
