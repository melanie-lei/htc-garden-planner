// ===================================================================
// DOM refs
// ===================================================================
const gridEl          = document.getElementById("grid");
const widthInput      = document.getElementById("grid-width");
const heightInput     = document.getElementById("grid-height");
const fillSelect      = document.getElementById("grid-fill");
const createBtn       = document.getElementById("create-grid");
const plotIdInput     = document.getElementById("plot-id");
const cellSizeInput   = document.getElementById("cell-size");
const filenameInput   = document.getElementById("filename");
const saveBtn         = document.getElementById("save-grid");
const loadBtn         = document.getElementById("load-grid");
const saveStatus      = document.getElementById("save-status");

const plantSelect     = document.getElementById("plant-select");
const addPlantBtn     = document.getElementById("add-plant");
const plantListEl     = document.getElementById("plant-list");
const planYearInput   = document.getElementById("plan-year");
const startMonthSel   = document.getElementById("start-month");
const runPlannerBtn   = document.getElementById("run-planner");
const planStatus      = document.getElementById("plan-status");

const resultsSection  = document.getElementById("results-section");
const planSummary     = document.getElementById("plan-summary");
const dateSlider      = document.getElementById("date-slider");
const currentDateEl   = document.getElementById("current-date");
const timelineGridEl  = document.getElementById("timeline-grid");
const plotTimelinesEl = document.getElementById("plot-timelines");
const adjEventsEl     = document.getElementById("adjacency-events");
const compatMatrixEl  = document.getElementById("compat-matrix");

// ===================================================================
// State
// ===================================================================
let state = {
  width: 0, height: 0, cells: [],
  tool: "brush", paintType: "plot",
  cellSize: Number(cellSizeInput.value),
};

let selectedPlants = [];   // ranked list of plant names
let currentPlan = null;    // last plan result from server
let isPainting = false;
let pending = new Map();
let flushTimer = null;

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

function getPaintValue() {
  if (state.paintType === "unassigned") return 0;
  if (state.paintType === "invalid") return 255;
  let id = Math.max(1, Math.min(254, Math.round(Number(plotIdInput.value) || 1)));
  plotIdInput.value = id;
  return id;
}

function plotColor(id) {
  return `hsl(${(id * 47) % 360}, 65%, 80%)`;
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

// ===================================================================
// Grid editor  (kept from original)
// ===================================================================
function applyCellStyle(el, value) {
  el.classList.remove("invalid", "unassigned", "plot");
  if (value === 255) {
    el.classList.add("invalid"); el.textContent = ""; el.style.backgroundColor = "";
  } else if (value === 0) {
    el.classList.add("unassigned"); el.textContent = ""; el.style.backgroundColor = "";
  } else {
    el.classList.add("plot"); el.textContent = value; el.style.backgroundColor = plotColor(value);
  }
}

function renderGrid() {
  gridEl.style.setProperty("--cell-size", `${state.cellSize}px`);
  gridEl.style.gridTemplateColumns = `repeat(${state.width}, var(--cell-size))`;
  gridEl.innerHTML = "";
  for (let r = 0; r < state.height; r++) {
    for (let c = 0; c < state.width; c++) {
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
  const data = await (await fetch("/api/grid")).json();
  state.width = data.width;
  state.height = data.height;
  state.cells = data.cells;
  widthInput.value = data.width;
  heightInput.value = data.height;
  renderGrid();
}

function queueCell(row, col, value) {
  pending.set(`${row},${col}`, { row, col, value });
  if (!flushTimer) flushTimer = setTimeout(flushPending, 120);
}

async function flushPending() {
  clearTimeout(flushTimer); flushTimer = null;
  if (pending.size === 0) return;
  const cells = [...pending.values()];
  pending.clear();
  await postJson("/api/paint", { cells });
}

function handleBrush(el) {
  const r = +el.dataset.row, c = +el.dataset.col, v = getPaintValue();
  if (state.cells[r][c] === v) return;
  state.cells[r][c] = v;
  applyCellStyle(el, v);
  queueCell(r, c, v);
}

async function handleFill(el) {
  const data = await postJson("/api/fill", {
    row: +el.dataset.row, col: +el.dataset.col, value: getPaintValue()
  });
  state.width = data.width; state.height = data.height; state.cells = data.cells;
  renderGrid();
}

function cellFromEvent(e) {
  return e.target.classList.contains("cell") ? e.target : null;
}

// Grid editor event listeners
createBtn.addEventListener("click", async () => {
  const data = await postJson("/api/grid", {
    width: +widthInput.value || 1, height: +heightInput.value || 1,
    fill: +fillSelect.value
  });
  state.width = data.width; state.height = data.height; state.cells = data.cells;
  renderGrid();
});

cellSizeInput.addEventListener("input", () => {
  state.cellSize = +cellSizeInput.value;
  renderGrid();
});

saveBtn.addEventListener("click", async () => {
  saveStatus.textContent = "";
  try {
    const data = await postJson("/api/save", { filename: filenameInput.value });
    saveStatus.textContent = `Saved to ${data.saved_to}`;
  } catch (e) { saveStatus.textContent = e.message; }
});

loadBtn.addEventListener("click", async () => {
  saveStatus.textContent = "";
  try {
    const data = await postJson("/api/load", { filename: filenameInput.value });
    state.width = data.width; state.height = data.height; state.cells = data.cells;
    widthInput.value = data.width; heightInput.value = data.height;
    renderGrid();
  } catch (e) { saveStatus.textContent = e.message; }
});

for (const inp of document.querySelectorAll("input[name='tool']"))
  inp.addEventListener("change", () => { state.tool = inp.value; });
for (const inp of document.querySelectorAll("input[name='paint-type']"))
  inp.addEventListener("change", () => { state.paintType = inp.value; });

gridEl.addEventListener("pointerdown", async (e) => {
  const cell = cellFromEvent(e);
  if (!cell) return;
  if (state.tool === "fill") { await handleFill(cell); return; }
  isPainting = true; handleBrush(cell);
});
gridEl.addEventListener("pointerover", (e) => {
  if (!isPainting || state.tool !== "brush") return;
  const cell = cellFromEvent(e);
  if (cell) handleBrush(cell);
});
window.addEventListener("pointerup", () => {
  if (isPainting) { isPainting = false; flushPending(); }
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
    upBtn.onclick = () => { [selectedPlants[i - 1], selectedPlants[i]] = [selectedPlants[i], selectedPlants[i - 1]]; renderPlantList(); };
    li.appendChild(upBtn);

    const downBtn = document.createElement("button");
    downBtn.textContent = "\u25BC"; downBtn.className = "sm";
    downBtn.disabled = i === selectedPlants.length - 1;
    downBtn.onclick = () => { [selectedPlants[i], selectedPlants[i + 1]] = [selectedPlants[i + 1], selectedPlants[i]]; renderPlantList(); };
    li.appendChild(downBtn);

    const rmBtn = document.createElement("button");
    rmBtn.textContent = "\u2715"; rmBtn.className = "sm danger";
    rmBtn.onclick = () => { selectedPlants.splice(i, 1); renderPlantList(); };
    li.appendChild(rmBtn);

    // Drag-and-drop reordering
    li.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", String(i)); });
    li.addEventListener("dragover", (e) => { e.preventDefault(); li.classList.add("drag-over"); });
    li.addEventListener("dragleave", () => { li.classList.remove("drag-over"); });
    li.addEventListener("drop", (e) => {
      e.preventDefault(); li.classList.remove("drag-over");
      const from = +e.dataTransfer.getData("text/plain");
      const to = i;
      if (from === to) return;
      const [item] = selectedPlants.splice(from, 1);
      selectedPlants.splice(to, 0, item);
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

  // Summary
  let html = `<p><strong>Score:</strong> ${plan.score} &nbsp; `;
  html += `<strong>Assigned:</strong> ${plan.assigned.length}/${plan.selected_plants.length}`;
  if (plan.unassigned_plants.length) {
    html += ` &nbsp; <strong>Could not fit:</strong> ${plan.unassigned_plants.join(", ")}`;
  }
  html += `</p>`;
  planSummary.innerHTML = html;

  // Plot timelines
  let tlHtml = "";
  for (const [plotId, entries] of Object.entries(plan.timeline).sort()) {
    tlHtml += `<div class="tl-plot"><strong>Plot ${plotId}</strong>`;
    if (entries.length === 0) { tlHtml += " (empty)"; }
    tlHtml += "<ul>";
    for (const e of entries) {
      const method = e.method.replace(/_/g, " ");
      tlHtml += `<li><span class="plant-chip" style="background:${plantColor(e.plant)}">${e.plant}</span> ${e.start} to ${e.end} <em>(${method})</em></li>`;
    }
    tlHtml += "</ul></div>";
  }
  plotTimelinesEl.innerHTML = tlHtml;

  // Adjacency events
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

  // Compatibility matrix
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

  // Render initial timeline grid at Jan 1
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

  // Build cell -> plotId map from current grid state
  const cs = state.cellSize;
  timelineGridEl.style.setProperty("--cell-size", `${cs}px`);
  timelineGridEl.style.gridTemplateColumns = `repeat(${state.width}, var(--cell-size))`;
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
// Section toggle  (collapse grid editor)
// ===================================================================
for (const toggle of document.querySelectorAll(".section-toggle")) {
  toggle.style.cursor = "pointer";
  toggle.addEventListener("click", () => {
    const target = document.getElementById(toggle.dataset.target);
    if (target) target.style.display = target.style.display === "none" ? "" : "none";
  });
}

// ===================================================================
// Init
// ===================================================================
(async () => {
  await fetchGrid();
  await fetchPlants();
  // Pre-populate a sample selection for quick testing
  const defaults = ["Tomatoes", "Corn", "Onions", "Cucumbers", "Lettuce", "Radish"];
  for (const p of defaults) {
    if ([...plantSelect.options].some(o => o.value === p)) {
      selectedPlants.push(p);
    }
  }
  renderPlantList();
})();
