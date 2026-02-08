// ===================================================================
// DOM refs
// ===================================================================

// Tabs
const tabs = document.querySelectorAll(".tab");
const views = document.querySelectorAll(".view");

// Farm Shape view
const widthInput      = document.getElementById("grid-width");
const heightInput     = document.getElementById("grid-height");
const createBtn       = document.getElementById("create-grid");
const cellSizeInput   = document.getElementById("cell-size");
const shapeGridEl     = document.getElementById("shape-grid");
const shapeBgImg      = document.getElementById("shape-bg-img");
const bgUploadBtn     = document.getElementById("bg-upload-btn");
const bgFileInput     = document.getElementById("bg-file-input");
const bgClearBtn      = document.getElementById("bg-clear-btn");
const bgOpacityInput  = document.getElementById("bg-opacity");

// Plot Assignment view
const plotListEl      = document.getElementById("plot-list");
const addPlotBtn      = document.getElementById("add-plot-btn");
const autoAssignBtn   = document.getElementById("auto-assign-btn");
const plotGridEl      = document.getElementById("plot-grid");
const plotBgImg       = document.getElementById("plot-bg-img");
const plotPaintHint   = document.getElementById("plot-paint-hint");

// Main / Planner view
const plantSelect     = document.getElementById("plant-select");
const addPlantBtn     = document.getElementById("add-plant");
const plantListEl     = document.getElementById("plant-list");
const planYearInput   = document.getElementById("plan-year");
const startMonthSel   = document.getElementById("start-month");
const runPlannerBtn   = document.getElementById("run-planner");
const planStatus      = document.getElementById("plan-status");

// Results
const resultsSection  = document.getElementById("results-section");
const planSummary     = document.getElementById("plan-summary");
const dateSlider      = document.getElementById("date-slider");
const currentDateEl   = document.getElementById("current-date");
const timelineGridEl  = document.getElementById("timeline-grid");
const plotTimelinesEl = document.getElementById("plot-timelines");
const adjEventsEl     = document.getElementById("adjacency-events");
const compatMatrixEl  = document.getElementById("compat-matrix");

// File controls
const downloadFarmBtn = document.getElementById("download-farm");
const uploadFarmBtn   = document.getElementById("upload-farm-btn");
const uploadFarmInput = document.getElementById("upload-farm-input");
const fileStatus      = document.getElementById("file-status");

// ===================================================================
// State
// ===================================================================

let state = {
  width: 0,
  height: 0,
  cells: [],
  cellSize: 26,
  bgOpacity: 30,
  bgDataUrl: null,
};

let shapeTool  = "brush";
let shapePaint = "farm";     // "farm" | "not-farm"
let plotTool   = "brush";
let plotPaint  = "plot";     // "plot" | "unassign"

let selectedPlotId = 1;
let selectedPlants = [];
let currentPlan    = null;
let isPainting     = false;
let activeGrid     = null;   // "shape" | "plot"
let pending        = new Map();
let flushTimer     = null;

// ===================================================================
// Helpers
// ===================================================================

async function postJson(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

function plotColor(id) {
  return `hsl(${(id * 47) % 360}, 65%, 75%)`;
}

function plantColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return `hsl(${h % 360}, 55%, 75%)`;
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
      if (v >= 1 && v <= 254) {
        plots[v] = (plots[v] || 0) + 1;
      }
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

// ===================================================================
// Tab switching
// ===================================================================

function switchView(viewName) {
  tabs.forEach(t => t.classList.toggle("active", t.dataset.view === viewName));
  views.forEach(v => v.classList.toggle("active", v.id === `view-${viewName}`));

  if (viewName === "farm-shape") renderShapeGrid();
  if (viewName === "plots") { renderPlotGrid(); renderPlotList(); }
}

tabs.forEach(tab => {
  tab.addEventListener("click", () => switchView(tab.dataset.view));
});

// ===================================================================
// Server communication
// ===================================================================

async function fetchGrid() {
  const data = await (await fetch("/api/grid")).json();
  state.width = data.width;
  state.height = data.height;
  state.cells = data.cells;
  widthInput.value = data.width;
  heightInput.value = data.height;
}

function queueCell(row, col, value) {
  pending.set(`${row},${col}`, { row, col, value });
  if (!flushTimer) flushTimer = setTimeout(flushPending, 120);
}

async function flushPending() {
  clearTimeout(flushTimer);
  flushTimer = null;
  if (pending.size === 0) return;
  const cells = [...pending.values()];
  pending.clear();
  await postJson("/api/paint", { cells });
}

// ===================================================================
// Grid rendering helpers
// ===================================================================

function setGridLayout(gridEl) {
  const cs = state.cellSize;
  gridEl.style.setProperty("--cell-size", `${cs}px`);
  gridEl.style.gridTemplateColumns = `repeat(${state.width}, var(--cell-size))`;
}

function updateBgImages() {
  const opacity = state.bgOpacity / 100;
  for (const img of [shapeBgImg, plotBgImg]) {
    if (state.bgDataUrl) {
      img.src = state.bgDataUrl;
      img.style.display = "block";
      img.style.opacity = opacity;
    } else {
      img.style.display = "none";
    }
  }
}

// ===================================================================
// Farm Shape view: render + paint
// ===================================================================

function renderShapeGrid() {
  setGridLayout(shapeGridEl);
  shapeGridEl.innerHTML = "";

  for (let r = 0; r < state.height; r++) {
    for (let c = 0; c < state.width; c++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.row = r;
      cell.dataset.col = c;
      cell.dataset.grid = "shape";

      const v = state.cells[r][c];
      if (v === 255) {
        cell.classList.add("invalid");
      } else {
        cell.classList.add("farm-cell");
      }
      shapeGridEl.appendChild(cell);
    }
  }
  updateBgImages();
}

function shapeHandleBrush(el) {
  const r = +el.dataset.row, c = +el.dataset.col;
  const current = state.cells[r][c];

  if (shapePaint === "farm") {
    if (current === 255) {
      state.cells[r][c] = 0;
      applyCellShape(el, 0);
      queueCell(r, c, 0);
    }
  } else {
    if (current !== 255) {
      state.cells[r][c] = 255;
      applyCellShape(el, 255);
      queueCell(r, c, 255);
    }
  }
}

async function shapeHandleFill(el) {
  const v = shapePaint === "farm" ? 0 : 255;
  const data = await postJson("/api/fill", {
    row: +el.dataset.row, col: +el.dataset.col, value: v,
  });
  state.cells = data.cells;
  renderShapeGrid();
}

function applyCellShape(el, v) {
  el.classList.remove("invalid", "farm-cell");
  el.classList.add(v === 255 ? "invalid" : "farm-cell");
}

// ===================================================================
// Plot Assignment view: render + paint
// ===================================================================

function renderPlotGrid() {
  setGridLayout(plotGridEl);
  plotGridEl.innerHTML = "";

  for (let r = 0; r < state.height; r++) {
    for (let c = 0; c < state.width; c++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.row = r;
      cell.dataset.col = c;
      cell.dataset.grid = "plot";

      const v = state.cells[r][c];
      if (v === 255) {
        cell.classList.add("invalid");
      } else if (v === 0) {
        cell.classList.add("unassigned");
      } else {
        cell.classList.add("plot");
        cell.textContent = v;
        cell.style.backgroundColor = plotColor(v);
        if (v === selectedPlotId) cell.classList.add("plot-selected");
      }
      plotGridEl.appendChild(cell);
    }
  }
  updateBgImages();
}

function renderPlotList() {
  const plots = getPlotInfo();
  const ids = Object.keys(plots).map(Number).sort((a, b) => a - b);

  plotListEl.innerHTML = "";
  for (const id of ids) {
    const item = document.createElement("div");
    item.className = "plot-item" + (id === selectedPlotId ? " selected" : "");
    item.innerHTML =
      `<span class="plot-swatch" style="background:${plotColor(id)}"></span>` +
      `Plot ${id} <small>(${plots[id]} cells)</small>`;
    item.addEventListener("click", () => {
      selectedPlotId = id;
      renderPlotList();
      renderPlotGrid();
    });
    plotListEl.appendChild(item);
  }

  if (ids.length === 0) {
    plotListEl.innerHTML =
      '<div class="hint">No plots yet. Click "+ New Plot" to start.</div>';
  }
}

function plotHandleBrush(el) {
  const r = +el.dataset.row, c = +el.dataset.col;
  const current = state.cells[r][c];
  if (current === 255) return; // can't paint on non-farm cells

  const v = plotPaint === "plot" ? selectedPlotId : 0;
  if (current === v) return;

  state.cells[r][c] = v;
  applyCellPlot(el, v);
  queueCell(r, c, v);
}

async function plotHandleFill(el) {
  const current = state.cells[+el.dataset.row][+el.dataset.col];
  if (current === 255) return;

  const v = plotPaint === "plot" ? selectedPlotId : 0;
  const data = await postJson("/api/fill", {
    row: +el.dataset.row, col: +el.dataset.col, value: v,
  });
  state.cells = data.cells;
  renderPlotGrid();
  renderPlotList();
}

function applyCellPlot(el, v) {
  el.classList.remove("invalid", "unassigned", "plot", "plot-selected");
  el.style.backgroundColor = "";
  el.textContent = "";

  if (v === 255) {
    el.classList.add("invalid");
  } else if (v === 0) {
    el.classList.add("unassigned");
  } else {
    el.classList.add("plot");
    el.textContent = v;
    el.style.backgroundColor = plotColor(v);
    if (v === selectedPlotId) el.classList.add("plot-selected");
  }
}

// ===================================================================
// Unified pointer events for painting
// ===================================================================

function cellFromEvent(e) {
  return e.target.classList.contains("cell") ? e.target : null;
}

function handlePointerDown(e) {
  const cell = cellFromEvent(e);
  if (!cell) return;
  const g = cell.dataset.grid;

  if (g === "shape") {
    if (shapeTool === "fill") { shapeHandleFill(cell); return; }
    isPainting = true;
    activeGrid = "shape";
    shapeHandleBrush(cell);
  } else if (g === "plot") {
    if (plotTool === "fill") { plotHandleFill(cell); return; }
    isPainting = true;
    activeGrid = "plot";
    plotHandleBrush(cell);
  }
}

function handlePointerOver(e) {
  if (!isPainting) return;
  const cell = cellFromEvent(e);
  if (!cell) return;
  if (activeGrid === "shape" && cell.dataset.grid === "shape") shapeHandleBrush(cell);
  if (activeGrid === "plot"  && cell.dataset.grid === "plot")  plotHandleBrush(cell);
}

function handlePointerUp() {
  if (isPainting) {
    isPainting = false;
    activeGrid = null;
    flushPending();
  }
}

shapeGridEl.addEventListener("pointerdown", handlePointerDown);
shapeGridEl.addEventListener("pointerover", handlePointerOver);
plotGridEl.addEventListener("pointerdown", handlePointerDown);
plotGridEl.addEventListener("pointerover", handlePointerOver);
window.addEventListener("pointerup", handlePointerUp);

// ===================================================================
// Farm Shape controls
// ===================================================================

createBtn.addEventListener("click", async () => {
  const data = await postJson("/api/grid", {
    width: +widthInput.value || 1,
    height: +heightInput.value || 1,
    fill: 255, // all invalid; user paints farm area
  });
  state.width = data.width;
  state.height = data.height;
  state.cells = data.cells;
  renderShapeGrid();
});

cellSizeInput.addEventListener("input", () => {
  state.cellSize = +cellSizeInput.value;
  const active = document.querySelector(".view.active");
  if (active.id === "view-farm-shape") renderShapeGrid();
  else if (active.id === "view-plots")  renderPlotGrid();
});

for (const inp of document.querySelectorAll("input[name='shape-tool']"))
  inp.addEventListener("change", () => { shapeTool = inp.value; });
for (const inp of document.querySelectorAll("input[name='shape-paint']"))
  inp.addEventListener("change", () => { shapePaint = inp.value; });

// ===================================================================
// Plot Assignment controls
// ===================================================================

for (const inp of document.querySelectorAll("input[name='plot-tool']"))
  inp.addEventListener("change", () => { plotTool = inp.value; });
for (const inp of document.querySelectorAll("input[name='plot-paint']"))
  inp.addEventListener("change", () => { plotPaint = inp.value; });

addPlotBtn.addEventListener("click", () => {
  const nextId = getNextPlotId();
  if (nextId === null) {
    plotPaintHint.textContent = "Maximum 254 plots reached!";
    return;
  }
  selectedPlotId = nextId;
  plotPaintHint.textContent = `Plot ${nextId} created. Paint on farm cells to assign.`;
  renderPlotList();
  renderPlotGrid();
});

autoAssignBtn.addEventListener("click", async () => {
  const data = await postJson("/api/auto-assign", {});
  state.width = data.width;
  state.height = data.height;
  state.cells = data.cells;
  renderPlotGrid();
  renderPlotList();
});

// ===================================================================
// Background Image
// ===================================================================

bgUploadBtn.addEventListener("click", () => bgFileInput.click());

bgFileInput.addEventListener("change", async () => {
  const file = bgFileInput.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async () => {
    state.bgDataUrl = reader.result;
    bgClearBtn.style.display = "";
    updateBgImages();

    const ext = file.name.split(".").pop() || "png";
    await postJson("/api/background", {
      image: reader.result,
      filename: `background.${ext}`,
    });
  };
  reader.readAsDataURL(file);
});

bgClearBtn.addEventListener("click", async () => {
  state.bgDataUrl = null;
  bgClearBtn.style.display = "none";
  updateBgImages();
  await postJson("/api/background", { image: null });
});

bgOpacityInput.addEventListener("input", () => {
  state.bgOpacity = +bgOpacityInput.value;
  updateBgImages();
});

document.addEventListener("paste", (e) => {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      e.preventDefault();
      const file = item.getAsFile();
      const reader = new FileReader();
      reader.onload = async () => {
        state.bgDataUrl = reader.result;
        bgClearBtn.style.display = "";
        updateBgImages();
        const ext = file.type.split("/")[1] || "png";
        await postJson("/api/background", {
          image: reader.result,
          filename: `background.${ext}`,
        });
      };
      reader.readAsDataURL(file);
      return;
    }
  }
});

// ===================================================================
// Plant selection
// ===================================================================

async function fetchPlants() {
  const data = await (await fetch("/api/plants")).json();
  plantSelect.innerHTML = "";
  for (const p of data.plants) {
    const opt = document.createElement("option");
    opt.value = p; opt.textContent = p;
    plantSelect.appendChild(opt);
  }
}

function renderPlantList() {
  plantListEl.innerHTML = "";
  selectedPlants.forEach((name, i) => {
    const li = document.createElement("li");
    li.draggable = true;
    li.dataset.index = i;

    const label = document.createElement("span");
    label.className = "plant-name";
    label.textContent = `${i + 1}. ${name}`;
    label.style.borderLeft = `4px solid ${plantColor(name)}`;
    li.appendChild(label);

    const upBtn = document.createElement("button");
    upBtn.textContent = "\u25B2"; upBtn.className = "sm";
    upBtn.disabled = i === 0;
    upBtn.onclick = () => {
      [selectedPlants[i - 1], selectedPlants[i]] = [selectedPlants[i], selectedPlants[i - 1]];
      renderPlantList();
    };
    li.appendChild(upBtn);

    const downBtn = document.createElement("button");
    downBtn.textContent = "\u25BC"; downBtn.className = "sm";
    downBtn.disabled = i === selectedPlants.length - 1;
    downBtn.onclick = () => {
      [selectedPlants[i], selectedPlants[i + 1]] = [selectedPlants[i + 1], selectedPlants[i]];
      renderPlantList();
    };
    li.appendChild(downBtn);

    const rmBtn = document.createElement("button");
    rmBtn.textContent = "\u2715"; rmBtn.className = "sm danger";
    rmBtn.onclick = () => { selectedPlants.splice(i, 1); renderPlantList(); };
    li.appendChild(rmBtn);

    li.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", String(i));
    });
    li.addEventListener("dragover", (e) => {
      e.preventDefault(); li.classList.add("drag-over");
    });
    li.addEventListener("dragleave", () => { li.classList.remove("drag-over"); });
    li.addEventListener("drop", (e) => {
      e.preventDefault(); li.classList.remove("drag-over");
      const from = +e.dataTransfer.getData("text/plain");
      if (from === i) return;
      const [item] = selectedPlants.splice(from, 1);
      selectedPlants.splice(i, 0, item);
      renderPlantList();
    });

    plantListEl.appendChild(li);
  });
}

addPlantBtn.addEventListener("click", () => {
  const name = plantSelect.value;
  if (!name || selectedPlants.includes(name)) return;
  selectedPlants.push(name);
  renderPlantList();
});

// ===================================================================
// Planner
// ===================================================================

runPlannerBtn.addEventListener("click", async () => {
  if (selectedPlants.length === 0) {
    planStatus.textContent = "Select at least one plant first.";
    return;
  }
  planStatus.textContent = "Running planner...";
  runPlannerBtn.disabled = true;
  try {
    currentPlan = await postJson("/api/plan", {
      plants: selectedPlants,
      year: +planYearInput.value || 2026,
      start_month: +startMonthSel.value || 1,
    });
    planStatus.textContent = "";
    showResults(currentPlan);
  } catch (e) {
    planStatus.textContent = `Error: ${e.message}`;
  } finally {
    runPlannerBtn.disabled = false;
  }
});

// ===================================================================
// Results display
// ===================================================================

function showResults(plan) {
  resultsSection.style.display = "";

  let html = `<p><strong>Score:</strong> ${plan.score} &nbsp; `;
  html += `<strong>Assigned:</strong> ${plan.assigned.length}/${plan.selected_plants.length}`;
  if (plan.unassigned_plants.length) {
    html += ` &nbsp; <strong>Could not fit:</strong> ${plan.unassigned_plants.join(", ")}`;
  }
  html += `</p>`;
  planSummary.innerHTML = html;

  let tlHtml = "";
  for (const [plotId, entries] of Object.entries(plan.timeline).sort()) {
    tlHtml += `<div class="tl-plot"><strong>Plot ${plotId}</strong>`;
    if (entries.length === 0) tlHtml += " (empty)";
    tlHtml += "<ul>";
    for (const e of entries) {
      const method = e.method.replace(/_/g, " ");
      tlHtml += `<li><span class="plant-chip" style="background:${plantColor(e.plant)}">${e.plant}</span> ${e.start} to ${e.end} <em>(${method})</em></li>`;
    }
    tlHtml += "</ul></div>";
  }
  plotTimelinesEl.innerHTML = tlHtml;

  let adjHtml = "";
  if (plan.adjacency_events.length === 0) {
    adjHtml = "<p>No adjacency interactions.</p>";
  } else {
    adjHtml = "<ul>";
    for (const ev of plan.adjacency_events) {
      const s = ev.compatibility;
      const cls = s > 0 ? "compat" : s < 0 ? "incompat" : "neutral";
      const tag = s > 0 ? "COMPATIBLE" : s < 0 ? "INCOMPATIBLE" : "NEUTRAL";
      adjHtml += `<li class="${cls}">Plot ${ev.plot_a} (<strong>${ev.plant_a}</strong>) &harr; Plot ${ev.plot_b} (<strong>${ev.plant_b}</strong>): ${tag} (${s > 0 ? "+" : ""}${s}) <em>${ev.overlap_start} to ${ev.overlap_end}</em></li>`;
    }
    adjHtml += "</ul>";
  }
  adjEventsEl.innerHTML = adjHtml;

  const cm = plan.compatibility_matrix;
  if (cm && cm.plants.length > 0) {
    let tbl = '<table class="matrix"><tr><th></th>';
    for (const p of cm.plants) tbl += `<th>${p.substring(0, 8)}</th>`;
    tbl += "</tr>";
    cm.plants.forEach((pa, i) => {
      tbl += `<tr><th>${pa.substring(0, 8)}</th>`;
      cm.scores[i].forEach((s, j) => {
        if (i === j) { tbl += '<td class="self">--</td>'; }
        else {
          const cls = s > 0 ? "compat" : s < 0 ? "incompat" : "neutral";
          tbl += `<td class="${cls}">${s > 0 ? "+" : ""}${s}</td>`;
        }
      });
      tbl += "</tr>";
    });
    tbl += "</table>";
    compatMatrixEl.innerHTML = tbl;
  }

  dateSlider.value = 0;
  updateTimelineGrid();
}

// ===================================================================
// Timeline scrubber
// ===================================================================

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

function updateTimelineGrid() {
  if (!currentPlan) return;
  const year = currentPlan.year;
  const d = dayToDate(+dateSlider.value, year);
  currentDateEl.textContent = fmtDate(d);
  const dateStr = isoDate(d);
  const snap = getSnapshot(currentPlan.timeline, dateStr);

  setGridLayout(timelineGridEl);
  timelineGridEl.innerHTML = "";

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
        const plant = snap[String(v)];
        if (plant) {
          cell.style.backgroundColor = plantColor(plant);
          cell.textContent = plant.substring(0, 4);
          cell.title = `Plot ${v}: ${plant}`;
          cell.classList.add("planted");
        } else {
          cell.style.backgroundColor = "#f0ece4";
          cell.textContent = v;
          cell.title = `Plot ${v}: empty`;
          cell.classList.add("plot-empty");
        }
      }
      timelineGridEl.appendChild(cell);
    }
  }
}

dateSlider.addEventListener("input", updateTimelineGrid);

// ===================================================================
// .farm file handling
// ===================================================================

downloadFarmBtn.addEventListener("click", async () => {
  fileStatus.textContent = "Exporting...";
  try {
    const metadata = {
      cellSize: state.cellSize,
      bgOpacity: state.bgOpacity,
      selectedPlants: selectedPlants,
      planYear: planYearInput.value,
      startMonth: startMonthSel.value,
      selectedPlotId: selectedPlotId,
    };
    const res = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metadata }),
    });
    const blob = await res.blob();
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
      const data = await postJson("/api/import", { data: b64 });

      // Restore grid
      state.width  = data.grid.width;
      state.height = data.grid.height;
      state.cells  = data.grid.cells;
      widthInput.value  = data.grid.width;
      heightInput.value = data.grid.height;

      // Restore metadata
      const meta = data.metadata || {};
      if (meta.cellSize) {
        state.cellSize = meta.cellSize;
        cellSizeInput.value = meta.cellSize;
      }
      if (meta.bgOpacity !== undefined) {
        state.bgOpacity = meta.bgOpacity;
        bgOpacityInput.value = meta.bgOpacity;
      }
      if (meta.selectedPlants) {
        selectedPlants = meta.selectedPlants;
        renderPlantList();
      }
      if (meta.planYear)       planYearInput.value = meta.planYear;
      if (meta.startMonth)     startMonthSel.value = meta.startMonth;
      if (meta.selectedPlotId) selectedPlotId = meta.selectedPlotId;

      // Restore background
      if (data.background) {
        state.bgDataUrl = data.background;
        bgClearBtn.style.display = "";
      } else {
        state.bgDataUrl = null;
        bgClearBtn.style.display = "none";
      }

      // Re-render all views
      renderShapeGrid();
      renderPlotGrid();
      renderPlotList();

      fileStatus.textContent = "Imported successfully!";
    } catch (e) {
      fileStatus.textContent = `Error: ${e.message}`;
    }
  };
  reader.readAsDataURL(file);
  uploadFarmInput.value = "";
});

// ===================================================================
// Init
// ===================================================================

(async () => {
  await fetchGrid();
  await fetchPlants();

  // Check for existing background on server
  const bgData = await (await fetch("/api/background")).json();
  if (bgData.image) {
    state.bgDataUrl = bgData.image;
    bgClearBtn.style.display = "";
  }

  // Pre-populate default plants for quick testing
  const defaults = ["Tomatoes", "Corn", "Onions", "Cucumbers", "Lettuce", "Radish"];
  for (const p of defaults) {
    if ([...plantSelect.options].some(o => o.value === p)) {
      selectedPlants.push(p);
    }
  }
  renderPlantList();

  // Render the initial view (Farm Shape)
  renderShapeGrid();
})();
