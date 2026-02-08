// ===================================================================
// SVG Icons (inline from figmaFiles)
// ===================================================================

const ICONS = {
  leaf: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M6.8291 17.0806C13.9002 21.3232 19.557 15.6663 18.8499 5.0598C8.24352 4.35269 2.58692 10.0097 6.8291 17.0806ZM6.8291 17.0806C6.82902 17.0805 6.82918 17.0807 6.8291 17.0806ZM6.8291 17.0806L5 18.909M6.8291 17.0806L10.6569 13.2522" stroke="#679436" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
  plus: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M8 12H12M12 12H16M12 12V16M12 12V8M4 16.8V7.2C4 6.08 4 5.52 4.218 5.092C4.41 4.715 4.715 4.41 5.092 4.218C5.52 4 6.08 4 7.2 4H16.8C17.92 4 18.48 4 18.908 4.218C19.284 4.41 19.59 4.715 19.782 5.092C20 5.52 20 6.08 20 7.2V16.8C20 17.92 20 18.48 19.782 18.908C19.59 19.284 19.284 19.59 18.908 19.782C18.48 20 17.92 20 16.8 20H7.2C6.08 20 5.52 20 5.092 19.782C4.715 19.59 4.41 19.284 4.218 18.908C4 18.48 4 17.92 4 16.8Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
  upload: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 18V12M12 12L9 14M12 12L15 14M13 3H8.2C7.08 3 6.52 3 6.092 3.218C5.715 3.41 5.41 3.715 5.218 4.092C5 4.52 5 5.08 5 6.2V17.8C5 18.92 5 19.48 5.218 19.908C5.41 20.284 5.715 20.59 6.092 20.782C6.52 21 7.08 21 8.2 21H15.8C16.92 21 17.48 21 17.907 20.782C18.284 20.59 18.59 20.284 18.782 19.908C19 19.48 19 18.92 19 17.8V9M13 3C13.286 3.003 13.466 3.014 13.639 3.055C13.843 3.104 14.038 3.185 14.217 3.295C14.419 3.419 14.592 3.592 14.938 3.938L18.063 7.063C18.409 7.409 18.581 7.581 18.705 7.783C18.814 7.962 18.895 8.157 18.944 8.361C18.986 8.534 18.996 8.715 18.999 9M13 3V5.8C13 6.92 13 7.48 13.218 7.908C13.41 8.284 13.715 8.59 14.092 8.782C14.52 9 15.08 9 16.2 9H19" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
  check: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M6 12L10.243 16.243L18.727 7.757" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
  search: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M15 15L21 21M10 17C6.134 17 3 13.866 3 10C3 6.134 6.134 3 10 3C13.866 3 17 6.134 17 10C17 13.866 13.866 17 10 17Z" stroke="#679436" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
};

// Default plot colours from Figma spec
const PLOT_COLORS = [
  "#F3534A", "#FF853E", "#FFBB3E", "#3A8844",
  "#43A1BC", "#A06EBF", "#F9A5D7",
];

// ===================================================================
// State
// ===================================================================

const state = {
  width: 0,
  height: 0,
  cells: [],
  cellSize: 30,
  bgDataUrl: null,
  bgOpacity: 40,
  bgImgWidth: 500,
};

// Plot metadata (id -> { name, color })
let plotMeta = {};
let selectedPlotId = null;
let clearMode = false;

// Paint state
let isPainting = false;
let activeGrid = null;
let pending = new Map();
let flushInFlight = null;
const PAINT_BATCH_SIZE = 2000;

// Plants & planner
let availablePlants = [];
let selectedPlants = [];
let currentPlan = null;
let historyPlans = [];
let activeHistoryDate = null;
let highlightedPlotId = null;

// ===================================================================
// Helpers
// ===================================================================

async function postJson(url, payload, options = {}) {
  const timeoutMs = options.timeoutMs;
  const controller = timeoutMs ? new AbortController() : null;
  const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller ? controller.signal : undefined,
    });
  } catch (err) {
    if (err && err.name === "AbortError") throw new Error("Request timed out");
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); }
    catch { if (!res.ok) throw new Error(text); throw new Error("Invalid JSON response"); }
  }
  if (!res.ok) {
    const msg = data && data.error ? data.error : (text || `${res.status} ${res.statusText}`);
    throw new Error(msg);
  }
  if (data && data.error) throw new Error(data.error);
  return data;
}

async function fetchBlobWithTimeout(url, options = {}, timeoutMs = null) {
  const controller = timeoutMs ? new AbortController() : null;
  const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;
  let res;
  try {
    res = await fetch(url, { ...options, signal: controller ? controller.signal : undefined });
    if (!res.ok) {
      const text = await res.text();
      let msg = `${res.status} ${res.statusText}`;
      try { const d = JSON.parse(text); if (d && d.error) msg = d.error; } catch {}
      throw new Error(msg);
    }
    return await res.blob();
  } catch (err) {
    if (err && err.name === "AbortError") throw new Error("Request timed out");
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function plotColor(id) {
  const meta = plotMeta[id];
  if (meta && meta.color) return meta.color;
  return PLOT_COLORS[(id - 1) % PLOT_COLORS.length];
}

function plantColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return `hsl(${h % 360}, 55%, 55%)`;
}

function plotName(id) {
  const meta = plotMeta[id];
  if (meta && meta.name) return meta.name;
  return `Plot ${id}`;
}

function fillRegionLocal(row, col, value) {
  if (row < 0 || col < 0 || row >= state.height || col >= state.width) return [];
  const target = state.cells[row][col];
  if (target === value) return [];
  const q = [[row, col]];
  const changed = [];
  state.cells[row][col] = value;
  changed.push([row, col]);
  for (let i = 0; i < q.length; i++) {
    const [r, c] = q[i];
    for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < state.height && nc >= 0 && nc < state.width && state.cells[nr][nc] === target) {
        state.cells[nr][nc] = value;
        changed.push([nr, nc]);
        q.push([nr, nc]);
      }
    }
  }
  return changed;
}

function dayToDate(dayOfYear, year) {
  const d = new Date(year, 0, 1);
  d.setDate(d.getDate() + dayOfYear);
  return d;
}

function fmtDate(d) {
  return d.toLocaleDateString("en-US", { month: "short", day: "2-digit" });
}

function isoDate(d) {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function getPlotInfo() {
  const plots = {};
  for (let r = 0; r < state.height; r++) {
    for (let c = 0; c < state.width; c++) {
      const v = state.cells[r][c];
      if (v >= 1 && v <= 254) plots[v] = (plots[v] || 0) + 1;
    }
  }
  return plots;
}

function getNextPlotId() {
  const plots = getPlotInfo();
  for (let id = 1; id <= 254; id++) {
    if (!plots[id]) return id;
  }
  return null;
}

function ensurePlotMeta(id) {
  if (!plotMeta[id]) {
    plotMeta[id] = {
      name: `Plot ${id}`,
      color: PLOT_COLORS[(id - 1) % PLOT_COLORS.length],
    };
  }
}

// ===================================================================
// Server communication
// ===================================================================

async function fetchGrid() {
  const data = await (await fetch("/api/grid")).json();
  state.width = data.width;
  state.height = data.height;
  state.cells = data.cells;
  // Ensure plotMeta for existing plots
  const plots = getPlotInfo();
  for (const id of Object.keys(plots)) ensurePlotMeta(Number(id));
}

async function fetchPlants() {
  const data = await (await fetch("/api/plants")).json();
  availablePlants = data.plants;
}

async function fetchHistory() {
  try {
    const data = await (await fetch("/api/history")).json();
    historyPlans = data.plans || [];
  } catch { historyPlans = []; }
}

function queueCell(row, col, value) {
  pending.set(`${row},${col}`, { row, col, value });
}

async function flushPending(options = {}) {
  if (flushInFlight) await flushInFlight;
  if (pending.size === 0) return;
  const cells = [...pending.values()];
  pending.clear();
  const timeoutMs = options.timeoutMs ?? 15000;
  const req = (async () => {
    for (let i = 0; i < cells.length; i += PAINT_BATCH_SIZE) {
      await postJson("/api/paint", { cells: cells.slice(i, i + PAINT_BATCH_SIZE) }, { timeoutMs });
    }
  })();
  flushInFlight = req;
  try { await req; }
  catch (err) {
    for (const cell of cells) pending.set(`${cell.row},${cell.col}`, cell);
    throw err;
  } finally {
    if (flushInFlight === req) flushInFlight = null;
  }
}

// ===================================================================
// Page navigation
// ===================================================================

function showPage(pageId) {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  const page = document.getElementById(pageId);
  if (page) page.classList.add("active");

  // Show file bar on main and later pages
  const fileBar = document.getElementById("file-bar");
  if (pageId === "page-main") {
    fileBar.style.display = "flex";
  } else {
    fileBar.style.display = "none";
  }

  // Render on switch
  if (pageId === "page-farm-area") renderFarmAreaGrid();
  if (pageId === "page-plots") { renderPlotsGrid(); renderPlotLegend(); }
  if (pageId === "page-main") { renderMainGrid(); renderHistoryTree(); }
  if (pageId === "page-suggestions") { renderSuggestionsGrid(); renderPlantSelect(); renderPlantList(); }
}

// ===================================================================
// Inject SVG icons into DOM
// ===================================================================

function injectIcons() {
  // Logos
  for (const id of ["logo-start", "logo-farm-area", "logo-plots", "logo-main"]) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = ICONS.leaf;
  }
  // Button icons
  const iconMap = {
    "icon-create": ICONS.plus,
    "icon-import": ICONS.upload,
    "icon-proceed-area": ICONS.check,
    "icon-proceed-plots": ICONS.check,
    "icon-add-plot": ICONS.plus,
    "icon-suggestions": ICONS.leaf,
    "icon-search": ICONS.search,
  };
  for (const [id, svg] of Object.entries(iconMap)) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = svg;
  }
}

// ===================================================================
// Grid rendering
// ===================================================================

function setGridLayout(gridEl) {
  gridEl.style.setProperty("--cell-size", `${state.cellSize}px`);
  gridEl.style.gridTemplateColumns = `repeat(${state.width}, var(--cell-size))`;
}

function updateBgImage(imgEl) {
  if (state.bgDataUrl) {
    imgEl.src = state.bgDataUrl;
    imgEl.style.display = "block";
    imgEl.style.opacity = state.bgOpacity / 100;
    imgEl.style.width = state.bgImgWidth + "px";
    imgEl.style.height = "auto";
  } else {
    imgEl.style.display = "none";
  }
}

// ===================================================================
// PAGE 1: START
// ===================================================================

const newFarmImage = document.getElementById("new-farm-image");
const newFarmBtn = document.getElementById("new-farm-btn");
const importFarmFile = document.getElementById("import-farm-file");
const importFarmBtn = document.getElementById("import-farm-btn");

newFarmImage.addEventListener("change", () => {
  const label = document.getElementById("new-farm-label");
  const textEl = label.querySelector(".file-input-text");
  if (newFarmImage.files[0]) {
    textEl.textContent = newFarmImage.files[0].name;
    label.classList.add("has-file");
  }
});

importFarmFile.addEventListener("change", () => {
  const label = document.getElementById("import-farm-label");
  const textEl = label.querySelector(".file-input-text");
  if (importFarmFile.files[0]) {
    textEl.textContent = importFarmFile.files[0].name;
    label.classList.add("has-file");
  }
});

newFarmBtn.addEventListener("click", async () => {
  // Create new grid (start with all invalid, user will paint farm area)
  const data = await postJson("/api/grid", { width: 10, height: 10, fill: 255 });
  state.width = data.width;
  state.height = data.height;
  state.cells = data.cells;
  plotMeta = {};

  // Upload background image if provided
  const file = newFarmImage.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = async () => {
      state.bgDataUrl = reader.result;
      state.bgImgWidth = Math.min(600, window.innerWidth - 100);
      const ext = file.name.split(".").pop() || "png";
      await postJson("/api/background", { image: reader.result, filename: `background.${ext}` });
      showPage("page-farm-area");
    };
    reader.readAsDataURL(file);
  } else {
    state.bgDataUrl = null;
    await postJson("/api/background", { image: null });
    showPage("page-farm-area");
  }
});

importFarmBtn.addEventListener("click", async () => {
  const file = importFarmFile.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const b64 = reader.result.split(",")[1];
      const data = await postJson("/api/import", { data: b64 }, { timeoutMs: 30000 });

      state.width = data.grid.width;
      state.height = data.grid.height;
      state.cells = data.grid.cells;

      const meta = data.metadata || {};
      if (meta.cellSize) state.cellSize = meta.cellSize;
      if (meta.bgOpacity !== undefined) state.bgOpacity = meta.bgOpacity;
      if (meta.bgImgWidth) state.bgImgWidth = meta.bgImgWidth;
      if (meta.selectedPlants) selectedPlants = meta.selectedPlants;
      if (meta.selectedPlotId) selectedPlotId = meta.selectedPlotId;
      if (meta.plotMeta) plotMeta = meta.plotMeta;

      if (data.background) {
        state.bgDataUrl = data.background;
      } else {
        state.bgDataUrl = null;
      }

      // Ensure plot meta for existing plots
      const plots = getPlotInfo();
      for (const id of Object.keys(plots)) ensurePlotMeta(Number(id));

      await fetchHistory();
      showPage("page-main");
    } catch (e) {
      alert(`Import error: ${e.message}`);
    }
  };
  reader.readAsDataURL(file);
});

// ===================================================================
// PAGE 2: FARM AREA SELECTION
// ===================================================================

const farmAreaGrid = document.getElementById("farm-area-grid");
const farmAreaBgImg = document.getElementById("farm-area-bg-img");
const gridIncrease = document.getElementById("grid-increase");
const gridDecrease = document.getElementById("grid-decrease");
const farmAreaProceed = document.getElementById("farm-area-proceed");

function renderFarmAreaGrid() {
  setGridLayout(farmAreaGrid);
  farmAreaGrid.innerHTML = "";
  for (let r = 0; r < state.height; r++) {
    for (let c = 0; c < state.width; c++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.row = r;
      cell.dataset.col = c;
      cell.dataset.grid = "farm-area";
      const v = state.cells[r][c];
      cell.classList.add(v === 255 ? "invalid" : "farm-cell");
      farmAreaGrid.appendChild(cell);
    }
  }
  updateBgImage(farmAreaBgImg);
}

// Toggle cell on click for farm area
farmAreaGrid.addEventListener("pointerdown", (e) => {
  const cell = e.target.closest(".cell");
  if (!cell) return;
  isPainting = true;
  activeGrid = "farm-area";
  farmAreaBrush(cell);
});

farmAreaGrid.addEventListener("pointerover", (e) => {
  if (!isPainting || activeGrid !== "farm-area") return;
  const cell = e.target.closest(".cell");
  if (cell) farmAreaBrush(cell);
});

function farmAreaBrush(el) {
  const r = +el.dataset.row, c = +el.dataset.col;
  const current = state.cells[r][c];
  // Toggle: if invalid make farm, if farm make invalid
  const newVal = current === 255 ? 0 : 255;
  state.cells[r][c] = newVal;
  el.classList.remove("invalid", "farm-cell");
  el.classList.add(newVal === 255 ? "invalid" : "farm-cell");
  queueCell(r, c, newVal);
}

gridIncrease.addEventListener("click", async () => {
  const newW = state.width + 1;
  const newH = state.height + 1;
  const data = await postJson("/api/grid", { width: newW, height: newH, fill: 255 });
  // Preserve existing cells
  const oldCells = state.cells.map(row => [...row]);
  state.width = data.width;
  state.height = data.height;
  state.cells = data.cells;
  // Copy old data back
  const paintCells = [];
  for (let r = 0; r < Math.min(oldCells.length, state.height); r++) {
    for (let c = 0; c < Math.min(oldCells[r].length, state.width); c++) {
      if (oldCells[r][c] !== 255) {
        state.cells[r][c] = oldCells[r][c];
        paintCells.push({ row: r, col: c, value: oldCells[r][c] });
      }
    }
  }
  if (paintCells.length > 0) {
    await postJson("/api/paint", { cells: paintCells });
  }
  renderFarmAreaGrid();
});

gridDecrease.addEventListener("click", async () => {
  if (state.width <= 2 || state.height <= 2) return;
  const newW = state.width - 1;
  const newH = state.height - 1;
  const data = await postJson("/api/grid", { width: newW, height: newH, fill: 255 });
  const oldCells = state.cells.map(row => [...row]);
  state.width = data.width;
  state.height = data.height;
  state.cells = data.cells;
  const paintCells = [];
  for (let r = 0; r < state.height; r++) {
    for (let c = 0; c < state.width; c++) {
      if (r < oldCells.length && c < oldCells[r].length && oldCells[r][c] !== 255) {
        state.cells[r][c] = oldCells[r][c];
        paintCells.push({ row: r, col: c, value: oldCells[r][c] });
      }
    }
  }
  if (paintCells.length > 0) {
    await postJson("/api/paint", { cells: paintCells });
  }
  renderFarmAreaGrid();
});

farmAreaProceed.addEventListener("click", () => {
  showPage("page-plots");
});

// ===================================================================
// PAGE 3: PLOT DELINEATION
// ===================================================================

const plotsGrid = document.getElementById("plots-grid");
const plotsBgImg = document.getElementById("plots-bg-img");
const plotLegend = document.getElementById("plot-legend");
const addPlotBtn = document.getElementById("add-plot-btn");
const clearCellBtn = document.getElementById("clear-cell-btn");
const plotsProceed = document.getElementById("plots-proceed");

function renderPlotsGrid() {
  setGridLayout(plotsGrid);
  plotsGrid.innerHTML = "";
  for (let r = 0; r < state.height; r++) {
    for (let c = 0; c < state.width; c++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.row = r;
      cell.dataset.col = c;
      cell.dataset.grid = "plots";
      const v = state.cells[r][c];
      if (v === 255) {
        cell.classList.add("invalid");
      } else if (v === 0) {
        cell.classList.add("unassigned");
      } else {
        cell.classList.add("plot");
        cell.style.backgroundColor = plotColor(v);
        cell.textContent = plotName(v).substring(0, 3);
        if (v === selectedPlotId) cell.classList.add("plot-selected");
      }
      plotsGrid.appendChild(cell);
    }
  }
  updateBgImage(plotsBgImg);
}

function renderPlotLegend() {
  const plots = getPlotInfo();
  const ids = Object.keys(plots).map(Number).sort((a, b) => a - b);
  plotLegend.innerHTML = "";

  for (const id of ids) {
    ensurePlotMeta(id);
    const item = document.createElement("div");
    item.className = "plot-legend-item";
    if (!clearMode && id === selectedPlotId) item.classList.add("selected");

    const swatch = document.createElement("div");
    swatch.className = "plot-swatch";
    swatch.style.backgroundColor = plotColor(id);
    item.appendChild(swatch);

    const nameSpan = document.createElement("span");
    nameSpan.className = "plot-name";
    nameSpan.textContent = plotName(id);
    nameSpan.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      // Replace with input for renaming
      const input = document.createElement("input");
      input.className = "plot-name-input";
      input.value = plotName(id);
      input.addEventListener("blur", () => {
        plotMeta[id].name = input.value || `Plot ${id}`;
        renderPlotLegend();
        renderPlotsGrid();
      });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") input.blur();
      });
      nameSpan.replaceWith(input);
      input.focus();
      input.select();
    });
    item.appendChild(nameSpan);

    const countEl = document.createElement("small");
    countEl.textContent = `${plots[id]}`;
    item.appendChild(countEl);

    item.addEventListener("click", () => {
      clearMode = false;
      selectedPlotId = id;
      renderPlotLegend();
      renderPlotsGrid();
    });

    plotLegend.appendChild(item);
  }

  if (ids.length === 0) {
    plotLegend.innerHTML = '<div style="font-size:12px;color:#636e72;padding:8px">No plots yet. Click "Add New Plot" to start.</div>';
  }

  // Update clear button style
  clearCellBtn.classList.toggle("btn-danger", clearMode);
}

addPlotBtn.addEventListener("click", () => {
  const nextId = getNextPlotId();
  if (!nextId) return;
  ensurePlotMeta(nextId);
  selectedPlotId = nextId;
  clearMode = false;
  // We need at least one cell to show it in the legend, so just select it
  renderPlotLegend();
  renderPlotsGrid();
});

clearCellBtn.addEventListener("click", () => {
  clearMode = !clearMode;
  if (clearMode) selectedPlotId = null;
  renderPlotLegend();
});

// Plot painting
plotsGrid.addEventListener("pointerdown", (e) => {
  const cell = e.target.closest(".cell");
  if (!cell) return;
  isPainting = true;
  activeGrid = "plots";
  plotsBrush(cell);
});

plotsGrid.addEventListener("pointerover", (e) => {
  if (!isPainting || activeGrid !== "plots") return;
  const cell = e.target.closest(".cell");
  if (cell) plotsBrush(cell);
});

function plotsBrush(el) {
  const r = +el.dataset.row, c = +el.dataset.col;
  const current = state.cells[r][c];
  if (current === 255) return; // can't paint on non-farm cells

  let v;
  if (clearMode) {
    v = 0;
  } else if (selectedPlotId) {
    v = selectedPlotId;
  } else {
    return;
  }

  if (current === v) return;
  state.cells[r][c] = v;
  queueCell(r, c, v);

  // Update cell visually
  el.classList.remove("invalid", "unassigned", "plot", "plot-selected");
  el.style.backgroundColor = "";
  el.textContent = "";
  if (v === 0) {
    el.classList.add("unassigned");
  } else {
    el.classList.add("plot");
    el.style.backgroundColor = plotColor(v);
    el.textContent = plotName(v).substring(0, 3);
    if (v === selectedPlotId) el.classList.add("plot-selected");
  }
}

plotsProceed.addEventListener("click", async () => {
  await flushPending();
  await fetchHistory();
  showPage("page-main");
});

// ===================================================================
// PAGE 4: MAIN PAGE
// ===================================================================

const mainGrid = document.getElementById("main-grid");
const notesContent = document.getElementById("notes-content");
const historyTree = document.getElementById("history-tree");
const openSuggestions = document.getElementById("open-suggestions");

function renderMainGrid(snapshot = null) {
  setGridLayout(mainGrid);
  mainGrid.innerHTML = "";

  for (let r = 0; r < state.height; r++) {
    for (let c = 0; c < state.width; c++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.row = r;
      cell.dataset.col = c;
      const v = state.cells[r][c];

      if (v === 255) {
        cell.classList.add("invalid");
      } else if (v === 0) {
        cell.classList.add("unassigned");
      } else {
        // Check if there's a plant in the snapshot
        const plant = snapshot ? snapshot[String(v)] : null;
        if (plant) {
          cell.classList.add("planted");
          cell.style.backgroundColor = plantColor(plant);
          cell.textContent = plant.substring(0, 4);
          cell.title = `${plotName(v)}: ${plant}`;
        } else {
          cell.classList.add("plot");
          cell.style.backgroundColor = plotColor(v);
          cell.textContent = plotName(v).substring(0, 3);
          cell.title = plotName(v);
        }

        if (v === highlightedPlotId) cell.classList.add("plot-highlighted");

        cell.addEventListener("click", () => {
          highlightedPlotId = (highlightedPlotId === v) ? null : v;
          renderMainGrid(snapshot);
          updatePlotNotes(snapshot);
        });
      }

      mainGrid.appendChild(cell);
    }
  }
}

function updatePlotNotes(snapshot = null) {
  if (!highlightedPlotId) {
    notesContent.textContent = "Select a plot to view details.";
    return;
  }

  const id = highlightedPlotId;
  let html = `<strong>${plotName(id)}</strong>`;

  // Count cells
  const plots = getPlotInfo();
  const cellCount = plots[id] || 0;
  html += `<br><span style="color:#636e72">${cellCount} cells</span>`;

  // If there's a plan, show what's planted
  if (currentPlan && currentPlan.timeline && currentPlan.timeline[String(id)]) {
    const entries = currentPlan.timeline[String(id)];
    if (entries.length > 0) {
      html += `<br><br><strong>Planting Schedule:</strong>`;
      for (const e of entries) {
        html += `<div class="note-plant">
          <span class="note-plant-chip" style="background:${plantColor(e.plant)}">${e.plant}</span>
          <span style="font-size:11px;color:#636e72">${e.start} to ${e.end}</span>
        </div>`;
      }
    }
  }

  // Check snapshot for current state
  if (snapshot && snapshot[String(id)]) {
    html += `<br><strong>Currently growing:</strong> ${snapshot[String(id)]}`;
  }

  notesContent.innerHTML = html;
}

function renderHistoryTree() {
  historyTree.innerHTML = "";

  if (historyPlans.length === 0) {
    historyTree.innerHTML = '<div style="font-size:12px;color:#636e72;padding:8px">No history yet. Run the planner from the Suggestions page.</div>';
    return;
  }

  for (const plan of historyPlans) {
    const year = plan.year;
    const yearEl = document.createElement("div");
    yearEl.className = "history-year";
    yearEl.innerHTML = `<span class="arrow">&#9654;</span> ${year}`;

    const datesEl = document.createElement("div");
    datesEl.className = "history-dates";

    // Collect significant dates from timeline
    const dates = new Set();
    if (plan.timeline) {
      for (const entries of Object.values(plan.timeline)) {
        for (const e of entries) {
          dates.add(e.start);
          dates.add(e.end);
        }
      }
    }
    const sortedDates = [...dates].sort();

    for (const dateStr of sortedDates) {
      const dateItem = document.createElement("div");
      dateItem.className = "history-date-item";
      dateItem.textContent = dateStr;
      if (dateStr === activeHistoryDate) dateItem.classList.add("active");

      dateItem.addEventListener("click", () => {
        activeHistoryDate = dateStr;
        currentPlan = plan;
        const snap = getSnapshot(plan.timeline, dateStr);
        renderMainGrid(snap);
        renderHistoryTree();
        updatePlotNotes(snap);
      });

      datesEl.appendChild(dateItem);
    }

    yearEl.addEventListener("click", () => {
      yearEl.classList.toggle("expanded");
      datesEl.classList.toggle("open");
    });

    historyTree.appendChild(yearEl);
    historyTree.appendChild(datesEl);
  }
}

function getSnapshot(timeline, dateStr) {
  const snap = {};
  for (const [plotId, entries] of Object.entries(timeline)) {
    snap[plotId] = null;
    for (const e of entries) {
      if (dateStr >= e.start && dateStr < e.end) {
        snap[plotId] = e.plant;
        break;
      }
    }
  }
  return snap;
}

openSuggestions.addEventListener("click", () => {
  showPage("page-suggestions");
});

// ===================================================================
// PAGE 5: SUGGESTIONS
// ===================================================================

const suggestionsSlider = document.getElementById("suggestions-slider");
const suggestionsDate = document.getElementById("suggestions-date");
const closeSuggestions = document.getElementById("close-suggestions");
const plantSearch = document.getElementById("plant-search");
const plantSelect = document.getElementById("plant-select");
const addPlantBtnEl = document.getElementById("add-plant-btn");
const plantListEl = document.getElementById("plant-list");
const runPlannerBtn = document.getElementById("run-planner-btn");
const planStatusEl = document.getElementById("plan-status");
const suggestionsGrid = document.getElementById("suggestions-grid");

function renderPlantSelect(filter = "") {
  plantSelect.innerHTML = "";
  const lf = filter.toLowerCase();
  for (const p of availablePlants) {
    if (lf && !p.toLowerCase().includes(lf)) continue;
    if (selectedPlants.includes(p)) continue;
    const opt = document.createElement("option");
    opt.value = p;
    opt.textContent = p;
    plantSelect.appendChild(opt);
  }
}

function renderPlantList() {
  plantListEl.innerHTML = "";
  selectedPlants.forEach((name, i) => {
    const item = document.createElement("div");
    item.className = "plant-item";
    item.draggable = true;
    item.dataset.index = i;

    const rank = document.createElement("span");
    rank.className = "plant-rank";
    rank.textContent = `${i + 1}.`;
    item.appendChild(rank);

    const dot = document.createElement("span");
    dot.className = "plant-color-dot";
    dot.style.backgroundColor = plantColor(name);
    item.appendChild(dot);

    const nameEl = document.createElement("span");
    nameEl.className = "plant-name";
    nameEl.textContent = name;
    item.appendChild(nameEl);

    const del = document.createElement("button");
    del.className = "plant-delete";
    del.innerHTML = "&#x2715;";
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      selectedPlants.splice(i, 1);
      renderPlantList();
      renderPlantSelect(plantSearch.value);
    });
    item.appendChild(del);

    // Drag and drop
    item.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", String(i));
    });
    item.addEventListener("dragover", (e) => {
      e.preventDefault();
      item.classList.add("drag-over");
    });
    item.addEventListener("dragleave", () => item.classList.remove("drag-over"));
    item.addEventListener("drop", (e) => {
      e.preventDefault();
      item.classList.remove("drag-over");
      const from = +e.dataTransfer.getData("text/plain");
      if (from === i) return;
      const [moved] = selectedPlants.splice(from, 1);
      selectedPlants.splice(i, 0, moved);
      renderPlantList();
    });

    plantListEl.appendChild(item);
  });
}

plantSearch.addEventListener("input", () => {
  renderPlantSelect(plantSearch.value);
});

addPlantBtnEl.addEventListener("click", () => {
  const name = plantSelect.value;
  if (!name || selectedPlants.includes(name)) return;
  selectedPlants.push(name);
  renderPlantList();
  renderPlantSelect(plantSearch.value);
});

// Double-click to add from select
plantSelect.addEventListener("dblclick", () => {
  const name = plantSelect.value;
  if (!name || selectedPlants.includes(name)) return;
  selectedPlants.push(name);
  renderPlantList();
  renderPlantSelect(plantSearch.value);
});

runPlannerBtn.addEventListener("click", async () => {
  if (selectedPlants.length === 0) {
    planStatusEl.textContent = "Select at least one plant first.";
    return;
  }
  planStatusEl.textContent = "Running planner...";
  runPlannerBtn.disabled = true;
  try {
    currentPlan = await postJson("/api/plan", {
      plants: selectedPlants,
      year: new Date().getFullYear(),
      start_month: 1,
    });
    planStatusEl.textContent = `Score: ${currentPlan.score} | Assigned: ${currentPlan.assigned.length}/${currentPlan.selected_plants.length}`;
    if (currentPlan.unassigned_plants.length > 0) {
      planStatusEl.textContent += ` | Could not fit: ${currentPlan.unassigned_plants.join(", ")}`;
    }
    // Refresh history
    await fetchHistory();
    // Update grid with day 0 snapshot
    suggestionsSlider.value = 0;
    updateSuggestionsGrid();
  } catch (e) {
    planStatusEl.textContent = `Error: ${e.message}`;
  } finally {
    runPlannerBtn.disabled = false;
  }
});

function renderSuggestionsGrid() {
  updateSuggestionsGrid();
}

function updateSuggestionsGrid() {
  setGridLayout(suggestionsGrid);
  suggestionsGrid.innerHTML = "";

  const year = currentPlan ? currentPlan.year : new Date().getFullYear();
  const d = dayToDate(+suggestionsSlider.value, year);
  suggestionsDate.textContent = fmtDate(d);

  // Update slider gradient (green for past, black for future)
  const pct = (suggestionsSlider.value / 364) * 100;
  suggestionsSlider.style.background = `linear-gradient(to right, #679436 0%, #679436 ${pct}%, #222 ${pct}%, #222 100%)`;

  let snap = null;
  if (currentPlan && currentPlan.timeline) {
    snap = getSnapshot(currentPlan.timeline, isoDate(d));
  }

  for (let r = 0; r < state.height; r++) {
    for (let c = 0; c < state.width; c++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      const v = state.cells[r][c];

      if (v === 255) {
        cell.classList.add("invalid");
      } else if (v === 0) {
        cell.classList.add("unassigned");
      } else {
        const plant = snap ? snap[String(v)] : null;
        if (plant) {
          cell.classList.add("planted");
          cell.style.backgroundColor = plantColor(plant);
          cell.textContent = plant.substring(0, 4);
          cell.title = `${plotName(v)}: ${plant}`;
        } else {
          cell.classList.add("plot-empty");
          cell.style.backgroundColor = "";
          cell.textContent = plotName(v).substring(0, 3);
          cell.title = `${plotName(v)}: empty`;
        }
      }

      suggestionsGrid.appendChild(cell);
    }
  }
}

suggestionsSlider.addEventListener("input", updateSuggestionsGrid);

closeSuggestions.addEventListener("click", async () => {
  await fetchHistory();
  showPage("page-main");
});

// ===================================================================
// Shared pointer up handler
// ===================================================================

window.addEventListener("pointerup", () => {
  if (isPainting) {
    isPainting = false;
    activeGrid = null;
    flushPending().catch(() => {});
    // Refresh plot legend counts
    const activePage = document.querySelector(".page.active");
    if (activePage && activePage.id === "page-plots") {
      renderPlotLegend();
    }
  }
});

// ===================================================================
// .farm file handling
// ===================================================================

const downloadFarmBtn = document.getElementById("download-farm");
const uploadFarmBtn = document.getElementById("upload-farm-btn");
const uploadFarmInput = document.getElementById("upload-farm-input");
const fileStatus = document.getElementById("file-status");

downloadFarmBtn.addEventListener("click", async () => {
  fileStatus.textContent = "Exporting...";
  try {
    await flushPending();
    const metadata = {
      cellSize: state.cellSize,
      bgOpacity: state.bgOpacity,
      bgImgWidth: state.bgImgWidth,
      selectedPlants,
      plotMeta,
      selectedPlotId,
    };
    const grid = { width: state.width, height: state.height, cells: state.cells };
    const blob = await fetchBlobWithTimeout("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metadata, grid }),
    }, 30000);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "farm.farm";
    a.click();
    URL.revokeObjectURL(url);
    fileStatus.textContent = "Downloaded!";
  } catch (e) {
    fileStatus.textContent = `Error: ${e.message}`;
  }
});

uploadFarmBtn.addEventListener("click", () => uploadFarmInput.click());

uploadFarmInput.addEventListener("change", async () => {
  const file = uploadFarmInput.files[0];
  if (!file) return;
  fileStatus.textContent = "Importing...";
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const b64 = reader.result.split(",")[1];
      const data = await postJson("/api/import", { data: b64 }, { timeoutMs: 30000 });
      state.width = data.grid.width;
      state.height = data.grid.height;
      state.cells = data.grid.cells;
      const meta = data.metadata || {};
      if (meta.cellSize) state.cellSize = meta.cellSize;
      if (meta.bgOpacity !== undefined) state.bgOpacity = meta.bgOpacity;
      if (meta.bgImgWidth) state.bgImgWidth = meta.bgImgWidth;
      if (meta.selectedPlants) selectedPlants = meta.selectedPlants;
      if (meta.selectedPlotId) selectedPlotId = meta.selectedPlotId;
      if (meta.plotMeta) plotMeta = meta.plotMeta;
      if (data.background) state.bgDataUrl = data.background;
      else state.bgDataUrl = null;

      const plots = getPlotInfo();
      for (const id of Object.keys(plots)) ensurePlotMeta(Number(id));

      await fetchHistory();
      renderMainGrid();
      renderHistoryTree();
      fileStatus.textContent = "Imported!";
    } catch (e) {
      fileStatus.textContent = `Error: ${e.message}`;
    }
  };
  reader.readAsDataURL(file);
  uploadFarmInput.value = "";
});

// ===================================================================
// Initialization
// ===================================================================

(async () => {
  injectIcons();
  await fetchGrid();
  await fetchPlants();
  await fetchHistory();

  // Check for existing background
  try {
    const bgData = await (await fetch("/api/background")).json();
    if (bgData.image) {
      state.bgDataUrl = bgData.image;
      state.bgImgWidth = Math.min(600, window.innerWidth - 100);
    }
  } catch {}

  // If there's existing data (plots), go to main page
  const plots = getPlotInfo();
  const hasFarmCells = state.cells.some(row => row.some(v => v !== 255));
  const hasPlots = Object.keys(plots).length > 0;

  if (hasPlots) {
    showPage("page-main");
  } else if (hasFarmCells) {
    showPage("page-plots");
  } else {
    showPage("page-start");
  }
})();
