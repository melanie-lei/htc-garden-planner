"""Web server for the farm planner.

Serves the grid editor frontend and exposes JSON APIs for:
  - Grid editing   (paint, fill, save, load)
  - Plant listing  (available plants with outdoor planting windows)
  - Planning       (run the time-aware planner)
  - Compatibility  (pairwise companion/antagonist scores)

Run:
    python3 web_server.py

Then open http://localhost:8000
"""

from __future__ import annotations

import json
import os
import sys
import threading
from collections import deque
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

_PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _PROJECT_ROOT)

from farm import (
    FarmGrid,
    FarmPlanner,
    PlantCompatibilityIndex,
    growth_durations,
    load_grid_csv,
    save_grid_csv,
    save_plan_json,
)
from plantCompatibility import compatible_plants, incompatible_plants
from plantPlantTime import planting_data

_WEB_DIR = os.path.join(_PROJECT_ROOT, "web")
_DATA_DIR = os.path.join(_PROJECT_ROOT, "data")
_DEFAULT_GRID_PATH = os.path.join(_DATA_DIR, "test_farm.csv")

# Shared planner infrastructure (read-only after init)
COMPAT_INDEX = PlantCompatibilityIndex(compatible_plants, incompatible_plants)

AVAILABLE_PLANTS: list[str] = sorted(
    name
    for name, data in planting_data.items()
    if data.get("transplant") or data.get("direct_sow")
)


# -------------------------------------------------------------------
# Grid state  (thread-safe, mutable)
# -------------------------------------------------------------------

class GridState:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._grid: FarmGrid | None = None
        os.makedirs(_DATA_DIR, exist_ok=True)
        self._load_or_init()

    def _load_or_init(self) -> None:
        if os.path.exists(_DEFAULT_GRID_PATH):
            self._grid = load_grid_csv(_DEFAULT_GRID_PATH)
        else:
            self._grid = FarmGrid(width=10, height=10)

    def get_state(self) -> dict:
        with self._lock:
            g = self._grid
            return {"width": g.width, "height": g.height,
                    "cells": [row[:] for row in g.cells]}

    def get_grid(self) -> FarmGrid:
        with self._lock:
            return FarmGrid.from_matrix(self._grid.cells)

    def new_grid(self, width: int, height: int, fill: int) -> dict:
        width, height = max(1, int(width)), max(1, int(height))
        fill = _coerce(fill)
        g = FarmGrid(width=width, height=height)
        if fill != FarmGrid.INVALID:
            for r in range(height):
                for c in range(width):
                    g.cells[r][c] = fill
        with self._lock:
            self._grid = g
        return self.get_state()

    def paint_cells(self, cells: list[dict], value: int | None) -> dict:
        default = None if value is None else _coerce(value)
        with self._lock:
            g = self._grid
            for cell in cells:
                r, c = int(cell.get("row", -1)), int(cell.get("col", -1))
                if not (0 <= r < g.height and 0 <= c < g.width):
                    continue
                v = cell.get("value", default)
                if v is None:
                    continue
                g.cells[r][c] = _coerce(v)
        return self.get_state()

    def fill_region(self, row: int, col: int, value: int) -> dict:
        value = _coerce(value)
        with self._lock:
            g = self._grid
            if not (0 <= row < g.height and 0 <= col < g.width):
                return self.get_state()
            target = g.cells[row][col]
            if target == value:
                return self.get_state()
            q: deque[tuple[int, int]] = deque([(row, col)])
            g.cells[row][col] = value
            while q:
                r, c = q.popleft()
                for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                    nr, nc = r + dr, c + dc
                    if 0 <= nr < g.height and 0 <= nc < g.width:
                        if g.cells[nr][nc] == target:
                            g.cells[nr][nc] = value
                            q.append((nr, nc))
        return self.get_state()

    def save_csv(self, filename: str | None) -> dict:
        path = _resolve_path(filename)
        with self._lock:
            save_grid_csv(self._grid, path)
        return {"saved_to": os.path.relpath(path, _PROJECT_ROOT)}

    def load_csv(self, filename: str | None) -> dict:
        path = _resolve_path(filename)
        if not os.path.exists(path):
            raise FileNotFoundError(f"File not found: {path}")
        g = load_grid_csv(path)
        with self._lock:
            self._grid = g
        return self.get_state()


def _coerce(value: int) -> int:
    try:
        value = int(value)
    except (TypeError, ValueError):
        return FarmGrid.UNASSIGNED
    return max(0, min(255, value))


def _resolve_path(filename: str | None) -> str:
    if not filename:
        return _DEFAULT_GRID_PATH
    filename = os.path.basename(filename)
    if not filename.endswith(".csv"):
        filename += ".csv"
    return os.path.join(_DATA_DIR, filename)


GRID_STATE = GridState()


# -------------------------------------------------------------------
# Planner helpers
# -------------------------------------------------------------------

def run_plan(grid: FarmGrid, plants: list[str], year: int,
             start_month: int) -> dict:
    """Run the planner and return the plan dict with an added compat matrix."""
    planner = FarmPlanner(grid, COMPAT_INDEX, planting_data, growth_durations)
    plan = planner.plan_year(plants, year, start_month)

    # Append NxN compatibility matrix for the selected plants
    scores = []
    for pa in plants:
        row = []
        for pb in plants:
            row.append(0 if pa == pb else COMPAT_INDEX.check_compatibility(pa, pb))
        scores.append(row)
    plan["compatibility_matrix"] = {"plants": plants, "scores": scores}

    # Save to disk automatically
    plan_path = os.path.join(_DATA_DIR, f"plan_{year}.json")
    save_plan_json(plan, plan_path)

    return plan


def get_compatibility(plants: list[str]) -> dict:
    scores = []
    for pa in plants:
        row = []
        for pb in plants:
            row.append(0 if pa == pb else COMPAT_INDEX.check_compatibility(pa, pb))
        scores.append(row)
    return {"plants": plants, "scores": scores}


# -------------------------------------------------------------------
# HTTP handler
# -------------------------------------------------------------------

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=_WEB_DIR, **kwargs)

    # ---- GET ----

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/grid":
            return self._json(GRID_STATE.get_state())
        if path == "/api/plants":
            return self._json({"plants": AVAILABLE_PLANTS})
        return super().do_GET()

    # ---- POST ----

    def do_POST(self):
        path = urlparse(self.path).path
        if not path.startswith("/api/"):
            return self.send_error(404)
        try:
            body = self._body()
            result = self._route(path, body)
            self._json(result)
        except FileNotFoundError as e:
            self._json({"error": str(e)}, 404)
        except Exception as e:
            self._json({"error": str(e)}, 400)

    def _route(self, path: str, body: dict) -> dict:
        if path == "/api/grid":
            return GRID_STATE.new_grid(
                body.get("width", 10), body.get("height", 10),
                body.get("fill", FarmGrid.INVALID))
        if path == "/api/paint":
            return GRID_STATE.paint_cells(body.get("cells", []),
                                          body.get("value"))
        if path == "/api/fill":
            return GRID_STATE.fill_region(
                int(body.get("row", -1)), int(body.get("col", -1)),
                body.get("value"))
        if path == "/api/save":
            return GRID_STATE.save_csv(body.get("filename"))
        if path == "/api/load":
            return GRID_STATE.load_csv(body.get("filename"))
        if path == "/api/plan":
            grid = GRID_STATE.get_grid()
            return run_plan(
                grid,
                body.get("plants", []),
                int(body.get("year", 2026)),
                int(body.get("start_month", 1)))
        if path == "/api/compatibility":
            return get_compatibility(body.get("plants", []))
        raise ValueError(f"Unknown endpoint: {path}")

    # ---- helpers ----

    def _body(self) -> dict:
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        return json.loads(self.rfile.read(length).decode())

    def _json(self, payload: dict, status: int = 200):
        raw = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def log_message(self, fmt, *args):
        return  # silence per-request logs


# -------------------------------------------------------------------
# Entry point
# -------------------------------------------------------------------

def main() -> None:
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"Farm planner running on http://localhost:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
