"""Farm planting planner — time-aware scheduling with succession planting.

Given a ranked list of plants the user wants to grow, the planner:

1.  Assigns each plant to a (plot, time-window) slot so that every
    selected plant gets grown if physically possible.
2.  Respects planting-window data (transplant / direct-sow only —
    greenhouse starts are ignored since they don't occupy plot space).
3.  Allows succession planting: short-season crops free their plot
    for a follow-up crop later in the year.
4.  Scores adjacent-plot compatibility using the companion / antagonist
    data, only penalising or rewarding plants that are *simultaneously*
    in the ground.
5.  Uses a most-constrained-first strategy so that plants with the
    fewest placement options get assigned first (maximising coverage).
    User priority (list order) breaks ties.

The compatibility scoring uses a normalised name index so that minor
spelling differences between the two data files (e.g. "Tomato" vs
"Tomatoes") are handled transparently.
"""

from datetime import date, timedelta

from .calendar_utils import parse_planting_windows
from .timeline import FarmTimeline


# -----------------------------------------------------------------------
# Plant-name normalisation
# -----------------------------------------------------------------------

def normalize_plant_name(name: str) -> str:
    """Reduce a plant name to a canonical lowercase form.

    Handles the most common English plural patterns so that
    ``"Tomatoes"`` and ``"Tomato"`` both normalise to ``"tomato"``.
    """
    name = name.strip().lower()
    if name.endswith("ies") and len(name) > 4:
        return name[:-3] + "y"       # strawberries → strawberry
    if name.endswith("oes") and len(name) > 4:
        return name[:-2]             # tomatoes → tomato
    if (
        name.endswith("s")
        and not name.endswith("ss")
        and not name.endswith("us")
        and len(name) > 3
    ):
        return name[:-1]             # carrots → carrot
    return name


# -----------------------------------------------------------------------
# Compatibility index
# -----------------------------------------------------------------------

class PlantCompatibilityIndex:
    """Fast, normalisation-aware lookup for companion / antagonist data."""

    def __init__(self, compatible_plants: dict, incompatible_plants: dict):
        self._compatible = compatible_plants
        self._incompatible = incompatible_plants
        self._name_map = self._build_name_map()

    def _build_name_map(self) -> dict[str, str]:
        name_map: dict[str, str] = {}
        for name in set(self._compatible) | set(self._incompatible):
            name_map[normalize_plant_name(name)] = name
        return name_map

    def _resolve(self, name: str) -> str:
        return self._name_map.get(normalize_plant_name(name), name)

    @staticmethod
    def _contains(plant: str, plant_list: list[str]) -> bool:
        norm = normalize_plant_name(plant)
        return any(normalize_plant_name(p) == norm for p in plant_list)

    def check_compatibility(self, plant_a: str, plant_b: str) -> int:
        """Score how well two plants get along when planted adjacently.

        +2 mutual companions, +1 one-directional, 0 neutral,
        -3 one-directional antagonist, -6 mutual antagonists.
        """
        score = 0
        key_a = self._resolve(plant_a)
        key_b = self._resolve(plant_b)

        if key_a in self._compatible and self._contains(plant_b, self._compatible[key_a]):
            score += 1
        if key_b in self._compatible and self._contains(plant_a, self._compatible[key_b]):
            score += 1
        if key_a in self._incompatible and self._contains(plant_b, self._incompatible[key_a]):
            score -= 3
        if key_b in self._incompatible and self._contains(plant_a, self._incompatible[key_b]):
            score -= 3
        return score

    def get_compatible(self, plant: str) -> list[str]:
        return self._compatible.get(self._resolve(plant), [])

    def get_incompatible(self, plant: str) -> list[str]:
        return self._incompatible.get(self._resolve(plant), [])


# -----------------------------------------------------------------------
# Time-aware planner
# -----------------------------------------------------------------------

_DEFAULT_DURATION = 90


class FarmPlanner:
    """Assigns plants to (plot, time-window) slots with succession planting.

    Args:
        farm_grid:        A ``FarmGrid`` with plots defined.
        compat:           A ``PlantCompatibilityIndex``.
        planting_data:    Dict from *plantPlantTime.py*.
        growth_durations: Dict from *plant_info.py* (plant name -> days).
    """

    def __init__(self, farm_grid, compat: PlantCompatibilityIndex,
                 planting_data: dict, growth_durations: dict[str, int]):
        self.grid = farm_grid
        self.compat = compat
        self.planting_data = planting_data
        self.growth_durations = growth_durations
        self._planting_name_map = {
            normalize_plant_name(n): n for n in planting_data
        }
        self._growth_name_map = {
            normalize_plant_name(n): n for n in growth_durations
        }

    # ---- public API ----

    def plan_year(self, selected_plants: list[str], year: int,
                  start_month: int = 1) -> dict:
        """Build a full-year planting plan (bootstrap mode).

        Args:
            selected_plants: Ranked list — earlier = higher priority.
            year:            Calendar year to plan for.
            start_month:     Earliest month to consider (default January).

        Returns:
            Plan dict ready for ``save_plan_json``.
        """
        timeline = FarmTimeline(self.grid)
        assigned: list[dict] = []
        unassigned: list[str] = []
        remaining = list(selected_plants)

        while remaining:
            pick = self._pick_next(remaining, year, timeline, start_month)
            if pick is None:
                unassigned.extend(remaining)
                break

            remaining.remove(pick["plant"])

            if pick["plot_id"] is None:
                unassigned.append(pick["plant"])
            else:
                timeline.add(pick["plot_id"], pick["plant"],
                             pick["start"], pick["end"], pick["method"])
                assigned.append(pick)

        score = self._total_compat_score(timeline)
        events = self._adjacency_events(timeline)

        return {
            "year": year,
            "mode": "bootstrap",
            "selected_plants": selected_plants,
            "timeline": timeline.to_dict(),
            "assigned": [
                {
                    "plant": a["plant"],
                    "plot_id": a["plot_id"],
                    "start": a["start"].isoformat(),
                    "end": a["end"].isoformat(),
                    "method": a["method"],
                }
                for a in assigned
            ],
            "unassigned_plants": unassigned,
            "adjacency_events": events,
            "score": score,
        }

    def get_timeline(self, selected_plants: list[str], year: int,
                     start_month: int = 1) -> FarmTimeline:
        """Like plan_year but returns the raw FarmTimeline object
        (useful for snapshot queries without going through JSON)."""
        timeline = FarmTimeline(self.grid)
        remaining = list(selected_plants)

        while remaining:
            pick = self._pick_next(remaining, year, timeline, start_month)
            if pick is None:
                break
            remaining.remove(pick["plant"])
            if pick["plot_id"] is not None:
                timeline.add(pick["plot_id"], pick["plant"],
                             pick["start"], pick["end"], pick["method"])
        return timeline

    # ---- core scheduling logic ----

    def _pick_next(self, remaining: list[str], year: int,
                   timeline: FarmTimeline, start_month: int):
        """Select the single best (plant, slot) to assign next.

        Strategy: most-constrained-first (fewest valid options),
        with user priority (position in *remaining*) as tiebreaker.
        Among options for the chosen plant, pick the highest compatibility
        score, then the earliest start date.
        """
        options_map: dict[str, list[dict]] = {}
        for plant in remaining:
            options_map[plant] = self._find_options(
                plant, year, timeline, start_month
            )

        best_plant: str | None = None
        best_option: dict | None = None
        min_count = float("inf")

        for plant in remaining:  # user-priority order
            opts = options_map[plant]
            if not opts:
                continue
            if len(opts) < min_count:
                min_count = len(opts)
                best_plant = plant
                best_option = max(
                    opts,
                    key=lambda o: (o["score"], -o["start"].toordinal()),
                )

        if best_option is not None:
            return best_option

        # No remaining plant has any valid slot
        return {
            "plant": remaining[0],
            "plot_id": None,
            "start": None,
            "end": None,
            "method": None,
        }

    def _find_options(self, plant: str, year: int,
                      timeline: FarmTimeline, start_month: int) -> list[dict]:
        """All valid (plot, time-window) placements for *plant*."""
        duration = self._get_duration(plant)
        windows = self._outdoor_windows(plant, year)
        if not windows:
            return []

        season_start = date(year, start_month, 1)
        season_end = date(year, 12, 15)
        options: list[dict] = []

        for w in windows:
            for pid, ptl in timeline.timelines.items():
                earliest = max(
                    w["start"],
                    ptl.earliest_free_after(w["start"]),
                    season_start,
                )
                if earliest > w["end"]:
                    continue

                end = earliest + timedelta(days=duration)
                if end > season_end:
                    continue
                if not ptl.is_free_during(earliest, end):
                    continue

                score = self._score_placement(
                    plant, pid, earliest, end, timeline
                )
                options.append({
                    "plant": plant,
                    "plot_id": pid,
                    "start": earliest,
                    "end": end,
                    "score": score,
                    "method": w["method"],
                })

        return options

    def _score_placement(self, plant: str, plot_id: int,
                         start: date, end: date,
                         timeline: FarmTimeline) -> int:
        """Compatibility score for placing *plant* during [start, end),
        considering what is simultaneously growing in adjacent plots."""
        score = 0
        seen: set[str] = set()
        for adj_plant in timeline.adjacent_plants_during(plot_id, start, end):
            if adj_plant not in seen:
                score += self.compat.check_compatibility(plant, adj_plant)
                seen.add(adj_plant)
        return score

    # ---- summary / reporting helpers ----

    def _total_compat_score(self, timeline: FarmTimeline) -> int:
        """Sum pairwise compatibility for all simultaneously-adjacent
        entries (each unique pair counted once)."""
        score = 0
        seen: set[tuple] = set()
        for pid, tl in timeline.timelines.items():
            for entry in tl.entries:
                for adj_id in self.grid.get_adjacent_plots(pid):
                    for ae in timeline.timelines[adj_id].overlapping_entries(
                        entry["start"], entry["end"]
                    ):
                        pair = tuple(sorted([
                            (pid, entry["plant"], entry["start"]),
                            (adj_id, ae["plant"], ae["start"]),
                        ]))
                        if pair not in seen:
                            seen.add(pair)
                            score += self.compat.check_compatibility(
                                entry["plant"], ae["plant"]
                            )
        return score

    def _adjacency_events(self, timeline: FarmTimeline) -> list[dict]:
        """Build a list of adjacency interactions for reporting."""
        events: list[dict] = []
        seen: set[tuple] = set()
        for pid, tl in timeline.timelines.items():
            for entry in tl.entries:
                for adj_id in self.grid.get_adjacent_plots(pid):
                    for ae in timeline.timelines[adj_id].overlapping_entries(
                        entry["start"], entry["end"]
                    ):
                        pair = tuple(sorted([
                            (pid, entry["plant"], entry["start"]),
                            (adj_id, ae["plant"], ae["start"]),
                        ]))
                        if pair in seen:
                            continue
                        seen.add(pair)
                        s = self.compat.check_compatibility(
                            entry["plant"], ae["plant"]
                        )
                        events.append({
                            "plot_a": pid,
                            "plot_b": adj_id,
                            "plant_a": entry["plant"],
                            "plant_b": ae["plant"],
                            "overlap_start": max(entry["start"], ae["start"]).isoformat(),
                            "overlap_end": min(entry["end"], ae["end"]).isoformat(),
                            "compatibility": s,
                        })
        return events

    # ---- data resolution helpers ----

    def _outdoor_windows(self, plant: str, year: int) -> list[dict]:
        """Planting windows for transplant + direct_sow only."""
        key = self._resolve_planting_key(plant)
        entry = self.planting_data.get(key)
        if not entry:
            return []
        windows: list[dict] = []
        for method in ("transplant", "direct_sow"):
            dates = entry.get(method, [])
            if dates:
                windows.extend(parse_planting_windows(dates, method, year))
        windows.sort(key=lambda w: w["start"])
        return windows

    def _get_duration(self, plant: str) -> int:
        if plant in self.growth_durations:
            return self.growth_durations[plant]
        key = self._growth_name_map.get(normalize_plant_name(plant))
        if key:
            return self.growth_durations[key]
        return _DEFAULT_DURATION

    def _resolve_planting_key(self, plant: str) -> str:
        if plant in self.planting_data:
            return plant
        return self._planting_name_map.get(normalize_plant_name(plant), plant)
