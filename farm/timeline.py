"""Time-aware plot occupancy tracking.

Each plot has a timeline of non-overlapping planting entries.  The farm
timeline aggregates all plots and supports snapshot queries ("what is
growing everywhere on date X?") which power the scrub-through-the-year
view.
"""

from datetime import date, timedelta

# Minimum gap between successive crops in the same plot (days).
# Covers clearing debris, light soil prep, etc.
CROP_BUFFER_DAYS = 7


class PlotTimeline:
    """Tracks what occupies a single plot across the year.

    Entries are kept sorted by start date and must never overlap.
    """

    def __init__(self, plot_id: int):
        self.plot_id = plot_id
        self.entries: list[dict] = []  # {plant, start, end, method}

    def add(self, plant: str, start: date, end: date, method: str = "direct_sow"):
        """Record a planting.  Entries are kept sorted by start date."""
        self.entries.append(
            {"plant": plant, "start": start, "end": end, "method": method}
        )
        self.entries.sort(key=lambda e: e["start"])

    def earliest_free_after(self, target: date) -> date:
        """First date >= *target* when the plot is unoccupied.

        Accounts for the between-crop buffer.
        """
        result = target
        for e in self.entries:
            buffer_end = e["end"] + timedelta(days=CROP_BUFFER_DAYS)
            if e["start"] <= result < buffer_end:
                result = buffer_end
        return result

    def is_free_during(self, start: date, end: date) -> bool:
        """True if no existing entry overlaps [start, end)."""
        for e in self.entries:
            if e["start"] < end and e["end"] > start:
                return False
        return True

    def plant_at(self, d: date) -> str | None:
        """Return the plant name occupying this plot on *d*, or None."""
        for e in self.entries:
            if e["start"] <= d < e["end"]:
                return e["plant"]
        return None

    def overlapping_entries(self, start: date, end: date) -> list[dict]:
        """All entries whose occupation overlaps [start, end)."""
        return [e for e in self.entries if e["start"] < end and e["end"] > start]


class FarmTimeline:
    """Aggregates per-plot timelines for the entire farm.

    Args:
        farm_grid: A ``FarmGrid`` whose plot IDs define the timelines.
    """

    def __init__(self, farm_grid):
        self.grid = farm_grid
        self.timelines: dict[int, PlotTimeline] = {
            pid: PlotTimeline(pid) for pid in farm_grid.get_plot_ids()
        }

    def add(self, plot_id: int, plant: str, start: date, end: date,
            method: str = "direct_sow"):
        self.timelines[plot_id].add(plant, start, end, method)

    # ---- queries ----

    def snapshot(self, d: date) -> dict[int, str | None]:
        """Map of plot_id -> plant name (or None) for a single date."""
        return {pid: tl.plant_at(d) for pid, tl in self.timelines.items()}

    def adjacent_plants_during(self, plot_id: int, start: date,
                               end: date) -> list[str]:
        """Distinct plants in adjacent plots whose time overlaps [start, end)."""
        plants: list[str] = []
        for adj_id in self.grid.get_adjacent_plots(plot_id):
            for e in self.timelines[adj_id].overlapping_entries(start, end):
                plants.append(e["plant"])
        return plants

    # ---- serialisation ----

    def to_dict(self) -> dict[str, list[dict]]:
        """Serialise to a JSON-friendly dict keyed by plot ID strings."""
        return {
            str(pid): [
                {
                    "plant": e["plant"],
                    "start": e["start"].isoformat(),
                    "end": e["end"].isoformat(),
                    "method": e["method"],
                }
                for e in tl.entries
            ]
            for pid, tl in self.timelines.items()
        }
