const state = {
  categories: [],
  incidentTypes: [],
  selectedCategory: "全部",
  selectedScopeCategories: new Set(),
  selectedPersonIds: new Set(),
  people: [],
  summary: null,
  activeGroups: [],
  history: [],
  eventSource: null
};

const REMEMBER_KEY = "attendance.rememberLogin";
const USERNAME_KEY = "attendance.username";
const PASSWORD_KEY = "attendance.password";
const HIDDEN_CATEGORIES = new Set(["一年級", "二年級", "三年級", "四年級"]);

const els = {
  loginView: document.querySelector("#loginView"),
  loginForm: document.querySelector("#loginForm"),
  loginUsername: document.querySelector("#loginUsername"),
  loginPassword: document.querySelector("#loginPassword"),
  rememberLogin: document.querySelector("#rememberLogin"),
  loginError: document.querySelector("#loginError"),
  appShells: document.querySelectorAll(".app-shell"),
  logoutButton: document.querySelector("#logoutButton"),
  clock: document.querySelector("#clock"),
  connectionStatus: document.querySelector("#connectionStatus"),
  categoryTabs: document.querySelector("#categoryTabs"),
  importFile: document.querySelector("#importFile"),
  expectedCount: document.querySelector("#expectedCount"),
  incidentCount: document.querySelector("#incidentCount"),
  actualCount: document.querySelector("#actualCount"),
  scopeFilter: document.querySelector("#scopeFilter"),
  scopeCategoryList: document.querySelector("#scopeCategoryList"),
  incidentCards: document.querySelector("#incidentCards"),
  searchInput: document.querySelector("#searchInput"),
  peopleRows: document.querySelector("#peopleRows"),
  bulkActions: document.querySelector("#bulkActions"),
  selectedCount: document.querySelector("#selectedCount"),
  selectVisiblePeople: document.querySelector("#selectVisiblePeople"),
  batchIncidentType: document.querySelector("#batchIncidentType"),
  batchStartAt: document.querySelector("#batchStartAt"),
  batchEndAt: document.querySelector("#batchEndAt"),
  batchNote: document.querySelector("#batchNote"),
  applyBatchIncident: document.querySelector("#applyBatchIncident"),
  clearSelection: document.querySelector("#clearSelection"),
  activeIncidents: document.querySelector("#activeIncidents"),
  activeIncidentsPanel: document.querySelector("#activeIncidentsPanel"),
  historyFilters: document.querySelector("#historyFilters"),
  historyDate: document.querySelector("#historyDate"),
  historyPerson: document.querySelector("#historyPerson"),
  historyType: document.querySelector("#historyType"),
  historyRows: document.querySelector("#historyRows"),
  incidentTypeForm: document.querySelector("#incidentTypeForm"),
  newIncidentType: document.querySelector("#newIncidentType"),
  incidentTypeList: document.querySelector("#incidentTypeList"),
  dialog: document.querySelector("#incidentDialog"),
  incidentForm: document.querySelector("#incidentForm"),
  dialogTitle: document.querySelector("#dialogTitle"),
  incidentId: document.querySelector("#incidentId"),
  personId: document.querySelector("#personId"),
  personLabel: document.querySelector("#personLabel"),
  incidentType: document.querySelector("#incidentType"),
  startAt: document.querySelector("#startAt"),
  endAt: document.querySelector("#endAt"),
  endAtLabel: document.querySelector("#endAtLabel"),
  note: document.querySelector("#note"),
  formError: document.querySelector("#formError"),
  closeDialog: document.querySelector("#closeDialog"),
  cancelDialog: document.querySelector("#cancelDialog"),
  incidentPeopleDialog: document.querySelector("#incidentPeopleDialog"),
  incidentPeopleTitle: document.querySelector("#incidentPeopleTitle"),
  incidentPeopleList: document.querySelector("#incidentPeopleList"),
  closeIncidentPeople: document.querySelector("#closeIncidentPeople"),
  toast: document.querySelector("#toast")
};

function apiUrl(path, params = {}) {
  const url = new URL(path, window.location.origin);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  }
  return url;
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && !String(path).includes("/api/auth/login")) {
      showLogin();
    }
    const detail = Array.isArray(data.errors) ? `：${data.errors.join("；")}` : "";
    throw new Error(`${data.message || "請求失敗"}${detail}`);
  }
  return data;
}

function showLogin() {
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
  els.loginView.hidden = false;
  for (const shell of els.appShells) shell.hidden = true;
}

function showApp() {
  els.loginView.hidden = true;
  for (const shell of els.appShells) shell.hidden = false;
}

function loadRememberedLogin() {
  const remember = window.localStorage.getItem(REMEMBER_KEY) === "true";
  els.rememberLogin.checked = remember;
  if (remember) {
    els.loginUsername.value = window.localStorage.getItem(USERNAME_KEY) || "";
    els.loginPassword.value = window.localStorage.getItem(PASSWORD_KEY) || "";
  }
}

function storeRememberedLogin(username, password) {
  if (els.rememberLogin.checked) {
    window.localStorage.setItem(REMEMBER_KEY, "true");
    window.localStorage.setItem(USERNAME_KEY, username);
    window.localStorage.setItem(PASSWORD_KEY, password);
  } else {
    window.localStorage.removeItem(REMEMBER_KEY);
    window.localStorage.removeItem(USERNAME_KEY);
    window.localStorage.removeItem(PASSWORD_KEY);
  }
}

async function loginWithCredentials(username, password) {
  const result = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password })
  });
  storeRememberedLogin(username, password);
  return result;
}

async function ensureAuthenticated() {
  loadRememberedLogin();
  const me = await request("/api/auth/me");
  if (me.authenticated) {
    showApp();
    return true;
  }

  if (els.rememberLogin.checked && els.loginUsername.value && els.loginPassword.value) {
    try {
      await loginWithCredentials(els.loginUsername.value, els.loginPassword.value);
      showApp();
      return true;
    } catch {
      showLogin();
      return false;
    }
  }

  showLogin();
  return false;
}

function formatDateTime(value) {
  if (!value) return "未設定";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(value));
}

function formatDateTimeLong(value) {
  if (!value) return "未設定";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(value));
}

function toLocalInputValue(date = new Date()) {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}`;
}

function isoToInputValue(value) {
  if (!value) return "";
  return toLocalInputValue(new Date(value));
}

function inputValueToIso(value) {
  if (!value) return null;
  return `${value}:00+08:00`;
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => els.toast.classList.remove("show"), 2800);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setConnectionStatus(status) {
  els.connectionStatus.classList.remove("online", "offline");
  if (status === "online") {
    els.connectionStatus.textContent = "已連線";
    els.connectionStatus.classList.add("online");
  } else if (status === "offline") {
    els.connectionStatus.textContent = "正在重新連線";
    els.connectionStatus.classList.add("offline");
  } else {
    els.connectionStatus.textContent = "連線中";
  }
}

function updateClock() {
  els.clock.textContent = new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(new Date());
}

function renderCategories() {
  els.categoryTabs.innerHTML = "";
  for (const category of state.categories) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = category;
    button.classList.toggle("active", state.selectedCategory === category);
    button.addEventListener("click", () => {
      state.selectedCategory = category;
      state.selectedPersonIds.clear();
      renderCategories();
      renderScopeFilter();
      loadDashboard();
    });
    els.categoryTabs.append(button);
  }
}

function selectedRealCategories() {
  return state.categories.filter((category) => category !== "全部");
}

function requestScopeParams() {
  const params = { category: state.selectedCategory };
  if (state.selectedCategory === "全部") {
    params.categories = [...state.selectedScopeCategories].join(",");
  }
  return params;
}

function renderScopeFilter() {
  const realCategories = selectedRealCategories();
  els.scopeFilter.hidden = state.selectedCategory !== "全部";
  els.scopeCategoryList.innerHTML = "";

  for (const category of realCategories) {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = category;
    checkbox.checked = state.selectedScopeCategories.has(category);
    checkbox.dataset.scopeCategory = category;
    const text = document.createElement("span");
    text.textContent = category;
    label.append(checkbox, text);
    els.scopeCategoryList.append(label);
  }
}

function renderSummary() {
  const summary = state.summary || { expected: 0, incidentTotal: 0, actual: 0, incidents: [] };
  els.expectedCount.textContent = summary.expected;
  els.incidentCount.textContent = summary.incidentTotal;
  els.actualCount.textContent = summary.actual;
  els.incidentCards.innerHTML = "";
  const visibleIncidents = summary.incidents.filter((incident) => incident.count > 0);
  els.incidentCards.hidden = visibleIncidents.length === 0;

  for (const incident of visibleIncidents) {
    const card = document.createElement("article");
    card.className = "incident-card";
    card.tabIndex = 0;
    card.role = "button";
    card.dataset.action = "show-incident-people";
    card.dataset.incidentType = incident.type;
    card.setAttribute("aria-label", `查看${incident.type}人員`);
    const label = document.createElement("span");
    label.textContent = incident.type;
    const count = document.createElement("strong");
    count.textContent = incident.count;
    const unit = document.createElement("small");
    unit.textContent = "員";
    card.append(label, count, unit);
    els.incidentCards.append(card);
  }
}

function statusBadge(status) {
  const cls = status === "正常" ? "normal" : "incident";
  return `<span class="badge ${cls}">${escapeHtml(status)}</span>`;
}

function renderIncidentTypeControls() {
  const currentIncidentType = els.incidentType.value;
  const currentBatchIncidentType = els.batchIncidentType.value;
  const currentHistoryType = els.historyType.value || "全部";

  els.incidentType.innerHTML = "";
  els.batchIncidentType.innerHTML = "";
  for (const type of state.incidentTypes) {
    const option = document.createElement("option");
    option.value = type;
    option.textContent = type;
    els.incidentType.append(option);

    const batchOption = document.createElement("option");
    batchOption.value = type;
    batchOption.textContent = type;
    els.batchIncidentType.append(batchOption);
  }
  if (state.incidentTypes.includes(currentIncidentType)) {
    els.incidentType.value = currentIncidentType;
  }
  if (state.incidentTypes.includes(currentBatchIncidentType)) {
    els.batchIncidentType.value = currentBatchIncidentType;
  }

  els.historyType.innerHTML = "";
  const allOption = document.createElement("option");
  allOption.value = "全部";
  allOption.textContent = "全部事故";
  els.historyType.append(allOption);
  for (const type of state.incidentTypes) {
    const option = document.createElement("option");
    option.value = type;
    option.textContent = type;
    els.historyType.append(option);
  }
  els.historyType.value = state.incidentTypes.includes(currentHistoryType) ? currentHistoryType : "全部";

  els.incidentTypeList.innerHTML = "";
  for (const type of state.incidentTypes) {
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = type;
    els.incidentTypeList.append(badge);
  }
  updateBatchEndVisibility();
}

function isSelectablePerson(person) {
  return person.enabled && person.status === "正常";
}

function updateSelectionControls() {
  const selectedCount = state.selectedPersonIds.size;
  const selectableVisible = state.people.filter(isSelectablePerson);
  const selectedVisibleCount = selectableVisible.filter((person) => state.selectedPersonIds.has(person.id)).length;

  els.bulkActions.hidden = selectedCount === 0;
  els.selectedCount.textContent = `已選 ${selectedCount} 人`;
  els.selectVisiblePeople.checked = selectableVisible.length > 0 && selectedVisibleCount === selectableVisible.length;
  els.selectVisiblePeople.indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < selectableVisible.length;
  els.selectVisiblePeople.disabled = selectableVisible.length === 0;

  if (!els.batchStartAt.value) {
    els.batchStartAt.value = toLocalInputValue();
  }
}

function reconcileSelectedPeople() {
  for (const person of state.people) {
    if (!isSelectablePerson(person)) {
      state.selectedPersonIds.delete(person.id);
    }
  }
  updateSelectionControls();
}

function renderPeople() {
  els.peopleRows.innerHTML = "";
  if (state.people.length === 0) {
    els.peopleRows.innerHTML = `<tr><td colspan="6" class="muted">目前沒有符合條件的人員</td></tr>`;
    updateSelectionControls();
    return;
  }

  for (const person of state.people) {
    const tr = document.createElement("tr");
    const canAdd = person.enabled && person.status === "正常";
    const canDelete = person.status === "正常";
    tr.innerHTML = `
      <td class="select-col">
        <input type="checkbox" data-select-person-id="${person.id}" ${canAdd ? "" : "disabled"} ${state.selectedPersonIds.has(person.id) ? "checked" : ""} aria-label="勾選 ${escapeHtml(person.name)}" />
      </td>
      <td>${escapeHtml(person.name)}${person.enabled ? "" : ' <span class="badge voided">停用</span>'}</td>
      <td>${escapeHtml(person.id)}</td>
      <td>${escapeHtml(person.category)}</td>
      <td>${statusBadge(person.status)}</td>
      <td>
        <div class="row-actions">
          <button type="button" ${canAdd ? "" : "disabled"} data-action="add" data-person-id="${person.id}">登記事故</button>
          <button type="button" class="danger" ${canDelete ? "" : "disabled"} data-action="delete-person" data-person-id="${person.id}">刪除</button>
        </div>
      </td>
    `;
    els.peopleRows.append(tr);
  }
  updateSelectionControls();
}

function renderActiveIncidents() {
  els.activeIncidents.innerHTML = "";
  els.activeIncidentsPanel.hidden = state.activeGroups.length === 0;
  if (state.activeGroups.length === 0) {
    return;
  }

  for (const group of state.activeGroups) {
    const section = document.createElement("section");
    section.className = "incident-group";
    const title = document.createElement("h3");
    title.textContent = `${group.type}：${group.count} 員`;
    section.append(title);

    for (const incident of group.incidents) {
      const item = document.createElement("article");
      item.className = "incident-item";
      item.innerHTML = `
        <div>
          <strong>${incident.personName}</strong>
          <div class="muted">${incident.personId}｜${incident.personCategory}</div>
        </div>
        <div>${statusBadge(incident.type)}</div>
        <div>
          <div>開始：${formatDateTime(incident.startAt)}</div>
          <div class="muted">結束：${formatDateTime(incident.endAt)}</div>
        </div>
        <div class="incident-actions">
          <button type="button" class="secondary" data-action="edit" data-incident-id="${incident.id}">編輯</button>
          <button type="button" class="warning" data-action="end" data-incident-id="${incident.id}">結束事故</button>
        </div>
      `;
      section.append(item);
    }

    els.activeIncidents.append(section);
  }
}

function renderHistory() {
  els.historyRows.innerHTML = "";
  if (state.history.length === 0) {
    els.historyRows.innerHTML = `<div class="empty">沒有符合條件的歷史紀錄</div>`;
    return;
  }

  for (const incident of state.history) {
    const item = document.createElement("article");
    item.className = "history-item";
    item.innerHTML = `
      <div>
        <strong>${incident.personName}</strong>
        <div class="muted">${incident.personId}｜${incident.personCategory}</div>
      </div>
      <div>${incident.voided ? '<span class="badge voided">已作廢</span>' : statusBadge(incident.type)}</div>
      <div>
        <div>${formatDateTimeLong(incident.startAt)}</div>
        <div class="muted">至 ${formatDateTimeLong(incident.endAt)}</div>
        ${incident.note ? `<div class="muted">備註：${incident.note}</div>` : ""}
      </div>
      <div class="incident-actions">
        <button type="button" class="danger" ${incident.voided ? "disabled" : ""} data-action="void" data-incident-id="${incident.id}">作廢</button>
      </div>
    `;
    els.historyRows.append(item);
  }
}

async function loadDashboard() {
  const q = els.searchInput.value.trim();
  const params = requestScopeParams();
  const [summary, people, active, history] = await Promise.all([
    request(apiUrl("/api/attendance/summary", params)),
    request(apiUrl("/api/people", { ...params, q })),
    request(apiUrl("/api/incidents/active", params)),
    loadHistoryData()
  ]);
  state.summary = summary;
  state.people = people.people;
  state.activeGroups = active.groups;
  state.history = history.incidents;
  reconcileSelectedPeople();
  renderSummary();
  renderPeople();
  renderActiveIncidents();
  renderHistory();
}

async function loadIncidentTypes() {
  const data = await request("/api/incident-types");
  state.incidentTypes = data.incidentTypes;
  renderIncidentTypeControls();
}

async function refreshAll() {
  await loadIncidentTypes();
  await loadDashboard();
}

async function loadHistoryData() {
  return request(
    apiUrl("/api/incidents/history", {
      ...requestScopeParams(),
      date: els.historyDate.value,
      person: els.historyPerson.value.trim(),
      type: els.historyType.value
    })
  );
}

async function loadCategories() {
  const data = await request("/api/categories");
  state.categories = data.categories.filter((category) => category === "全部" || !HIDDEN_CATEGORIES.has(category));
  if (!state.categories.includes(state.selectedCategory)) {
    state.selectedCategory = "全部";
  }
  for (const category of [...state.selectedScopeCategories]) {
    if (!state.categories.includes(category)) {
      state.selectedScopeCategories.delete(category);
    }
  }
  if (state.selectedScopeCategories.size === 0) {
    for (const category of selectedRealCategories()) {
      state.selectedScopeCategories.add(category);
    }
  }
  renderCategories();
  renderScopeFilter();
}

function findPerson(id) {
  return state.people.find((person) => person.id === id);
}

function findIncident(id) {
  for (const group of state.activeGroups) {
    const incident = group.incidents.find((item) => item.id === id);
    if (incident) return incident;
  }
  return state.history.find((item) => item.id === id);
}

function activeIncidentsByType(type) {
  const group = state.activeGroups.find((item) => item.type === type);
  return group?.incidents || [];
}

function openIncidentPeopleDialog(type) {
  const incidents = activeIncidentsByType(type);
  els.incidentPeopleTitle.textContent = `${type}：${incidents.length} 人`;
  els.incidentPeopleList.innerHTML = "";

  for (const incident of incidents) {
    const item = document.createElement("article");
    item.className = "incident-people-item";
    const info = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = incident.personName;
    const detail = document.createElement("div");
    detail.className = "muted";
    detail.textContent = `${incident.personId}｜${incident.personCategory}｜開始 ${formatDateTime(incident.startAt)}`;
    info.append(name, detail);
    const badge = document.createElement("span");
    badge.className = "badge incident";
    badge.textContent = incident.type;
    item.append(info, badge);
    els.incidentPeopleList.append(item);
  }

  els.incidentPeopleDialog.showModal();
}

function openCreateDialog(person) {
  els.dialogTitle.textContent = "登記事故";
  els.incidentId.value = "";
  els.personId.value = person.id;
  els.personLabel.value = `${person.name}（${person.id}｜${person.category}）`;
  els.incidentType.value = state.incidentTypes[0] || "";
  els.startAt.value = toLocalInputValue();
  els.endAt.value = "";
  els.note.value = "";
  els.formError.textContent = "";
  updateEndAtVisibility();
  els.dialog.showModal();
}

function openEditDialog(incident) {
  els.dialogTitle.textContent = "編輯事故";
  els.incidentId.value = incident.id;
  els.personId.value = incident.personId;
  els.personLabel.value = `${incident.personName}（${incident.personId}｜${incident.personCategory}）`;
  els.incidentType.value = incident.type;
  els.startAt.value = isoToInputValue(incident.startAt);
  els.endAt.value = isoToInputValue(incident.endAt);
  els.note.value = incident.note || "";
  els.formError.textContent = "";
  updateEndAtVisibility();
  els.dialog.showModal();
}

function updateEndAtVisibility() {
  const isFullRest = els.incidentType.value === "全休";
  els.endAtLabel.hidden = isFullRest;
  if (isFullRest) els.endAt.value = "";
}

function updateBatchEndVisibility() {
  const isFullRest = els.batchIncidentType.value === "全休";
  els.batchEndAt.hidden = isFullRest;
  if (isFullRest) els.batchEndAt.value = "";
}

async function handleIncidentSubmit(event) {
  event.preventDefault();
  els.formError.textContent = "";

  const payload = {
    personId: els.personId.value,
    type: els.incidentType.value,
    startAt: inputValueToIso(els.startAt.value),
    endAt: els.incidentType.value === "全休" ? null : inputValueToIso(els.endAt.value),
    note: els.note.value.trim()
  };

  try {
    if (els.incidentId.value) {
      await request(`/api/incidents/${els.incidentId.value}`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      });
      showToast("事故已更新");
    } else {
      await request("/api/incidents", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      showToast("事故已登記");
    }
    els.dialog.close();
    await loadDashboard();
  } catch (error) {
    els.formError.textContent = error.message;
  }
}

async function handleImport(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".json")) {
    showToast("請選擇 .json 檔案");
    event.target.value = "";
    return;
  }

  try {
    const json = JSON.parse(await file.text());
    const result = await request("/api/people/import", {
      method: "POST",
      body: JSON.stringify(json)
    });
    showToast(`匯入完成：成功 ${result.imported} 筆，失敗 ${result.failed} 筆`);
    await loadDashboard();
  } catch (error) {
    showToast(error.message);
  } finally {
    event.target.value = "";
  }
}

async function handleIncidentTypeSubmit(event) {
  event.preventDefault();
  const name = els.newIncidentType.value.trim();
  if (!name) {
    showToast("請輸入事故類型名稱");
    return;
  }

  try {
    await request("/api/incident-types", {
      method: "POST",
      body: JSON.stringify({ name })
    });
    els.newIncidentType.value = "";
    showToast("事故類型已新增");
    await refreshAll();
  } catch (error) {
    showToast(error.message);
  }
}

function handleVisibleSelectionChange(event) {
  const selectableVisible = state.people.filter(isSelectablePerson);
  for (const person of selectableVisible) {
    if (event.target.checked) {
      state.selectedPersonIds.add(person.id);
    } else {
      state.selectedPersonIds.delete(person.id);
    }
  }
  renderPeople();
}

function handlePersonSelectionChange(event) {
  const checkbox = event.target.closest("input[data-select-person-id]");
  if (!checkbox) return;
  if (checkbox.checked) {
    state.selectedPersonIds.add(checkbox.dataset.selectPersonId);
  } else {
    state.selectedPersonIds.delete(checkbox.dataset.selectPersonId);
  }
  updateSelectionControls();
}

function handleScopeCategoryChange(event) {
  const checkbox = event.target.closest("input[data-scope-category]");
  if (!checkbox) return;
  const category = checkbox.dataset.scopeCategory;

  if (checkbox.checked) {
    state.selectedScopeCategories.add(category);
  } else if (state.selectedScopeCategories.size > 1) {
    state.selectedScopeCategories.delete(category);
  } else {
    checkbox.checked = true;
    showToast("至少保留一個統計單位");
    return;
  }

  state.selectedPersonIds.clear();
  loadDashboard().catch((error) => showToast(error.message));
}

async function handleBatchIncident() {
  const personIds = [...state.selectedPersonIds];
  if (personIds.length === 0) {
    showToast("請先勾選人員");
    return;
  }

  const payload = {
    personIds,
    type: els.batchIncidentType.value,
    startAt: inputValueToIso(els.batchStartAt.value),
    endAt: els.batchIncidentType.value === "全休" ? null : inputValueToIso(els.batchEndAt.value),
    note: els.batchNote.value.trim()
  };

  try {
    const result = await request("/api/incidents/batch", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    state.selectedPersonIds.clear();
    els.batchNote.value = "";
    showToast(`已登記 ${result.created} 人${result.failed ? `，略過 ${result.failed} 人` : ""}`);
    await loadDashboard();
  } catch (error) {
    showToast(error.message);
    await loadDashboard();
  }
}

async function startApplication() {
  showApp();
  setConnectionStatus("connecting");
  await loadCategories();
  await refreshAll();
  connectEvents();
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  els.loginError.textContent = "";
  const username = els.loginUsername.value.trim();
  const password = els.loginPassword.value;

  try {
    await loginWithCredentials(username, password);
    await startApplication();
  } catch (error) {
    els.loginError.textContent = error.message;
  }
}

async function handleLogout() {
  try {
    await request("/api/auth/logout", { method: "POST", body: "{}" });
  } catch {
    // Logging out should still return the user to the login screen.
  }
  showLogin();
}

async function handleDocumentClick(event) {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action;
  const personId = target.dataset.personId;
  const incidentId = target.dataset.incidentId;

  if (action === "add") {
    const person = findPerson(personId);
    if (person) openCreateDialog(person);
  }

  if (action === "delete-person") {
    const person = findPerson(personId);
    if (!person) return;
    if (!window.confirm(`確定刪除 ${person.name}（${person.id}）？`)) return;
    await request(`/api/people/${encodeURIComponent(person.id)}`, { method: "DELETE" });
    state.selectedPersonIds.delete(person.id);
    showToast("人員已刪除");
    await loadDashboard();
  }

  if (action === "edit") {
    const incident = findIncident(incidentId);
    if (incident) openEditDialog(incident);
  }

  if (action === "end") {
    if (!window.confirm("確定要結束這筆事故？")) return;
    await request(`/api/incidents/${incidentId}/end`, { method: "POST", body: "{}" });
    showToast("事故已結束");
    await loadDashboard();
  }

  if (action === "void") {
    if (!window.confirm("作廢會保留紀錄但不列入統計，確定作廢？")) return;
    await request(`/api/incidents/${incidentId}/void`, { method: "POST", body: "{}" });
    showToast("紀錄已作廢");
    await loadDashboard();
  }

  if (action === "show-incident-people") {
    openIncidentPeopleDialog(target.dataset.incidentType);
  }
}

function connectEvents() {
  if (state.eventSource) state.eventSource.close();
  state.eventSource = new EventSource("/api/events");
  state.eventSource.onopen = () => setConnectionStatus("online");
  state.eventSource.onerror = () => setConnectionStatus("offline");
  state.eventSource.onmessage = (event) => {
    const payload = JSON.parse(event.data || "{}");
    if (payload.type === "changed") {
      refreshAll().catch((error) => showToast(error.message));
    }
  };
}

function bindEvents() {
  els.loginForm.addEventListener("submit", handleLoginSubmit);
  els.logoutButton.addEventListener("click", handleLogout);
  let searchTimer;
  els.searchInput.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => loadDashboard().catch((error) => showToast(error.message)), 180);
  });
  els.importFile.addEventListener("change", handleImport);
  els.incidentTypeForm.addEventListener("submit", handleIncidentTypeSubmit);
  els.incidentType.addEventListener("change", updateEndAtVisibility);
  els.batchIncidentType.addEventListener("change", updateBatchEndVisibility);
  els.selectVisiblePeople.addEventListener("change", handleVisibleSelectionChange);
  els.applyBatchIncident.addEventListener("click", handleBatchIncident);
  els.clearSelection.addEventListener("click", () => {
    state.selectedPersonIds.clear();
    renderPeople();
  });
  els.incidentForm.addEventListener("submit", handleIncidentSubmit);
  els.closeDialog.addEventListener("click", () => els.dialog.close());
  els.cancelDialog.addEventListener("click", () => els.dialog.close());
  els.closeIncidentPeople.addEventListener("click", () => els.incidentPeopleDialog.close());
  els.historyFilters.addEventListener("submit", (event) => {
    event.preventDefault();
    loadDashboard().catch((error) => showToast(error.message));
  });
  document.addEventListener("click", (event) => {
    handleDocumentClick(event).catch((error) => showToast(error.message));
  });
  document.addEventListener("change", handlePersonSelectionChange);
  document.addEventListener("change", handleScopeCategoryChange);
  document.addEventListener("keydown", (event) => {
    const card = event.target.closest?.('[data-action="show-incident-people"]');
    if (!card) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openIncidentPeopleDialog(card.dataset.incidentType);
    }
  });
}

async function init() {
  updateClock();
  window.setInterval(updateClock, 1000);
  bindEvents();
  const authenticated = await ensureAuthenticated();
  if (authenticated) {
    await startApplication();
  }
}

init().catch((error) => {
  showToast(error.message);
  setConnectionStatus("offline");
});
