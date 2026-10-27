/* =========================================================
   server.js — локальный сервер сайта и кабинета мастера
   Без зависимостей: node server.js  (или npm start)
   Данные: data/db.json
   ========================================================= */
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

const PORT = Number(process.env.PORT) || 4173;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "ekaterina";
const ADMIN_SECRET = process.env.ADMIN_SECRET || loadSecret();

const SLOT_STEP = 30;
const SLOT_BUFFER = 15;
const SESSION_COOKIE = "ek_admin";

/* ── Данные по умолчанию ───────────────────────────────── */

const DEFAULT_SERVICES = [
  {
    id: "lamination",
    title: "Ламинирование ресниц",
    description:
      "Изгиб, объём и ухоженный вид без туши и наращивания. Форму подбираю под разрез глаз и характер ресниц.",
    price: 2500,
    durationMin: 90,
    active: true,
    sortOrder: 1
  }
];

function defaultWorkDays() {
  const day = (enabled, start, end, breakStart, breakEnd) => ({
    enabled, start, end, breakStart: breakStart || "", breakEnd: breakEnd || ""
  });
  return {
    0: day(false, "10:00", "18:00"),
    1: day(true, "10:00", "20:00", "14:00", "15:00"),
    2: day(true, "10:00", "20:00", "14:00", "15:00"),
    3: day(true, "10:00", "20:00", "14:00", "15:00"),
    4: day(true, "10:00", "20:00", "14:00", "15:00"),
    5: day(true, "10:00", "20:00", "14:00", "15:00"),
    6: day(true, "10:00", "18:00")
  };
}

function defaultSettings() {
  return {
    workDays: defaultWorkDays(),
    blockedDates: [],
    blockedSlots: [],
    maxDaysAhead: 60,
    holdHours: 24,
    phone: "+7 (912) 000-00-00",
    telegram: "@laminationTyumen"
  };
}

/* ── Хранилище ─────────────────────────────────────────── */

let db = loadDb();

function loadSecret() {
  const file = path.join(DATA_DIR, "secret.txt");
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const saved = fs.readFileSync(file, "utf8").trim();
    if (saved) return saved;
  } catch (e) {}
  const generated = crypto.randomBytes(32).toString("hex");
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(file, generated, "utf8");
  } catch (e) {}
  return generated;
}

function loadDb() {
  try {
    const raw = fs.readFileSync(DB_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return {
      services: Array.isArray(parsed.services) && parsed.services.length
        ? parsed.services
        : structuredClone(DEFAULT_SERVICES),
      settings: mergeSettings(parsed.settings),
      appointments: Array.isArray(parsed.appointments) ? parsed.appointments : []
    };
  } catch (e) {
    return {
      services: structuredClone(DEFAULT_SERVICES),
      settings: defaultSettings(),
      appointments: []
    };
  }
}

function persist() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DB_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2), "utf8");
    fs.renameSync(tmp, DB_FILE);
  } catch (e) {
    console.error("Не удалось сохранить data/db.json:", e.message);
  }
}

function mergeSettings(saved) {
  const base = defaultSettings();
  if (!saved || typeof saved !== "object") return base;
  const merged = Object.assign({}, base, saved);
  merged.workDays = Object.assign({}, base.workDays, saved.workDays || {});
  if (!Array.isArray(merged.blockedDates)) merged.blockedDates = [];
  if (!Array.isArray(merged.blockedSlots)) merged.blockedSlots = [];
  return merged;
}

/* ── Даты и слоты ──────────────────────────────────────── */

const pad = (n) => String(n).padStart(2, "0");

function toISO(date) {
  return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
}

function parseISO(iso) {
  const p = String(iso).split("-");
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

function toMinutes(hhmm) {
  if (!hhmm) return null;
  const p = String(hhmm).split(":");
  return Number(p[0]) * 60 + Number(p[1]);
}

function fromMinutes(min) {
  return pad(Math.floor(min / 60) % 24) + ":" + pad(min % 60);
}

function isExpired(appointment, settings) {
  if (!appointment || appointment.status !== "pending") return false;
  const created = new Date(appointment.createdAt).getTime();
  if (isNaN(created)) return false;
  return Date.now() - created > (Number(settings.holdHours) || 24) * 3600 * 1000;
}

function isActive(appointment, settings) {
  if (!appointment) return false;
  if (appointment.status === "cancelled") return false;
  return !isExpired(appointment, settings);
}

function activeList(settings) {
  return db.appointments.filter((a) => isActive(a, settings));
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function isBlocked(iso, time, settings) {
  if (settings.blockedDates.includes(iso)) return true;
  return settings.blockedSlots.some((b) => b.date === iso && b.time === time);
}

function isSlotFree(iso, time, durationMin, settings, ignoreId) {
  const start = toMinutes(time);
  if (start == null) return false;
  const end = start + (Number(durationMin) || 60);
  if (isBlocked(iso, time, settings)) return false;

  return !activeList(settings)
    .filter((a) => a.date === iso && a.id !== ignoreId)
    .some((a) => {
      const s = toMinutes(a.time);
      const e = s + (Number(a.durationMin) || 60) + SLOT_BUFFER;
      return overlaps(start, end + SLOT_BUFFER, s, e);
    });
}

function slotsForDay(iso, service, settings) {
  if (!service) return [];
  const date = parseISO(iso);
  const wd = settings.workDays[date.getDay()];
  if (!wd || !wd.enabled) return [];
  if (settings.blockedDates.includes(iso)) return [];

  const dayStart = toMinutes(wd.start);
  const dayEnd = toMinutes(wd.end);
  const duration = Number(service.durationMin) || 60;
  if (dayStart == null || dayEnd == null || dayEnd - dayStart < duration) return [];

  const breakStart = toMinutes(wd.breakStart);
  const breakEnd = toMinutes(wd.breakEnd);
  const now = new Date();
  const isToday = toISO(now) === iso;
  const nowMin = now.getHours() * 60 + now.getMinutes() + 30;

  const busy = activeList(settings)
    .filter((a) => a.date === iso)
    .map((a) => {
      const start = toMinutes(a.time);
      return { start, end: start + (Number(a.durationMin) || 60) + SLOT_BUFFER };
    });

  const result = [];
  for (let t = dayStart; t + duration <= dayEnd; t += SLOT_STEP) {
    if (isToday && t < nowMin) continue;
    if (breakStart != null && breakEnd != null && overlaps(t, t + duration + SLOT_BUFFER, breakStart, breakEnd)) continue;
    if (busy.some((b) => overlaps(t, t + duration + SLOT_BUFFER, b.start, b.end))) continue;
    const time = fromMinutes(t);
    if (isBlocked(iso, time, settings)) continue;
    result.push(time);
  }
  return result;
}

function publicSettings(settings) {
  return {
    workDays: settings.workDays,
    blockedDates: settings.blockedDates,
    blockedSlots: settings.blockedSlots,
    maxDaysAhead: settings.maxDaysAhead,
    holdHours: settings.holdHours,
    phone: settings.phone,
    telegram: settings.telegram
  };
}

function publicState() {
  const settings = db.settings;
  const today = startOfDay(new Date());
  const limit = addDays(today, Number(settings.maxDaysAhead) || 60);
  const busy = activeList(settings)
    .filter((a) => {
      const d = parseISO(a.date);
      return d >= today && d <= limit;
    })
    .map((a) => ({
      date: a.date,
      time: a.time,
      durationMin: a.durationMin,
      status: a.status,
      createdAt: a.createdAt
    }));
  return {
    services: db.services.slice().sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)),
    settings: publicSettings(settings),
    busy
  };
}

function adminState() {
  return {
    services: db.services.slice().sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)),
    settings: db.settings,
    appointments: db.appointments
  };
}

/* ── Авторизация ───────────────────────────────────────── */

function signToken() {
  return crypto.createHmac("sha256", ADMIN_SECRET).update("ek-admin").digest("hex");
}

function isAuthed(req) {
  const cookie = req.headers.cookie || "";
  const match = cookie.match(new RegExp("(?:^|; )" + SESSION_COOKIE + "=([^;]+)"));
  if (!match) return false;
  const expected = signToken();
  const given = match[1];
  if (given.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

/* ── Утилиты HTTP ──────────────────────────────────────── */

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".txt": "text/plain; charset=utf-8"
};

function sendJson(res, status, body, headers) {
  const data = JSON.stringify(body);
  res.writeHead(status, Object.assign({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  }, headers || {}));
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 2 * 1024 * 1024) reject(new Error("Слишком большой запрос"));
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error("Некорректный JSON"));
      }
    });
    req.on("error", reject);
  });
}

function serveStatic(req, res, pathname) {
  const rel = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
  const target = path.resolve(ROOT, "." + rel);
  if (!target.startsWith(ROOT) || /[\\/](data|node_modules)[\\/]/.test(target) || target.endsWith("server.js")) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.stat(target, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Страница не найдена");
      return;
    }
    const type = MIME[path.extname(target).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" });
    fs.createReadStream(target).pipe(res);
  });
}

/* ── Уведомление в Telegram ────────────────────────────── */

function notifyTelegram(appointment) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return;
  const text = [
    "Новая запись",
    appointment.serviceTitle,
    appointment.date + " в " + appointment.time,
    appointment.name,
    appointment.contacts.phone || "",
    appointment.contacts.telegram ? "@" + String(appointment.contacts.telegram).replace(/^@/, "") : ""
  ].filter(Boolean).join("\n");

  fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text })
  }).catch((e) => console.warn("Telegram:", e.message));
}

/* ── Валидация записи ──────────────────────────────────── */

function sanitizeAppointment(input, base) {
  const item = Object.assign({}, base || {});
  if (input.date !== undefined) item.date = String(input.date).slice(0, 10);
  if (input.time !== undefined) item.time = String(input.time).slice(0, 5);
  if (input.serviceId !== undefined) item.serviceId = String(input.serviceId);
  if (input.serviceTitle !== undefined) item.serviceTitle = String(input.serviceTitle).slice(0, 120);
  if (input.durationMin !== undefined) item.durationMin = Math.max(15, Math.min(300, Number(input.durationMin) || 60));
  if (input.price !== undefined) item.price = Math.max(0, Number(input.price) || 0);
  if (input.name !== undefined) item.name = String(input.name).trim().slice(0, 80);
  if (input.contacts !== undefined && input.contacts && typeof input.contacts === "object") {
    item.contacts = {};
    ["phone", "telegram"].forEach((k) => {
      if (input.contacts[k]) item.contacts[k] = String(input.contacts[k]).trim().slice(0, 120);
    });
  }
  if (input.comment !== undefined) item.comment = String(input.comment).trim().slice(0, 800);
  if (input.notes !== undefined) item.notes = String(input.notes).trim().slice(0, 800);
  if (input.status !== undefined) item.status = String(input.status);
  if (input.source !== undefined) item.source = String(input.source);
  return item;
}

function validateNew(item) {
  if (!item.name || item.name.length < 2) return "Укажите имя";
  const contacts = item.contacts || {};
  const phoneOk = contacts.phone && contacts.phone.replace(/\D/g, "").length >= 10;
  const tgOk = Boolean(contacts.telegram);
  if (!phoneOk && !tgOk) return "Нужен телефон или Telegram для связи";

  if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date)) return "Некорректная дата";
  if (!/^\d{2}:\d{2}$/.test(item.time)) return "Некорректное время";

  const settings = db.settings;
  const date = parseISO(item.date);
  const today = startOfDay(new Date());
  if (date < today) return "Эта дата уже прошла";
  const limit = addDays(today, Number(settings.maxDaysAhead) || 60);
  if (date > limit) return "Слишком далеко вперёд";

  const wd = settings.workDays[date.getDay()];
  if (!wd || !wd.enabled) return "В этот день приёма нет";
  if (settings.blockedDates.includes(item.date)) return "Этот день закрыт";

  const service = db.services.find((s) => s.id === item.serviceId && s.active);
  if (!service) return "Услуга недоступна";

  const start = toMinutes(item.time);
  const dayStart = toMinutes(wd.start);
  const dayEnd = toMinutes(wd.end);
  if (start == null || start < dayStart || start + item.durationMin > dayEnd) return "Время вне рабочих часов";

  if (!isSlotFree(item.date, item.time, item.durationMin, settings, item.id)) {
    return "Это время уже занято. Выберите другое окно.";
  }
  return null;
}

/* ── API ───────────────────────────────────────────────── */

async function handleApi(req, res, pathname) {
  const method = req.method.toUpperCase();

  try {
    if (pathname === "/api/public" && method === "GET") {
      return sendJson(res, 200, publicState());
    }

    if (pathname === "/api/appointments" && method === "POST") {
      const body = await readBody(req);
      const service = db.services.find((s) => s.id === body.serviceId && s.active);
      if (!service) return sendJson(res, 400, { error: "Услуга недоступна" });

      const item = sanitizeAppointment(Object.assign({}, body, {
        serviceId: service.id,
        serviceTitle: service.title,
        durationMin: service.durationMin,
        price: service.price,
        status: "pending"
      }), {
        id: "ap_" + Date.now().toString(36) + "_" + crypto.randomBytes(3).toString("hex"),
        notes: "",
        source: "site",
        createdAt: new Date().toISOString()
      });

      const problem = validateNew(item);
      if (problem) return sendJson(res, 409, { error: problem });

      db.appointments.push(item);
      persist();
      notifyTelegram(item);
      return sendJson(res, 201, { appointment: item });
    }

    if (pathname === "/api/admin/login" && method === "POST") {
      const body = await readBody(req);
      const given = crypto.createHash("sha256").update(String(body.password || "")).digest();
      const expected = crypto.createHash("sha256").update(ADMIN_PASSWORD).digest();
      if (!crypto.timingSafeEqual(given, expected)) {
        return sendJson(res, 401, { error: "Неверный пароль" });
      }
      const cookie = SESSION_COOKIE + "=" + signToken() +
        "; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200";
      return sendJson(res, 200, adminState(), { "Set-Cookie": cookie });
    }

    if (pathname === "/api/admin/logout" && method === "POST") {
      return sendJson(res, 200, { ok: true }, {
        "Set-Cookie": SESSION_COOKIE + "=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"
      });
    }

    // всё ниже — только для авторизованного мастера
    if (pathname.startsWith("/api/admin/") && !isAuthed(req)) {
      return sendJson(res, 401, { error: "Нужен вход" });
    }

    if (pathname === "/api/admin/data" && method === "GET") {
      return sendJson(res, 200, adminState());
    }

    if (pathname === "/api/admin/appointments" && method === "POST") {
      const body = await readBody(req);
      const service = db.services.find((s) => s.id === body.serviceId) || db.services[0];
      if (!service) return sendJson(res, 400, { error: "Сначала добавьте услугу" });

      const item = sanitizeAppointment(Object.assign({}, body, {
        serviceId: service.id,
        serviceTitle: service.title,
        durationMin: body.durationMin || service.durationMin,
        price: body.price != null ? body.price : service.price,
        status: body.status || "confirmed"
      }), {
        id: "ap_" + Date.now().toString(36) + "_" + crypto.randomBytes(3).toString("hex"),
        notes: "",
        source: "admin",
        createdAt: new Date().toISOString()
      });

      if (!item.name || !item.date || !item.time) {
        return sendJson(res, 400, { error: "Заполните имя, дату и время" });
      }
      if (item.status !== "cancelled" && !isSlotFree(item.date, item.time, item.durationMin, db.settings, item.id)) {
        return sendJson(res, 409, { error: "На это время уже есть запись" });
      }

      db.appointments.push(item);
      persist();
      return sendJson(res, 201, { appointment: item });
    }

    const apMatch = pathname.match(/^\/api\/admin\/appointments\/([^/]+)$/);
    if (apMatch) {
      const id = decodeURIComponent(apMatch[1]);
      const idx = db.appointments.findIndex((a) => a.id === id);
      if (idx === -1) return sendJson(res, 404, { error: "Запись не найдена" });

      if (method === "PATCH") {
        const body = await readBody(req);
        const updated = sanitizeAppointment(body, db.appointments[idx]);
        if (updated.status !== "cancelled" && !isSlotFree(updated.date, updated.time, updated.durationMin, db.settings, updated.id)) {
          return sendJson(res, 409, { error: "На это время уже есть другая запись" });
        }
        db.appointments[idx] = updated;
        persist();
        return sendJson(res, 200, { appointment: updated });
      }

      if (method === "DELETE") {
        db.appointments.splice(idx, 1);
        persist();
        return sendJson(res, 200, { ok: true });
      }
    }

    if (pathname === "/api/admin/services" && method === "PUT") {
      const body = await readBody(req);
      if (!Array.isArray(body.services)) return sendJson(res, 400, { error: "Нет списка услуг" });
      db.services = body.services.map((s, i) => ({
        id: String(s.id || "service_" + i),
        title: String(s.title || "Услуга").slice(0, 120),
        description: String(s.description || "").slice(0, 500),
        price: Math.max(0, Number(s.price) || 0),
        durationMin: Math.max(15, Math.min(300, Number(s.durationMin) || 60)),
        active: s.active !== false,
        sortOrder: Number(s.sortOrder) || i + 1
      }));
      persist();
      return sendJson(res, 200, adminState());
    }

    if (pathname === "/api/admin/settings" && method === "PUT") {
      const body = await readBody(req);
      db.settings = mergeSettings(body.settings);
      persist();
      return sendJson(res, 200, adminState());
    }

    if (pathname === "/api/admin/import" && method === "PUT") {
      const body = await readBody(req);
      if (Array.isArray(body.services) && body.services.length) db.services = body.services;
      if (body.settings) db.settings = mergeSettings(body.settings);
      if (Array.isArray(body.appointments)) db.appointments = body.appointments;
      persist();
      return sendJson(res, 200, adminState());
    }

    if (pathname === "/api/admin/reset" && method === "POST") {
      db = {
        services: structuredClone(DEFAULT_SERVICES),
        settings: defaultSettings(),
        appointments: []
      };
      persist();
      return sendJson(res, 200, adminState());
    }

    return sendJson(res, 404, { error: "Не найдено" });
  } catch (err) {
    return sendJson(res, 400, { error: err.message || "Ошибка запроса" });
  }
}

/* ── Сервер ────────────────────────────────────────────── */

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const pathname = url.pathname;

  if (pathname.startsWith("/api/")) {
    handleApi(req, res, pathname);
    return;
  }
  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log("Екатерина: сайт и кабинет — http://localhost:" + PORT);
  console.log("Кабинет: http://localhost:" + PORT + "/admin.html");
  if (!process.env.ADMIN_PASSWORD) {
    console.log("Пароль по умолчанию: ekaterina (задайте ADMIN_PASSWORD, чтобы изменить)");
  }
});
