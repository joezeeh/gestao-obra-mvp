const STORAGE_KEY = "obra-mvp1-state-v2";
const FLOOR_CHECK_KEY = "__floor__";
const SUPABASE_ENABLED = Boolean(window.supabase && window.SUPABASE_CONFIG);
const supabaseClient = SUPABASE_ENABLED
  ? window.supabase.createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.anonKey)
  : null;

const initialState = {
  projectName: "",
  builderName: "",
  projectLocation: "",
  updatedAt: "",
  targetDeliveryDate: "",
  forecastFinishDate: "",
  builderLogo: "",
  projectPhoto: "",
  floors: [],
  stages: [],
  checks: {},
  measurements: []
};

let state = loadState();
let activeView = "setup";
let activeStageId = state.stages[0]?.id || "";
let draggedFloorId = "";
let draggedStageId = "";
let stageSlideDirection = "";
let touchStartX = 0;
let currentUser = null;
let currentProjectId = "";
let remoteReady = false;
let suppressRealtimeReload = false;
let realtimeChannel = null;
let saveProjectTimer = null;
const saveStageTimers = new Map();
const saveFloorTimers = new Map();

const elements = {
  authView: document.querySelector("#authView"),
  appContent: document.querySelectorAll(".app-content"),
  loginForm: document.querySelector("#loginForm"),
  loginEmail: document.querySelector("#loginEmail"),
  loginPassword: document.querySelector("#loginPassword"),
  loginButton: document.querySelector("#loginButton"),
  signupButton: document.querySelector("#signupButton"),
  logoutButton: document.querySelector("#logoutButton"),
  userEmail: document.querySelector("#userEmail"),
  authMessage: document.querySelector("#authMessage"),
  tabs: document.querySelectorAll(".tab"),
  setupView: document.querySelector("#setupView"),
  trackingView: document.querySelector("#trackingView"),
  reviewView: document.querySelector("#reviewView"),
  measurementsView: document.querySelector("#measurementsView"),
  projectName: document.querySelector("#projectName"),
  builderName: document.querySelector("#builderName"),
  projectLocation: document.querySelector("#projectLocation"),
  updatedAt: document.querySelector("#updatedAt"),
  targetDeliveryDate: document.querySelector("#targetDeliveryDate"),
  forecastFinishDate: document.querySelector("#forecastFinishDate"),
  uploadMeasurement: document.querySelector("#uploadMeasurement"),
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
  measurementReport: document.querySelector("#measurementReport"),
  trendReport: document.querySelector("#trendReport"),
  exportButton: document.querySelector("#exportButton"),
  importFile: document.querySelector("#importFile")
};

wireEvents();
initApp();

function wireEvents() {
  elements.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await signIn();
  });

  elements.signupButton.addEventListener("click", signUp);
  elements.logoutButton.addEventListener("click", signOut);

  elements.tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      activeView = tab.dataset.view;
      render();
    });
  });

  elements.projectName.addEventListener("input", () => {
    state.projectName = elements.projectName.value;
    queueSaveProject();
    saveAndRender(false);
  });

  elements.builderName.addEventListener("input", () => {
    state.builderName = elements.builderName.value;
    queueSaveProject();
    saveAndRender(false);
  });

  elements.projectLocation.addEventListener("input", () => {
    state.projectLocation = elements.projectLocation.value;
    queueSaveProject();
    saveAndRender(false);
  });

  elements.targetDeliveryDate.addEventListener("input", () => {
    state.targetDeliveryDate = elements.targetDeliveryDate.value;
    queueSaveProject();
    saveAndRender(false);
  });

  elements.updatedAt.addEventListener("input", () => {
    state.updatedAt = elements.updatedAt.value;
    queueSaveProject();
    saveAndRender(false);
  });

  elements.forecastFinishDate.addEventListener("input", () => {
    state.forecastFinishDate = elements.forecastFinishDate.value;
    saveAndRender(false);
  });

  elements.builderLogo.addEventListener("change", (event) => {
    readImageFile(event, async (dataUrl, file) => {
      state.builderLogo = await uploadProjectAsset(file, "logo") || dataUrl;
      await saveProject();
      saveAndRender();
    });
  });

  elements.projectPhoto.addEventListener("change", (event) => {
    readImageFile(event, async (dataUrl, file) => {
      state.projectPhoto = await uploadProjectAsset(file, "photo") || dataUrl;
      await saveProject();
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
  elements.uploadMeasurement.addEventListener("click", uploadMeasurement);

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

async function initApp() {
  if (!SUPABASE_ENABLED) {
    remoteReady = false;
    showApp();
    render();
    return;
  }

  const { data } = await supabaseClient.auth.getSession();
  currentUser = data.session?.user || null;

  supabaseClient.auth.onAuthStateChange(async (_event, session) => {
    currentUser = session?.user || null;
    if (currentUser) {
      await loadRemoteWorkspace();
    } else {
      showLogin();
    }
  });

  if (currentUser) {
    await loadRemoteWorkspace();
  } else {
    showLogin();
  }
}

function showLogin(message = "") {
  remoteReady = false;
  elements.authView.classList.add("active");
  elements.appContent.forEach((item) => item.classList.add("hidden"));
  elements.logoutButton.classList.add("hidden");
  elements.userEmail.textContent = "";
  elements.authMessage.textContent = message;
}

function showApp() {
  elements.authView.classList.remove("active");
  elements.appContent.forEach((item) => item.classList.remove("hidden"));
  elements.logoutButton.classList.toggle("hidden", !currentUser);
  elements.userEmail.textContent = currentUser?.email || "";
}

async function signIn() {
  if (!SUPABASE_ENABLED) return;
  setAuthMessage("Entrando...");
  const { error } = await supabaseClient.auth.signInWithPassword({
    email: elements.loginEmail.value.trim(),
    password: elements.loginPassword.value
  });

  if (error) {
    setAuthMessage(error.message);
    return;
  }

  setAuthMessage("");
}

async function signUp() {
  if (!SUPABASE_ENABLED) return;
  setAuthMessage("Criando acesso...");
  const { error } = await supabaseClient.auth.signUp({
    email: elements.loginEmail.value.trim(),
    password: elements.loginPassword.value
  });

  if (error) {
    setAuthMessage(error.message);
    return;
  }

  setAuthMessage("Acesso criado. Se o Supabase pedir confirmação, verifique o e-mail.");
}

async function signOut() {
  if (!SUPABASE_ENABLED) return;
  await supabaseClient.auth.signOut();
}

function setAuthMessage(message) {
  elements.authMessage.textContent = message;
}

async function loadRemoteWorkspace() {
  if (!SUPABASE_ENABLED || !currentUser) return;

  showApp();
  remoteReady = false;

  let project = await fetchFirstProject();
  if (!project) {
    project = await createBlankProject();
  }

  currentProjectId = project.id;

  const [{ data: floors }, { data: stages }, { data: progressRows }, { data: measurements }, { data: measurementTotals }] = await Promise.all([
    supabaseClient.from("floors").select("*").eq("project_id", currentProjectId).order("sort_order"),
    supabaseClient.from("stages").select("*").eq("project_id", currentProjectId).order("sort_order"),
    supabaseClient.from("progress").select("*").eq("project_id", currentProjectId),
    supabaseClient.from("measurements").select("*").eq("project_id", currentProjectId).order("sort_order"),
    supabaseClient.from("measurement_stage_totals").select("*").eq("project_id", currentProjectId)
  ]);

  state = {
    projectName: project.name || "",
    builderName: project.builder_name || "",
    projectLocation: project.location || "",
    updatedAt: project.updated_at ? toDateTimeInputValue(new Date(project.updated_at)) : "",
    targetDeliveryDate: project.target_delivery_date || "",
    forecastFinishDate: state.forecastFinishDate || "",
    builderLogo: project.logo_url || "",
    projectPhoto: project.photo_url || "",
    floors: (floors || []).map((floor) => ({
      id: floor.id,
      name: floor.name,
      units: generateUnitList(floor.unit_count)
    })),
    stages: (stages || []).map((stage) => normalizeStage({
      id: stage.id,
      name: stage.name,
      trackingLevel: stage.tracking_level
    })),
    checks: buildChecks(progressRows || []),
    measurements: buildMeasurements(measurements || [], measurementTotals || [])
  };

  activeStageId = state.stages[0]?.id || "";
  remoteReady = true;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  subscribeToRealtime();
  render();
}

async function fetchFirstProject() {
  const { data, error } = await supabaseClient
    .from("projects")
    .select("*")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(error);
    return null;
  }

  return data;
}

async function createBlankProject() {
  const { data, error } = await supabaseClient
    .from("projects")
    .insert({
      name: "",
      builder_name: "",
      location: ""
    })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

function buildChecks(progressRows) {
  const checks = {};

  progressRows.forEach((row) => {
    if (!checks[row.stage_id]) checks[row.stage_id] = {};
    if (!checks[row.stage_id][row.floor_id]) checks[row.stage_id][row.floor_id] = {};
    checks[row.stage_id][row.floor_id][row.unit_label] = row.done;
  });

  return checks;
}

function buildMeasurements(measurements, totals) {
  const totalsByMeasurement = new Map();

  totals.forEach((total) => {
    if (!totalsByMeasurement.has(total.measurement_id)) {
      totalsByMeasurement.set(total.measurement_id, {});
    }
    totalsByMeasurement.get(total.measurement_id)[total.stage_id] = {
      completed: total.completed_count,
      total: total.total_count
    };
  });

  return measurements.map((measurement) => ({
    id: measurement.id,
    label: measurement.label,
    measuredAt: measurement.measured_at,
    forecastFinishDate: measurement.forecast_finish_date || "",
    sortOrder: measurement.sort_order,
    totals: totalsByMeasurement.get(measurement.id) || {}
  }));
}

function subscribeToRealtime() {
  if (!SUPABASE_ENABLED || !currentProjectId) return;
  if (realtimeChannel) supabaseClient.removeChannel(realtimeChannel);

  realtimeChannel = supabaseClient
    .channel(`project-${currentProjectId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "projects" }, reloadFromRealtime)
    .on("postgres_changes", { event: "*", schema: "public", table: "floors" }, reloadFromRealtime)
    .on("postgres_changes", { event: "*", schema: "public", table: "stages" }, reloadFromRealtime)
    .on("postgres_changes", { event: "*", schema: "public", table: "progress" }, reloadFromRealtime)
    .on("postgres_changes", { event: "*", schema: "public", table: "measurements" }, reloadFromRealtime)
    .on("postgres_changes", { event: "*", schema: "public", table: "measurement_stage_totals" }, reloadFromRealtime)
    .subscribe();
}

async function reloadFromRealtime() {
  if (suppressRealtimeReload) return;
  await loadRemoteWorkspace();
}

async function withRealtimeSuppressed(action) {
  suppressRealtimeReload = true;
  try {
    return await action();
  } finally {
    window.setTimeout(() => {
      suppressRealtimeReload = false;
    }, 250);
  }
}

function queueSaveProject() {
  if (!remoteReady || !currentProjectId) return;
  window.clearTimeout(saveProjectTimer);
  saveProjectTimer = window.setTimeout(saveProject, 450);
}

async function saveProject() {
  if (!remoteReady || !currentProjectId) return;

  await withRealtimeSuppressed(async () => {
    const { error } = await supabaseClient
      .from("projects")
      .update({
        name: state.projectName,
        builder_name: state.builderName,
        location: state.projectLocation,
        logo_url: state.builderLogo || null,
        photo_url: state.projectPhoto || null,
        updated_at: state.updatedAt ? new Date(state.updatedAt).toISOString() : null,
        target_delivery_date: state.targetDeliveryDate || null
      })
      .eq("id", currentProjectId);

    if (error) console.error(error);
  });
}

async function uploadProjectAsset(file, kind) {
  if (!remoteReady || !currentProjectId || !file) return "";

  const extension = file.name.split(".").pop() || "png";
  const path = `${currentProjectId}/${kind}-${Date.now()}.${extension}`;
  const { error } = await supabaseClient.storage
    .from("project-assets")
    .upload(path, file, { upsert: true });

  if (error) {
    console.error(error);
    return "";
  }

  const { data } = supabaseClient.storage.from("project-assets").getPublicUrl(path);
  return data.publicUrl;
}

function queueSaveStage(stageId) {
  if (!remoteReady || !currentProjectId) return;
  window.clearTimeout(saveStageTimers.get(stageId));
  saveStageTimers.set(stageId, window.setTimeout(() => saveStageRemote(stageId), 450));
}

async function saveStageRemote(stageId) {
  const stage = state.stages.find((item) => item.id === stageId);
  if (!remoteReady || !stage) return;

  await withRealtimeSuppressed(async () => {
    const { error } = await supabaseClient
      .from("stages")
      .update({
        name: stage.name,
        tracking_level: stage.trackingLevel === "floor" ? "floor" : "unit"
      })
      .eq("id", stageId);
    if (error) console.error(error);
  });
}

function queueSaveFloor(floorId) {
  if (!remoteReady || !currentProjectId) return;
  window.clearTimeout(saveFloorTimers.get(floorId));
  saveFloorTimers.set(floorId, window.setTimeout(() => saveFloorRemote(floorId), 450));
}

async function saveFloorRemote(floorId) {
  const floor = state.floors.find((item) => item.id === floorId);
  if (!remoteReady || !floor) return;

  await withRealtimeSuppressed(async () => {
    const { error } = await supabaseClient
      .from("floors")
      .update({
        name: floor.name,
        unit_count: floor.units.length
      })
      .eq("id", floorId);
    if (error) console.error(error);
  });
}

async function deleteStageRemote(stageId) {
  if (!remoteReady) return;
  await withRealtimeSuppressed(async () => {
    const { error } = await supabaseClient.from("stages").delete().eq("id", stageId);
    if (error) console.error(error);
  });
}

async function deleteFloorRemote(floorId) {
  if (!remoteReady) return;
  await withRealtimeSuppressed(async () => {
    const { error } = await supabaseClient.from("floors").delete().eq("id", floorId);
    if (error) console.error(error);
  });
}

async function persistStageOrder() {
  if (!remoteReady) return;
  await withRealtimeSuppressed(async () => {
    const updates = state.stages.map((stage, index) => (
      supabaseClient.from("stages").update({ sort_order: index }).eq("id", stage.id)
    ));
    const results = await Promise.all(updates);
    results.forEach(({ error }) => error && console.error(error));
  });
}

async function persistFloorOrder() {
  if (!remoteReady) return;
  await withRealtimeSuppressed(async () => {
    const updates = state.floors.map((floor, index) => (
      supabaseClient.from("floors").update({ sort_order: index }).eq("id", floor.id)
    ));
    const results = await Promise.all(updates);
    results.forEach(({ error }) => error && console.error(error));
  });
}

async function addFloorRowsFromMatrix() {
  const name = elements.floorMatrixName.value.trim();
  const unitCount = Number(elements.floorMatrixUnits.value);
  const repeatCount = Number(elements.floorMatrixRepeat.value);

  if (!name || unitCount < 1 || repeatCount < 1) return;

  const newFloors = Array.from({ length: repeatCount }, (_, index) => ({
    id: crypto.randomUUID(),
    name: incrementFloorName(name, index),
    units: generateUnitList(unitCount)
  })).reverse();

  if (remoteReady && currentProjectId) {
    const startOrder = state.floors.length;
    const rows = newFloors.map((floor, index) => ({
      project_id: currentProjectId,
      name: floor.name,
      unit_count: floor.units.length,
      sort_order: startOrder + index
    }));

    await withRealtimeSuppressed(async () => {
      const { error } = await supabaseClient.from("floors").insert(rows);
      if (error) console.error(error);
    });
    await loadRemoteWorkspace();
    return;
  }

  state.floors.push(...newFloors);
  saveAndRender();
}

async function addStageFromInput() {
  const name = elements.stageName.value.trim();
  if (!name) return;

  const stage = { id: crypto.randomUUID(), name, trackingLevel: "unit" };
  elements.stageName.value = "";

  if (remoteReady && currentProjectId) {
    await withRealtimeSuppressed(async () => {
      const { data, error } = await supabaseClient
        .from("stages")
        .insert({
          project_id: currentProjectId,
          name,
          tracking_level: "unit",
          sort_order: state.stages.length
        })
        .select("id")
        .single();

      if (error) {
        console.error(error);
        return;
      }
      activeStageId = data.id;
    });
    await loadRemoteWorkspace();
    return;
  }

  state.stages.push(stage);
  activeStageId = stage.id;
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
  elements.measurementsView.classList.toggle("active", activeView === "measurements");

  elements.projectName.value = state.projectName;
  elements.builderName.value = state.builderName;
  elements.projectLocation.value = state.projectLocation;
  elements.updatedAt.value = state.updatedAt;
  elements.targetDeliveryDate.value = state.targetDeliveryDate;
  elements.forecastFinishDate.value = state.forecastFinishDate;
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
  renderMeasurements();
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
      persistStageOrder();
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
      queueSaveStage(stage.id);
      saveAndRender(false);
    });

    const control = document.createElement("label");
    control.className = "stage-control";

    const controlInput = document.createElement("input");
    controlInput.type = "checkbox";
    controlInput.checked = isFloorControlled(stage.id);
    controlInput.addEventListener("change", () => {
      stage.trackingLevel = controlInput.checked ? "floor" : "unit";
      queueSaveStage(stage.id);
      saveAndRender();
    });

    const controlText = document.createElement("span");
    controlText.textContent = "Por pavimento";
    control.append(controlInput, controlText);

    const remove = document.createElement("button");
    remove.className = "danger-button icon-button";
    remove.type = "button";
    remove.textContent = "-";
    remove.title = "Remover etapa";
    remove.setAttribute("aria-label", "Remover etapa");
    remove.addEventListener("click", () => {
      state.stages = state.stages.filter((item) => item.id !== stage.id);
      delete state.checks[stage.id];
      deleteStageRemote(stage.id);
      saveAndRender();
    });

    row.append(handle, order, nameInput, control, remove);
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
      persistFloorOrder();
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
      queueSaveFloor(floor.id);
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
      queueSaveFloor(floor.id);
      saveAndRender(false);
    });

    const preview = document.createElement("div");
    preview.className = "floor-meta";
    preview.textContent = floor.units.join(", ");

    const remove = document.createElement("button");
    remove.className = "danger-button icon-button";
    remove.type = "button";
    remove.textContent = "-";
    remove.title = "Remover pavimento";
    remove.setAttribute("aria-label", "Remover pavimento");
    remove.addEventListener("click", () => {
      state.floors = state.floors.filter((item) => item.id !== floor.id);
      removeChecksForFloor(floor.id);
      deleteFloorRemote(floor.id);
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

  if (isFloorControlled(activeStageId)) {
    renderFloorTrackingMatrix();
    return;
  }

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

  playStageSlide();
}

function renderFloorTrackingMatrix() {
  elements.trackingMatrix.style.gridTemplateColumns = "124px 118px";

  addMatrixCell("", "matrix-cell header corner");
  addMatrixCell("Pavimento", "matrix-cell header");

  state.floors.forEach((floor) => {
    addMatrixCell(floor.name, "matrix-cell floor-label");

    const cell = document.createElement("div");
    cell.className = "matrix-cell";

    const button = document.createElement("button");
    button.className = `check-button ${isChecked(activeStageId, floor.id, FLOOR_CHECK_KEY) ? "checked" : ""}`;
    button.type = "button";
    button.setAttribute("aria-label", `${floor.name} concluído`);
    button.addEventListener("click", () => toggleCheck(activeStageId, floor.id, FLOOR_CHECK_KEY));
    cell.append(button);
    elements.trackingMatrix.append(cell);
  });

  const progress = calculateProgress(activeStageId);
  elements.trackingPercent.textContent = formatPercent(progress.percent);
  elements.trackingCount.textContent = `${progress.done} de ${progress.total} pavimentos`;

  playStageSlide();
}

function playStageSlide() {
  if (stageSlideDirection) {
    void elements.trackingMatrix.offsetWidth;
    elements.trackingMatrix.classList.add(stageSlideDirection === "next" ? "slide-next" : "slide-previous");
    stageSlideDirection = "";
  }
}

function renderReview() {
  elements.summaryStrip.innerHTML = "";
  elements.reviewGrid.innerHTML = "";

  renderReportHeader();
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

      const units = isFloorControlled(stage.id) ? [FLOOR_CHECK_KEY] : floor.units;

      units.forEach((unit) => {
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

async function uploadMeasurement() {
  if (!remoteReady || !currentProjectId) {
    alert("Faça login para subir a medição.");
    return;
  }

  if (state.stages.length === 0) {
    alert("Cadastre etapas antes de subir a medição.");
    return;
  }

  const sortOrder = state.measurements.length;
  const label = `M${String(sortOrder + 1).padStart(2, "0")}`;
  const measuredAt = state.updatedAt ? state.updatedAt.slice(0, 10) : toDateInputValue(new Date());

  await withRealtimeSuppressed(async () => {
    const { data: measurement, error } = await supabaseClient
      .from("measurements")
      .insert({
        project_id: currentProjectId,
        label,
        measured_at: measuredAt,
        forecast_finish_date: state.forecastFinishDate || null,
        sort_order: sortOrder,
        created_by: currentUser?.id || null
      })
      .select("id")
      .single();

    if (error) {
      console.error(error);
      alert("Não foi possível subir a medição.");
      return;
    }

    const totals = state.stages.map((stage) => {
      const progress = calculateProgress(stage.id);
      return {
        measurement_id: measurement.id,
        project_id: currentProjectId,
        stage_id: stage.id,
        completed_count: progress.done,
        total_count: progress.total
      };
    });

    const { error: totalsError } = await supabaseClient
      .from("measurement_stage_totals")
      .insert(totals);

    if (totalsError) {
      console.error(totalsError);
      alert("A medição foi criada, mas os totais não foram salvos.");
    }
  });

  await loadRemoteWorkspace();
  activeView = "measurements";
  render();
}

function renderMeasurements() {
  elements.measurementReport.innerHTML = "";
  elements.trendReport.innerHTML = "";

  renderMeasurementTable();
  renderTrendChart();
}

function renderMeasurementTable() {
  const tableWrap = document.createElement("article");
  tableWrap.className = "measurement-table-card";

  const header = document.createElement("header");
  const title = document.createElement("h2");
  title.textContent = "Unidades concluídas por medição";
  header.append(title);
  tableWrap.append(header);

  const scroller = document.createElement("div");
  scroller.className = "measurement-table-scroll";

  const table = document.createElement("table");
  table.className = "measurement-table";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  ["Serviços", "Unidade", "Qtd. total", "Atual", ...state.measurements.map(formatMeasurementHeader)].forEach((label) => {
    const th = document.createElement("th");
    th.textContent = label;
    headRow.append(th);
  });
  thead.append(headRow);

  const tbody = document.createElement("tbody");
  state.stages.forEach((stage) => {
    const progress = calculateProgress(stage.id);
    const row = document.createElement("tr");
    const unitLabel = isFloorControlled(stage.id) ? "PAV." : "APTO";

    [stage.name, unitLabel, progress.total, progress.done].forEach((value) => {
      const td = document.createElement("td");
      td.textContent = value;
      row.append(td);
    });

    state.measurements.forEach((measurement, index) => {
      const previous = index === 0 ? 0 : (state.measurements[index - 1].totals[stage.id]?.completed || 0);
      const current = measurement.totals[stage.id]?.completed || 0;
      const delta = Math.max(0, current - previous);
      const td = document.createElement("td");
      td.textContent = delta > 0 ? String(delta) : "";
      row.append(td);
    });

    tbody.append(row);
  });

  table.append(thead, tbody);
  scroller.append(table);
  tableWrap.append(scroller);
  elements.measurementReport.append(tableWrap);
}

function renderTrendChart() {
  const card = document.createElement("article");
  card.className = "trend-card";

  const title = document.createElement("h2");
  title.textContent = "Variação de Tendência para Término";
  card.append(title);

  const points = state.measurements
    .filter((measurement) => measurement.forecastFinishDate)
    .map((measurement) => ({
      label: formatShortDate(measurement.measuredAt),
      date: measurement.forecastFinishDate,
      time: new Date(`${measurement.forecastFinishDate}T00:00:00`).getTime()
    }));

  if (points.length === 0 || !state.targetDeliveryDate) {
    const empty = document.createElement("p");
    empty.className = "empty-note";
    empty.textContent = "Informe a meta de entrega e suba medições com término atualizado para visualizar o gráfico.";
    card.append(empty);
    elements.trendReport.append(card);
    return;
  }

  const targetTime = new Date(`${state.targetDeliveryDate}T00:00:00`).getTime();
  const values = [...points.map((point) => point.time), targetTime];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const padding = Math.max(1, (max - min) * 0.15);
  const minY = min - padding;
  const maxY = max + padding;
  const width = 900;
  const height = 300;
  const left = 70;
  const right = 28;
  const top = 28;
  const bottom = 54;
  const innerWidth = width - left - right;
  const innerHeight = height - top - bottom;
  const xFor = (index) => left + (points.length === 1 ? innerWidth / 2 : (innerWidth * index) / (points.length - 1));
  const yFor = (time) => top + innerHeight - ((time - minY) / (maxY - minY)) * innerHeight;
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${xFor(index)} ${yFor(point.time)}`).join(" ");
  const targetY = yFor(targetTime);

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.classList.add("trend-svg");

  svg.innerHTML = `
    <line x1="${left}" y1="${targetY}" x2="${width - right}" y2="${targetY}" class="target-line" />
    <text x="${left + 12}" y="${targetY - 8}" class="target-label">META</text>
    <text x="${width - right - 92}" y="${targetY - 8}" class="target-label">${formatShortDate(state.targetDeliveryDate)}</text>
    <path d="${path}" class="trend-line" />
    ${points.map((point, index) => `
      <circle cx="${xFor(index)}" cy="${yFor(point.time)}" r="4" class="trend-point" />
      <text x="${xFor(index)}" y="${yFor(point.time) - 10}" class="trend-value">${daysBetween(state.targetDeliveryDate, point.date)}</text>
      <text x="${xFor(index)}" y="${height - 18}" class="trend-x">${point.label}</text>
    `).join("")}
  `;

  card.append(svg);
  elements.trendReport.append(card);
}

function renderReportHeader() {
  const report = document.createElement("article");
  report.className = "report-header";

  const logoBox = document.createElement("div");
  logoBox.className = "report-logo";
  if (state.builderLogo) {
    const logo = document.createElement("img");
    logo.src = state.builderLogo;
    logo.alt = "";
    logoBox.append(logo);
  }

  const info = document.createElement("div");
  info.className = "report-info";

  const title = document.createElement("h2");
  title.textContent = state.projectName || "Obra sem nome";

  const meta = document.createElement("p");
  const parts = [state.builderName, state.projectLocation].filter(Boolean);
  meta.textContent = parts.length > 0 ? parts.join(" | ") : "Dados da obra não informados";

  const updated = document.createElement("span");
  updated.textContent = state.updatedAt ? `Atualizado em ${formatDateTime(state.updatedAt)}` : "Atualização não informada";

  info.append(title, meta, updated);

  const photoBox = document.createElement("div");
  photoBox.className = "report-photo";
  if (state.projectPhoto) {
    const photo = document.createElement("img");
    photo.src = state.projectPhoto;
    photo.alt = "";
    photoBox.append(photo);
  }

  report.append(logoBox, info, photoBox);
  elements.summaryStrip.append(report);
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
  saveProgressRemote(stageId, floorId, unit, state.checks[stageId][floorId][unit]);
  saveAndRender();
}

function isChecked(stageId, floorId, unit) {
  return Boolean(state.checks[stageId]?.[floorId]?.[unit]);
}

async function saveProgressRemote(stageId, floorId, unit, done) {
  if (!remoteReady || !currentProjectId || !stageId || !floorId || !unit) return;

  await withRealtimeSuppressed(async () => {
    const { error } = await supabaseClient
      .from("progress")
      .upsert({
        project_id: currentProjectId,
        stage_id: stageId,
        floor_id: floorId,
        unit_label: unit,
        done,
        updated_by: currentUser?.id || null,
        updated_at: new Date().toISOString()
      }, { onConflict: "stage_id,floor_id,unit_label" });

    if (error) console.error(error);
  });
}

function calculateProgress(stageId) {
  if (isFloorControlled(stageId)) {
    const total = state.floors.length;
    const done = state.floors.filter((floor) => isChecked(stageId, floor.id, FLOOR_CHECK_KEY)).length;

    return {
      total,
      done,
      percent: total === 0 ? 0 : done / total
    };
  }

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

function getStage(stageId) {
  return state.stages.find((stage) => stage.id === stageId);
}

function isFloorControlled(stageId) {
  return getStage(stageId)?.trackingLevel === "floor";
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
    onLoad(String(reader.result), file);
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
      targetDeliveryDate: parsed.targetDeliveryDate || initialState.targetDeliveryDate,
      forecastFinishDate: parsed.forecastFinishDate || initialState.forecastFinishDate,
      builderLogo: parsed.builderLogo || initialState.builderLogo,
      projectPhoto: parsed.projectPhoto || initialState.projectPhoto,
      floors: Array.isArray(parsed.floors) ? parsed.floors : initialState.floors,
      stages: Array.isArray(parsed.stages) ? parsed.stages.map(normalizeStage) : initialState.stages,
      checks: parsed.checks || {},
      measurements: Array.isArray(parsed.measurements) ? parsed.measurements : initialState.measurements
    };
  } catch {
    return initialState;
  }
}

function normalizeStage(stage) {
  return {
    ...stage,
    trackingLevel: stage.trackingLevel === "floor" ? "floor" : "unit"
  };
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
        targetDeliveryDate: imported.targetDeliveryDate || "",
        forecastFinishDate: imported.forecastFinishDate || "",
        builderLogo: imported.builderLogo || "",
        projectPhoto: imported.projectPhoto || "",
        floors: Array.isArray(imported.floors) ? imported.floors : [],
        stages: Array.isArray(imported.stages) ? imported.stages.map(normalizeStage) : [],
        checks: imported.checks || {},
        measurements: Array.isArray(imported.measurements) ? imported.measurements : []
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

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(date);
}

function formatMeasurementHeader(measurement) {
  return `${measurement.label} - ${formatShortDate(measurement.measuredAt)}`;
}

function formatShortDate(value) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value || "";

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(date);
}

function daysBetween(targetDate, forecastDate) {
  if (!targetDate || !forecastDate) return "";
  const target = new Date(`${targetDate}T00:00:00`);
  const forecast = new Date(`${forecastDate}T00:00:00`);
  if (Number.isNaN(target.getTime()) || Number.isNaN(forecast.getTime())) return "";

  return Math.round((forecast - target) / (1000 * 60 * 60 * 24));
}

function toDateTimeInputValue(date) {
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 16);
}

function toDateInputValue(date) {
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

function slugify(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "obra";
}
