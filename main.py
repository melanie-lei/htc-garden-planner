"""Farm planting tool — demonstration and entry point.

Loads the farm grid from CSV, runs the time-aware planner in bootstrap
mode, and displays the resulting timeline with monthly snapshots.
"""

import os
import sys
from datetime import date

_PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _PROJECT_ROOT)

from farm import (
    FarmGrid,
    FarmPlanner,
    FarmTimeline,
    PlantCompatibilityIndex,
    growth_durations,
    load_grid_csv,
    save_plan_json,
    save_history_json,
)
from plantCompatibility import compatible_plants, incompatible_plants
from plantPlantTime import planting_data


# -------------------------------------------------------------------
# Display helpers
# -------------------------------------------------------------------

def display_timeline(plan: dict):
    """Pretty-print the timeline plan."""
    print(f"\n{'=' * 60}")
    print(f"  Farm Planting Plan — {plan['year']}  (mode: {plan['mode']})")
    print(f"{'=' * 60}")

    print(f"\nSelected plants (ranked): {', '.join(plan['selected_plants'])}")
    print(f"Compatibility score: {plan['score']}")

    if plan["unassigned_plants"]:
        print(f"Could not fit: {', '.join(plan['unassigned_plants'])}")

    # Per-plot timelines
    print("\n--- Plot Timelines ---")
    for plot_str, entries in sorted(plan["timeline"].items()):
        if not entries:
            print(f"\n  Plot {plot_str}: (empty)")
            continue
        print(f"\n  Plot {plot_str}:")
        for e in entries:
            method = e["method"].replace("_", " ").title()
            print(f"    {e['start']}  to  {e['end']}  |  {e['plant']:16s}  ({method})")

    # Adjacency events
    if plan["adjacency_events"]:
        print("\n--- Adjacency Interactions ---")
        for ev in plan["adjacency_events"]:
            s = ev["compatibility"]
            tag = "COMPATIBLE" if s > 0 else ("INCOMPATIBLE" if s < 0 else "NEUTRAL")
            print(
                f"  Plot {ev['plot_a']} ({ev['plant_a']}) <-> "
                f"Plot {ev['plot_b']} ({ev['plant_b']}):  "
                f"{tag} ({s:+d})  during {ev['overlap_start']} to {ev['overlap_end']}"
            )
    print()


def display_snapshots(timeline: FarmTimeline, grid: FarmGrid, year: int):
    """Show what the farm looks like at the 1st of each month."""
    print("--- Monthly Snapshots ---")
    print("(what is growing in each plot on the 1st of each month)\n")

    plot_ids = grid.get_plot_ids()
    col_w = 14

    # Header
    header = "Date".ljust(12) + "".join(
        f"Plot {pid}".ljust(col_w) for pid in plot_ids
    )
    print(header)
    print("-" * len(header))

    for month in range(1, 13):
        d = date(year, month, 1)
        snap = timeline.snapshot(d)
        row = d.strftime("%b %d").ljust(12)
        for pid in plot_ids:
            plant = snap.get(pid)
            row += (plant or "--").ljust(col_w)
        print(row)
    print()


def display_compat_matrix(plants: list[str], compat: PlantCompatibilityIndex):
    """Print a compatibility cross-reference for selected plants."""
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
    grid_path = os.path.join(data_dir, "test_farm.csv")
    plan_path = os.path.join(data_dir, "plan_2026.json")
    history_path = os.path.join(data_dir, "history.json")

    # ---- 1. Load the farm grid ----
    print(f"Loading farm grid from {grid_path}...")
    grid = load_grid_csv(grid_path)

    print(f"\nFarm layout ({grid.width}x{grid.height}):")
    print(grid.display())

    plot_ids = grid.get_plot_ids()
    adjacency = grid.get_adjacency_map()
    print(f"\nPlots: {plot_ids}")
    for pid in plot_ids:
        cells = grid.get_plot_cells(pid)
        adj = adjacency[pid]
        print(f"  Plot {pid}: {len(cells)} cells, adjacent to {adj or 'nothing'}")

    # ---- 2. Set up the planner ----
    compat_index = PlantCompatibilityIndex(compatible_plants, incompatible_plants)
    planner = FarmPlanner(grid, compat_index, planting_data, growth_durations)

    # ---- 3. Run bootstrap planning ----
    selected = ["Tomatoes", "Corn", "Onions", "Cucumbers", "Lettuce", "Radish"]
    year = 2026
    print(f"\nUser-selected plants (ranked): {selected}")
    print("Running time-aware planner (bootstrap mode)...")

    plan = planner.plan_year(selected, year)

    # ---- 4. Display results ----
    display_timeline(plan)

    # Monthly snapshot view (the "scrub through the year" data)
    timeline = planner.get_timeline(selected, year)
    display_snapshots(timeline, grid, year)

    # Compatibility matrix
    print("--- Compatibility Matrix ---")
    display_compat_matrix(selected, compat_index)

    # ---- 5. Persist ----
    save_plan_json(plan, plan_path)
    print(f"\nPlan saved to {plan_path}")

    save_history_json([plan], history_path)
    print(f"History saved to {history_path}")


if __name__ == "__main__":
    main()
