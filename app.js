const STORAGE_KEY = "obra-mvp1-state-v2";

const initialState = {
  projectName: "",
  builderName: "",
  projectLocation: "",
  updatedAt: "",
  builderLogo: "",
  projectPhoto: "",
  floors: [],
  stages: [],
  checks: {}
};

let state = loadState();
let activeView = "setup";
let activeStageId = state.stages[0]?.id || "";
let draggedFloorId = "";
let draggedStageId = "";
let stageSlideDirection = "";
let touchStartX = 0;

const elements = {
  tabs: document.querySelectorAll(".tab"),
  setupView: document.querySelector("#setupView"),
  trackingView: document.querySelector("#trackingView"),
  reviewView: document.querySelector("#reviewView"),
  projectName: document.querySelector("#projectName"),
  builderName: document.querySelector("#builderName"),
  projectLocation: document.querySelector("#projectLocation"),
  updatedAt: document.querySelector("#updatedAt"),
  builderLogo: document.querySelector("#builderLogo"),
  projectPhoto: document.querySelector("#projectPhoto"),
  builderLogoPreview: document.querySelector("#builderLogoPreview"),
  projectPhotoPreview: document.querySelector("#projectPhotoPreview"),
  floorMatrixName: document.querySelector("#floorMatrixName"),
  floorMatrixUnits: document.querySelector("#floorMatrixUnits"),
  floorMatrixRepeat: document.querySelector("#floorMatrixRepeat"),
  addFloorMatrix: document.querySelector("#addFloorMatrix"),
  stageName: document.querySelector("#stageName"),
  addStage: document.querySelector("#addStage"),
  stageList: document.querySelector("#stageList"),
  floorList: document.querySelector("#floorList"),
  trackingStage: document.querySelector("#trackingStage"),
  previousStage: document.querySelector("#previousStage"),
  nextStage: document.querySelector("#nextStage"),
  trackingPercent: document.querySelector("#trackingPercent"),
  trackingCount: document.querySelector("#trackingCount"),
  trackingMatrix: document.querySelector("#trackingMatrix"),
  summaryStrip: document.querySelector("#summaryStrip"),
  reviewGrid: document.querySelector("#reviewGrid"),
  exportButton: document.querySelector("#exportButton"),
  importFile: document.querySelector("#importFile")
};

wireEvents();
render();

function wireEvents() {
  elements.tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      activeView = tab.dataset.view;
      render();
    });
  });

  elements.projectName.addEventListener("input", () => {
    state.projectName = elements.projectName.value;
    saveAndRender(false);
  });

  elements.builderName.addEventListener("input", () => {
    state.builderName = elements.builderName.value;
    saveAndRender(false);
  });

  elements.projectLocation.addEventListener("input", () => {
    state.projectLocation = elements.projectLocation.value;
    saveAndRender(false);
  });

  elements.updatedAt.addEventListener("input", () => {
    state.updatedAt = elements.updatedAt.value;
    saveAndRender(false);
  });

  elements.builderLogo.addEventListener("change", (event) => {
    readImageFile(event, (dataUrl) => {
      state.builderLogo = dataUrl;
      saveAndRender();
    });
  });

  elements.projectPhoto.addEventListener("change", (event) => {
    readImageFile(event, (dataUrl) => {
      state.projectPhoto = dataUrl;
      saveAndRender();
    });
  });

  elements.addFloorMatrix.addEventListener("click", addFloorRowsFromMatrix);

  elements.addStage.addEventListener("click", addStageFromInput);
  elements.stageName.addEventListener("keydown", (event) => {
    if (event.key === "Enter") addStageFromInput();
  });

  elements.trackingStage.addEventListener("change", () => {
    const currentIndex = state.stages.findIndex((stage) => stage.id === activeStageId);
    const nextIndex = state.stages.findIndex((stage) => stage.id === elements.trackingStage.value);
    setActiveStage(elements.trackingStage.value, nextIndex >= currentIndex ? "next" : "previous");
  });

  elements.previousStage.addEventListener("click", () => moveStage(-1));
  elements.nextStage.addEventListener("click", () => moveStage(1));

  elements.exportButton.addEventListener("click", exportState);
  elements.importFile.addEventListener("change", importState);

  document.addEventListener("keydown", handleGridNavigation);
  elements.trackingMatrix.addEventListener("touchstart", (event) => {
    touchStartX = event.touches[0]?.clientX || 0;
  }, { passive: true });
  elements.trackingMatrix.addEventListener("touchend", (event) => {
    const touchEndX = event.changedTouches[0]?.clientX || 0;
    const distance = touchEndX - touchStartX;
    if (Math.abs(distance) < 60) return;
    moveStage(distance < 0 ? 1 : -1);
  });
}

function addFloorRowsFromMatrix() {
  const name = elements.floorMatrixName.value.trim();
  const unitCount = Number(elements.floorMatrixUnits.value);
  const repeatCount = Number(elements.floorMatrixRepeat.value);

  if (!name || unitCount < 1 || repeatCount < 1) return;

  const newFloors = Array.from({ length: repeatCount }, (_, index) => ({
    id: crypto.randomUUID(),
    name: incrementFloorName(name, index),
    units: generateUnitList(unitCount)
  })).reverse();

  state.floors.push(...newFloors);
  saveAndRender();
}

function addStageFromInput() {
  const name = elements.stageName.value.trim();
  if (!name) return;

  const stage = { id: crypto.randomUUID(), name };
  state.stages.push(stage);
  activeStageId = stage.id;
  elements.stageName.value = "";
  saveAndRender();
}

function moveStage(offset) {
  const index = state.stages.findIndex((stage) => stage.id === activeStageId);
  if (index < 0 || state.stages.length === 0) return;
  const nextIndex = (index + offset + state.stages.length) % state.stages.length;
  setActiveStage(state.stages[nextIndex].id, offset > 0 ? "next" : "previous");
}

function setActiveStage(stageId, direction = "") {
  activeStageId = stageId;
  stageSlideDirection = direction;
  render();
}

function render() {
  elements.tabs.forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.view === activeView);
  });

  elements.setupView.classList.toggle("active", activeView === "setup");
  elements.trackingView.classList.toggle("active", activeView === "tracking");
  elements.reviewView.classList.toggle("active", activeView === "review");

  elements.projectName.value = state.projectName;
  elements.builderName.value = state.builderName;
  elements.projectLocation.value = state.projectLocation;
  elements.updatedAt.value = state.updatedAt;
  renderImagePreview(elements.builderLogoPreview, state.builderLogo);
  renderImagePreview(elements.projectPhotoPreview, state.projectPhoto);

  if (!state.stages.some((stage) => stage.id === activeStageId)) {
    activeStageId = state.stages[0]?.id || "";
  }

  renderStages();
  renderFloors();
  renderStageSelect();
  renderTrackingMatrix();
  renderReview();
}

function renderStages() {
  elements.stageList.innerHTML = "";

  state.stages.forEach((stage, index) => {
    const row = document.createElement("div");
    row.className = "stage-row draggable-row";
    row.dataset.stageId = stage.id;

    row.addEventListener("dragover", (event) => event.preventDefault());
    row.addEventListener("drop", (event) => {
      event.preventDefault();
      reorderById(state.stages, draggedStageId, stage.id);
      saveAndRender();
    });

    const handle = document.createElement("span");
    handle.className = "drag-handle";
    handle.draggable = true;
    handle.textContent = "::";
    handle.title = "Arrastar para reordenar";
    handle.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData("text/plain", stage.id);
      draggedStageId = stage.id;
      row.classList.add("dragging");
    });
    handle.addEventListener("dragend", () => {
      draggedStageId = "";
      row.classList.remove("dragging");
    });

    const order = document.createElement("span");
    order.className = "row-order";
    order.textContent = String(index + 1).padStart(2, "0");

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.value = stage.name;
    nameInput.className = "grid-input";
    nameInput.dataset.grid = "stages";
    nameInput.dataset.row = String(index);
    nameInput.dataset.col = "0";
    nameInput.setAttribute("aria-label", "Nome da etapa");
    nameInput.addEventListener("input", () => {
      stage.name = nameInput.value;
      saveAndRender(false);
    });

    const remove = document.createElement("button");
    remove.className = "danger-button";
    remove.type = "button";
    remove.textContent = "Remover";
    remove.addEventListener("click", () => {
      state.stages = state.stages.filter((item) => item.id !== stage.id);
      delete state.checks[stage.id];
      saveAndRender();
    });

    row.append(handle, order, nameInput, remove);
    elements.stageList.append(row);
  });
}

function renderFloors() {
  elements.floorList.innerHTML = "";

  state.floors.forEach((floor, index) => {
    const row = document.createElement("div");
    row.className = "floor-row draggable-row";
    row.dataset.floorId = floor.id;

    row.addEventListener("dragover", (event) => event.preventDefault());
    row.addEventListener("drop", (event) => {
      event.preventDefault();
      reorderById(state.floors, draggedFloorId, floor.id);
      saveAndRender();
    });

    const handle = document.createElement("span");
    handle.className = "drag-handle";
    handle.draggable = true;
    handle.textContent = "::";
    handle.title = "Arrastar para reordenar";
    handle.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData("text/plain", floor.id);
      draggedFloorId = floor.id;
      row.classList.add("dragging");
    });
    handle.addEventListener("dragend", () => {
      draggedFloorId = "";
      row.classList.remove("dragging");
    });

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.value = floor.name;
    nameInput.className = "grid-input";
    nameInput.dataset.grid = "floors";
    nameInput.dataset.row = String(index);
    nameInput.dataset.col = "0";
    nameInput.setAttribute("aria-label", "Nome do pavimento");
    nameInput.addEventListener("input", () => {
      floor.name = nameInput.value;
      saveAndRender(false);
    });

    const unitInput = document.createElement("input");
    unitInput.type = "number";
    unitInput.min = "1";
    unitInput.value = String(floor.units.length);
    unitInput.className = "grid-input";
    unitInput.dataset.grid = "floors";
    unitInput.dataset.row = String(index);
    unitInput.dataset.col = "1";
    unitInput.setAttribute("aria-label", "Número de unidades");
    unitInput.addEventListener("change", () => {
      const count = Math.max(1, Number(unitInput.value) || 1);
      floor.units = generateUnitList(count);
      pruneChecksForFloor(floor.id, floor.units);
      preview.textContent = floor.units.join(", ");
      saveAndRender(false);
    });

    const preview = document.createElement("div");
    preview.className = "floor-meta";
    preview.textContent = floor.units.join(", ");

    const remove = document.createElement("button");
    remove.className = "danger-button";
    remove.type = "button";
    remove.textContent = "Remover";
    remove.addEventListener("click", () => {
      state.floors = state.floors.filter((item) => item.id !== floor.id);
      removeChecksForFloor(floor.id);
      saveAndRender();
    });

    row.append(handle, nameInput, unitInput, preview, remove);
    elements.floorList.append(row);
  });
}

function renderStageSelect() {
  elements.trackingStage.innerHTML = "";

  state.stages.forEach((stage) => {
    const option = document.createElement("option");
    option.value = stage.id;
    option.textContent = stage.name;
    option.selected = stage.id === activeStageId;
    elements.trackingStage.append(option);
  });
}

function renderTrackingMatrix() {
  elements.trackingMatrix.innerHTML = "";
  elements.trackingMatrix.classList.remove("slide-next", "slide-previous");

  const units = collectUnits();
  const columns = ["124px", ...units.map(() => "62px")].join(" ");
  elements.trackingMatrix.style.gridTemplateColumns = columns;

  addMatrixCell("", "matrix-cell header corner");
  units.forEach((unit) => addMatrixCell(unit, "matrix-cell header"));

  state.floors.forEach((floor) => {
    addMatrixCell(floor.name, "matrix-cell floor-label");

    units.forEach((unit) => {
      const cell = document.createElement("div");
      cell.className = "matrix-cell";

      if (floor.units.includes(unit)) {
        const button = document.createElement("button");
        button.className = `check-button ${isChecked(activeStageId, floor.id, unit) ? "checked" : ""}`;
        button.type = "button";
        button.setAttribute("aria-label", `${floor.name} unidade ${unit}`);
        button.addEventListener("click", () => toggleCheck(activeStageId, floor.id, unit));
        cell.append(button);
      }

      elements.trackingMatrix.append(cell);
    });
  });

  const progress = calculateProgress(activeStageId);
  elements.trackingPercent.textContent = formatPercent(progress.percent);
  elements.trackingCount.textContent = `${progress.done} de ${progress.total} unidades`;

  if (stageSlideDirection) {
    void elements.trackingMatrix.offsetWidth;
    elements.trackingMatrix.classList.add(stageSlideDirection === "next" ? "slide-next" : "slide-previous");
    stageSlideDirection = "";
  }
}

function renderReview() {
  elements.summaryStrip.innerHTML = "";
  elements.reviewGrid.innerHTML = "";

  renderProgressChart();

  state.stages.forEach((stage) => {
    const progress = calculateProgress(stage.id);

    const stageCard = document.createElement("article");
    stageCard.className = "review-stage";

    const header = document.createElement("header");
    const title = document.createElement("strong");
    title.textContent = stage.name;
    const count = document.createElement("span");
    count.textContent = `${progress.done}/${progress.total}`;
    header.append(title, count);

    const miniMatrix = document.createElement("div");
    miniMatrix.className = "mini-matrix";

    state.floors.forEach((floor) => {
      const row = document.createElement("div");
      row.className = "mini-row";

      const floorName = document.createElement("strong");
      floorName.textContent = floor.name;

      const dots = document.createElement("div");
      dots.className = "mini-units";

      floor.units.forEach((unit) => {
        const dot = document.createElement("span");
        dot.className = `mini-dot ${isChecked(stage.id, floor.id, unit) ? "checked" : ""}`;
        dots.append(dot);
      });

      row.append(floorName, dots);
      miniMatrix.append(row);
    });

    stageCard.append(header, miniMatrix);
    elements.reviewGrid.append(stageCard);
  });
}

function renderProgressChart() {
  const chart = document.createElement("article");
  chart.className = "progress-chart";

  const header = document.createElement("header");
  const title = document.createElement("h2");
  title.textContent = "Avanço por etapa";
  header.append(title);
  chart.append(header);

  if (state.stages.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-note";
    empty.textContent = "Cadastre etapas para visualizar o gráfico.";
    chart.append(empty);
    elements.summaryStrip.append(chart);
    return;
  }

  state.stages.forEach((stage) => {
    const progress = calculateProgress(stage.id);
    const row = document.createElement("div");
    row.className = "chart-row";

    const label = document.createElement("span");
    label.textContent = stage.name;

    const track = document.createElement("div");
    track.className = "chart-track";

    const fill = document.createElement("div");
    fill.className = "chart-fill";
    fill.style.width = `${Math.round(progress.percent * 100)}%`;

    const value = document.createElement("strong");
    value.textContent = formatPercent(progress.percent);

    track.append(fill);
    row.append(label, track, value);
    chart.append(row);
  });

  elements.summaryStrip.append(chart);
}

function addMatrixCell(text, className) {
  const cell = document.createElement("div");
  cell.className = className;
  cell.textContent = text;
  elements.trackingMatrix.append(cell);
}

function toggleCheck(stageId, floorId, unit) {
  if (!state.checks[stageId]) state.checks[stageId] = {};
  if (!state.checks[stageId][floorId]) state.checks[stageId][floorId] = {};
  state.checks[stageId][floorId][unit] = !state.checks[stageId][floorId][unit];
  saveAndRender();
}

function isChecked(stageId, floorId, unit) {
  return Boolean(state.checks[stageId]?.[floorId]?.[unit]);
}

function calculateProgress(stageId) {
  const total = state.floors.reduce((sum, floor) => sum + floor.units.length, 0);
  const done = state.floors.reduce((sum, floor) => {
    const completed = floor.units.filter((unit) => isChecked(stageId, floor.id, unit)).length;
    return sum + completed;
  }, 0);

  return {
    total,
    done,
    percent: total === 0 ? 0 : done / total
  };
}

function collectUnits() {
  const unique = new Set();
  state.floors.forEach((floor) => floor.units.forEach((unit) => unique.add(unit)));
  return [...unique].sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));
}

function generateUnitList(count) {
  return Array.from({ length: count }, (_, index) => String(index + 1).padStart(2, "0"));
}

function incrementFloorName(name, offset) {
  if (offset === 0) return name;

  const match = name.match(/^(.*?)(\d+)(\D*)$/);
  if (!match) return `${name} ${offset + 1}`;

  const [, prefix, numberText, suffix] = match;
  const nextNumber = Number(numberText) + offset;
  return `${prefix}${String(nextNumber).padStart(numberText.length, "0")}${suffix}`;
}

function reorderById(items, draggedId, targetId) {
  if (!draggedId || !targetId || draggedId === targetId) return;

  const fromIndex = items.findIndex((item) => item.id === draggedId);
  const toIndex = items.findIndex((item) => item.id === targetId);
  if (fromIndex < 0 || toIndex < 0) return;

  const [moved] = items.splice(fromIndex, 1);
  items.splice(toIndex, 0, moved);
}

function handleGridNavigation(event) {
  if (event.defaultPrevented) return;
  if (!event.target.classList?.contains("grid-input")) return;

  const keyMap = {
    ArrowUp: [-1, 0],
    ArrowDown: [1, 0],
    ArrowLeft: [0, -1],
    ArrowRight: [0, 1]
  };
  const movement = keyMap[event.key];
  if (!movement) return;

  const current = event.target;
  const grid = current.dataset.grid;
  const row = Number(current.dataset.row);
  const col = Number(current.dataset.col);
  if (!grid || !Number.isFinite(row) || !Number.isFinite(col)) return;

  const [rowOffset, colOffset] = movement;
  const next = findGridInput(grid, row + rowOffset, col + colOffset);
  event.preventDefault();
  if (!next) return;

  next.focus();
  next.select();
}

function findGridInput(grid, row, col) {
  return document.querySelector(
    `.grid-input[data-grid="${grid}"][data-row="${row}"][data-col="${col}"]`
  );
}

function readImageFile(event, onLoad) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    onLoad(String(reader.result));
  });
  reader.readAsDataURL(file);
  event.target.value = "";
}

function renderImagePreview(image, dataUrl) {
  if (!dataUrl) {
    image.removeAttribute("src");
    image.classList.remove("has-image");
    return;
  }

  image.src = dataUrl;
  image.classList.add("has-image");
}

function pruneChecksForFloor(floorId, units) {
  const allowed = new Set(units);
  Object.values(state.checks).forEach((stageChecks) => {
    if (!stageChecks[floorId]) return;
    Object.keys(stageChecks[floorId]).forEach((unit) => {
      if (!allowed.has(unit)) delete stageChecks[floorId][unit];
    });
  });
}

function removeChecksForFloor(floorId) {
  Object.values(state.checks).forEach((stageChecks) => {
    delete stageChecks[floorId];
  });
}

function saveAndRender(shouldRender = true) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (shouldRender) render();
}

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return initialState;

  try {
    const parsed = JSON.parse(saved);
    return {
      projectName: parsed.projectName || initialState.projectName,
      builderName: parsed.builderName || initialState.builderName,
      projectLocation: parsed.projectLocation || initialState.projectLocation,
      updatedAt: parsed.updatedAt || initialState.updatedAt,
      builderLogo: parsed.builderLogo || initialState.builderLogo,
      projectPhoto: parsed.projectPhoto || initialState.projectPhoto,
      floors: Array.isArray(parsed.floors) ? parsed.floors : initialState.floors,
      stages: Array.isArray(parsed.stages) ? parsed.stages : initialState.stages,
      checks: parsed.checks || {}
    };
  } catch {
    return initialState;
  }
}

function exportState() {
  const payload = JSON.stringify(state, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${slugify(state.projectName)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function importState(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      const imported = JSON.parse(String(reader.result));
      state = {
        projectName: imported.projectName || "Obra sem nome",
        builderName: imported.builderName || "",
        projectLocation: imported.projectLocation || "",
        updatedAt: imported.updatedAt || "",
        builderLogo: imported.builderLogo || "",
        projectPhoto: imported.projectPhoto || "",
        floors: Array.isArray(imported.floors) ? imported.floors : [],
        stages: Array.isArray(imported.stages) ? imported.stages : [],
        checks: imported.checks || {}
      };
      activeStageId = state.stages[0]?.id || "";
      saveAndRender();
    } catch {
      alert("Arquivo inválido.");
    }
  });
  reader.readAsText(file);
  event.target.value = "";
}

function formatPercent(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  }).format(value);
}

function toDateTimeInputValue(date) {
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 16);
}

function slugify(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "obra";
}
