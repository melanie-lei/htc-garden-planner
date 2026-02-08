const gridEl = document.getElementById("grid");
const widthInput = document.getElementById("grid-width");
const heightInput = document.getElementById("grid-height");
const fillSelect = document.getElementById("grid-fill");
const createBtn = document.getElementById("create-grid");
const fillInvalidBtn = document.getElementById("fill-invalid");
const fillUnassignedBtn = document.getElementById("fill-unassigned");
const plotIdInput = document.getElementById("plot-id");
const cellSizeInput = document.getElementById("cell-size");
const filenameInput = document.getElementById("filename");
const saveBtn = document.getElementById("save-grid");
const loadBtn = document.getElementById("load-grid");
const saveStatus = document.getElementById("save-status");

let state = {
  width: 0,
  height: 0,
  cells: [],
  tool: "brush",
  paintType: "plot",
  cellSize: Number(cellSizeInput.value),
};

let isPainting = false;
let pending = new Map();
let flushTimer = null;

function getPaintValue() {
  if (state.paintType === "unassigned") return 0;
  if (state.paintType === "invalid") return 255;
  let id = Number(plotIdInput.value);
  if (!Number.isFinite(id)) id = 1;
  id = Math.max(1, Math.min(254, Math.round(id)));
  plotIdInput.value = id;
  return id;
}

function colorForPlot(id) {
  const hue = (id * 47) % 360;
  return `hsl(${hue}, 65%, 80%)`;
}

function applyCellStyle(cellEl, value) {
  cellEl.classList.remove("invalid", "unassigned", "plot");
  if (value === 255) {
    cellEl.classList.add("invalid");
    cellEl.textContent = "";
    cellEl.style.backgroundColor = "";
  } else if (value === 0) {
    cellEl.classList.add("unassigned");
    cellEl.textContent = "";
    cellEl.style.backgroundColor = "";
  } else {
    cellEl.classList.add("plot");
    cellEl.textContent = value;
    cellEl.style.backgroundColor = colorForPlot(value);
  }
}

function renderGrid() {
  gridEl.style.setProperty("--cell-size", `${state.cellSize}px`);
  gridEl.style.gridTemplateColumns = `repeat(${state.width}, var(--cell-size))`;
  gridEl.innerHTML = "";

  for (let r = 0; r < state.height; r += 1) {
    for (let c = 0; c < state.width; c += 1) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.row = r;
      cell.dataset.col = c;
      applyCellStyle(cell, state.cells[r][c]);
      gridEl.appendChild(cell);
    }
  }
}

async function fetchGrid() {
  const res = await fetch("/api/grid");
  const data = await res.json();
  state.width = data.width;
  state.height = data.height;
  state.cells = data.cells;
  widthInput.value = data.width;
  heightInput.value = data.height;
  renderGrid();
}

async function postJson(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (data.error) {
    throw new Error(data.error);
  }
  return data;
}

function queueCell(row, col, value) {
  const key = `${row},${col}`;
  pending.set(key, { row, col, value });
  if (!flushTimer) {
    flushTimer = window.setTimeout(flushPending, 120);
  }
}

async function flushPending() {
  if (flushTimer) {
    window.clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (pending.size === 0) return;

  const cells = [];
  for (const item of pending.values()) {
    cells.push({ row: item.row, col: item.col, value: item.value });
  }
  pending.clear();

  await postJson("/api/paint", { cells });
}

function handleBrush(cellEl) {
  const row = Number(cellEl.dataset.row);
  const col = Number(cellEl.dataset.col);
  const value = getPaintValue();
  if (state.cells[row][col] === value) return;
  state.cells[row][col] = value;
  applyCellStyle(cellEl, value);
  queueCell(row, col, value);
}

async function handleFill(cellEl) {
  const row = Number(cellEl.dataset.row);
  const col = Number(cellEl.dataset.col);
  const value = getPaintValue();
  const data = await postJson("/api/fill", { row, col, value });
  state.width = data.width;
  state.height = data.height;
  state.cells = data.cells;
  renderGrid();
}

function cellFromEvent(event) {
  const target = event.target;
  if (!target.classList.contains("cell")) return null;
  return target;
}

createBtn.addEventListener("click", async () => {
  const width = Number(widthInput.value || 1);
  const height = Number(heightInput.value || 1);
  const fill = Number(fillSelect.value || 255);
  const data = await postJson("/api/grid", { width, height, fill });
  state.width = data.width;
  state.height = data.height;
  state.cells = data.cells;
  renderGrid();
});

fillInvalidBtn.addEventListener("click", async () => {
  const data = await postJson("/api/grid", {
    width: state.width,
    height: state.height,
    fill: 255,
  });
  state.width = data.width;
  state.height = data.height;
  state.cells = data.cells;
  renderGrid();
});

fillUnassignedBtn.addEventListener("click", async () => {
  const data = await postJson("/api/grid", {
    width: state.width,
    height: state.height,
    fill: 0,
  });
  state.width = data.width;
  state.height = data.height;
  state.cells = data.cells;
  renderGrid();
});

cellSizeInput.addEventListener("input", () => {
  state.cellSize = Number(cellSizeInput.value);
  renderGrid();
});

saveBtn.addEventListener("click", async () => {
  saveStatus.textContent = "";
  try {
    const data = await postJson("/api/save", { filename: filenameInput.value });
    saveStatus.textContent = `Saved to ${data.saved_to}`;
  } catch (err) {
    saveStatus.textContent = err.message;
  }
});

loadBtn.addEventListener("click", async () => {
  saveStatus.textContent = "";
  try {
    const data = await postJson("/api/load", { filename: filenameInput.value });
    state.width = data.width;
    state.height = data.height;
    state.cells = data.cells;
    widthInput.value = data.width;
    heightInput.value = data.height;
    renderGrid();
  } catch (err) {
    saveStatus.textContent = err.message;
  }
});

for (const input of document.querySelectorAll("input[name='tool']")) {
  input.addEventListener("change", () => {
    state.tool = input.value;
  });
}

for (const input of document.querySelectorAll("input[name='paint-type']")) {
  input.addEventListener("change", () => {
    state.paintType = input.value;
  });
}

gridEl.addEventListener("pointerdown", async (event) => {
  const cell = cellFromEvent(event);
  if (!cell) return;
  if (state.tool === "fill") {
    await handleFill(cell);
    return;
  }
  isPainting = true;
  handleBrush(cell);
});

gridEl.addEventListener("pointerover", (event) => {
  if (!isPainting || state.tool !== "brush") return;
  const cell = cellFromEvent(event);
  if (!cell) return;
  handleBrush(cell);
});

window.addEventListener("pointerup", () => {
  if (!isPainting) return;
  isPainting = false;
  flushPending();
});

fetchGrid();
