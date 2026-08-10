import express from "express";
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DateTime } from "luxon";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const seedDataFile = path.join(rootDir, "data", "store.json");
const dataFile = process.env.DATA_FILE ? path.resolve(process.env.DATA_FILE) : seedDataFile;
const publicDir = path.join(rootDir, "public");

const PORT = Number(process.env.PORT || 3000);
const TZ = "Asia/Taipei";
const ALL_CATEGORY = "全部";
const CATEGORIES = ["入伍生", "學生幹部", "一年級", "二年級", "三年級", "四年級"];
const DEFAULT_INCIDENT_TYPES = ["醫護所", "轉診", "全休", "上課"];
const LOGIN_USERNAME = process.env.APP_USERNAME || "qwertyuiop";
const LOGIN_PASSWORD = process.env.APP_PASSWORD || "asdfghjkl";
const SESSION_COOKIE = "attendance_session";
const sessions = new Map();

const personSchema = z.object({
  id: z.string().trim().min(1, "人員編號必填"),
  name: z.string().trim().min(1, "姓名必填"),
  category: z.enum(CATEGORIES),
  enabled: z.boolean().optional().default(true)
});

const importSchema = z.object({
  people: z.array(personSchema).min(1, "people 至少需要一筆資料")
});

const incidentCreateSchema = z.object({
  personId: z.string().trim().min(1, "人員必填"),
  type: z.string().trim().min(1, "事故類型必填"),
  startAt: z.string().trim().min(1, "開始時間必填"),
  endAt: z.string().trim().optional().nullable(),
  note: z.string().trim().max(240, "備註最多 240 字").optional().default("")
});

const incidentBatchCreateSchema = z.object({
  personIds: z.array(z.string().trim().min(1)).min(1, "至少需勾選一位人員"),
  type: z.string().trim().min(1, "事故類型必填"),
  startAt: z.string().trim().min(1, "開始時間必填"),
  endAt: z.string().trim().optional().nullable(),
  note: z.string().trim().max(240, "備註最多 240 字").optional().default("")
});

const incidentPatchSchema = z.object({
  type: z.string().trim().min(1).optional(),
  startAt: z.string().trim().min(1).optional(),
  endAt: z.string().trim().optional().nullable(),
  note: z.string().trim().max(240).optional()
});

const incidentTypeCreateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "事故名稱必填")
    .max(16, "事故名稱最多 16 字")
    .refine((value) => !["全部", "正常"].includes(value), "事故名稱不可使用保留字")
});

const loginSchema = z.object({
  username: z.string().trim().min(1, "帳號必填"),
  password: z.string().min(1, "密碼必填")
});

const historyQuerySchema = z.object({
  date: z.string().optional(),
  person: z.string().optional(),
  category: z.string().optional(),
  categories: z.string().optional(),
  type: z.string().optional()
});

const app = express();
const sseClients = new Set();
const HOST = process.env.HOST || "127.0.0.1";

app.use(express.json({ limit: "2mb" }));
app.use(express.static(publicDir));

function parseCookies(req) {
  return String(req.headers.cookie || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const index = part.indexOf("=");
      if (index === -1) return cookies;
      cookies[decodeURIComponent(part.slice(0, index))] = decodeURIComponent(part.slice(index + 1));
      return cookies;
    }, {});
}

function sessionFromRequest(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  return { token, session };
}

function setSessionCookie(res, token) {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function requireAuth(req, res, next) {
  if (req.path.startsWith("/auth/") || req.path === "/health") return next();
  if (sessionFromRequest(req)) return next();
  return res.status(401).json({ message: "請先登入" });
}

app.use("/api", requireAuth);

async function ensureStore() {
  await fs.mkdir(path.dirname(dataFile), { recursive: true });
  try {
    await fs.access(dataFile);
  } catch {
    if (dataFile !== seedDataFile) {
      try {
        await fs.copyFile(seedDataFile, dataFile);
        return;
      } catch {
        // Fall through to creating an empty store if no seed file is available.
      }
    }
    await writeStore({ people: [], incidents: [], incidentTypes: DEFAULT_INCIDENT_TYPES });
  }
}

async function readStore() {
  await ensureStore();
  const raw = await fs.readFile(dataFile, "utf8");
  const parsed = JSON.parse(raw || "{}");
  const configuredTypes = Array.isArray(parsed.incidentTypes) ? parsed.incidentTypes : [];
  const usedTypes = Array.isArray(parsed.incidents) ? parsed.incidents.map((incident) => incident.type).filter(Boolean) : [];
  return {
    people: Array.isArray(parsed.people) ? parsed.people : [],
    incidents: Array.isArray(parsed.incidents) ? parsed.incidents : [],
    incidentTypes: uniqueIncidentTypes([...DEFAULT_INCIDENT_TYPES, ...configuredTypes, ...usedTypes])
  };
}

async function writeStore(store) {
  const tmpFile = `${dataFile}.tmp`;
  await fs.writeFile(tmpFile, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await fs.rename(tmpFile, dataFile);
}

function nowTaipei() {
  return DateTime.now().setZone(TZ);
}

function parseTaipei(value, fieldName = "時間") {
  const parsed = DateTime.fromISO(value, { zone: TZ });
  if (!parsed.isValid) {
    throw Object.assign(new Error(`${fieldName}格式不正確`), { status: 400 });
  }
  return parsed.setZone(TZ);
}

function toIsoTaipei(value) {
  return value.setZone(TZ).toISO({ suppressMilliseconds: true });
}

function normalizeEndAt(type, startAt, endAt) {
  if (type === "全休") {
    return toIsoTaipei(startAt.plus({ days: 1 }).startOf("day"));
  }

  if (!endAt) return null;
  const parsedEnd = parseTaipei(endAt, "結束時間");
  if (parsedEnd <= startAt) {
    throw Object.assign(new Error("結束時間必須晚於開始時間"), { status: 400 });
  }
  return toIsoTaipei(parsedEnd);
}

function isActiveIncident(incident, at = nowTaipei()) {
  if (incident.voided) return false;
  const startAt = parseTaipei(incident.startAt, "開始時間");
  const endAt = incident.endAt ? parseTaipei(incident.endAt, "結束時間") : null;
  return startAt <= at && (!endAt || at < endAt);
}

function categoryMatches(person, category) {
  return !category || category === ALL_CATEGORY || person.category === category;
}

function normalizeCategory(category) {
  return category && CATEGORIES.includes(category) ? category : ALL_CATEGORY;
}

function uniqueIncidentTypes(types) {
  const seen = new Set();
  return types
    .map((type) => String(type || "").trim())
    .filter((type) => {
      if (!type || seen.has(type)) return false;
      seen.add(type);
      return true;
    });
}

function assertKnownIncidentType(store, type) {
  if (!store.incidentTypes.includes(type)) {
    throw Object.assign(new Error("事故類型不合法，請先新增事故類型"), { status: 400 });
  }
}

function parseCategoryScope(categoryValue, categoriesValue) {
  const category = normalizeCategory(categoryValue);
  assertKnownCategory(category);
  if (category !== ALL_CATEGORY) {
    return { category, categories: [category] };
  }

  const rawCategories = String(categoriesValue || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const invalid = rawCategories.filter((item) => !CATEGORIES.includes(item));
  if (invalid.length > 0) {
    throw Object.assign(new Error(`分類不合法：${invalid.join("、")}`), { status: 400 });
  }

  const categories = [...new Set(rawCategories)];
  return { category, categories: categories.length > 0 ? categories : null };
}

function categoryInScope(person, scope) {
  return !scope.categories || scope.categories.includes(person.category);
}

function publicPerson(person, activeByPersonId) {
  const active = activeByPersonId.get(person.id);
  return {
    ...person,
    status: active ? active.type : "正常",
    activeIncidentId: active?.id || null
  };
}

function getPeopleInScope(store, scope, q = "") {
  const keyword = q.trim().toLowerCase();
  return store.people
    .filter((person) => categoryInScope(person, scope))
    .filter((person) => {
      if (!keyword) return true;
      return person.id.toLowerCase().includes(keyword) || person.name.toLowerCase().includes(keyword);
    })
    .sort((a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) || a.id.localeCompare(b.id, "zh-Hant"));
}

function activeIncidentMap(store, at = nowTaipei()) {
  const active = store.incidents.filter((incident) => isActiveIncident(incident, at));
  return new Map(active.map((incident) => [incident.personId, incident]));
}

function incidentTypeCounts(store, incidents) {
  const order = new Map(store.incidentTypes.map((type, index) => [type, index]));
  const counts = store.incidentTypes.map((type) => ({
    type,
    count: incidents.filter((incident) => incident.type === type).length
  }));
  return counts.sort((a, b) => b.count - a.count || order.get(a.type) - order.get(b.type));
}

function peopleById(store) {
  return new Map(store.people.map((person) => [person.id, person]));
}

function enrichIncident(incident, person) {
  return {
    ...incident,
    personName: person?.name || incident.personNameSnapshot || "未知人員",
    personCategory: person?.category || incident.personCategorySnapshot || "",
    personEnabled: Boolean(person?.enabled)
  };
}

function activeIncidentsInScope(store, scope) {
  const peopleMap = peopleById(store);
  return store.incidents
    .filter((incident) => isActiveIncident(incident))
    .map((incident) => enrichIncident(incident, peopleMap.get(incident.personId)))
    .filter((incident) => categoryInScope({ category: incident.personCategory }, scope))
    .sort((a, b) => DateTime.fromISO(a.startAt).toMillis() - DateTime.fromISO(b.startAt).toMillis());
}

function groupedActiveIncidents(store, scope) {
  const active = activeIncidentsInScope(store, scope);
  const groups = store.incidentTypes.map((type) => ({
    type,
    count: active.filter((incident) => incident.type === type).length,
    incidents: active.filter((incident) => incident.type === type)
  }));
  const order = new Map(store.incidentTypes.map((type, index) => [type, index]));
  return groups
    .filter((group) => group.count > 0)
    .sort((a, b) => b.count - a.count || order.get(a.type) - order.get(b.type));
}

function sendChangeEvent() {
  const payload = `data: ${JSON.stringify({ type: "changed", updatedAt: toIsoTaipei(nowTaipei()) })}\n\n`;
  for (const client of sseClients) {
    client.write(payload);
  }
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function buildIncident(data, startAt, endAt, now) {
  return {
    id: makeId("inc"),
    personId: data.personId,
    type: data.type,
    startAt: toIsoTaipei(startAt),
    endAt,
    note: data.note || "",
    voided: false,
    createdAt: toIsoTaipei(now),
    updatedAt: toIsoTaipei(now)
  };
}

function assertKnownCategory(category) {
  if (category && category !== ALL_CATEGORY && !CATEGORIES.includes(category)) {
    throw Object.assign(new Error("分類不合法"), { status: 400 });
  }
}

function validateUniqueImportIds(people) {
  const seen = new Set();
  const duplicateIds = [];
  for (const person of people) {
    if (seen.has(person.id)) duplicateIds.push(person.id);
    seen.add(person.id);
  }
  if (duplicateIds.length > 0) {
    throw Object.assign(new Error(`匯入檔內人員編號重複：${[...new Set(duplicateIds)].join("、")}`), { status: 400 });
  }
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true, timezone: TZ, now: toIsoTaipei(nowTaipei()) });
});

app.get("/api/auth/me", (req, res) => {
  const current = sessionFromRequest(req);
  res.json({
    authenticated: Boolean(current),
    username: current ? current.session.username : null
  });
});

app.post("/api/auth/login", (req, res, next) => {
  try {
    const data = loginSchema.parse(req.body);
    if (data.username !== LOGIN_USERNAME || data.password !== LOGIN_PASSWORD) {
      return res.status(401).json({ message: "帳號或密碼錯誤" });
    }

    const token = crypto.randomUUID();
    sessions.set(token, {
      username: data.username,
      createdAt: toIsoTaipei(nowTaipei())
    });
    setSessionCookie(res, token);
    res.json({ authenticated: true, username: data.username });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/logout", (req, res) => {
  const current = sessionFromRequest(req);
  if (current) sessions.delete(current.token);
  clearSessionCookie(res);
  res.json({ authenticated: false });
});

app.get("/api/categories", (req, res) => {
  res.json({ categories: [ALL_CATEGORY, ...CATEGORIES] });
});

app.get("/api/incident-types", async (req, res, next) => {
  try {
    const store = await readStore();
    res.json({ incidentTypes: store.incidentTypes });
  } catch (error) {
    next(error);
  }
});

app.post("/api/incident-types", async (req, res, next) => {
  try {
    const data = incidentTypeCreateSchema.parse(req.body);
    const store = await readStore();
    if (store.incidentTypes.includes(data.name)) {
      return res.status(409).json({ message: "事故類型已存在" });
    }

    store.incidentTypes.push(data.name);
    store.incidentTypes = uniqueIncidentTypes(store.incidentTypes);
    await writeStore(store);
    sendChangeEvent();

    res.status(201).json({ incidentTypes: store.incidentTypes, created: data.name });
  } catch (error) {
    next(error);
  }
});

app.get("/api/people", async (req, res, next) => {
  try {
    const scope = parseCategoryScope(req.query.category, req.query.categories);
    const store = await readStore();
    const activeByPersonId = activeIncidentMap(store);
    const people = getPeopleInScope(store, scope, String(req.query.q || "")).map((person) => publicPerson(person, activeByPersonId));
    res.json({ people });
  } catch (error) {
    next(error);
  }
});

app.post("/api/people/import", async (req, res, next) => {
  try {
    const parsed = importSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "匯入格式不正確",
        errors: parsed.error.issues.map((issue) => `${issue.path.join(".") || "root"}：${issue.message}`)
      });
    }

    validateUniqueImportIds(parsed.data.people);

    const store = await readStore();
    const existing = new Map(store.people.map((person) => [person.id, person]));
    let created = 0;
    let updated = 0;

    for (const person of parsed.data.people) {
      if (existing.has(person.id)) {
        existing.set(person.id, { ...existing.get(person.id), ...person });
        updated += 1;
      } else {
        existing.set(person.id, person);
        created += 1;
      }
    }

    store.people = [...existing.values()].sort((a, b) => a.id.localeCompare(b.id, "zh-Hant"));
    await writeStore(store);
    sendChangeEvent();

    res.json({
      success: true,
      imported: parsed.data.people.length,
      created,
      updated,
      failed: 0,
      errors: []
    });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/people/:id", async (req, res, next) => {
  try {
    const store = await readStore();
    const personIndex = store.people.findIndex((person) => person.id === req.params.id);
    if (personIndex === -1) {
      return res.status(404).json({ message: "找不到人員" });
    }

    const person = store.people[personIndex];
    const activeIncident = store.incidents.find((incident) => incident.personId === person.id && isActiveIncident(incident));
    if (activeIncident) {
      return res.status(409).json({ message: "此人員目前有有效事故，請先結束事故再刪除" });
    }

    store.incidents = store.incidents.map((incident) => {
      if (incident.personId !== person.id) return incident;
      return {
        ...incident,
        personNameSnapshot: incident.personNameSnapshot || person.name,
        personCategorySnapshot: incident.personCategorySnapshot || person.category
      };
    });
    store.people.splice(personIndex, 1);

    await writeStore(store);
    sendChangeEvent();
    res.json({ deleted: person });
  } catch (error) {
    next(error);
  }
});

app.get("/api/attendance/summary", async (req, res, next) => {
  try {
    const scope = parseCategoryScope(req.query.category, req.query.categories);
    const store = await readStore();
    const peopleInScope = store.people.filter((person) => person.enabled && categoryInScope(person, scope));
    const enabledIds = new Set(peopleInScope.map((person) => person.id));
    const active = store.incidents.filter((incident) => enabledIds.has(incident.personId) && isActiveIncident(incident));
    const incidentPersonIds = new Set(active.map((incident) => incident.personId));

    res.json({
      category: scope.category,
      categories: scope.categories,
      expected: peopleInScope.length,
      incidentTotal: incidentPersonIds.size,
      actual: peopleInScope.length - incidentPersonIds.size,
      incidents: incidentTypeCounts(store, active),
      updatedAt: toIsoTaipei(nowTaipei())
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/incidents/active", async (req, res, next) => {
  try {
    const scope = parseCategoryScope(req.query.category, req.query.categories);
    const store = await readStore();
    res.json({ groups: groupedActiveIncidents(store, scope) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/incidents/history", async (req, res, next) => {
  try {
    const query = historyQuerySchema.parse(req.query);
    const store = await readStore();
    const peopleMap = peopleById(store);
    const scope = parseCategoryScope(query.category, query.categories);
    const keyword = (query.person || "").trim().toLowerCase();
    const date = (query.date || "").trim();
    const type = (query.type || "").trim();

    const incidents = store.incidents
      .map((incident) => enrichIncident(incident, peopleMap.get(incident.personId)))
      .filter((incident) => categoryInScope({ category: incident.personCategory }, scope))
      .filter((incident) => !type || type === "全部" || incident.type === type)
      .filter((incident) => {
        if (!keyword) return true;
        return incident.personId.toLowerCase().includes(keyword) || incident.personName.toLowerCase().includes(keyword);
      })
      .filter((incident) => {
        if (!date) return true;
        return parseTaipei(incident.startAt).toISODate() === date;
      })
      .sort((a, b) => DateTime.fromISO(b.startAt).toMillis() - DateTime.fromISO(a.startAt).toMillis());

    res.json({ incidents });
  } catch (error) {
    next(error);
  }
});

app.post("/api/incidents", async (req, res, next) => {
  try {
    const data = incidentCreateSchema.parse(req.body);
    const store = await readStore();
    assertKnownIncidentType(store, data.type);
    const person = store.people.find((item) => item.id === data.personId);
    if (!person) {
      return res.status(404).json({ message: "找不到人員" });
    }
    if (!person.enabled) {
      return res.status(400).json({ message: "停用人員不可新增有效事故" });
    }
    const existingActive = store.incidents.find((incident) => incident.personId === data.personId && isActiveIncident(incident));
    if (existingActive) {
      return res.status(409).json({ message: "此人員已有有效事故，請先結束或修改既有紀錄" });
    }

    const startAt = parseTaipei(data.startAt, "開始時間");
    const now = nowTaipei();
    const incident = buildIncident(data, startAt, normalizeEndAt(data.type, startAt, data.endAt), now);

    store.incidents.push(incident);
    await writeStore(store);
    sendChangeEvent();
    res.status(201).json({ incident: enrichIncident(incident, person) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/incidents/batch", async (req, res, next) => {
  try {
    const data = incidentBatchCreateSchema.parse(req.body);
    const store = await readStore();
    assertKnownIncidentType(store, data.type);

    const uniquePersonIds = [...new Set(data.personIds)];
    const startAt = parseTaipei(data.startAt, "開始時間");
    const endAt = normalizeEndAt(data.type, startAt, data.endAt);
    const now = nowTaipei();
    const created = [];
    const errors = [];

    for (const personId of uniquePersonIds) {
      const person = store.people.find((item) => item.id === personId);
      if (!person) {
        errors.push({ personId, reason: "找不到人員" });
        continue;
      }
      if (!person.enabled) {
        errors.push({ personId, personName: person.name, reason: "停用人員不可新增有效事故" });
        continue;
      }
      const existingActive = store.incidents.find((incident) => incident.personId === personId && isActiveIncident(incident));
      if (existingActive) {
        errors.push({ personId, personName: person.name, reason: "已有有效事故" });
        continue;
      }

      const incident = buildIncident({ ...data, personId }, startAt, endAt, now);
      store.incidents.push(incident);
      created.push(enrichIncident(incident, person));
    }

    if (created.length > 0) {
      await writeStore(store);
      sendChangeEvent();
    }

    res.status(created.length > 0 ? 201 : 400).json({
      message: created.length > 0 ? "批次事故已建立" : "批次登記未建立任何事故",
      created: created.length,
      failed: errors.length,
      incidents: created,
      errors
    });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/incidents/:id", async (req, res, next) => {
  try {
    const data = incidentPatchSchema.parse(req.body);
    const store = await readStore();
    const index = store.incidents.findIndex((incident) => incident.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ message: "找不到事故紀錄" });
    }

    const original = store.incidents[index];
    if (original.voided) {
      return res.status(400).json({ message: "作廢紀錄不可修改" });
    }

    const type = data.type || original.type;
    assertKnownIncidentType(store, type);
    const startAt = data.startAt ? parseTaipei(data.startAt, "開始時間") : parseTaipei(original.startAt, "開始時間");
    const endAtInput = Object.prototype.hasOwnProperty.call(data, "endAt") ? data.endAt : original.endAt;
    const updated = {
      ...original,
      ...data,
      type,
      startAt: toIsoTaipei(startAt),
      endAt: normalizeEndAt(type, startAt, endAtInput),
      updatedAt: toIsoTaipei(nowTaipei())
    };

    store.incidents[index] = updated;
    await writeStore(store);
    sendChangeEvent();
    res.json({ incident: updated });
  } catch (error) {
    next(error);
  }
});

app.post("/api/incidents/:id/end", async (req, res, next) => {
  try {
    const store = await readStore();
    const index = store.incidents.findIndex((incident) => incident.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ message: "找不到事故紀錄" });
    }
    const now = nowTaipei();
    store.incidents[index] = {
      ...store.incidents[index],
      endAt: toIsoTaipei(now),
      updatedAt: toIsoTaipei(now)
    };
    await writeStore(store);
    sendChangeEvent();
    res.json({ incident: store.incidents[index] });
  } catch (error) {
    next(error);
  }
});

app.post("/api/incidents/:id/void", async (req, res, next) => {
  try {
    const store = await readStore();
    const index = store.incidents.findIndex((incident) => incident.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ message: "找不到事故紀錄" });
    }
    const now = nowTaipei();
    store.incidents[index] = {
      ...store.incidents[index],
      voided: true,
      endAt: store.incidents[index].endAt || toIsoTaipei(now),
      updatedAt: toIsoTaipei(now)
    };
    await writeStore(store);
    sendChangeEvent();
    res.json({ incident: store.incidents[index] });
  } catch (error) {
    next(error);
  }
});

app.get("/api/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  res.write(`data: ${JSON.stringify({ type: "connected", updatedAt: toIsoTaipei(nowTaipei()) })}\n\n`);
  sseClients.add(res);

  req.on("close", () => {
    sseClients.delete(res);
  });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof z.ZodError) {
    return res.status(400).json({
      message: "資料驗證失敗",
      errors: error.issues.map((issue) => `${issue.path.join(".") || "root"}：${issue.message}`)
    });
  }
  const status = error.status || 500;
  res.status(status).json({
    message: error.message || "伺服器錯誤"
  });
});

await ensureStore();

app.listen(PORT, HOST, () => {
  console.log(`Attendance roster is running at http://${HOST}:${PORT}`);
});
