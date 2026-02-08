# htc-garden-planner
Garden Planner by Lossy Compression for Hack The Coast

## Visual Grid Editor

Run the lightweight grid painter to create and save plot layouts:

```bash
python3 web_server.py
```

Then open `http://localhost:8000` in your browser. The editor lets you:
- Create a new grid with a chosen fill value
- Brush or flood-fill plot IDs, unassigned cells (0), and invalid cells (255)
- Save and load layouts as CSV files in `data/`
