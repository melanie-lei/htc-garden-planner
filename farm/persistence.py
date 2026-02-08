"""Save and load farm grids and planting plans.

Grid format (CSV):
    Plain matrix — one row per line, comma-separated integer values.
    This is deliberately simple so it can be opened in any spreadsheet tool.

Plan format (JSON):
    Structured dict containing year, assignments, schedule, and metadata.
    Supports storing multiple years of history in a single file.
"""

import csv
import json
import os

from .grid import FarmGrid


# ---------------------------------------------------------------------------
# Grid persistence (CSV)
# ---------------------------------------------------------------------------

def save_grid_csv(grid: FarmGrid, filepath: str):
    """Write a FarmGrid to a CSV file (one row per line)."""
    os.makedirs(os.path.dirname(filepath) or ".", exist_ok=True)
    with open(filepath, "w", newline="") as f:
        writer = csv.writer(f)
        for row in grid.cells:
            writer.writerow(row)


def load_grid_csv(filepath: str) -> FarmGrid:
    """Read a FarmGrid from a CSV file produced by *save_grid_csv*."""
    with open(filepath, "r") as f:
        reader = csv.reader(f)
        matrix = [[int(v) for v in row] for row in reader]
    return FarmGrid.from_matrix(matrix)


# ---------------------------------------------------------------------------
# Plan persistence (JSON)
# ---------------------------------------------------------------------------

def save_plan_json(plan: dict, filepath: str):
    """Write a planting plan dict to a JSON file.

    Uses *default=str* so datetime objects serialise cleanly.
    """
    os.makedirs(os.path.dirname(filepath) or ".", exist_ok=True)
    with open(filepath, "w") as f:
        json.dump(plan, f, indent=2, default=str)


def load_plan_json(filepath: str) -> dict:
    """Read a planting plan dict from a JSON file."""
    with open(filepath, "r") as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# History helpers
# ---------------------------------------------------------------------------

def save_history_json(plans: list[dict], filepath: str):
    """Persist a list of yearly plans (max 4 years kept)."""
    # Keep only the most recent 4 years
    plans = sorted(plans, key=lambda p: p.get("year", 0))[-4:]
    os.makedirs(os.path.dirname(filepath) or ".", exist_ok=True)
    with open(filepath, "w") as f:
        json.dump({"plans": plans}, f, indent=2, default=str)


def load_history_json(filepath: str) -> list[dict]:
    """Load yearly plan history.  Returns an empty list if the file is missing."""
    if not os.path.exists(filepath):
        return []
    with open(filepath, "r") as f:
        data = json.load(f)
    return data.get("plans", [])
