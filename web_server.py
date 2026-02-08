"""Minimal visual grid editor for the farm planner.

Run:
    python3 web_server.py

Then open http://localhost:8000
"""

from __future__ import annotations

import json
import os
import threading
from collections import deque
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

from farm import FarmGrid, load_grid_csv, save_grid_csv

_PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
_WEB_DIR = os.path.join(_PROJECT_ROOT, "web")
_DATA_DIR = os.path.join(_PROJECT_ROOT, "data")
_DEFAULT_GRID_PATH = os.path.join(_DATA_DIR, "test_farm.csv")


class GridState:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._grid: FarmGrid | None = None
        self._ensure_data_dir()
        self._load_or_init()

    @staticmethod
    def _ensure_data_dir() -> None:
        os.makedirs(_DATA_DIR, exist_ok=True)

    def _load_or_init(self) -> None:
        if os.path.exists(_DEFAULT_GRID_PATH):
            self._grid = load_grid_csv(_DEFAULT_GRID_PATH)
        else:
            self._grid = FarmGrid(width=10, height=10)

    def get_state(self) -> dict:
        with self._lock:
            grid = self._grid
            return {
                "width": grid.width,
                "height": grid.height,
                "cells": [row[:] for row in grid.cells],
            }

    def new_grid(self, width: int, height: int, fill: int) -> dict:
        width = max(1, int(width))
        height = max(1, int(height))
        fill = self._coerce_cell_value(fill)

        grid = FarmGrid(width=width, height=height)
        if fill != FarmGrid.INVALID:
            for r in range(height):
                for c in range(width):
                    grid.cells[r][c] = fill

        with self._lock:
            self._grid = grid
        return self.get_state()

    def paint_cells(self, cells: list[dict], value: int | None) -> dict:
        default_value = None if value is None else self._coerce_cell_value(value)
        with self._lock:
            grid = self._grid
            for cell in cells:
                r = int(cell.get("row", -1))
                c = int(cell.get("col", -1))
                if not (0 <= r < grid.height and 0 <= c < grid.width):
                    continue
                cell_value = cell.get("value", default_value)
                if cell_value is None:
                    continue
                grid.cells[r][c] = self._coerce_cell_value(cell_value)
        return self.get_state()

    def fill_region(self, row: int, col: int, value: int) -> dict:
        value = self._coerce_cell_value(value)
        with self._lock:
            grid = self._grid
            if not (0 <= row < grid.height and 0 <= col < grid.width):
                return self.get_state()

            target = grid.cells[row][col]
            if target == value:
                return self.get_state()

            q: deque[tuple[int, int]] = deque()
            q.append((row, col))
            grid.cells[row][col] = value

            while q:
                r, c = q.popleft()
                for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                    nr, nc = r + dr, c + dc
                    if 0 <= nr < grid.height and 0 <= nc < grid.width:
                        if grid.cells[nr][nc] == target:
                            grid.cells[nr][nc] = value
                            q.append((nr, nc))
        return self.get_state()

    def save_csv(self, filename: str | None) -> dict:
        path = self._resolve_data_path(filename)
        with self._lock:
            save_grid_csv(self._grid, path)
        return {"saved_to": os.path.relpath(path, _PROJECT_ROOT)}

    def load_csv(self, filename: str | None) -> dict:
        path = self._resolve_data_path(filename)
        if not os.path.exists(path):
            raise FileNotFoundError(f"File not found: {path}")
        grid = load_grid_csv(path)
        with self._lock:
            self._grid = grid
        return self.get_state()

    @staticmethod
    def _coerce_cell_value(value: int) -> int:
        try:
            value = int(value)
        except (TypeError, ValueError):
            return FarmGrid.UNASSIGNED
        return max(0, min(255, value))

    @staticmethod
    def _resolve_data_path(filename: str | None) -> str:
        if not filename:
            return _DEFAULT_GRID_PATH
        filename = os.path.basename(filename)
        if not filename.endswith(".csv"):
            filename += ".csv"
        return os.path.join(_DATA_DIR, filename)


GRID_STATE = GridState()


class GridHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=_WEB_DIR, **kwargs)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/grid":
            self._send_json(GRID_STATE.get_state())
            return
        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            try:
                payload = self._read_json()
                response = self._handle_api(parsed.path, payload)
                self._send_json(response)
            except FileNotFoundError as exc:
                self._send_json({"error": str(exc)}, status=404)
            except Exception as exc:  # pragma: no cover - general handler
                self._send_json({"error": str(exc)}, status=400)
            return
        self.send_error(404, "Not Found")

    def _handle_api(self, path: str, payload: dict) -> dict:
        if path == "/api/grid":
            return GRID_STATE.new_grid(
                payload.get("width", 10),
                payload.get("height", 10),
                payload.get("fill", FarmGrid.INVALID),
            )
        if path == "/api/paint":
            return GRID_STATE.paint_cells(payload.get("cells", []), payload.get("value"))
        if path == "/api/fill":
            return GRID_STATE.fill_region(
                int(payload.get("row", -1)),
                int(payload.get("col", -1)),
                payload.get("value"),
            )
        if path == "/api/save":
            return GRID_STATE.save_csv(payload.get("filename"))
        if path == "/api/load":
            return GRID_STATE.load_csv(payload.get("filename"))
        raise ValueError(f"Unknown endpoint: {path}")

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def _send_json(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        return


def main() -> None:
    host = "0.0.0.0"
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer((host, port), GridHandler)
    print(f"Grid editor running on http://localhost:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
