import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class Tournament(Base):
    __tablename__ = "tournaments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String, default="Torneo VP Racing")
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=datetime.datetime.utcnow
    )

    participants: Mapped[list["Participant"]] = relationship(
        back_populates="tournament", cascade="all, delete-orphan"
    )
    matches: Mapped[list["Match"]] = relationship(
        back_populates="tournament",
        cascade="all, delete-orphan",
        foreign_keys="Match.tournament_id",
    )


class Participant(Base):
    __tablename__ = "participants"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tournament_id: Mapped[int] = mapped_column(ForeignKey("tournaments.id"))
    name: Mapped[str] = mapped_column(String)

    tournament: Mapped["Tournament"] = relationship(back_populates="participants")


class Match(Base):
    __tablename__ = "matches"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tournament_id: Mapped[int] = mapped_column(ForeignKey("tournaments.id"))
    round_number: Mapped[int] = mapped_column(Integer)
    match_index: Mapped[int] = mapped_column(Integer)  # posición dentro de la ronda

    participant1_id: Mapped[int | None] = mapped_column(
        ForeignKey("participants.id"), nullable=True
    )
    participant2_id: Mapped[int | None] = mapped_column(
        ForeignKey("participants.id"), nullable=True
    )
    time1_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    time2_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    winner_id: Mapped[int | None] = mapped_column(
        ForeignKey("participants.id"), nullable=True
    )
    is_bye: Mapped[bool] = mapped_column(Boolean, default=False)

    next_match_id: Mapped[int | None] = mapped_column(ForeignKey("matches.id"), nullable=True)
    next_match_slot: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 1 o 2

    tournament: Mapped["Tournament"] = relationship(
        back_populates="matches", foreign_keys=[tournament_id]
    )
    participant1: Mapped["Participant | None"] = relationship(foreign_keys=[participant1_id])
    participant2: Mapped["Participant | None"] = relationship(foreign_keys=[participant2_id])
    winner: Mapped["Participant | None"] = relationship(foreign_keys=[winner_id])
