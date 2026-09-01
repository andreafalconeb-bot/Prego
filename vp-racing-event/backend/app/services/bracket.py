"""Lógica de bracket de eliminación simple, por tiempo (gana el más rápido).

Pensado para 12 participantes, pero funciona para cualquier cantidad: se
completa hasta la siguiente potencia de 2 con "byes" (pases directos a la
siguiente ronda) para que el resto del bracket quede parejo.

Las funciones acá son puras (no tocan la base de datos) para poder
testearlas fácil; `tournament_service.py` las usa para persistir en SQLAlchemy.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field


@dataclass
class MatchPlan:
    round_number: int  # 1 = primera ronda
    match_index: int  # posición dentro de la ronda, empieza en 0
    participant1: str | None
    participant2: str | None
    is_bye: bool = False
    winner: str | None = None  # solo se completa automáticamente si es bye


@dataclass
class BracketPlan:
    rounds: list[list[MatchPlan]] = field(default_factory=list)


def _next_power_of_two(n: int) -> int:
    if n < 1:
        raise ValueError("Se necesita al menos 1 participante")
    return 1 << math.ceil(math.log2(n))


def build_bracket(participant_names: list[str], shuffle: bool = True) -> BracketPlan:
    """Arma el bracket completo (todas las rondas) para una lista de nombres.

    - Si la cantidad no es potencia de 2, se agregan byes hasta completar.
    - Los byes se reparten al azar entre los participantes (evento casual,
      sin seeding por ranking).
    - Ronda 1 puede tener matches reales y byes mezclados; de la ronda 2 en
      adelante todos los matches son reales porque ya se resolvieron los byes.
    """
    if len(participant_names) < 2:
        raise ValueError("Se necesitan al menos 2 participantes")
    if len(set(participant_names)) != len(participant_names):
        raise ValueError("Los nombres de los participantes deben ser únicos")

    real = list(participant_names)
    if shuffle:
        random.shuffle(real)

    bracket_size = _next_power_of_two(len(real))
    matches_count = bracket_size // 2
    byes_needed = bracket_size - len(real)
    # Por construcción (bracket_size es la MENOR potencia de 2 >= n) siempre
    # se cumple byes_needed < matches_count, así que nunca faltan
    # participantes reales para armar todos los matches (bye + reales) y dos
    # byes jamás quedan emparejados entre sí.

    plan = BracketPlan()
    round1: list[MatchPlan] = []
    cursor = 0
    for i in range(byes_needed):
        winner = real[cursor]
        cursor += 1
        round1.append(
            MatchPlan(round_number=1, match_index=i, participant1=winner, participant2=None, is_bye=True, winner=winner)
        )
    for i in range(byes_needed, matches_count):
        p1, p2 = real[cursor], real[cursor + 1]
        cursor += 2
        round1.append(MatchPlan(round_number=1, match_index=i, participant1=p1, participant2=p2))

    if shuffle:
        random.shuffle(round1)
        for i, match in enumerate(round1):
            match.match_index = i

    plan.rounds.append(round1)

    # Rondas siguientes: placeholders vacíos, se completan a medida que se
    # cargan resultados (o automáticamente para los ganadores de bye).
    matches_in_round = bracket_size // 2
    round_number = 2
    while matches_in_round > 1:
        matches_in_round //= 2
        next_round = [
            MatchPlan(round_number=round_number, match_index=i, participant1=None, participant2=None)
            for i in range(matches_in_round)
        ]
        plan.rounds.append(next_round)
        round_number += 1

    _propagate_byes(plan)
    return plan


def _propagate_byes(plan: BracketPlan) -> None:
    """Empuja los ganadores de los byes de ronda 1 hacia la ronda 2.

    Nota: por cómo se calculan los byes (siempre menos de la mitad de los
    slots del bracket), nunca puede pasar que un match de ronda 2 en
    adelante quede resuelto automáticamente por dos byes seguidos — como
    mucho junta a dos ganadores de bye, que entonces sí juegan un match real
    entre ellos. Por eso una sola pasada de propagación alcanza.
    """
    for round_idx in range(len(plan.rounds) - 1):
        current_round = plan.rounds[round_idx]
        next_round = plan.rounds[round_idx + 1]
        for match in current_round:
            if match.winner is None:
                continue
            next_match = next_round[match.match_index // 2]
            if match.match_index % 2 == 0:
                next_match.participant1 = match.winner
            else:
                next_match.participant2 = match.winner
