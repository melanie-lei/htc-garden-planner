"""Farm planting planner.

Assigns plants to plots and builds a planting schedule.  Two modes:

1. **Bootstrap** — no prior history.  The user picks which plants they
   want to grow; the planner finds the assignment of plants to plots
   that maximises compatibility between adjacent plots and returns a
   calendar schedule based on the planting-window data.

2. **Historical** (future) — considers up to 4 prior years of data for
   crop-rotation and soil-health planning.

The compatibility scoring uses a normalised name index so that minor
spelling differences between the two data files (e.g. "Tomato" vs
"Tomatoes") are handled transparently.
"""

from collections import Counter
from itertools import combinations, permutations
from math import comb, factorial

from .calendar_utils import get_all_planting_windows, get_best_planting_method

# If the brute-force search space exceeds this many candidate
# assignments we fall back to a greedy heuristic instead.
_MAX_BRUTE_FORCE = 100_000


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
    """Fast, normalisation-aware lookup for companion / antagonist data.

    Wraps the raw ``compatible_plants`` and ``incompatible_plants`` dicts
    from *plantCompatibility.py* and resolves name mismatches automatically.
    """

    def __init__(self, compatible_plants: dict, incompatible_plants: dict):
        self._compatible = compatible_plants
        self._incompatible = incompatible_plants
        self._name_map = self._build_name_map()

    def _build_name_map(self) -> dict[str, str]:
        """Map normalised names → original dict keys."""
        name_map: dict[str, str] = {}
        for name in set(self._compatible) | set(self._incompatible):
            name_map[normalize_plant_name(name)] = name
        return name_map

    def _resolve(self, name: str) -> str:
        """Return the canonical (original-dict-key) version of *name*."""
        return self._name_map.get(normalize_plant_name(name), name)

    @staticmethod
    def _contains(plant: str, plant_list: list[str]) -> bool:
        """Check membership using normalised comparison."""
        norm = normalize_plant_name(plant)
        return any(normalize_plant_name(p) == norm for p in plant_list)

    def check_compatibility(self, plant_a: str, plant_b: str) -> int:
        """Score how well two plants get along when planted adjacently.

        Returns an integer:
            * **+2** mutual companions  (both list each other)
            * **+1** one-directional companion
            *  **0** neutral
            * **-3** one-directional antagonist
            * **-6** mutual antagonists

        Both directions (A→B *and* B→A) are checked so that data
        asymmetries are handled gracefully.
        """
        score = 0
        key_a = self._resolve(plant_a)
        key_b = self._resolve(plant_b)

        # Companion checks
        if key_a in self._compatible and self._contains(plant_b, self._compatible[key_a]):
            score += 1
        if key_b in self._compatible and self._contains(plant_a, self._compatible[key_b]):
            score += 1

        # Antagonist checks
        if key_a in self._incompatible and self._contains(plant_b, self._incompatible[key_a]):
            score -= 3
        if key_b in self._incompatible and self._contains(plant_a, self._incompatible[key_b]):
            score -= 3

        return score

    def get_compatible(self, plant: str) -> list[str]:
        """Return the raw companion list for *plant* (empty if unknown)."""
        return self._compatible.get(self._resolve(plant), [])

    def get_incompatible(self, plant: str) -> list[str]:
        """Return the raw antagonist list for *plant* (empty if unknown)."""
        return self._incompatible.get(self._resolve(plant), [])


# -----------------------------------------------------------------------
# Planner
# -----------------------------------------------------------------------

class FarmPlanner:
    """Assigns plants to plots and generates planting schedules.

    Args:
        farm_grid:  A ``FarmGrid`` with plots already defined.
        compat:     A ``PlantCompatibilityIndex`` instance.
        planting_data: The ``planting_data`` dict from *plantPlantTime.py*.
    """

    def __init__(self, farm_grid, compat: PlantCompatibilityIndex, planting_data: dict):
        self.grid = farm_grid
        self.compat = compat
        self.planting_data = planting_data
        self._planting_name_map = {
            normalize_plant_name(name): name for name in planting_data
        }

    # ----- scoring -----

    def score_assignment(self, assignment: dict[int, str]) -> int:
        """Total compatibility score for a full plot→plant mapping.

        Only adjacent plot pairs contribute to the score (each pair
        counted once, not twice).
        """
        adjacency = self.grid.get_adjacency_map()
        score = 0
        seen: set[tuple[int, int]] = set()

        for plot_id, plant in assignment.items():
            for adj_id in adjacency.get(plot_id, set()):
                if adj_id not in assignment:
                    continue
                pair = (min(plot_id, adj_id), max(plot_id, adj_id))
                if pair in seen:
                    continue
                seen.add(pair)
                score += self.compat.check_compatibility(plant, assignment[adj_id])

        return score

    # ----- assignment search -----

    def suggest_assignment(self, selected_plants: list[str], year: int | None = None):
        """Find the best plant→plot mapping (bootstrap mode).

        Tries all feasible combinations and returns the one with the
        highest adjacency-compatibility score.  Falls back to a greedy
        heuristic for large search spaces.

        Args:
            selected_plants: Plants the user wants to grow.
            year: Optional planning year (reserved for window validation).

        Returns:
            dict with keys ``assignment``, ``score``, ``unassigned``,
            ``details``.
        """
        plot_ids = self.grid.get_plot_ids()
        n_plots = len(plot_ids)
        n_plants = len(selected_plants)

        if n_plots == 0 or n_plants == 0:
            return self._empty_result(selected_plants)

        k = min(n_plots, n_plants)

        # Guard against combinatorial explosion
        total = comb(n_plants, k) * comb(n_plots, k) * factorial(k)
        if total > _MAX_BRUTE_FORCE:
            return self._greedy_assignment(selected_plants, plot_ids)

        best_assignment: dict[int, str] | None = None
        best_score = float("-inf")
        best_plant_combo: tuple[str, ...] | None = None

        for plant_combo in combinations(selected_plants, k):
            for plot_combo in combinations(plot_ids, k):
                for perm in permutations(plant_combo):
                    assignment = dict(zip(plot_combo, perm))
                    s = self.score_assignment(assignment)
                    if s > best_score:
                        best_score = s
                        best_assignment = assignment
                        best_plant_combo = plant_combo

        if best_assignment is None or best_plant_combo is None:
            return self._empty_result(selected_plants)

        unassigned = self._multiset_difference(selected_plants, list(best_plant_combo))
        details = self._adjacency_details(best_assignment)

        return {
            "assignment": best_assignment,
            "score": best_score,
            "unassigned": unassigned,
            "details": details,
        }

    def _greedy_assignment(self, selected_plants: list[str], plot_ids: list[int]):
        """Greedy fallback for large farms.

        Assigns one plant at a time, always picking the (plant, plot)
        pair that adds the most compatibility with already-placed
        neighbours.
        """
        adjacency = self.grid.get_adjacency_map()
        assignment: dict[int, str] = {}
        remaining_plants = list(selected_plants)
        remaining_plots = list(plot_ids)

        # Seed: first plant → first plot (arbitrary, no neighbours yet)
        if remaining_plants and remaining_plots:
            assignment[remaining_plots.pop(0)] = remaining_plants.pop(0)

        while remaining_plants and remaining_plots:
            best_s = float("-inf")
            best_plant: str | None = None
            best_plot: int | None = None

            for plant in remaining_plants:
                for plot in remaining_plots:
                    s = sum(
                        self.compat.check_compatibility(plant, assignment[adj])
                        for adj in adjacency.get(plot, set())
                        if adj in assignment
                    )
                    if s > best_s:
                        best_s = s
                        best_plant = plant
                        best_plot = plot

            if best_plant is not None and best_plot is not None:
                assignment[best_plot] = best_plant
                remaining_plants.remove(best_plant)
                remaining_plots.remove(best_plot)
            else:
                break

        return {
            "assignment": assignment,
            "score": self.score_assignment(assignment),
            "unassigned": remaining_plants,
            "details": self._adjacency_details(assignment),
        }

    # ----- schedule creation -----

    def create_schedule(self, assignment: dict[int, str], year: int):
        """Build a calendar schedule for each assigned plot.

        Returns a list of dicts with plot info, recommended planting
        method/window, and all available windows.
        """
        schedule = []
        for plot_id, plant in sorted(assignment.items()):
            entry = {
                "plot_id": plot_id,
                "plant": plant,
                "cell_count": len(self.grid.get_plot_cells(plot_id)),
                "status": "planned",
                "notes": "",
                "windows": [],
                "recommended": None,
            }

            plant_key = self._resolve_planting_key(plant)

            for w in get_all_planting_windows(plant_key, self.planting_data, year):
                entry["windows"].append(
                    {
                        "method": w["method"],
                        "start": w["start"].isoformat(),
                        "end": w["end"].isoformat(),
                    }
                )

            best = get_best_planting_method(plant_key, self.planting_data, year)
            if best:
                entry["recommended"] = {
                    "method": best["method"],
                    "start": best["start"].isoformat(),
                    "end": best["end"].isoformat(),
                }
            elif plant_key not in self.planting_data:
                entry["notes"] = "No planting-window data found."

            schedule.append(entry)

        return schedule

    # ----- full pipeline -----

    def create_plan(self, selected_plants: list[str], year: int) -> dict:
        """Run the complete planning pipeline (bootstrap mode).

        1. Find optimal assignment
        2. Build schedule with planting windows
        3. Package everything into a dict ready for persistence

        Returns:
            A plan dict suitable for ``save_plan_json``.
        """
        result = self.suggest_assignment(selected_plants, year)
        schedule = self.create_schedule(result["assignment"], year)

        return {
            "year": year,
            "mode": "bootstrap",
            "selected_plants": selected_plants,
            "assignment": {str(k): v for k, v in result["assignment"].items()},
            "score": result["score"],
            "unassigned_plants": result["unassigned"],
            "adjacency_details": [
                {
                    "plot_a": d[0],
                    "plot_b": d[1],
                    "plant_a": d[2],
                    "plant_b": d[3],
                    "compatibility_score": d[4],
                }
                for d in result["details"]
            ],
            "schedule": schedule,
        }

    # ----- internal helpers -----

    def _adjacency_details(self, assignment: dict[int, str]):
        """Build a list of (plot_a, plot_b, plant_a, plant_b, score) tuples."""
        adjacency = self.grid.get_adjacency_map()
        details = []
        seen: set[tuple[int, int]] = set()

        for plot_id, plant in assignment.items():
            for adj_id in adjacency.get(plot_id, set()):
                if adj_id not in assignment:
                    continue
                pair = (min(plot_id, adj_id), max(plot_id, adj_id))
                if pair in seen:
                    continue
                seen.add(pair)
                adj_plant = assignment[adj_id]
                s = self.compat.check_compatibility(plant, adj_plant)
                details.append((plot_id, adj_id, plant, adj_plant, s))

        return details

    def _resolve_planting_key(self, plant: str) -> str:
        if plant in self.planting_data:
            return plant
        return self._planting_name_map.get(normalize_plant_name(plant), plant)

    @staticmethod
    def _multiset_difference(items: list[str], used: list[str]) -> list[str]:
        remaining = Counter(items)
        remaining.subtract(used)
        leftover = []
        for item in items:
            if remaining[item] > 0:
                leftover.append(item)
                remaining[item] -= 1
        return leftover

    @staticmethod
    def _empty_result(selected_plants):
        return {
            "assignment": {},
            "score": 0,
            "unassigned": list(selected_plants),
            "details": [],
        }
