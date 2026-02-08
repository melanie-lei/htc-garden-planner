"""Farm planting tool — demonstration and entry point.

Loads the test farm grid, runs the planner in bootstrap mode with a
sample set of user-selected plants, and displays + saves the result.
"""

import os
import sys

# Ensure project root is on the path so ``farm`` and the data modules
# can be imported regardless of the working directory.
_PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _PROJECT_ROOT)

from farm import (
    FarmGrid,
    FarmPlanner,
    PlantCompatibilityIndex,
    save_grid_csv,
    load_grid_csv,
    save_plan_json,
    save_history_json,
)
from plantCompatibility import compatible_plants, incompatible_plants
from plantPlantTime import planting_data


# -------------------------------------------------------------------
# Helpers
# -------------------------------------------------------------------

def create_test_grid() -> FarmGrid:
    """Build the 5x5 test grid with a 4x3 planting area in the
    bottom-right corner, split into two 2x3 plots.

    Layout (. = invalid / 255)::

        .  .  .  .  .
        .  .  .  .  .
        .  1  1  2  2
        .  1  1  2  2
        .  1  1  2  2

    Plot 1: columns 1-2, rows 2-4  (6 cells)
    Plot 2: columns 3-4, rows 2-4  (6 cells)
    """
    grid = FarmGrid(width=5, height=5)
    for row in range(2, 5):
        for col in range(1, 3):
            grid.set_cell(row, col, 1)
        for col in range(3, 5):
            grid.set_cell(row, col, 2)
    return grid


def display_plan(plan: dict):
    """Pretty-print a planting plan to stdout."""
    print(f"\n{'=' * 55}")
    print(f"  Farm Planting Plan — {plan['year']}")
    print(f"  Mode: {plan['mode']}")
    print(f"{'=' * 55}")

    print(f"\nSelected plants: {', '.join(plan['selected_plants'])}")
    print(f"Compatibility score: {plan['score']}")

    if plan["unassigned_plants"]:
        print(
            f"\nCould not assign (not enough plots): "
            f"{', '.join(plan['unassigned_plants'])}"
        )

    print("\n--- Plot Assignments ---")
    for entry in plan["schedule"]:
        print(f"\n  Plot {entry['plot_id']}  ({entry['cell_count']} cells)")
        print(f"    Plant : {entry['plant']}")
        print(f"    Status: {entry['status']}")

        if entry["recommended"]:
            rec = entry["recommended"]
            method = rec["method"].replace("_", " ").title()
            print(f"    Best method : {method}")
            print(f"    Best window : {rec['start']}  to  {rec['end']}")

        if entry["windows"]:
            print("    All options :")
            for w in entry["windows"]:
                m = w["method"].replace("_", " ").title()
                print(f"      {m:14s}  {w['start']}  to  {w['end']}")

    if plan["adjacency_details"]:
        print("\n--- Adjacency Compatibility ---")
        for d in plan["adjacency_details"]:
            s = d["compatibility_score"]
            tag = "COMPATIBLE" if s > 0 else ("INCOMPATIBLE" if s < 0 else "NEUTRAL")
            print(
                f"  Plot {d['plot_a']} ({d['plant_a']})  <->  "
                f"Plot {d['plot_b']} ({d['plant_b']}):  {tag} ({s:+d})"
            )

    print()


def display_compat_matrix(plants: list[str], compat: PlantCompatibilityIndex):
    """Print a quick compatibility cross-reference for *plants*."""
    col_w = 13
    header = "".ljust(col_w) + "".join(p[:11].ljust(col_w) for p in plants)
    print(header)
    for pa in plants:
        row = pa[:11].ljust(col_w)
        for pb in plants:
            if pa == pb:
                row += "--".ljust(col_w)
            else:
                s = compat.check_compatibility(pa, pb)
                row += f"{s:+d}".ljust(col_w)
        print(row)


# -------------------------------------------------------------------
# Main
# -------------------------------------------------------------------

def main():
    data_dir = os.path.join(_PROJECT_ROOT, "data")
    os.makedirs(data_dir, exist_ok=True)

    grid_path = os.path.join(data_dir, "test_farm.csv")
    plan_path = os.path.join(data_dir, "plan_2026.json")
    history_path = os.path.join(data_dir, "history.json")

    # ---- 1. Create / load the test grid ----
    print("Creating test farm grid (5x5, 4x3 planting area)...")
    grid = create_test_grid()
    save_grid_csv(grid, grid_path)
    print(f"Saved to {grid_path}\n")

    print("Farm layout:")
    print(grid.display())

    plot_ids = grid.get_plot_ids()
    adjacency = grid.get_adjacency_map()
    print(f"\nPlots: {plot_ids}")
    for pid in plot_ids:
        cells = grid.get_plot_cells(pid)
        adj = adjacency[pid]
        print(f"  Plot {pid}: {len(cells)} cells, adjacent to {adj or 'nothing'}")

    # Verify UNASSIGNED=0 is fully consumed
    assert not grid.has_unassigned(), "Grid still contains unassigned (0) cells!"

    # ---- 2. Verify round-trip persistence ----
    print("\nVerifying CSV round-trip...")
    reloaded = load_grid_csv(grid_path)
    assert reloaded.cells == grid.cells, "Round-trip mismatch!"
    print("OK — grid reloads identically.\n")

    # ---- 3. Set up the planner ----
    compat_index = PlantCompatibilityIndex(compatible_plants, incompatible_plants)
    planner = FarmPlanner(grid, compat_index, planting_data)

    # ---- 4. Run bootstrap planning ----
    selected = ["Tomatoes", "Corn", "Onions", "Cucumbers"]
    print(f"User-selected plants: {selected}")
    print("Running planner (bootstrap mode)...\n")

    plan = planner.create_plan(selected, year=2026)

    # ---- 5. Display the plan ----
    display_plan(plan)

    # ---- 6. Compatibility matrix for reference ----
    print("--- Compatibility Matrix ---")
    display_compat_matrix(selected, compat_index)

    # ---- 7. Persist ----
    save_plan_json(plan, plan_path)
    print(f"\nPlan saved to {plan_path}")

    save_history_json([plan], history_path)
    print(f"History saved to {history_path}")


if __name__ == "__main__":
    main()
