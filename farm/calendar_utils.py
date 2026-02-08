"""Utilities for converting the month-float notation in plantPlantTime.py
to real calendar dates.

The planting data uses floats to encode months:
    1.0  → January 1
    1.5  → January 15   (mid-month)
    5.5  → May 15
    13.0 → December 31  (special overflow for garlic, etc.)

Planting windows come as flat lists of pairs:
    [start1, end1]                  — one window
    [start1, end1, start2, end2]    — two windows (e.g. spring + fall)
"""

import calendar
from datetime import date


def month_float_to_date(month_float: float, year: int) -> date:
    """Convert a month float to a ``datetime.date``.

    Examples:
        >>> month_float_to_date(5.5, 2026)
        datetime.date(2026, 5, 15)
        >>> month_float_to_date(13.0, 2026)
        datetime.date(2026, 12, 31)
    """
    if month_float >= 13.0:
        return date(year, 12, 31)

    month = max(1, min(12, int(month_float)))
    fraction = month_float - int(month_float)
    days_in_month = calendar.monthrange(year, month)[1]

    if fraction == 0:
        day = 1
    elif fraction <= 0.25:
        day = 8
    elif fraction <= 0.5:
        day = 15
    else:
        day = min(int(1 + fraction * days_in_month), days_in_month)

    return date(year, month, day)


def parse_planting_windows(date_list: list[float], method: str, year: int):
    """Turn a flat list of month-float pairs into structured windows.

    Args:
        date_list: e.g. ``[5.5, 6.5]`` or ``[2.0, 4.5, 9.0, 11.0]``
        method:    ``"start"`` | ``"transplant"`` | ``"direct_sow"``
        year:      Calendar year for date conversion.

    Returns:
        List of dicts ``{"method", "start", "end"}`` where start/end are
        ``datetime.date`` objects.
    """
    windows = []
    for i in range(0, len(date_list) - 1, 2):
        windows.append(
            {
                "method": method,
                "start": month_float_to_date(date_list[i], year),
                "end": month_float_to_date(date_list[i + 1], year),
            }
        )
    return windows


def get_all_planting_windows(plant_name: str, planting_data: dict, year: int):
    """Collect every planting window for *plant_name* across all methods.

    Returns a list of window dicts sorted by start date, or an empty list
    if the plant is not found in *planting_data*.
    """
    entry = planting_data.get(plant_name)
    if entry is None:
        return []

    windows = []
    for method in ("start", "transplant", "direct_sow"):
        dates = entry.get(method, [])
        if dates:
            windows.extend(parse_planting_windows(dates, method, year))

    windows.sort(key=lambda w: w["start"])
    return windows


def get_best_planting_method(plant_name: str, planting_data: dict, year: int):
    """Pick the single best planting window for a plant.

    Priority order:
        1. transplant — implies starting indoors then moving outside
        2. direct_sow — simplest outdoor method
        3. start      — indoor-only (less ideal without a transplant step)

    Returns a window dict or ``None`` if no data is available.
    """
    entry = planting_data.get(plant_name)
    if entry is None:
        return None

    for method in ("transplant", "direct_sow", "start"):
        dates = entry.get(method, [])
        if dates:
            windows = parse_planting_windows(dates, method, year)
            if windows:
                return windows[0]  # earliest window

    return None
