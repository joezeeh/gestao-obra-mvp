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
let suppressRealtimeUntil = 0;
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
  panelView: document.querySelector("#panelView"),
  projectName: document.querySelector("#projectName"),
  builderName: document.querySelector("#builderName"),
  projectLocation: document.querySelector("#projectLocation"),
  updatedAt: document.querySelector("#updatedAt"),
  targetDeliveryDate: document.querySelector("#targetDeliveryDate"),
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
  printPanelHeader: document.querySelector("#printPanelHeader"),
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

  elements.exportButton?.addEventListener("click", exportState);
  elements.importFile?.addEventListener("change", importState);

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
  const previousActiveStageId = activeStageId;

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
    builderLogo: project.logo_url || "",
    projectPhoto: project.photo_url || "",
    floors: (floors || []).map((floor) => {
      const savedUnits = Array.isArray(floor.unit_labels) ? floor.unit_labels.map(String).filter(Boolean) : [];
      return {
        id: floor.id,
        name: floor.name,
        units: savedUnits.length > 0 ? savedUnits : generateUnitList(floor.unit_count)
      };
    }),
    stages: (stages || []).map((stage) => normalizeStage({
      id: stage.id,
      name: stage.name,
      trackingLevel: stage.tracking_level
    })),
    checks: buildChecks(progressRows || []),
    measurements: buildMeasurements(measurements || [], measurementTotals || [])
  };

  activeStageId = state.stages.some((stage) => stage.id === previousActiveStageId)
    ? previousActiveStageId
    : state.stages[0]?.id || "";
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
  if (suppressRealtimeReload || Date.now() < suppressRealtimeUntil) return;

  if (isUserEditing()) {
    window.setTimeout(reloadFromRealtime, 900);
    return;
  }

  await loadRemoteWorkspace();
}

async function withRealtimeSuppressed(action) {
  suppressRealtimeReload = true;
  suppressRealtimeUntil = Date.now() + 2200;
  try {
    return await action();
  } finally {
    window.setTimeout(() => {
      suppressRealtimeReload = false;
    }, 900);
  }
}

function isUserEditing() {
  const active = document.activeElement;
  if (!active) return false;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName);
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
        unit_count: floor.units.length,
        unit_labels: floor.units
      })
      .eq("id", floorId);
    if (error && String(error.message || "").includes("unit_labels")) {
      const { error: fallbackError } = await supabaseClient
        .from("floors")
        .update({
          name: floor.name,
          unit_count: floor.units.length
        })
        .eq("id", floorId);
      if (fallbackError) console.error(fallbackError);
      return;
    }
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
      unit_labels: floor.units,
      sort_order: startOrder + index
    }));

    await withRealtimeSuppressed(async () => {
      const { error } = await supabaseClient.from("floors").insert(rows);
      if (error && String(error.message || "").includes("unit_labels")) {
        const fallbackRows = rows.map(({ unit_labels, ...row }) => row);
        const { error: fallbackError } = await supabaseClient.from("floors").insert(fallbackRows);
        if (fallbackError) console.error(fallbackError);
        return;
      }
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
  document.body.dataset.activeView = activeView;

  elements.tabs.forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.view === activeView);
  });

  elements.setupView.classList.toggle("active", activeView === "setup");
  elements.trackingView.classList.toggle("active", activeView === "tracking");
  elements.reviewView.classList.toggle("active", activeView === "review");
  elements.panelView.classList.toggle("active", activeView === "panel");

  elements.projectName.value = state.projectName;
  elements.builderName.value = state.builderName;
  elements.projectLocation.value = state.projectLocation;
  elements.updatedAt.value = state.updatedAt;
  elements.targetDeliveryDate.value = state.targetDeliveryDate;
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
  renderPanel();
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
      unitsInput.value = floor.units.join(", ");
      queueSaveFloor(floor.id);
      saveAndRender(false);
    });

    const unitsInput = document.createElement("input");
    unitsInput.type = "text";
    unitsInput.value = floor.units.join(", ");
    unitsInput.className = "grid-input";
    unitsInput.dataset.grid = "floors";
    unitsInput.dataset.row = String(index);
    unitsInput.dataset.col = "2";
    unitsInput.setAttribute("aria-label", "Numeração das unidades");
    unitsInput.addEventListener("change", () => {
      const units = parseUnitLabels(unitsInput.value);
      if (units.length === 0) {
        unitsInput.value = floor.units.join(", ");
        return;
      }
      floor.units = units;
      unitInput.value = String(floor.units.length);
      pruneChecksForFloor(floor.id, floor.units);
      queueSaveFloor(floor.id);
      saveAndRender(false);
    });

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

    row.append(handle, nameInput, unitInput, unitsInput, remove);
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
  elements.measurementReport.innerHTML = "";
  elements.trendReport.innerHTML = "";

  renderReportHeader();
  renderProgressChart();
  renderMeasurementTable();
  renderTrendChart();
}

function renderPanel() {
  elements.printPanelHeader.innerHTML = "";
  elements.reviewGrid.innerHTML = "";

  renderPrintPanelHeader();

  state.stages.forEach((stage) => {
    const progress = calculateProgress(stage.id);

    const stageCard = document.createElement("article");
    stageCard.className = "review-stage";

    const header = document.createElement("header");
    const title = document.createElement("strong");
    title.textContent = stage.name;
    const count = document.createElement("span");
    count.textContent = `${progress.done}/${progress.total} | ${formatPercent(progress.percent)}`;
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

function renderPrintPanelHeader() {
  const header = document.createElement("article");
  header.className = "print-panel-card";

  const logoBox = document.createElement("div");
  logoBox.className = "print-logo";
  if (state.builderLogo) {
    const logo = document.createElement("img");
    logo.src = state.builderLogo;
    logo.alt = "";
    logoBox.append(logo);
  }

  const info = document.createElement("div");
  info.className = "print-info";

  const title = document.createElement("h2");
  title.textContent = state.projectName || "Obra sem nome";

  const meta = document.createElement("p");
  const parts = [state.builderName, state.projectLocation].filter(Boolean);
  meta.textContent = parts.length > 0 ? parts.join(" | ") : "Dados da obra não informados";

  const updated = document.createElement("span");
  updated.textContent = state.updatedAt ? `Atualizado em ${formatDateTime(state.updatedAt)}` : "Atualização não informada";

  info.append(title, meta, updated);
  header.append(logoBox, info);
  elements.printPanelHeader.append(header);
}

async function uploadMeasurement() {
  if (!remoteReady || !currentProjectId) {
    alert("Faça login para subir a medição.");
    return;
  }

  if (!state.updatedAt) {
    alert("Informe a data de atualização antes de subir a medição.");
    return;
  }

  if (state.stages.length === 0) {
    alert("Cadastre etapas antes de subir a medição.");
    return;
  }

  const sortOrder = state.measurements.length;
  const label = `M${String(sortOrder + 1).padStart(2, "0")}`;
  const measuredAt = state.updatedAt.slice(0, 10);

  await withRealtimeSuppressed(async () => {
    const { data: measurement, error } = await supabaseClient
      .from("measurements")
      .insert({
        project_id: currentProjectId,
        label,
        measured_at: measuredAt,
        forecast_finish_date: null,
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
  activeView = "review";
  render();
}

function renderMeasurementTableLegacy() {
  const card = document.createElement("article");
  card.className = "measurement-table-card";

  const title = document.createElement("h2");
  title.textContent = "Unidades concluídas por medição";
  card.append(title);

  const scroller = document.createElement("div");
  scroller.className = "measurement-board-scroll";

  const board = document.createElement("div");
  board.className = "measurement-board";
  board.append(renderServiceBlock(), renderCurrentMeasurementBlock(), renderHistoryMeasurementBlock());

  scroller.append(board);
  card.append(scroller);
  elements.measurementReport.append(card);
}

function renderServiceBlock() {
  const table = document.createElement("table");
  table.className = "measurement-block services-block";
  table.innerHTML = `
    <thead>
      <tr><th colspan="4">SERVIÇOS</th></tr>
      <tr><th></th><th>ETAPA</th><th>UNIDADE</th><th>QTD. TOTAL</th></tr>
    </thead>
  `;

  const tbody = document.createElement("tbody");
  state.stages.forEach((stage, index) => {
    const progress = calculateProgress(stage.id);
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${index + 1}</td>
      <td>${escapeHtml(stage.name)}</td>
      <td>${isFloorControlled(stage.id) ? "PAV." : "APTO"}</td>
      <td>${progress.total}</td>
    `;
    tbody.append(row);
  });

  table.append(tbody);
  return table;
}

function renderCurrentMeasurementBlock() {
  const latest = state.measurements[state.measurements.length - 1];
  const table = document.createElement("table");
  table.className = "measurement-block current-block";
  table.innerHTML = `
    <thead>
      <tr><th>${latest?.label || "ATUAL"}</th></tr>
      <tr><th>${latest ? formatShortDate(latest.measuredAt) : "Sem medição"}</th></tr>
    </thead>
  `;

  const tbody = document.createElement("tbody");
  state.stages.forEach((stage) => {
    const progress = calculateProgress(stage.id);
    const row = document.createElement("tr");
    row.innerHTML = `<td>${progress.done || ""}</td>`;
    tbody.append(row);
  });

  table.append(tbody);
  return table;
}

function renderHistoryMeasurementBlock() {
  const wrap = document.createElement("div");
  wrap.className = "history-wrap";

  const forecastRow = document.createElement("div");
  forecastRow.className = "forecast-row";
  state.measurements.forEach((measurement) => {
    const cell = document.createElement("div");
    cell.className = "forecast-cell";

    const forecast = document.createElement("input");
    forecast.type = "date";
    forecast.value = measurement.forecastFinishDate || "";
    forecast.setAttribute("aria-label", "Término atualizado");
    forecast.addEventListener("change", () => updateMeasurement(measurement.id, { forecast_finish_date: forecast.value || null }));

    const remove = document.createElement("button");
    remove.className = "danger-button mini-remove";
    remove.type = "button";
    remove.textContent = "-";
    remove.title = "Remover medição";
    remove.addEventListener("click", () => deleteMeasurement(measurement.id));

    cell.append(forecast, remove);
    forecastRow.append(cell);
  });

  if (state.measurements.length === 0) {
    const cell = document.createElement("div");
    cell.className = "forecast-cell";
    cell.textContent = "Término atualizado";
    forecastRow.append(cell);
  }

  const table = document.createElement("table");
  table.className = "measurement-block history-block";
  const thead = document.createElement("thead");
  const titleRow = document.createElement("tr");
  const title = document.createElement("th");
  title.colSpan = Math.max(1, state.measurements.length);
  title.textContent = "UNIDADES CONCLUÍDAS POR MEDIÇÃO";
  titleRow.append(title);
  const dateRow = document.createElement("tr");
  state.measurements.forEach((measurement) => {
    const dateTh = document.createElement("th");
    dateTh.className = "measurement-edit-head";

    const headerStack = document.createElement("div");
    headerStack.className = "measurement-date-stack";

    const label = document.createElement("input");
    label.value = measurement.label;
    label.setAttribute("aria-label", "Nome da medição");
    label.addEventListener("change", () => updateMeasurement(measurement.id, { label: label.value.trim() || measurement.label }));

    const measuredAt = document.createElement("input");
    measuredAt.type = "date";
    measuredAt.value = measurement.measuredAt || "";
    measuredAt.setAttribute("aria-label", "Data da medição");
    measuredAt.addEventListener("change", () => {
      if (!measuredAt.value) {
        measuredAt.value = measurement.measuredAt || "";
        return;
      }
      updateMeasurement(measurement.id, { measured_at: measuredAt.value });
    });

    headerStack.append(label, measuredAt);
    dateTh.append(headerStack);
    dateRow.append(dateTh);
  });

  if (state.measurements.length === 0) {
    const th = document.createElement("th");
    th.textContent = "Sem medições";
    dateRow.append(th);
  }

  thead.append(titleRow, dateRow);

  const tbody = document.createElement("tbody");
  state.stages.forEach((stage) => {
    const row = document.createElement("tr");

    state.measurements.forEach((measurement, index) => {
      const previous = index === 0 ? 0 : (state.measurements[index - 1].totals[stage.id]?.completed || 0);
      const current = measurement.totals[stage.id]?.completed || 0;
      const delta = Math.max(0, current - previous);
      const td = document.createElement("td");
      const input = document.createElement("input");
      input.className = "measurement-delta-input";
      input.type = "number";
      input.min = "0";
      input.value = delta > 0 ? String(delta) : "";
      input.addEventListener("change", () => updateMeasurementDelta(measurement.id, stage.id, Number(input.value) || 0));
      td.append(input);
      row.append(td);
    });

    if (state.measurements.length === 0) {
      const td = document.createElement("td");
      td.textContent = "";
      row.append(td);
    }

    tbody.append(row);
  });

  table.append(thead, tbody);
  wrap.append(forecastRow, table);
  return wrap;
}

function renderMeasurementTable() {
  const card = document.createElement("article");
  card.className = "measurement-table-card";

  const header = document.createElement("header");
  const title = document.createElement("h2");
  title.textContent = "Unidades concluídas por medição";
  header.append(title);
  card.append(header);

  card.append(renderMeasurementSplitLayout());
  elements.measurementReport.append(card);
}

function renderMeasurementSplitLayout() {
  const wrap = document.createElement("div");
  wrap.className = "measurement-excel-scroll";

  const measurements = state.measurements;
  const visibleMeasurements = measurements.slice(-4);
  const latest = measurements[measurements.length - 1];
  const startIndex = Math.max(0, measurements.length - visibleMeasurements.length);
  const historySlots = 4;

  const table = document.createElement("table");
  table.className = "measurement-excel-table";

  const colgroup = document.createElement("colgroup");
  [
    { className: "id-col", width: "3%" },
    { className: "stage-col", width: "24%" },
    { className: "unit-col", width: "7%" },
    { className: "total-col", width: "8%" },
    { className: "gap-col", width: "1%" },
    { className: "current-col", width: "12%" },
    { className: "gap-col", width: "1%" },
    { className: "history-col", width: "11%" },
    { className: "history-col", width: "11%" },
    { className: "history-col", width: "11%" },
    { className: "history-col", width: "11%" }
  ].forEach(({ width, className }) => {
    const col = document.createElement("col");
    if (width) col.style.width = width;
    col.className = className;
    colgroup.append(col);
  });

  const thead = document.createElement("thead");
  const groupRow = document.createElement("tr");
  groupRow.append(
    createMeasurementHeader("SERVIÇOS", "group services-title", { colSpan: 4 }),
    createMeasurementHeader("", "gap", { rowSpan: 3 }),
    createMeasurementHeader("MEDIÇÃO ATUAL", "group current-title"),
    createMeasurementHeader("", "gap", { rowSpan: 3 }),
    createMeasurementHeader("UNIDADES CONCLUÍDAS POR MEDIÇÃO", "group history-title", { colSpan: historySlots })
  );

  const labelRow = document.createElement("tr");
  labelRow.append(
    createMeasurementHeader("ETAPA", "subhead stage-subhead", { colSpan: 2, rowSpan: 2 }),
    createMeasurementHeader("UNID.", "subhead", { rowSpan: 2 }),
    createMeasurementHeader("QTD. TOTAL", "subhead", { rowSpan: 2 }),
    createMeasurementHeader(latest?.label || "ATUAL", "current-label")
  );

  visibleMeasurements.forEach((measurement) => {
    const th = createMeasurementHeader("", "measurement-edit-head history-label");
    const label = document.createElement("input");
    label.value = measurement.label;
    label.setAttribute("aria-label", "Nome da medição");
    label.addEventListener("change", () => updateMeasurement(measurement.id, { label: label.value.trim() || measurement.label }));
    th.append(label);
    labelRow.append(th);
  });

  Array.from({ length: historySlots - visibleMeasurements.length }).forEach(() => {
    labelRow.append(createMeasurementHeader("", "history-placeholder-cell"));
  });

  const dateRow = document.createElement("tr");
  dateRow.append(createMeasurementHeader(latest ? formatCompactDate(latest.measuredAt) : "Sem medição", "current-date"));

  visibleMeasurements.forEach((measurement) => {
    const th = createMeasurementHeader("", "measurement-edit-head history-date");
    th.append(createDateEditor(
      measurement.measuredAt,
      "Data da medição",
      (value) => {
        if (!value) return;
        updateMeasurement(measurement.id, { measured_at: value });
      },
      false,
      { compact: true }
    ));
    dateRow.append(th);
  });

  Array.from({ length: historySlots - visibleMeasurements.length }).forEach(() => {
    dateRow.append(createMeasurementHeader("", "history-placeholder-cell"));
  });

  thead.append(groupRow, labelRow, dateRow);

  const tbody = document.createElement("tbody");
  state.stages.forEach((stage, stageIndex) => {
    const progress = calculateProgress(stage.id);
    const row = document.createElement("tr");
    row.append(
      createMeasurementCell(stageIndex + 1, "number-cell"),
      createMeasurementCell(stage.name, "stage-name-cell"),
      createMeasurementCell(isFloorControlled(stage.id) ? "PAV." : "APTO"),
      createMeasurementCell(progress.total, "number-cell"),
      createMeasurementCell("", "gap"),
      createMeasurementCell(latest?.totals[stage.id]?.completed || "", "current-progress-cell number-cell"),
      createMeasurementCell("", "gap")
    );

    visibleMeasurements.forEach((measurement, measurementOffset) => {
      const measurementIndex = startIndex + measurementOffset;
      const previous = measurementIndex === 0 ? 0 : (measurements[measurementIndex - 1].totals[stage.id]?.completed || 0);
      const completed = measurement.totals[stage.id]?.completed || 0;
      const delta = Math.max(0, completed - previous);
      const cell = createMeasurementCell("", "history-value-cell");
      const input = document.createElement("input");
      input.className = "measurement-delta-input";
      input.type = "number";
      input.min = "0";
      input.value = delta > 0 ? String(delta) : "";
      input.addEventListener("change", () => updateMeasurementDelta(measurement.id, stage.id, Number(input.value) || 0));
      cell.append(input);
      row.append(cell);
    });

    Array.from({ length: historySlots - visibleMeasurements.length }).forEach(() => {
      row.append(createMeasurementCell("", "history-placeholder-cell"));
    });

    tbody.append(row);
  });

  const separatorRow = document.createElement("tr");
  separatorRow.className = "measurement-separator-row";
  [
    "",
    "",
    "",
    "",
    "gap",
    "",
    "gap",
    "",
    "",
    "",
    ""
  ].forEach((className) => {
    separatorRow.append(createMeasurementCell("", className));
  });
  tbody.append(separatorRow);

  const trendRow = document.createElement("tr");
  trendRow.className = "measurement-trend-row";
  trendRow.append(
    createMeasurementCell("TENDÊNCIA PARA TÉRMINO", "trend-label", { colSpan: 6 }),
    createMeasurementCell("", "gap")
  );

  visibleMeasurements.forEach((measurement) => {
    const cell = createMeasurementCell("", "forecast-date-cell");
    cell.append(createDateEditor(
      measurement.forecastFinishDate,
      `Tendência para término da ${measurement.label}`,
      (value) => updateMeasurement(measurement.id, { forecast_finish_date: value || null })
    ));
    trendRow.append(cell);
  });

  Array.from({ length: historySlots - visibleMeasurements.length }).forEach(() => {
    trendRow.append(createMeasurementCell("", "history-placeholder-cell"));
  });
  tbody.append(trendRow);

  table.append(colgroup, thead, tbody);
  wrap.append(table);
  return wrap;
}

function createMeasurementHeader(text, className = "", options = {}) {
  const th = document.createElement("th");
  th.className = className;
  th.textContent = text;
  if (options.colSpan) th.colSpan = options.colSpan;
  if (options.rowSpan) th.rowSpan = options.rowSpan;
  return th;
}

function createMeasurementCell(text, className = "", options = {}) {
  const td = document.createElement("td");
  td.className = className;
  td.textContent = text;
  if (options.colSpan) td.colSpan = options.colSpan;
  if (options.rowSpan) td.rowSpan = options.rowSpan;
  return td;
}

function renderServicesSplitTable() {
  const table = document.createElement("table");
  table.className = "measurement-split-table services-split-table";

  const thead = document.createElement("thead");
  thead.innerHTML = `
    <tr><th colspan="4">SERVIÇOS</th></tr>
    <tr><th>ID</th><th>ETAPA</th><th>UNID.</th><th>QTD. TOTAL</th></tr>
  `;

  const tbody = document.createElement("tbody");
  state.stages.forEach((stage, index) => {
    const progress = calculateProgress(stage.id);
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${index + 1}</td>
      <td class="stage-name-cell">${escapeHtml(stage.name)}</td>
      <td>${isFloorControlled(stage.id) ? "PAV." : "APTO"}</td>
      <td>${progress.total}</td>
    `;
    tbody.append(row);
  });

  table.append(thead, tbody);
  return table;
}

function renderCurrentSplitTable() {
  const latest = state.measurements[state.measurements.length - 1];
  const table = document.createElement("table");
  table.className = "measurement-split-table current-split-table";

  const thead = document.createElement("thead");
  const labelRow = document.createElement("tr");
  const label = document.createElement("th");
  label.textContent = latest?.label || "ATUAL";
  labelRow.append(label);
  const dateRow = document.createElement("tr");
  const date = document.createElement("th");
  date.textContent = latest ? formatShortDate(latest.measuredAt) : "Sem medição";
  dateRow.append(date);
  thead.append(labelRow, dateRow);

  const tbody = document.createElement("tbody");
  state.stages.forEach((stage) => {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.className = "current-progress-cell";
    cell.textContent = latest?.totals[stage.id]?.completed || "";
    row.append(cell);
    tbody.append(row);
  });

  table.append(thead, tbody);
  return table;
}

function renderHistorySplitTable() {
  const measurements = state.measurements;
  const columnCount = Math.max(5, measurements.length);
  const placeholderCount = columnCount - measurements.length;
  const table = document.createElement("table");
  table.className = "measurement-split-table history-split-table";

  const thead = document.createElement("thead");
  const titleRow = document.createElement("tr");
  const title = document.createElement("th");
  title.colSpan = columnCount;
  title.textContent = "UNIDADES CONCLUÍDAS POR MEDIÇÃO";
  titleRow.append(title);
  const headerRow = document.createElement("tr");

  if (measurements.length === 0) {
    const empty = document.createElement("th");
    empty.textContent = "Sem medições";
    headerRow.append(empty);
  } else {
    measurements.forEach((measurement) => {
      const th = document.createElement("th");
      th.className = "measurement-edit-head";
      const label = document.createElement("input");
      label.value = measurement.label;
      label.setAttribute("aria-label", "Nome da medição");
      label.addEventListener("change", () => updateMeasurement(measurement.id, { label: label.value.trim() || measurement.label }));
      const measuredAt = createDateEditor(
        measurement.measuredAt,
        "Data da medição",
        (value) => {
          if (!value) return;
          updateMeasurement(measurement.id, { measured_at: value });
        },
        false
      );
      const stack = document.createElement("div");
      stack.className = "measurement-date-stack";
      stack.append(label, measuredAt);
      th.append(stack);
      headerRow.append(th);
    });
  }

  Array.from({ length: placeholderCount }).forEach(() => {
    const th = document.createElement("th");
    th.className = "history-placeholder-cell";
    headerRow.append(th);
  });

  thead.append(titleRow, headerRow);

  const tbody = document.createElement("tbody");
  state.stages.forEach((stage) => {
    const row = document.createElement("tr");
    if (measurements.length === 0) {
      row.append(document.createElement("td"));
    } else {
      measurements.forEach((measurement, measurementIndex) => {
        const previous = measurementIndex === 0 ? 0 : (measurements[measurementIndex - 1].totals[stage.id]?.completed || 0);
        const completed = measurement.totals[stage.id]?.completed || 0;
        const delta = Math.max(0, completed - previous);
        const cell = document.createElement("td");
        const input = document.createElement("input");
        input.className = "measurement-delta-input";
        input.type = "number";
        input.min = "0";
        input.value = delta > 0 ? String(delta) : "";
        input.addEventListener("change", () => updateMeasurementDelta(measurement.id, stage.id, Number(input.value) || 0));
        cell.append(input);
        row.append(cell);
      });
    }
    Array.from({ length: placeholderCount }).forEach(() => {
      const cell = document.createElement("td");
      cell.className = "history-placeholder-cell";
      row.append(cell);
    });
    tbody.append(row);
  });

  table.append(thead, tbody);
  return table;
}

function renderMeasurementTrendLabel() {
  const label = document.createElement("div");
  label.className = "measurement-trend-label";
  label.textContent = "Tendência para término";
  return label;
}

function renderMeasurementTrendDates() {
  const measurements = state.measurements;
  const columnCount = Math.max(5, measurements.length);
  const placeholderCount = columnCount - measurements.length;
  const row = document.createElement("div");
  row.className = "measurement-trend-dates";

  if (measurements.length === 0) {
    const empty = document.createElement("div");
    empty.textContent = "Sem medições";
    row.append(empty);
  } else {
    measurements.forEach((measurement) => {
      const cell = document.createElement("div");
      cell.className = "forecast-date-cell";
      cell.append(createDateEditor(
        measurement.forecastFinishDate,
        `Tendência para término da ${measurement.label}`,
        (value) => updateMeasurement(measurement.id, { forecast_finish_date: value || null })
      ));
      row.append(cell);
    });
  }

  Array.from({ length: placeholderCount }).forEach(() => {
    const cell = document.createElement("div");
    cell.className = "history-placeholder-cell";
    row.append(cell);
  });

  return row;
}

function renderMeasurementColgroup() {
  const colgroup = document.createElement("colgroup");
  ["40px", "260px", "96px", "104px", "30px", "130px", "30px"].forEach((width, index) => {
    const col = document.createElement("col");
    col.style.width = width;
    if (index === 4 || index === 6) col.className = "measurement-gap-col";
    colgroup.append(col);
  });

  const measurementCount = Math.max(1, state.measurements.length);
  Array.from({ length: measurementCount }).forEach(() => {
    const col = document.createElement("col");
    col.style.width = "154px";
    colgroup.append(col);
  });

  return colgroup;
}

function renderMeasurementHead() {
  const thead = document.createElement("thead");
  const measurements = state.measurements;

  const groupRow = document.createElement("tr");
  groupRow.className = "measurement-group-row";
  const services = document.createElement("th");
  services.colSpan = 4;
  services.textContent = "SERVIÇOS";
  groupRow.append(services, createGapHeader());

  const latest = measurements[measurements.length - 1];
  const current = document.createElement("th");
  current.textContent = latest?.label || "ATUAL";
  groupRow.append(current, createGapHeader());

  const history = document.createElement("th");
  history.colSpan = Math.max(1, measurements.length);
  history.textContent = "UNIDADES CONCLUÍDAS POR MEDIÇÃO";
  groupRow.append(history);

  const headerRow = document.createElement("tr");
  headerRow.className = "measurement-column-row";
  ["ID", "ETAPA", "UNIDADE", "QTD. TOTAL"].forEach((label) => {
    const th = document.createElement("th");
    th.textContent = label;
    headerRow.append(th);
  });
  headerRow.append(createGapHeader());

  const currentDate = document.createElement("th");
  currentDate.textContent = latest ? formatShortDate(latest.measuredAt) : "Sem medição";
  headerRow.append(currentDate, createGapHeader());

  if (measurements.length === 0) {
    const th = document.createElement("th");
    th.textContent = "Sem medições";
    headerRow.append(th);
  } else {
    measurements.forEach((measurement) => {
      const th = document.createElement("th");
      th.className = "measurement-edit-head";

      const label = document.createElement("input");
      label.value = measurement.label;
      label.setAttribute("aria-label", "Nome da medição");
      label.addEventListener("change", () => updateMeasurement(measurement.id, { label: label.value.trim() || measurement.label }));

      const measuredAt = createDateEditor(
        measurement.measuredAt,
        "Data da medição",
        (value) => {
          if (!value) return;
          updateMeasurement(measurement.id, { measured_at: value });
        },
        false
      );

      const stack = document.createElement("div");
      stack.className = "measurement-date-stack";
      const remove = document.createElement("button");
      remove.className = "danger-button mini-remove screen-only";
      remove.type = "button";
      remove.textContent = "-";
      remove.title = "Remover medição";
      remove.setAttribute("aria-label", `Remover ${measurement.label}`);
      remove.addEventListener("click", () => deleteMeasurement(measurement.id));
      stack.append(label, measuredAt, remove);
      th.append(stack);
      headerRow.append(th);
    });
  }

  thead.append(groupRow, headerRow);
  return thead;
}

function renderMeasurementBody() {
  const tbody = document.createElement("tbody");

  state.stages.forEach((stage, index) => {
    const progress = calculateProgress(stage.id);
    const latest = state.measurements[state.measurements.length - 1];
    const row = document.createElement("tr");

    [
      index + 1,
      stage.name,
      isFloorControlled(stage.id) ? "PAV." : "APTO",
      progress.total
    ].forEach((value, cellIndex) => {
      const td = document.createElement("td");
      td.textContent = value;
      if (cellIndex === 1) td.className = "stage-name-cell";
      row.append(td);
    });

    row.append(createGapCell());

    const current = document.createElement("td");
    current.className = "current-progress-cell";
    current.textContent = latest?.totals[stage.id]?.completed || "";
    row.append(current, createGapCell());

    if (state.measurements.length === 0) {
      row.append(document.createElement("td"));
    } else {
      state.measurements.forEach((measurement, measurementIndex) => {
        const previous = measurementIndex === 0 ? 0 : (state.measurements[measurementIndex - 1].totals[stage.id]?.completed || 0);
        const completed = measurement.totals[stage.id]?.completed || 0;
        const delta = Math.max(0, completed - previous);
        const td = document.createElement("td");
        const input = document.createElement("input");
        input.className = "measurement-delta-input";
        input.type = "number";
        input.min = "0";
        input.value = delta > 0 ? String(delta) : "";
        input.addEventListener("change", () => updateMeasurementDelta(measurement.id, stage.id, Number(input.value) || 0));
        td.append(input);
        row.append(td);
      });
    }

    tbody.append(row);
  });

  tbody.append(renderMeasurementSpacerRow(), renderForecastFooterRow());
  return tbody;
}

function renderMeasurementSpacerRow() {
  const row = document.createElement("tr");
  row.className = "measurement-spacer-row";
  const cell = document.createElement("td");
  cell.colSpan = 7 + Math.max(1, state.measurements.length);
  row.append(cell);
  return row;
}

function renderForecastFooterRow() {
  const row = document.createElement("tr");
  row.className = "measurement-forecast-row";

  const label = document.createElement("td");
  label.colSpan = 7;
  label.textContent = "Tendência para término";
  row.append(label);

  if (state.measurements.length === 0) {
    const empty = document.createElement("td");
    empty.textContent = "Sem medições";
    row.append(empty);
    return row;
  }

  state.measurements.forEach((measurement) => {
    const cell = document.createElement("td");
    cell.className = "forecast-date-cell";
    cell.append(createDateEditor(
      measurement.forecastFinishDate,
      `Tendência para término da ${measurement.label}`,
      (value) => updateMeasurement(measurement.id, { forecast_finish_date: value || null })
    ));
    row.append(cell);
  });

  return row;
}

function createGapHeader() {
  const th = document.createElement("th");
  th.className = "measurement-gap";
  th.setAttribute("aria-hidden", "true");
  return th;
}

function createGapCell() {
  const td = document.createElement("td");
  td.className = "measurement-gap";
  td.setAttribute("aria-hidden", "true");
  return td;
}

function createDateEditor(value, label, onCommit, allowBlank = true, options = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = "date-editor";
  if (options.compact) wrapper.classList.add("compact-date-editor");

  const text = document.createElement("input");
  text.className = "date-text-input";
  text.type = "text";
  text.inputMode = "numeric";
  text.placeholder = options.compact ? "dd/mm/aa" : "dd/mm/aaaa";
  text.value = options.compact ? formatCompactDate(value) : formatDateForInput(value);
  text.setAttribute("aria-label", label);

  const picker = document.createElement("input");
  picker.className = "date-picker-input";
  picker.type = "date";
  picker.value = value || "";
  picker.title = label;
  picker.setAttribute("aria-label", `${label} pelo calendário`);

  const commitTextValue = () => {
    if (!text.value.trim()) {
      if (allowBlank) {
        picker.value = "";
        onCommit("");
        return;
      }
      text.value = options.compact ? formatCompactDate(picker.value) : formatDateForInput(picker.value);
      return;
    }

    const parsed = parseBrazilianDate(text.value);
    if (!parsed) {
      text.value = options.compact ? formatCompactDate(picker.value) : formatDateForInput(picker.value);
      return;
    }
    if (parsed === picker.value) return;
    picker.value = parsed;
    text.value = options.compact ? formatCompactDate(parsed) : formatDateForInput(parsed);
    onCommit(parsed);
  };

  text.addEventListener("input", () => {
    text.value = maskBrazilianDate(text.value, options.compact);
  });
  text.addEventListener("focus", () => text.select());
  text.addEventListener("blur", commitTextValue);
  text.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitTextValue();
      text.blur();
    }
  });

  picker.addEventListener("change", () => {
    text.value = options.compact ? formatCompactDate(picker.value) : formatDateForInput(picker.value);
    onCommit(picker.value || "");
  });

  wrapper.append(text, picker);
  return wrapper;
}

async function updateMeasurement(measurementId, changes) {
  const measurement = state.measurements.find((item) => item.id === measurementId);
  if (!measurement) return;

  if (Object.prototype.hasOwnProperty.call(changes, "label")) measurement.label = changes.label;
  if (Object.prototype.hasOwnProperty.call(changes, "measured_at")) measurement.measuredAt = changes.measured_at || "";
  if (Object.prototype.hasOwnProperty.call(changes, "forecast_finish_date")) {
    measurement.forecastFinishDate = changes.forecast_finish_date || "";
  }
  saveAndRender(false);

  if (!remoteReady) return;
  await withRealtimeSuppressed(async () => {
    const { error } = await supabaseClient
      .from("measurements")
      .update(changes)
      .eq("id", measurementId);
    if (error) console.error(error);
  });
  render();
}

async function updateMeasurementDelta(measurementId, stageId, delta) {
  const measurementIndex = state.measurements.findIndex((item) => item.id === measurementId);
  if (measurementIndex < 0) return;

  const previousCompleted = measurementIndex === 0
    ? 0
    : state.measurements[measurementIndex - 1].totals[stageId]?.completed || 0;
  const stageTotal = calculateProgress(stageId).total;
  const completed = Math.min(stageTotal, Math.max(0, previousCompleted + delta));
  const measurement = state.measurements[measurementIndex];

  if (!measurement.totals[stageId]) measurement.totals[stageId] = {};
  measurement.totals[stageId] = { completed, total: stageTotal };
  saveAndRender(false);

  if (!remoteReady || !currentProjectId) return;
  await withRealtimeSuppressed(async () => {
    const { error } = await supabaseClient
      .from("measurement_stage_totals")
      .upsert({
        measurement_id: measurementId,
        project_id: currentProjectId,
        stage_id: stageId,
        completed_count: completed,
        total_count: stageTotal
      }, { onConflict: "measurement_id,stage_id" });
    if (error) console.error(error);
  });
  render();
}

async function deleteMeasurement(measurementId) {
  const measurement = state.measurements.find((item) => item.id === measurementId);
  if (!measurement) return;

  const confirmed = window.confirm(`Remover a medição ${measurement.label}?`);
  if (!confirmed) return;

  state.measurements = state.measurements.filter((item) => item.id !== measurementId);
  saveAndRender();

  if (!remoteReady) return;
  await withRealtimeSuppressed(async () => {
    const { error } = await supabaseClient
      .from("measurements")
      .delete()
      .eq("id", measurementId);
    if (error) console.error(error);
  });
  await persistMeasurementOrder();
}

async function persistMeasurementOrder() {
  if (!remoteReady) return;

  await withRealtimeSuppressed(async () => {
    const updates = state.measurements.map((measurement, index) => (
      supabaseClient.from("measurements").update({ sort_order: index }).eq("id", measurement.id)
    ));
    const results = await Promise.all(updates);
    results.forEach(({ error }) => error && console.error(error));
  });
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
      label: formatMeasurementHeader(measurement),
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
  const minDate = new Date(Math.min(...values));
  const maxDate = new Date(Math.max(...values));
  const minYDate = new Date(minDate.getFullYear(), minDate.getMonth() - 1, 1);
  const maxYDate = new Date(maxDate.getFullYear(), maxDate.getMonth() + 2, 1);
  const minY = minYDate.getTime();
  const maxY = maxYDate.getTime();
  const yTicks = [];
  for (
    let tick = new Date(minYDate);
    tick.getTime() <= maxY;
    tick = new Date(tick.getFullYear(), tick.getMonth() + 1, 1)
  ) {
    yTicks.push(tick.getTime());
  }
  const width = 900;
  const height = 330;
  const left = 86;
  const right = 28;
  const top = 28;
  const bottom = 54;
  const innerWidth = width - left - right;
  const innerHeight = height - top - bottom;
  const xFor = (index) => {
    if (points.length === 1) return left + innerWidth / 2;
    const paddingRatio = points.length === 2 ? 0.28 : 0.1;
    const usableWidth = innerWidth * (1 - paddingRatio * 2);
    return left + innerWidth * paddingRatio + (usableWidth * index) / (points.length - 1);
  };
  const yFor = (time) => top + innerHeight - ((time - minY) / (maxY - minY)) * innerHeight;
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${xFor(index)} ${yFor(point.time)}`).join(" ");
  const targetY = yFor(targetTime);
  const valueLabelFor = (point) => {
    const pointY = yFor(point.time);
    const nearTarget = Math.abs(pointY - targetY) < 22;
    const putBelow = nearTarget || pointY < top + 28;
    return {
      y: pointY + (putBelow ? 22 : -10),
      className: `trend-value ${putBelow ? "below" : "above"}`
    };
  };

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.classList.add("trend-svg");

  svg.innerHTML = `
    ${yTicks.map((tick) => `
      <line x1="${left}" y1="${yFor(tick)}" x2="${width - right}" y2="${yFor(tick)}" class="trend-grid-line" />
      <text x="${left - 12}" y="${yFor(tick) + 4}" class="trend-y">${formatMonthTick(tick)}</text>
    `).join("")}
    <line x1="${left}" y1="${top}" x2="${left}" y2="${height - bottom}" class="trend-axis" />
    <line x1="${left}" y1="${height - bottom}" x2="${width - right}" y2="${height - bottom}" class="trend-axis" />
    <line x1="${left}" y1="${targetY}" x2="${width - right}" y2="${targetY}" class="target-line" />
    <text x="${left + 12}" y="${targetY - 8}" class="target-label">META</text>
    <text x="${width - right - 92}" y="${targetY - 8}" class="target-label">${formatShortDate(state.targetDeliveryDate)}</text>
    <path d="${path}" class="trend-line" />
    ${points.map((point, index) => `
      <circle cx="${xFor(index)}" cy="${yFor(point.time)}" r="6" class="trend-point" data-tooltip="${escapeHtml(`${point.label}|Término: ${formatShortDate(point.date)}|${formatDeviationDays(daysBetween(state.targetDeliveryDate, point.date))}`)}" />
      <text x="${xFor(index)}" y="${valueLabelFor(point).y}" class="${valueLabelFor(point).className}">${daysBetween(state.targetDeliveryDate, point.date)}</text>
      <text x="${xFor(index)}" y="${height - 34}" class="trend-x">${point.label}</text>
    `).join("")}
  `;

  const tooltip = document.createElement("div");
  tooltip.className = "trend-tooltip";
  card.append(svg, tooltip);
  wireTrendTooltip(card, tooltip);
  elements.trendReport.append(card);
}

function wireTrendTooltip(card, tooltip) {
  card.querySelectorAll(".trend-point").forEach((point) => {
    point.addEventListener("mouseenter", (event) => {
      const [title, subtitle, deviation] = event.currentTarget.dataset.tooltip.split("|");
      tooltip.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(subtitle || "")}</span><span>${escapeHtml(deviation || "")}</span>`;
      tooltip.classList.add("active");
      positionTrendTooltip(card, tooltip, event);
    });
    point.addEventListener("mousemove", (event) => positionTrendTooltip(card, tooltip, event));
    point.addEventListener("mouseleave", () => tooltip.classList.remove("active"));
  });
}

function positionTrendTooltip(card, tooltip, event) {
  const rect = card.getBoundingClientRect();
  tooltip.style.left = `${event.clientX - rect.left + 12}px`;
  tooltip.style.top = `${event.clientY - rect.top - 12}px`;
}

function renderReportHeader() {
  const report = document.createElement("article");
  report.className = "report-header";
  const latest = state.measurements[state.measurements.length - 1];

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
  updated.textContent = latest?.measuredAt
    ? `Atualizado em ${formatShortDate(latest.measuredAt)}`
    : (state.updatedAt ? `Atualizado em ${formatDateTime(state.updatedAt)}` : "Atualização não informada");

  info.append(title, meta, updated);

  const reportBadge = document.createElement("div");
  reportBadge.className = "report-badge";
  const reportTitle = document.createElement("strong");
  reportTitle.textContent = "Relatório de desempenho físico de obra";
  const reportMeasurement = document.createElement("span");
  reportMeasurement.textContent = latest ? formatMeasurementBadge(latest.label) : "Sem medição";
  reportBadge.append(reportTitle, reportMeasurement);

  report.append(logoBox, info, reportBadge);
  elements.summaryStrip.append(report);
}

function renderProgressChart() {
  const overview = document.createElement("section");
  overview.className = "dashboard-overview";

  const photoBox = document.createElement("article");
  photoBox.className = "dashboard-photo-card";
  if (state.projectPhoto) {
    const photo = document.createElement("img");
    photo.src = state.projectPhoto;
    photo.alt = "";
    photoBox.append(photo);
  }

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

    const doneCount = document.createElement("span");
    doneCount.className = "chart-count chart-count-done";
    doneCount.textContent = progress.done;

    const totalCount = document.createElement("span");
    totalCount.className = `chart-count chart-count-total ${progress.percent >= 1 ? "on-fill" : ""}`;
    totalCount.textContent = progress.total;

    const value = document.createElement("strong");
    value.textContent = formatPercent(progress.percent);

    if (progress.percent <= 0) track.append(fill, totalCount);
    else if (progress.percent < 1) track.append(fill, doneCount, totalCount);
    else track.append(fill, totalCount);
    row.append(label, track, value);
    chart.append(row);
  });

  overview.append(photoBox, chart);
  elements.summaryStrip.append(overview);
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

function parseUnitLabels(value) {
  return [...new Set(String(value)
    .split(/[,\n;]/)
    .map((item) => item.trim())
    .filter(Boolean))];
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

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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

function formatMeasurementBadge(label) {
  const match = String(label || "").match(/(\d+)/);
  if (!match) return `Medição ${label || ""}`.trim();
  return `Medição ${match[1].padStart(2, "0")}`;
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

function formatCompactDate(value) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value || "";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = String(date.getFullYear()).slice(-2);
  return `${day}/${month}/${year}`;
}

function formatDateForInput(value) {
  if (!value) return "";
  return formatShortDate(value);
}

function maskBrazilianDate(value, compact = false) {
  const maxLength = compact ? 6 : 8;
  const digits = String(value).replace(/\D/g, "").slice(0, maxLength);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function parseBrazilianDate(value) {
  const digits = String(value).replace(/\D/g, "");
  if (![6, 8].includes(digits.length)) return "";
  const day = Number(digits.slice(0, 2));
  const month = Number(digits.slice(2, 4));
  const year = digits.length === 6 ? 2000 + Number(digits.slice(4)) : Number(digits.slice(4));
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return "";
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function formatMonthTick(time) {
  const date = new Date(time);
  const month = new Intl.DateTimeFormat("pt-BR", { month: "short" })
    .format(date)
    .replace(".", "")
    .toUpperCase();
  return `${month} ${date.getFullYear()}`;
}

function daysBetween(targetDate, forecastDate) {
  if (!targetDate || !forecastDate) return "";
  const target = new Date(`${targetDate}T00:00:00`);
  const forecast = new Date(`${forecastDate}T00:00:00`);
  if (Number.isNaN(target.getTime()) || Number.isNaN(forecast.getTime())) return "";

  return Math.round((forecast - target) / (1000 * 60 * 60 * 24));
}

function formatDeviationDays(value) {
  if (value === "" || value === null || value === undefined) return "Desvio:";
  const unit = Math.abs(Number(value)) === 1 ? "dia" : "dias";
  return `Desvio: ${value} ${unit}`;
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
