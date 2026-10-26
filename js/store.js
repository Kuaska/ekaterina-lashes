/* =========================================================
   store.js — общие данные и логика записи
   Работает без сервера: данные хранятся в localStorage.
   Ключи версионированы, чтобы обновления сайта не ломали данные.
   ========================================================= */
(function (global) {
  "use strict";

  var DB_VERSION = "v1";
  var K_SERVICES = "ek_services_v2";
  var K_SETTINGS = "ek_settings_" + DB_VERSION;
  var K_APPOINTMENTS = "ek_appointments_" + DB_VERSION;

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

  /* ── Хранилище ───────────────────────────────────────── */
  function read(key, fallback) {
    try {
      var raw = global.localStorage.getItem(key);
      if (!raw) return clone(fallback);
      var parsed = JSON.parse(raw);
      return parsed == null ? clone(fallback) : parsed;
    } catch (e) {
      return clone(fallback);
    }
  }

  function write(key, value) {
    try {
      global.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.warn("Не удалось сохранить данные", e);
      return false;
    }
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function getServices() {
    var list = read(K_SERVICES, DEFAULT_SERVICES);
    if (!Array.isArray(list) || !list.length) list = clone(DEFAULT_SERVICES);
    return list.sort(function (a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0); });
  }

  function saveServices(list) {
    return write(K_SERVICES, list);
  }

  function getSettings() {
    var saved = read(K_SETTINGS, DEFAULT_SETTINGS);
    var s = Object.assign({}, clone(DEFAULT_SETTINGS), saved);
    s.workDays = Object.assign({}, defaultWorkDays(), saved && saved.workDays ? saved.workDays : {});
    if (!Array.isArray(s.blockedDates)) s.blockedDates = [];
    if (!Array.isArray(s.blockedSlots)) s.blockedSlots = [];
    return s;
  }

  function saveSettings(settings) {
    return write(K_SETTINGS, settings);
  }

  function getAppointments() {
    var list = read(K_APPOINTMENTS, []);
    return Array.isArray(list) ? list : [];
  }

  function saveAppointments(list) {
    return write(K_APPOINTMENTS, list);
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
    var list = getAppointments();
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
    list.push(item);
    saveAppointments(list);
    return item;
  }

  function updateAppointment(id, patch) {
    var list = getAppointments();
    var idx = -1;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) { idx = i; break; }
    if (idx === -1) return null;
    list[idx] = Object.assign({}, list[idx], patch);
    saveAppointments(list);
    return list[idx];
  }

  function deleteAppointment(id) {
    var list = getAppointments().filter(function (a) { return a.id !== id; });
    saveAppointments(list);
  }

  function getAppointment(id) {
    return getAppointments().filter(function (a) { return a.id === id; })[0] || null;
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
    if (!data || typeof data !== "object") throw new Error("Неверный формат файла");
    if (Array.isArray(data.services)) saveServices(data.services);
    if (data.settings) saveSettings(data.settings);
    if (Array.isArray(data.appointments)) saveAppointments(data.appointments);
    return true;
  }

  function resetAll() {
    try {
      global.localStorage.removeItem(K_SERVICES);
      global.localStorage.removeItem(K_SETTINGS);
      global.localStorage.removeItem(K_APPOINTMENTS);
    } catch (e) {}
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
    saveAppointments: saveAppointments,
    getAppointment: getAppointment,
    createAppointment: createAppointment,
    updateAppointment: updateAppointment,
    deleteAppointment: deleteAppointment,

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
