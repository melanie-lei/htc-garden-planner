"""Web server for the farm planner.

Serves the grid editor frontend and exposes JSON APIs for:
  - Grid editing      (paint, fill, save, load, auto-assign)
  - Plant listing     (available plants with outdoor planting windows)
  - Planning          (run the time-aware planner)
  - Compatibility     (pairwise companion/antagonist scores)
  - Background image  (upload/retrieve for grid overlay)
  - .farm file I/O    (export/import ZIP archive)

Run:
    python3 web_server.py

Then open http://localhost:8000
"""

from __future__ import annotations

import base64
import io
import json
import os
import sys
import threading
import zipfile
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
    load_history_json,
)
from plantCompatibility import compatible_plants, incompatible_plants
from plantPlantTime import planting_data

_WEB_DIR = os.path.join(_PROJECT_ROOT, "web")
_DATA_DIR = os.path.join(_PROJECT_ROOT, "data")
_FIGMA_DIR = os.path.join(_PROJECT_ROOT, "figmaFiles")
_DEFAULT_GRID_PATH = os.path.join(_DATA_DIR, "test_farm.csv")
_HISTORY_PATH = os.path.join(_DATA_DIR, "history.json")

# Shared planner infrastructure (read-only after init)
COMPAT_INDEX = PlantCompatibilityIndex(compatible_plants, incompatible_plants)

AVAILABLE_PLANTS: list[str] = sorted(
    name
    for name, data in planting_data.items()
    if data.get("transplant") or data.get("direct_sow")
)

# Background image storage (guarded by _bg_lock)
_bg_lock = threading.Lock()
_bg_data: bytes | None = None
_bg_filename: str = "background.png"

_MIME_FOR_EXT: dict[str, str] = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
}


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

    def set_grid(self, grid: FarmGrid) -> None:
        with self._lock:
            self._grid = grid

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
        if not cells:
            return {"ok": True}
        chunk_size = 2000
        for i in range(0, len(cells), chunk_size):
            with self._lock:
                g = self._grid
                for cell in cells[i:i + chunk_size]:
                    r, c = int(cell.get("row", -1)), int(cell.get("col", -1))
                    if not (0 <= r < g.height and 0 <= c < g.width):
                        continue
                    v = cell.get("value", default)
                    if v is None:
                        continue
                    g.cells[r][c] = _coerce(v)
        return {"ok": True}

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

    def auto_assign(self) -> dict:
        """Assign unassigned farm cells to the nearest existing plot.

        Uses multi-source BFS from all existing plot cells, then
        Manhattan-distance fallback for any disconnected islands.
        If no plots exist at all, creates plot 1 for all unassigned cells.
        """
        with self._lock:
            g = self._grid

            # Phase 1: BFS from every existing plot cell
            queue: deque[tuple[int, int, int]] = deque()
            for r in range(g.height):
                for c in range(g.width):
                    v = g.cells[r][c]
                    if 1 <= v <= 254:
                        queue.append((r, c, v))

            while queue:
                r, c, pid = queue.popleft()
                for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                    nr, nc = r + dr, c + dc
                    if 0 <= nr < g.height and 0 <= nc < g.width:
                        if g.cells[nr][nc] == 0:
                            g.cells[nr][nc] = pid
                            queue.append((nr, nc, pid))

            # Phase 2: handle disconnected islands via Manhattan distance
            plot_cells: list[tuple[int, int, int]] = []
            unassigned: list[tuple[int, int]] = []
            for r in range(g.height):
                for c in range(g.width):
                    v = g.cells[r][c]
                    if 1 <= v <= 254:
                        plot_cells.append((r, c, v))
                    elif v == 0:
                        unassigned.append((r, c))

            if unassigned and plot_cells:
                for ur, uc in unassigned:
                    best_dist = float("inf")
                    best_pid = 1
                    for pr, pc, pid in plot_cells:
                        d = abs(ur - pr) + abs(uc - pc)
                        if d < best_dist:
                            best_dist = d
                            best_pid = pid
                    g.cells[ur][uc] = best_pid
            elif unassigned and not plot_cells:
                for ur, uc in unassigned:
                    g.cells[ur][uc] = 1

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


def _normalize_cells(cells) -> list[list[int]] | None:
    if not isinstance(cells, list) or not cells:
        return None
    rows = []
    for row in cells:
        if not isinstance(row, list):
            return None
        rows.append([_coerce(v) for v in row])
    width = len(rows[0]) if rows else 0
    if width == 0:
        return None
    normalized = []
    for row in rows:
        if len(row) < width:
            row = row + [FarmGrid.UNASSIGNED] * (width - len(row))
        elif len(row) > width:
            row = row[:width]
        normalized.append(row)
    return normalized


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

    scores = []
    for pa in plants:
        row = []
        for pb in plants:
            row.append(0 if pa == pb else COMPAT_INDEX.check_compatibility(pa, pb))
        scores.append(row)
    plan["compatibility_matrix"] = {"plants": plants, "scores": scores}

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
# Background image helpers
# -------------------------------------------------------------------

def set_background(data_url: str | None, filename: str | None) -> None:
    """Store or clear the background image from a data-URL string."""
    global _bg_data, _bg_filename
    with _bg_lock:
        if not data_url:
            _bg_data = None
            _bg_filename = "background.png"
            return
        # Parse "data:image/png;base64,iVBOR..."
        _, b64 = data_url.split(",", 1)
        _bg_data = base64.b64decode(b64)
        _bg_filename = filename or "background.png"


def get_background_data_url() -> str | None:
    """Return the stored background as a data-URL, or None."""
    with _bg_lock:
        if _bg_data is None:
            return None
        ext = os.path.splitext(_bg_filename)[1].lower()
        ct = _MIME_FOR_EXT.get(ext, "image/png")
        return f"data:{ct};base64," + base64.b64encode(_bg_data).decode()


# -------------------------------------------------------------------
# .farm file helpers  (ZIP containing grid.csv, metadata.json, image)
# -------------------------------------------------------------------

def export_farm(metadata: dict, grid: dict | None = None) -> bytes:
    """Create a .farm ZIP archive in memory and return the raw bytes."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        # 1. grid.csv
        cells = None
        if isinstance(grid, dict):
            cells = _normalize_cells(grid.get("cells"))
        if cells is None:
            state = GRID_STATE.get_state()
            cells = state["cells"]
        csv_lines = []
        for row in cells:
            csv_lines.append(",".join(str(v) for v in row))
        zf.writestr("grid.csv", "\n".join(csv_lines) + "\n")

        # 2. metadata.json
        zf.writestr("metadata.json", json.dumps(metadata, indent=2))

        # 3. background image (if present)
        with _bg_lock:
            if _bg_data is not None:
                zf.writestr(_bg_filename, _bg_data)

    return buf.getvalue()


def import_farm(farm_bytes: bytes) -> dict:
    """Extract a .farm ZIP, restore grid + background, return full state."""
    global _bg_data, _bg_filename

    buf = io.BytesIO(farm_bytes)
    result: dict = {}

    with zipfile.ZipFile(buf, "r") as zf:
        names = zf.namelist()

        # 1. grid
        if "grid.csv" in names:
            csv_text = zf.read("grid.csv").decode()
            rows = []
            for line in csv_text.strip().split("\n"):
                if line.strip():
                    rows.append([int(v) for v in line.split(",")])
            grid = FarmGrid.from_matrix(rows)
            GRID_STATE.set_grid(grid)
        result["grid"] = GRID_STATE.get_state()

        # 2. metadata
        metadata = {}
        if "metadata.json" in names:
            metadata = json.loads(zf.read("metadata.json").decode())
        result["metadata"] = metadata

        # 3. background image
        bg_url = None
        with _bg_lock:
            _bg_data = None
            _bg_filename = "background.png"
            for name in names:
                if name.startswith("background"):
                    img_bytes = zf.read(name)
                    ext = os.path.splitext(name)[1].lower()
                    ct = _MIME_FOR_EXT.get(ext, "image/png")
                    _bg_data = img_bytes
                    _bg_filename = name
                    bg_url = f"data:{ct};base64," + base64.b64encode(img_bytes).decode()
                    break
        result["background"] = bg_url

    return result


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
        if path == "/api/background":
            return self._json({"image": get_background_data_url()})
        if path == "/api/history":
            plans = load_history_json(_HISTORY_PATH)
            return self._json({"plans": plans})
        # Serve figmaFiles/ as /figmaFiles/
        if path.startswith("/figmaFiles/"):
            rel = path[len("/figmaFiles/"):]
            file_path = os.path.join(_FIGMA_DIR, rel)
            if os.path.isfile(file_path) and file_path.endswith(".svg"):
                with open(file_path, "rb") as f:
                    data = f.read()
                self.send_response(200)
                self.send_header("Content-Type", "image/svg+xml")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return
        return super().do_GET()

    # ---- POST ----

    def do_POST(self):
        path = urlparse(self.path).path
        if not path.startswith("/api/"):
            return self.send_error(404)
        try:
            body = self._body()

            # Export returns binary, not JSON
            if path == "/api/export":
                data = export_farm(body.get("metadata", {}), body.get("grid"))
                return self._binary(data, "application/zip", "farm.farm")

            result = self._route(path, body)
            self._json(result)
        except FileNotFoundError as e:
            print(f"[error] {path}: {e}", file=sys.stderr)
            self._json({"error": str(e)}, 404)
        except Exception as e:
            print(f"[error] {path}: {e}", file=sys.stderr)
            self._json({"error": str(e)}, 400)

    def _route(self, path: str, body: dict) -> dict:
        if path == "/api/grid":
            return GRID_STATE.new_grid(
                body.get("width", 10), body.get("height", 10),
                body.get("fill", FarmGrid.INVALID))
        if path == "/api/paint":
            GRID_STATE.paint_cells(body.get("cells", []),
                                   body.get("value"))
            return {"ok": True}
        if path == "/api/fill":
            return GRID_STATE.fill_region(
                int(body.get("row", -1)), int(body.get("col", -1)),
                body.get("value"))
        if path == "/api/auto-assign":
            return GRID_STATE.auto_assign()
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
        if path == "/api/background":
            set_background(body.get("image"), body.get("filename"))
            return {"ok": True}
        if path == "/api/import":
            farm_data = base64.b64decode(body.get("data", ""))
            return import_farm(farm_data)
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

    def _binary(self, data: bytes, content_type: str, filename: str):
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Disposition",
                         f'attachment; filename="{filename}"')
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

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
