/* =========================================================
   store.js — общие данные и логика записи
   Данные приходят с сервера (/api), в браузере только кэш.
   ========================================================= */
(function (global) {
  "use strict";

  var DB_VERSION = "v1";

  var SLOT_STEP = 30;      // шаг сетки, минут
  var SLOT_BUFFER = 15;    // буфер между клиентами, минут

  /* ── Услуги по умолчанию ─────────────────────────────── */
  var DEFAULT_SERVICES = [
    {
      id: "lamination",
      title: "Ламинирование ресниц",
      description: "Изгиб, объём и ухоженный вид без туши и наращивания. Форму подбираю под разрез глаз и характер ресниц.",
      price: 2500,
      durationMin: 90,
      active: true,
      sortOrder: 1
    }
  ];

  /* ── Настройки по умолчанию ──────────────────────────── */
  // weekday: 0 — воскресенье, 1 — понедельник, … 6 — суббота
  function defaultWorkDays() {
    return {
      0: { enabled: false, start: "10:00", end: "18:00", breakStart: "", breakEnd: "" },
      1: { enabled: true, start: "10:00", end: "20:00", breakStart: "14:00", breakEnd: "15:00" },
      2: { enabled: true, start: "10:00", end: "20:00", breakStart: "14:00", breakEnd: "15:00" },
      3: { enabled: true, start: "10:00", end: "20:00", breakStart: "14:00", breakEnd: "15:00" },
      4: { enabled: true, start: "10:00", end: "20:00", breakStart: "14:00", breakEnd: "15:00" },
      5: { enabled: true, start: "10:00", end: "20:00", breakStart: "14:00", breakEnd: "15:00" },
      6: { enabled: true, start: "10:00", end: "18:00", breakStart: "", breakEnd: "" }
    };
  }

  var DEFAULT_SETTINGS = {
    workDays: defaultWorkDays(),
    blockedDates: [],
    blockedSlots: [],
    maxDaysAhead: 60,
    holdHours: 24,
    phone: "+7 (912) 000-00-00",
    telegram: "@laminationTyumen"
  };

  /* ── Утилиты дат ─────────────────────────────────────── */
  function pad(n) { return (n < 10 ? "0" : "") + n; }

  function toISO(date) {
    return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
  }

  function parseISO(iso) {
    var p = String(iso).split("-");
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function addDays(date, days) {
    var d = new Date(date.getTime());
    d.setDate(d.getDate() + days);
    return d;
  }

  function daysInMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
  }

  /** Понедельник = 0 … воскресенье = 6 (для сетки календаря). */
  function mondayIndex(date) {
    return (date.getDay() + 6) % 7;
  }

  function toMinutes(hhmm) {
    if (!hhmm) return null;
    var p = String(hhmm).split(":");
    return Number(p[0]) * 60 + Number(p[1]);
  }

  function fromMinutes(min) {
    return pad(Math.floor(min / 60) % 24) + ":" + pad(min % 60);
  }

  var MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь",
    "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
  var MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  var WEEKDAYS = ["воскресенье", "понедельник", "вторник", "среда",
    "четверг", "пятница", "суббота"];
  var WEEKDAYS_SHORT = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

  function formatDateRu(iso) {
    var d = parseISO(iso);
    return d.getDate() + " " + MONTHS_GEN[d.getMonth()] + ", " + WEEKDAYS[d.getDay()];
  }

  function formatDateShort(iso) {
    var d = parseISO(iso);
    return pad(d.getDate()) + "." + pad(d.getMonth() + 1);
  }

  function formatPrice(n) {
    return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " ₽";
  }

  function formatDuration(min) {
    var m = Number(min) || 0;
    if (m < 60) return m + " мин";
    var h = Math.floor(m / 60);
    var rest = m % 60;
    return rest ? h + " ч " + rest + " мин" : h + " ч";
  }

  /* ── Хранилище (сервер, а без сервера — localStorage) ── */
  var cache = { services: null, settings: null, appointments: null, admin: false, offline: false };
  var errorHandler = null;

  var LS = {
    services: "ek_services_v2",
    settings: "ek_settings_v1",
    appointments: "ek_appointments_v1"
  };

  function lsGet(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }

  function lsSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* приватный режим */ }
  }

  function hydrateLocal() {
    cache.services = lsGet(LS.services, null);
    cache.settings = lsGet(LS.settings, null);
    cache.appointments = lsGet(LS.appointments, []);
  }

  function persistLocal() {
    lsSet(LS.services, cache.services);
    lsSet(LS.settings, cache.settings);
    lsSet(LS.appointments, cache.appointments);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function api(path, options) {
    var opts = options || {};
    opts.credentials = "same-origin";
    opts.headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
    return fetch("api" + path, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) {
          var err = new Error(body && body.error ? body.error : "Ошибка сервера (" + res.status + ")");
          err.status = res.status;
          throw err;
        }
        return body;
      });
    });
  }

  function applyPublic(data) {
    if (!data) return;
    cache.services = data.services || null;
    cache.settings = data.settings || null;
    cache.appointments = data.busy || [];
    cache.admin = false;
  }

  function applyAdmin(data) {
    if (!data) return;
    cache.services = data.services || null;
    cache.settings = data.settings || null;
    cache.appointments = data.appointments || [];
    cache.admin = true;
  }

  /** Загрузить данные: mode = "public" | "admin". */
  function init(mode) {
    if (mode === "admin") {
      return api("/admin/data").then(function (data) {
        cache.offline = false;
        applyAdmin(data);
        return { authed: true };
      }).catch(function (err) {
        if (err.status === 401) return { authed: false };
        console.warn("Сервер недоступен — кабинет работает в локальном режиме", err);
        cache.offline = true;
        hydrateLocal();
        var authed = false;
        try { authed = sessionStorage.getItem("ek_admin_local") === "1"; } catch (e) {}
        if (authed) cache.admin = true;
        return { authed: authed, offline: true };
      });
    }
    return api("/public").then(function (data) {
      cache.offline = false;
      applyPublic(data);
      return { authed: false };
    }).catch(function (err) {
      console.warn("Сервер недоступен — работаем на локальных данных", err);
      cache.offline = true;
      hydrateLocal();
      return { authed: false, offline: true };
    });
  }

  var OFFLINE_PASSWORD = "ekaterina";

  function login(password) {
    if (cache.offline) {
      if (String(password) !== OFFLINE_PASSWORD) {
        var err = new Error("Неверный пароль");
        err.status = 401;
        return Promise.reject(err);
      }
      cache.admin = true;
      try { sessionStorage.setItem("ek_admin_local", "1"); } catch (e) {}
      return Promise.resolve(true);
    }
    return api("/admin/login", { method: "POST", body: JSON.stringify({ password: password }) })
      .then(function (data) { applyAdmin(data); return true; });
  }

  function logout() {
    cache.admin = false;
    cache.appointments = [];
    try { sessionStorage.removeItem("ek_admin_local"); } catch (e) {}
    if (cache.offline) return Promise.resolve(true);
    return api("/admin/logout", { method: "POST" }).catch(function () {});
  }

  function background(promise) {
    promise.catch(function (err) {
      console.warn("Не удалось сохранить на сервере", err);
      if (typeof errorHandler === "function") errorHandler(err);
    });
  }

  function onError(fn) { errorHandler = fn; }

  function getServices() {
    var list = cache.services;
    if (!Array.isArray(list) || !list.length) list = clone(DEFAULT_SERVICES);
    return list.slice().sort(function (a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0); });
  }

  function saveServices(list) {
    cache.services = clone(list);
    if (cache.offline) { lsSet(LS.services, cache.services); return true; }
    background(api("/admin/services", { method: "PUT", body: JSON.stringify({ services: list }) }));
    return true;
  }

  function getSettings() {
    var saved = cache.settings || {};
    var s = Object.assign({}, clone(DEFAULT_SETTINGS), saved);
    s.workDays = Object.assign({}, defaultWorkDays(), saved.workDays || {});
    if (!Array.isArray(s.blockedDates)) s.blockedDates = [];
    if (!Array.isArray(s.blockedSlots)) s.blockedSlots = [];
    return s;
  }

  function saveSettings(settings) {
    cache.settings = clone(settings);
    if (cache.offline) { lsSet(LS.settings, cache.settings); return true; }
    background(api("/admin/settings", { method: "PUT", body: JSON.stringify({ settings: settings }) }));
    return true;
  }

  function getAppointments() {
    return Array.isArray(cache.appointments) ? cache.appointments : [];
  }

  function setAppointments(list) {
    cache.appointments = list;
    if (cache.offline) lsSet(LS.appointments, list);
  }

  function uid() {
    return "ap_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
  }

  /* ── Логика слотов ───────────────────────────────────── */
  /** Активные записи: всё, кроме отменённых и истёкших предварительных. */
  function isExpired(appointment, settings) {
    if (!appointment || appointment.status !== "pending") return false;
    var created = new Date(appointment.createdAt).getTime();
    if (isNaN(created)) return false;
    var holdMs = (Number(settings.holdHours) || 24) * 3600 * 1000;
    return Date.now() - created > holdMs;
  }

  function isActive(appointment, settings) {
    if (!appointment) return false;
    if (appointment.status === "cancelled") return false;
    if (isExpired(appointment, settings)) return false;
    return true;
  }

  function activeAppointments(settings) {
    return getAppointments().filter(function (a) { return isActive(a, settings); });
  }

  function intervalsForDate(iso, settings) {
    return activeAppointments(settings)
      .filter(function (a) { return a.date === iso; })
      .map(function (a) {
        var start = toMinutes(a.time);
        var end = start + (Number(a.durationMin) || 60) + SLOT_BUFFER;
        return { start: start, end: end };
      });
  }

  function overlaps(aStart, aEnd, bStart, bEnd) {
    return aStart < bEnd && bStart < aEnd;
  }

  function isBlocked(iso, time, settings) {
    if (settings.blockedDates.indexOf(iso) !== -1) return true;
    return settings.blockedSlots.some(function (b) {
      return b.date === iso && b.time === time;
    });
  }

  function isSlotFree(iso, time, durationMin, settings, ignoreId) {
    var start = toMinutes(time);
    if (start == null) return false;
    var end = start + (Number(durationMin) || 60);
    if (isBlocked(iso, time, settings)) return false;

    var list = activeAppointments(settings).filter(function (a) {
      return a.date === iso && (!ignoreId || a.id !== ignoreId);
    });

    for (var i = 0; i < list.length; i++) {
      var s = toMinutes(list[i].time);
      var e = s + (Number(list[i].durationMin) || 60) + SLOT_BUFFER;
      if (overlaps(start, end + SLOT_BUFFER, s, e)) return false;
    }
    return true;
  }

  function dayIsAvailable(iso, service, settings) {
    var date = parseISO(iso);
    var today = startOfDay(new Date());
    if (date < today) return false;
    var limit = addDays(today, Number(settings.maxDaysAhead) || 60);
    if (date > limit) return false;

    var wd = settings.workDays[date.getDay()];
    if (!wd || !wd.enabled) return false;
    if (settings.blockedDates.indexOf(iso) !== -1) return false;

    return slotsForDay(iso, service, settings).length > 0;
  }

  /** Свободные слоты дня для выбранной услуги. */
  function slotsForDay(iso, service, settings) {
    if (!service) return [];
    var date = parseISO(iso);
    var wd = settings.workDays[date.getDay()];
    if (!wd || !wd.enabled) return [];
    if (settings.blockedDates.indexOf(iso) !== -1) return [];

    var dayStart = toMinutes(wd.start);
    var dayEnd = toMinutes(wd.end);
    var duration = Number(service.durationMin) || 60;
    if (dayStart == null || dayEnd == null || dayEnd - dayStart < duration) return [];

    var breakStart = toMinutes(wd.breakStart);
    var breakEnd = toMinutes(wd.breakEnd);

    var now = new Date();
    var isToday = toISO(now) === iso;
    var nowMin = now.getHours() * 60 + now.getMinutes() + 30; // буфер 30 минут

    var busy = intervalsForDate(iso, settings);
    var result = [];

    for (var t = dayStart; t + duration <= dayEnd; t += SLOT_STEP) {
      if (isToday && t < nowMin) continue;
      if (breakStart != null && breakEnd != null && overlaps(t, t + duration + SLOT_BUFFER, breakStart, breakEnd)) continue;

      var clash = busy.some(function (b) {
        return overlaps(t, t + duration + SLOT_BUFFER, b.start, b.end);
      });
      if (clash) continue;

      var time = fromMinutes(t);
      if (isBlocked(iso, time, settings)) continue;
      result.push(time);
    }
    return result;
  }

  function hasFreeSlot(iso, settings) {
    // быстрая проверка без привязки к услуге: есть ли вообще окно
    var services = getServices().filter(function (s) { return s.active; });
    return services.some(function (s) { return slotsForDay(iso, s, settings).length > 0; });
  }

  /* ── CRUD записей ────────────────────────────────────── */
  function createAppointment(data) {
    var item = {
      id: uid(),
      date: data.date,
      time: data.time,
      serviceId: data.serviceId,
      serviceTitle: data.serviceTitle,
      durationMin: Number(data.durationMin) || 60,
      price: Number(data.price) || 0,
      name: String(data.name || "").trim(),
      contacts: data.contacts || {},
      comment: String(data.comment || "").trim(),
      status: "pending",
      notes: "",
      source: data.source || "site",
      createdAt: new Date().toISOString()
    };
    var list = getAppointments().slice();
    list.push(item);
    setAppointments(list);

    var url = cache.admin ? "/admin/appointments" : "/appointments";
    if (cache.offline) {
      item.ready = Promise.resolve(item);
      return item;
    }
    var ready = api(url, { method: "POST", body: JSON.stringify(item) }).then(function (res) {
      var saved = res.appointment || item;
      setAppointments(getAppointments().map(function (a) { return a.id === item.id ? saved : a; }));
      if (!cache.admin) {
        // публичной странице достаточно знать занятые окна
        setAppointments(getAppointments().map(function (a) {
          return { date: a.date, time: a.time, durationMin: a.durationMin, status: a.status, createdAt: a.createdAt };
        }));
      }
      return saved;
    }).catch(function (err) {
      setAppointments(getAppointments().filter(function (a) { return a.id !== item.id; }));
      if (typeof errorHandler === "function") errorHandler(err);
      throw err;
    });

    item.ready = ready;
    return item;
  }

  function updateAppointment(id, patch) {
    var list = getAppointments().slice();
    var idx = -1;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) { idx = i; break; }
    if (idx === -1) return null;
    list[idx] = Object.assign({}, list[idx], patch);
    setAppointments(list);
    if (cache.offline) return list[idx];
    background(api("/admin/appointments/" + encodeURIComponent(id), {
      method: "PATCH",
      body: JSON.stringify(patch)
    }).then(function (res) {
      if (res && res.appointment) {
        setAppointments(getAppointments().map(function (a) { return a.id === id ? res.appointment : a; }));
      }
    }));
    return list[idx];
  }

  function deleteAppointment(id) {
    setAppointments(getAppointments().filter(function (a) { return a.id !== id; }));
    if (cache.offline) return;
    background(api("/admin/appointments/" + encodeURIComponent(id), { method: "DELETE" }));
  }

  function getAppointment(id) {
    return getAppointments().filter(function (a) { return a.id === id; })[0] || null;
  }

  function refreshAdmin() {
    if (cache.offline) { hydrateLocal(); cache.admin = true; return Promise.resolve(true); }
    return api("/admin/data").then(function (data) { applyAdmin(data); return true; });
  }

  /* ── Экспорт / импорт ────────────────────────────────── */
  function exportAll() {
    return JSON.stringify({
      version: DB_VERSION,
      exportedAt: new Date().toISOString(),
      services: getServices(),
      settings: getSettings(),
      appointments: getAppointments()
    }, null, 2);
  }

  function importAll(raw) {
    var data = JSON.parse(raw);
    if (!data || typeof data !== "object") return Promise.reject(new Error("Неверный формат файла"));
    if (cache.offline) {
      cache.services = data.services || null;
      cache.settings = data.settings || null;
      cache.appointments = data.appointments || [];
      cache.admin = true;
      persistLocal();
      return Promise.resolve(true);
    }
    return api("/admin/import", { method: "PUT", body: JSON.stringify(data) })
      .then(function (res) { applyAdmin(res); return true; });
  }

  function resetAll() {
    if (cache.offline) {
      try {
        localStorage.removeItem(LS.services);
        localStorage.removeItem(LS.settings);
        localStorage.removeItem(LS.appointments);
      } catch (e) {}
      cache.services = null;
      cache.settings = null;
      cache.appointments = [];
      cache.admin = true;
      return Promise.resolve(true);
    }
    return api("/admin/reset", { method: "POST" })
      .then(function (res) { applyAdmin(res); return true; });
  }

  /* ── Публичный API ───────────────────────────────────── */
  global.EK = {
    DEFAULT_SERVICES: DEFAULT_SERVICES,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    SLOT_STEP: SLOT_STEP,
    MONTHS: MONTHS,
    MONTHS_GEN: MONTHS_GEN,
    WEEKDAYS: WEEKDAYS,
    WEEKDAYS_SHORT: WEEKDAYS_SHORT,

    toISO: toISO,
    parseISO: parseISO,
    startOfDay: startOfDay,
    addDays: addDays,
    daysInMonth: daysInMonth,
    mondayIndex: mondayIndex,
    toMinutes: toMinutes,
    fromMinutes: fromMinutes,
    formatDateRu: formatDateRu,
    formatDateShort: formatDateShort,
    formatPrice: formatPrice,
    formatDuration: formatDuration,

    getServices: getServices,
    saveServices: saveServices,
    getSettings: getSettings,
    saveSettings: saveSettings,
    getAppointments: getAppointments,
    setAppointments: setAppointments,
    getAppointment: getAppointment,
    createAppointment: createAppointment,
    updateAppointment: updateAppointment,
    deleteAppointment: deleteAppointment,
    refreshAdmin: refreshAdmin,

    init: init,
    login: login,
    logout: logout,
    onError: onError,
    isOffline: function () { return cache.offline; },

    isExpired: isExpired,
    isActive: isActive,
    activeAppointments: activeAppointments,
    isSlotFree: isSlotFree,
    dayIsAvailable: dayIsAvailable,
    slotsForDay: slotsForDay,
    hasFreeSlot: hasFreeSlot,

    exportAll: exportAll,
    importAll: importAll,
    resetAll: resetAll
  };
})(window);
