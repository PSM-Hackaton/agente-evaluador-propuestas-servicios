"""La tasa BCV manual del comité solo vale el día local en que se fija (#15)."""

from datetime import UTC, datetime

from app.services.finance.bcv import manual_override_is_current


def test_override_vale_el_mismo_dia_local():
    fijada = datetime(2026, 11, 27, 13, 0, tzinfo=UTC)  # 09:00 en Caracas
    assert manual_override_is_current(fijada, now=datetime(2026, 11, 28, 3, 59, tzinfo=UTC))  # 23:59 del 27


def test_override_caduca_al_dia_siguiente_local():
    fijada = datetime(2026, 11, 27, 13, 0, tzinfo=UTC)
    assert not manual_override_is_current(fijada, now=datetime(2026, 11, 28, 4, 1, tzinfo=UTC))  # 00:01 del 28


def test_override_sin_zona_horaria_se_trata_como_utc():
    fijada = datetime(2026, 11, 27, 13, 0)
    assert manual_override_is_current(fijada, now=datetime(2026, 11, 27, 20, 0, tzinfo=UTC))
