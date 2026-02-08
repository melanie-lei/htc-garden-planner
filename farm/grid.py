"""Farm grid representation.

The farm is modeled as a 2D grid of cells. Each cell holds an integer value:
  - 255 (INVALID):    Outside the farm boundary (not plantable space)
  - 0   (UNASSIGNED): Valid farm space not yet assigned to a plot
  - 1-254:            Plot ID — a contiguous region the user has defined

This allows irregular farm shapes to be represented naturally: only the
cells the user "paints" as valid become part of the working area, while
everything else stays 255.
"""


class FarmGrid:
    """2D grid of cells representing a farm layout.

    Attributes:
        width:  Number of columns.
        height: Number of rows.
        cells:  2D list (row-major) of integer cell values.
    """

    INVALID = 255
    UNASSIGNED = 0

    def __init__(self, width: int, height: int):
        """Create a grid filled entirely with INVALID cells."""
        self.width = width
        self.height = height
        self.cells = [[self.INVALID] * width for _ in range(height)]

    # ------------------------------------------------------------------
    # Construction helpers
    # ------------------------------------------------------------------

    @classmethod
    def from_matrix(cls, matrix):
        """Create a FarmGrid from an existing 2D list of integers.

        Args:
            matrix: list[list[int]] — each inner list is one row.

        Returns:
            A new FarmGrid instance.
        """
        height = len(matrix)
        width = len(matrix[0]) if height > 0 else 0
        grid = cls(width, height)
        grid.cells = [row[:] for row in matrix]  # defensive copy
        return grid

    # ------------------------------------------------------------------
    # Cell access
    # ------------------------------------------------------------------

    def set_cell(self, row: int, col: int, value: int):
        """Set a single cell's value.

        Raises IndexError if (row, col) is out of bounds.
        """
        if not (0 <= row < self.height and 0 <= col < self.width):
            raise IndexError(
                f"Cell ({row}, {col}) out of bounds for "
                f"{self.width}x{self.height} grid"
            )
        self.cells[row][col] = value

    def get_cell(self, row: int, col: int) -> int:
        """Return the value of a single cell.

        Raises IndexError if (row, col) is out of bounds.
        """
        if not (0 <= row < self.height and 0 <= col < self.width):
            raise IndexError(
                f"Cell ({row}, {col}) out of bounds for "
                f"{self.width}x{self.height} grid"
            )
        return self.cells[row][col]

    # ------------------------------------------------------------------
    # Plot queries
    # ------------------------------------------------------------------

    def get_plot_cells(self, plot_id: int):
        """Return a list of (row, col) tuples belonging to *plot_id*."""
        return [
            (r, c)
            for r in range(self.height)
            for c in range(self.width)
            if self.cells[r][c] == plot_id
        ]

    def get_plot_ids(self):
        """Return a sorted list of unique plot IDs (excludes INVALID and UNASSIGNED)."""
        ids = set()
        for row in self.cells:
            for v in row:
                if v != self.INVALID and v != self.UNASSIGNED:
                    ids.add(v)
        return sorted(ids)

    def get_adjacent_plots(self, plot_id: int):
        """Return the set of plot IDs that share an edge with *plot_id*.

        Uses 4-connectivity (up / down / left / right).
        """
        adjacent = set()
        for r, c in self.get_plot_cells(plot_id):
            for dr, dc in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
                nr, nc = r + dr, c + dc
                if 0 <= nr < self.height and 0 <= nc < self.width:
                    neighbor = self.cells[nr][nc]
                    if (
                        neighbor != self.INVALID
                        and neighbor != self.UNASSIGNED
                        and neighbor != plot_id
                    ):
                        adjacent.add(neighbor)
        return adjacent

    def get_adjacency_map(self):
        """Return a dict mapping every plot ID to its set of adjacent plot IDs."""
        return {pid: self.get_adjacent_plots(pid) for pid in self.get_plot_ids()}

    def has_unassigned(self):
        """Return True if any cell is UNASSIGNED (0)."""
        return any(v == self.UNASSIGNED for row in self.cells for v in row)

    # ------------------------------------------------------------------
    # Display
    # ------------------------------------------------------------------

    def display(self) -> str:
        """Return a human-readable string of the grid.

        Invalid cells are shown as '.' for clarity.
        """
        max_val = max(
            (v for row in self.cells for v in row if v != self.INVALID),
            default=0,
        )
        w = max(len(str(max_val)), 3)

        lines = []
        for row in self.cells:
            parts = []
            for v in row:
                parts.append("." .rjust(w) if v == self.INVALID else str(v).rjust(w))
            lines.append(" ".join(parts))
        return "\n".join(lines)
