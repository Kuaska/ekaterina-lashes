/* =========================================================
   admin.js — кабинет мастера
   Пароль по умолчанию: ekaterina (меняется в ADMIN_PASSWORD)
   ========================================================= */
(function () {
  "use strict";

  var S = window.EK;
  var ADMIN_PASSWORD = "ekaterina";
  var SESSION_KEY = "ek_admin_session";

  var state = {
    view: "appointments",
    status: "all",
    search: "",
    weekStart: null,
    editingId: null
  };

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function esc(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function toast(message) {
    var node = $("#toast");
    if (!node) return;
    node.textContent = message;
    node.classList.add("is-visible");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { node.classList.remove("is-visible"); }, 3000);
  }

  var STATUS = {
    pending: { label: "ожидает", cls: "pending" },
    confirmed: { label: "подтверждена", cls: "confirmed" },
    done: { label: "выполнена", cls: "done" },
    cancelled: { label: "отменена", cls: "cancelled" }
  };

  /* ── Авторизация ─────────────────────────────────────── */
  function isAuthed() {
    try { return sessionStorage.getItem(SESSION_KEY) === "1"; } catch (e) { return false; }
  }

  function showApp() {
    $("#login-screen").hidden = true;
    $("#admin-app").hidden = false;
    initApp();
  }

  function showLogin() {
    $("#admin-app").hidden = true;
    $("#login-screen").hidden = false;
    setTimeout(function () { $("#login-password").focus(); }, 60);
  }

  function initLogin() {
    $("#login-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var value = $("#login-password").value;
      if (value === ADMIN_PASSWORD) {
        try { sessionStorage.setItem(SESSION_KEY, "1"); } catch (err) {}
        $("#login-error").hidden = true;
        showApp();
      } else {
        $("#login-error").hidden = false;
        $("#login-password").select();
      }
    });

    $("#logout-btn").addEventListener("click", function () {
      try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
      location.reload();
    });
  }

  /* ── Навигация ───────────────────────────────────────── */
  function setView(view) {
    state.view = view;
    $$(".admin-nav-item").forEach(function (b) {
      b.classList.toggle("is-active", b.dataset.view === view);
    });
    $$(".admin-view").forEach(function (v) {
      v.classList.toggle("is-active", v.dataset.view === view);
    });
    if (view === "appointments") renderAppointments();
    if (view === "calendar") renderWeek();
    if (view === "services") renderServicesEditor();
    if (view === "settings") renderSettings();
  }

  function initNav() {
    $$(".admin-nav-item").forEach(function (btn) {
      btn.addEventListener("click", function () { setView(btn.dataset.view); });
    });
    $$("[data-goto]").forEach(function (btn) {
      btn.addEventListener("click", function () { setView(btn.dataset.goto); });
    });
  }

  /* ── Заявки ──────────────────────────────────────────── */
  function statusOf(appointment) {
    if (appointment.status === "pending" && S.isExpired(appointment, S.getSettings())) {
      return { key: "expired", label: "бронь истекла", cls: "expired" };
    }
    var meta = STATUS[appointment.status] || STATUS.pending;
    return { key: appointment.status, label: meta.label, cls: meta.cls };
  }

  function sortedAppointments() {
    var today = S.toISO(new Date());
    return S.getAppointments().slice().sort(function (a, b) {
      var aPast = a.date < today;
      var bPast = b.date < today;
      if (aPast !== bPast) return aPast ? 1 : -1;
      var keyA = a.date + a.time;
      var keyB = b.date + b.time;
      return aPast ? keyB.localeCompare(keyA) : keyA.localeCompare(keyB);
    });
  }

  function contactUrl(kind, value) {
    var v = String(value || "").trim();
    if (kind === "phone") return "tel:" + v.replace(/[^\d+]/g, "");
    if (kind === "telegram") {
      if (/^https?:\/\//i.test(v)) return v;
      return "https://t.me/" + v.replace(/^@/, "").replace(/^t\.me\//i, "");
    }
    return "#";
  }

  function contactChip(kind, value) {
    if (!value) return "";
    var icon = {
      phone: '<svg viewBox="0 0 24 24" width="12" height="12"><path d="M6.5 3.5h3l1.5 4-2 1.5a12 12 0 0 0 6 6l1.5-2 4 1.5v3c0 1.1-.9 2-2 2A17 17 0 0 1 4.5 5.5c0-1.1.9-2 2-2Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
      telegram: '<svg viewBox="0 0 24 24" width="12" height="12"><path d="m21 4-2.6 15-6.4-4.7L9 17l.3-4.2L18 5.5 7.4 11.4 3 9.8 21 4Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>'
    }[kind];
    var label = kind === "phone" ? value : (kind === "telegram" ? (String(value).charAt(0) === "@" ? value : "@" + value) : value);
    return '<a class="ap-contact" href="' + esc(contactUrl(kind, value)) + '" target="_blank" rel="noopener">' +
      (icon || "") + esc(label) + "</a>";
  }

  function renderCounts() {
    var settings = S.getSettings();
    var list = S.getAppointments();
    var counts = { all: list.length, pending: 0, confirmed: 0, done: 0, cancelled: 0 };
    list.forEach(function (a) {
      if (a.status === "pending" && S.isExpired(a, settings)) return; // истёкшие не считаем активными
      if (counts[a.status] != null) counts[a.status]++;
    });
    $("#count-all").textContent = counts.all;
    $("#count-pending").textContent = counts.pending;
    $("#count-confirmed").textContent = counts.confirmed;
    $("#count-done").textContent = counts.done;
    $("#count-cancelled").textContent = counts.cancelled;
    $("#badge-pending").textContent = counts.pending;
    $("#badge-pending").style.display = counts.pending ? "grid" : "none";
  }

  function renderAppointments() {
    var listNode = $("#appointment-list");
    if (!listNode) return;

    var all = sortedAppointments();
    var settings = S.getSettings();
    var query = state.search.trim().toLowerCase();

    var filtered = all.filter(function (a) {
      if (state.status !== "all") {
        var key = statusOf(a).key;
        if (state.status !== key) return false;
      }
      if (!query) return true;
      var hay = [
        a.name, a.serviceTitle, a.date, a.time, a.comment, a.notes,
        a.contacts && a.contacts.phone, a.contacts && a.contacts.telegram
      ].join(" ").toLowerCase();
      return hay.indexOf(query) !== -1;
    });

    renderCounts();
    listNode.innerHTML = "";
    $("#appointments-empty").hidden = filtered.length > 0;

    var upcoming = filtered.filter(function (a) {
      return a.date >= S.toISO(new Date()) && a.status !== "cancelled";
    });
    $("#appointments-sub").textContent = filtered.length
      ? (upcoming.length + " " + plural(upcoming.length, "будущая запись", "будущие записи", "будущих записей") +
         " · всего " + filtered.length)
      : "Нет записей по выбранному фильтру";

    filtered.forEach(function (a) {
      listNode.appendChild(renderAppointmentCard(a, settings));
    });

    if (!filtered.length && all.length) {
      $("#appointments-empty").hidden = false;
      $("#appointments-empty .empty-title").textContent = "Ничего не найдено";
      $("#appointments-empty .empty-text").textContent = "Попробуйте изменить фильтр или поисковый запрос.";
    } else {
      $("#appointments-empty .empty-title").textContent = "Пока тихо";
      $("#appointments-empty .empty-text").textContent = "Новые заявки с сайта появятся здесь автоматически.";
    }
  }

  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  }

  function renderAppointmentCard(a, settings) {
    var d = S.parseISO(a.date);
    var status = statusOf(a);
    var contacts = a.contacts || {};

    var card = document.createElement("article");
    card.className = "ap-card is-" + (status.key === "expired" ? "pending" : a.status);
    card.dataset.id = a.id;

    var dateBlock =
      '<div class="ap-date">' +
        '<span class="ap-day">' + String(d.getDate()).padStart(2, "0") + "</span>" +
        '<span class="ap-month">' + S.MONTHS_GEN[d.getMonth()] + "</span>" +
        '<span class="ap-time">' + esc(a.time) + "</span>" +
      "</div>";

    var contactsHtml = [
      contactChip("phone", contacts.phone),
      contactChip("telegram", contacts.telegram)
    ].join("");

    var actions = "";
    if (a.status === "pending") {
      actions =
        '<button class="ap-action is-primary" type="button" data-act="confirm" data-id="' + esc(a.id) + '">Подтвердить</button>' +
        '<button class="ap-action" type="button" data-act="cancel" data-id="' + esc(a.id) + '">Отменить</button>' +
        '<button class="ap-action" type="button" data-act="edit" data-id="' + esc(a.id) + '">Изменить</button>';
    } else if (a.status === "confirmed") {
      actions =
        '<button class="ap-action is-primary" type="button" data-act="done" data-id="' + esc(a.id) + '">Выполнено</button>' +
        '<button class="ap-action" type="button" data-act="cancel" data-id="' + esc(a.id) + '">Отменить</button>' +
        '<button class="ap-action" type="button" data-act="edit" data-id="' + esc(a.id) + '">Изменить</button>';
    } else if (a.status === "done") {
      actions =
        '<button class="ap-action" type="button" data-act="edit" data-id="' + esc(a.id) + '">Изменить</button>' +
        '<button class="ap-action is-danger" type="button" data-act="delete" data-id="' + esc(a.id) + '">Удалить</button>';
    } else {
      actions =
        '<button class="ap-action" type="button" data-act="restore" data-id="' + esc(a.id) + '">Вернуть в ожидание</button>' +
        '<button class="ap-action is-danger" type="button" data-act="delete" data-id="' + esc(a.id) + '">Удалить</button>';
    }

    card.innerHTML =
      dateBlock +
      '<div class="ap-main">' +
        '<div class="ap-topline">' +
          '<span class="ap-name">' + esc(a.name) + "</span>" +
          '<span class="status-pill ' + status.cls + '">' + status.label + "</span>" +
        "</div>" +
        '<div class="ap-service"><b>' + esc(a.serviceTitle) + "</b> · " +
          S.formatDuration(a.durationMin) + " · " + S.formatPrice(a.price) + "</div>" +
        (contactsHtml ? '<div class="ap-contacts">' + contactsHtml + "</div>" : "") +
        (a.comment ? '<p class="ap-comment">' + esc(a.comment) + "</p>" : "") +
        (a.notes ? '<p class="ap-notes">Заметка: ' + esc(a.notes) + "</p>" : "") +
      "</div>" +
      '<div class="ap-actions">' + actions + "</div>";

    return card;
  }

  function initAppointments() {
    var listNode = $("#appointment-list");

    listNode.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-act]");
      if (!btn) return;
      var id = btn.dataset.id;
      var act = btn.dataset.act;

      if (act === "confirm") {
        S.updateAppointment(id, { status: "confirmed", confirmedAt: new Date().toISOString() });
        toast("Запись подтверждена");
      } else if (act === "done") {
        S.updateAppointment(id, { status: "done" });
        toast("Отмечено как выполнено");
      } else if (act === "cancel") {
        if (!confirm("Отменить эту запись? Слот снова станет свободным.")) return;
        S.updateAppointment(id, { status: "cancelled" });
        toast("Запись отменена");
      } else if (act === "restore") {
        S.updateAppointment(id, { status: "pending", createdAt: new Date().toISOString() });
        toast("Запись возвращена в ожидание");
      } else if (act === "delete") {
        if (!confirm("Удалить запись навсегда?")) return;
        S.deleteAppointment(id);
        toast("Запись удалена");
      } else if (act === "edit") {
        openAppointmentModal(id);
        return;
      }
      renderAppointments();
      renderWeek();
    });

    $$("#status-filter .filter-tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        state.status = tab.dataset.status;
        $$("#status-filter .filter-tab").forEach(function (t) {
          t.classList.toggle("is-active", t === tab);
        });
        renderAppointments();
      });
    });

    var search = $("#appointments-search");
    var timer = null;
    search.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        state.search = search.value;
        renderAppointments();
      }, 140);
    });

    $("#new-appointment-btn").addEventListener("click", function () { openAppointmentModal(null); });
  }

  /* ── Модалка записи ──────────────────────────────────── */
  function openAppointmentModal(id) {
    state.editingId = id;
    var appointment = id ? S.getAppointment(id) : null;

    var select = $("#ap-service");
    select.innerHTML = "";
    S.getServices().forEach(function (s) {
      var opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.title + " · " + S.formatDuration(s.durationMin);
      select.appendChild(opt);
    });

    if (appointment) {
      $("#modal-title").textContent = "Изменить запись";
      $("#ap-id").value = appointment.id;
      $("#ap-name").value = appointment.name || "";
      var c = appointment.contacts || {};
      $("#ap-phone").value = c.phone || "";
      $("#ap-telegram").value = c.telegram || "";
      select.value = appointment.serviceId;
      $("#ap-status").value = appointment.status;
      $("#ap-date").value = appointment.date;
      $("#ap-time").value = appointment.time;
      $("#ap-notes").value = appointment.notes || "";
    } else {
      $("#modal-title").textContent = "Новая запись";
      $("#appointment-form").reset();
      $("#ap-id").value = "";
      $("#ap-date").value = S.toISO(new Date());
      $("#ap-time").value = "11:00";
      $("#ap-status").value = "confirmed";
      if (select.options.length) select.selectedIndex = 0;
    }

    $("#ap-error").hidden = true;
    $("#appointment-modal").hidden = false;
    setTimeout(function () { $("#ap-name").focus(); }, 80);
  }

  function closeModal(node) {
    node.hidden = true;
  }

  function initAppointmentModal() {
    var modal = $("#appointment-modal");

    $$("[data-close-modal]", modal).forEach(function (btn) {
      btn.addEventListener("click", function () { closeModal(modal); });
    });

    $("#appointment-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var id = $("#ap-id").value;
      var name = $("#ap-name").value.trim();
      var date = $("#ap-date").value;
      var time = $("#ap-time").value;
      var serviceId = $("#ap-service").value;
      var status = $("#ap-status").value;
      var notes = $("#ap-notes").value.trim();

      var error = $("#ap-error");
      error.hidden = true;

      if (!name) { error.textContent = "Укажите имя клиента."; error.hidden = false; return; }
      if (!date || !time) { error.textContent = "Укажите дату и время."; error.hidden = false; return; }

      var service = S.getServices().filter(function (s) { return s.id === serviceId; })[0];
      if (!service) { error.textContent = "Выберите услугу."; error.hidden = false; return; }

      var contacts = {
        phone: $("#ap-phone").value.trim(),
        telegram: $("#ap-telegram").value.trim()
      };
      Object.keys(contacts).forEach(function (k) { if (!contacts[k]) delete contacts[k]; });

      var settings = S.getSettings();
      if (status !== "cancelled") {
        var conflict = !S.isSlotFree(date, time, service.durationMin, settings, id || null);
        if (conflict) {
          error.textContent = "На это время уже есть другая запись. Выберите другое окно.";
          error.hidden = false;
          return;
        }
      }

      if (id) {
        S.updateAppointment(id, {
          name: name,
          date: date,
          time: time,
          serviceId: service.id,
          serviceTitle: service.title,
          durationMin: service.durationMin,
          price: service.price,
          status: status,
          notes: notes,
          contacts: contacts
        });
        toast("Запись обновлена");
      } else {
        var created = S.createAppointment({
          name: name,
          date: date,
          time: time,
          serviceId: service.id,
          serviceTitle: service.title,
          durationMin: service.durationMin,
          price: service.price,
          contacts: contacts,
          notes: notes,
          source: "manual"
        });
        S.updateAppointment(created.id, { status: status, notes: notes });
        toast("Запись добавлена");
      }

      closeModal(modal);
      renderAppointments();
      renderWeek();
    });
  }

  /* ── Неделя ──────────────────────────────────────────── */
  function mondayOf(date) {
    var d = S.startOfDay(date);
    var shift = (d.getDay() + 6) % 7;
    return S.addDays(d, -shift);
  }

  function renderWeek() {
    var grid = $("#week-grid");
    if (!grid) return;

    if (!state.weekStart) state.weekStart = mondayOf(new Date());
    var start = state.weekStart;
    var settings = S.getSettings();
    var end = S.addDays(start, 6);

    $("#week-sub").textContent =
      S.formatDateShort(S.toISO(start)) + " — " + S.formatDateShort(S.toISO(end)) + " " +
      S.MONTHS_GEN[end.getMonth()] + " " + end.getFullYear();

    var appointments = S.activeAppointments(settings);
    var todayISO = S.toISO(new Date());

    grid.innerHTML = "";

    for (var i = 0; i < 7; i++) {
      var day = S.addDays(start, i);
      var iso = S.toISO(day);
      var wd = settings.workDays[day.getDay()];
      var closed = settings.blockedDates.indexOf(iso) !== -1;
      var dayApps = appointments
        .filter(function (a) { return a.date === iso; })
        .sort(function (a, b) { return a.time.localeCompare(b.time); });

      var col = document.createElement("div");
      col.className = "week-day" + (iso === todayISO ? " is-today" : "") +
        (closed ? " is-closed" : "") + (!wd || !wd.enabled ? " is-off" : "");
      col.dataset.date = iso;

      var hours = !wd || !wd.enabled ? "выходной" : wd.start + "–" + wd.end;

      col.innerHTML =
        '<div class="week-day-head">' +
          '<span class="week-day-name">' + S.WEEKDAYS_SHORT[day.getDay()] + "</span>" +
          '<span class="week-day-num">' + day.getDate() + "</span>" +
        "</div>" +
        '<div class="week-day-hours">' + hours + (closed ? " · закрыто" : "") + "</div>";

      if (dayApps.length) {
        dayApps.forEach(function (a) {
          var btn = document.createElement("button");
          btn.type = "button";
          btn.className = "week-ap is-" + a.status;
          btn.dataset.open = a.id;
          btn.innerHTML = "<b>" + esc(a.time) + " · " + esc(a.name) + "</b><span>" + esc(a.serviceTitle) + "</span>";
          btn.addEventListener("click", function () { openAppointmentModal(a.id); });
          col.appendChild(btn);
        });
      } else {
        var empty = document.createElement("div");
        empty.className = "week-empty";
        empty.textContent = closed ? "день закрыт" : "свободно";
        col.appendChild(empty);
      }

      var toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "week-day-toggle";
      toggle.textContent = closed ? "Открыть день" : "Закрыть день";
      toggle.addEventListener("click", function () {
        toggleBlockedDate(iso, closed);
      });
      col.appendChild(toggle);

      grid.appendChild(col);
    }
  }

  function toggleBlockedDate(iso, isClosed) {
    var settings = S.getSettings();
    if (isClosed) {
      settings.blockedDates = settings.blockedDates.filter(function (d) { return d !== iso; });
      toast("День открыт для записи");
    } else {
      var hasActive = S.activeAppointments(settings).some(function (a) { return a.date === iso; });
      if (hasActive && !confirm("На этот день уже есть записи. Закрыть день всё равно? Существующие записи останутся.")) return;
      if (!settings.blockedDates.includes(iso)) settings.blockedDates.push(iso);
      toast("День закрыт");
    }
    S.saveSettings(settings);
    renderWeek();
  }

  function initWeek() {
    $("#week-prev").addEventListener("click", function () {
      state.weekStart = S.addDays(state.weekStart, -7);
      renderWeek();
    });
    $("#week-next").addEventListener("click", function () {
      state.weekStart = S.addDays(state.weekStart, 7);
      renderWeek();
    });
    $("#week-today").addEventListener("click", function () {
      state.weekStart = mondayOf(new Date());
      renderWeek();
    });

    $("#week-grid").addEventListener("click", function (e) {
      var cell = e.target.closest(".week-day");
      if (!cell || e.target.closest("button")) return;
      var iso = cell.dataset.date;
      var settings = S.getSettings();
      toggleBlockedDate(iso, settings.blockedDates.indexOf(iso) !== -1);
    });

    // блокировка времени
    $("#block-time-btn").addEventListener("click", function () {
      var today = S.toISO(new Date());
      $("#block-date").value = today;
      $("#block-start").value = "12:00";
      $("#block-end").value = "14:00";
      $("#block-error").hidden = true;
      $("#block-modal").hidden = false;
    });

    $$("#block-modal [data-close-modal]").forEach(function (btn) {
      btn.addEventListener("click", function () { $("#block-modal").hidden = true; });
    });

    $("#block-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var date = $("#block-date").value;
      var start = $("#block-start").value;
      var end = $("#block-end").value;
      var error = $("#block-error");
      error.hidden = true;

      if (!date) { error.textContent = "Выберите дату."; error.hidden = false; return; }

      var startMin = S.toMinutes(start);
      var endMin = S.toMinutes(end);
      if (startMin == null || endMin == null || endMin <= startMin) {
        error.textContent = "Конец должен быть позже начала.";
        error.hidden = false;
        return;
      }

      var settings = S.getSettings();
      var added = 0;
      for (var t = startMin; t < endMin; t += 30) {
        var time = S.fromMinutes(t);
        var exists = settings.blockedSlots.some(function (b) { return b.date === date && b.time === time; });
        if (!exists) { settings.blockedSlots.push({ date: date, time: time }); added++; }
      }
      S.saveSettings(settings);
      $("#block-modal").hidden = true;
      toast("Закрыто " + plural(added, "окно", "окна", "окон"));
      renderWeek();
    });
  }

  /* ── Услуги ──────────────────────────────────────────── */
  function renderServicesEditor() {
    var wrap = $("#service-editor");
    if (!wrap) return;
    wrap.innerHTML = "";

    S.getServices().forEach(function (service) {
      var row = document.createElement("div");
      row.className = "service-row" + (service.active ? "" : " is-off");
      row.dataset.id = service.id;

      row.innerHTML =
        '<input class="service-input service-title-input" data-field="title" value="' + esc(service.title) + '" aria-label="Название">' +
        '<input class="service-num-input" data-field="price" type="number" min="0" step="50" value="' + Number(service.price) + '" aria-label="Цена">' +
        '<input class="service-num-input" data-field="durationMin" type="number" min="15" step="15" value="' + Number(service.durationMin) + '" aria-label="Минуты">' +
        '<textarea class="service-area" data-field="description" rows="2" aria-label="Описание">' + esc(service.description) + "</textarea>" +
        '<div class="service-controls">' +
          '<span class="service-label">' + (service.active ? "на сайте" : "скрыта") + "</span>" +
          '<button class="switch ' + (service.active ? "is-on" : "") + '" type="button" data-toggle aria-label="Показывать на сайте"></button>' +
          '<button class="icon-danger" type="button" data-remove aria-label="Удалить услугу">×</button>' +
        "</div>";

      row.addEventListener("change", function (e) {
        var field = e.target.dataset.field;
        if (!field) return;
        var list = S.getServices();
        var idx = list.findIndex(function (s) { return s.id === service.id; });
        if (idx === -1) return;
        var value = e.target.value;
        if (field === "price" || field === "durationMin") value = Number(value) || 0;
        list[idx][field] = value;
        S.saveServices(list);
        toast("Услуга обновлена");
      });

      row.querySelector("[data-toggle]").addEventListener("click", function () {
        var list = S.getServices();
        var idx = list.findIndex(function (s) { return s.id === service.id; });
        list[idx].active = !list[idx].active;
        S.saveServices(list);
        renderServicesEditor();
        toast(list[idx].active ? "Услуга показана на сайте" : "Услуга скрыта");
      });

      row.querySelector("[data-remove]").addEventListener("click", function () {
        if (!confirm("Удалить услугу «" + service.title + "»? Записи останутся в архиве.")) return;
        S.saveServices(S.getServices().filter(function (s) { return s.id !== service.id; }));
        renderServicesEditor();
        toast("Услуга удалена");
      });

      wrap.appendChild(row);
    });
  }

  function initServices() {
    $("#add-service-btn").addEventListener("click", function () {
      var list = S.getServices();
      var item = {
        id: "service_" + Date.now().toString(36),
        title: "Новая услуга",
        description: "Короткое описание услуги.",
        price: 1000,
        durationMin: 60,
        active: false,
        sortOrder: list.length + 1
      };
      list.push(item);
      S.saveServices(list);
      renderServicesEditor();
      toast("Услуга добавлена — заполните поля и включите её");
    });
  }

  /* ── Настройки ───────────────────────────────────────── */
  function renderSettings() {
    var settings = S.getSettings();
    var wrap = $("#workdays");
    if (!wrap) return;

    var names = ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];
    var order = [1, 2, 3, 4, 5, 6, 0];
    wrap.innerHTML = "";

    order.forEach(function (day) {
      var wd = settings.workDays[day];
      var row = document.createElement("div");
      row.className = "workday" + (wd.enabled ? "" : " is-off");
      row.dataset.day = day;
      row.innerHTML =
        '<span class="workday-name">' + names[day] + "</span>" +
        '<button class="switch ' + (wd.enabled ? "is-on" : "") + '" type="button" data-day-toggle aria-label="Рабочий день"></button>' +
        '<span class="workday-times">' +
          '<input class="tiny-input" type="time" data-field="start" value="' + esc(wd.start) + '" aria-label="Начало">' +
          "—" +
          '<input class="tiny-input" type="time" data-field="end" value="' + esc(wd.end) + '" aria-label="Конец">' +
          " · обед " +
          '<input class="tiny-input" type="time" data-field="breakStart" value="' + esc(wd.breakStart || "") + '" aria-label="Начало обеда">' +
          "—" +
          '<input class="tiny-input" type="time" data-field="breakEnd" value="' + esc(wd.breakEnd || "") + '" aria-label="Конец обеда">' +
        "</span>" +
        "<span></span>";

      row.querySelector("[data-day-toggle]").addEventListener("click", function () {
        wd.enabled = !wd.enabled;
        S.saveSettings(settings);
        renderSettings();
      });

      wrap.appendChild(row);
    });

    // закрытые даты
    var chips = $("#blocked-dates");
    chips.innerHTML = "";
    settings.blockedDates.slice().sort().forEach(function (iso) {
      var chip = document.createElement("span");
      chip.className = "blocked-chip";
      chip.innerHTML = "<span>" + esc(S.formatDateShort(iso)) + "." + S.parseISO(iso).getFullYear() + "</span>" +
        '<button type="button" aria-label="Открыть день">×</button>';
      chip.querySelector("button").addEventListener("click", function () {
        settings.blockedDates = settings.blockedDates.filter(function (d) { return d !== iso; });
        S.saveSettings(settings);
        renderSettings();
        toast("День открыт");
      });
      chips.appendChild(chip);
    });

    if (!settings.blockedDates.length) {
      chips.innerHTML = '<span class="card-sub">Все дни открыты по расписанию.</span>';
    }

    $("#max-days").value = settings.maxDaysAhead;
    $("#hold-hours").value = settings.holdHours;
    $("#settings-phone").value = settings.phone || "";
    $("#settings-telegram").value = settings.telegram || "";

    var count = S.getAppointments().length;
    $("#storage-note").textContent = "Сейчас в браузере: " + count + " " +
      plural(count, "запись", "записи", "записей") + ". Экспорт создаёт резервную копию JSON.";
  }

  function readWorkdays() {
    var settings = S.getSettings();
    $$(".workday").forEach(function (row) {
      var day = Number(row.dataset.day);
      var wd = settings.workDays[day];
      if (!wd) return;
      wd.start = row.querySelector('[data-field="start"]').value || "10:00";
      wd.end = row.querySelector('[data-field="end"]').value || "20:00";
      wd.breakStart = row.querySelector('[data-field="breakStart"]').value || "";
      wd.breakEnd = row.querySelector('[data-field="breakEnd"]').value || "";
    });
    return settings;
  }

  function initSettings() {
    $("#save-settings-btn").addEventListener("click", function () {
      var settings = readWorkdays();
      settings.maxDaysAhead = Math.max(7, Math.min(180, Number($("#max-days").value) || 60));
      settings.holdHours = Math.max(1, Math.min(72, Number($("#hold-hours").value) || 24));
      settings.phone = $("#settings-phone").value.trim();
      settings.telegram = $("#settings-telegram").value.trim();
      S.saveSettings(settings);
      renderSettings();
      toast("Настройки сохранены");
    });

    $("#add-block-date").addEventListener("click", function () {
      var value = $("#block-date-input").value;
      if (!value) { toast("Выберите дату"); return; }
      var settings = S.getSettings();
      if (!settings.blockedDates.includes(value)) {
        settings.blockedDates.push(value);
        S.saveSettings(settings);
        toast("День закрыт");
      } else {
        toast("Этот день уже закрыт");
      }
      $("#block-date-input").value = "";
      renderSettings();
    });

    $("#export-btn").addEventListener("click", function () {
      var blob = new Blob([S.exportAll()], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "ekaterina-backup-" + S.toISO(new Date()) + ".json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      toast("Файл с данными скачан");
    });

    $("#import-file").addEventListener("change", function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          S.importAll(String(reader.result));
          toast("Данные загружены");
          renderSettings();
          renderAppointments();
          renderWeek();
        } catch (err) {
          toast("Не удалось прочитать файл");
        }
      };
      reader.readAsText(file);
      e.target.value = "";
    });

    $("#demo-btn").addEventListener("click", function () {
      if (!confirm("Добавить несколько демонстрационных записей? Их можно удалить в любой момент.")) return;
      var services = S.getServices().filter(function (s) { return s.active; });
      if (!services.length) { toast("Сначала добавьте услугу"); return; }
      var main = services[0];
      var today = S.startOfDay(new Date());
      var demo = [
        { offset: 1, time: "11:00", name: "Анна", service: main, status: "pending", phone: "+7 (912) 111-22-33", comment: "Первый раз, ресницы тонкие." },
        { offset: 1, time: "15:30", name: "Мария", service: main, status: "confirmed", telegram: "@maria_tmn" },
        { offset: 2, time: "12:00", name: "Ольга", service: main, status: "confirmed", phone: "+7 (912) 777-88-99" },
        { offset: -2, time: "16:00", name: "Дарья", service: main, status: "done", phone: "+7 (912) 444-55-66" }
      ];
      demo.forEach(function (item) {
        var date = S.toISO(S.addDays(today, item.offset));
        var created = S.createAppointment({
          date: date,
          time: item.time,
          serviceId: item.service.id,
          serviceTitle: item.service.title,
          durationMin: item.service.durationMin,
          price: item.service.price,
          name: item.name,
          contacts: { phone: item.phone, telegram: item.telegram },
          comment: item.comment || "",
          source: "demo"
        });
        S.updateAppointment(created.id, { status: item.status });
      });
      toast("Демо-записи добавлены");
      renderAppointments();
      renderWeek();
      renderSettings();
    });

    $("#reset-btn").addEventListener("click", function () {
      if (!confirm("Удалить все записи, услуги и настройки из этого браузера? Действие необратимо.")) return;
      S.resetAll();
      toast("Все данные сброшены");
      renderAppointments();
      renderWeek();
      renderServicesEditor();
      renderSettings();
    });
  }

  /* ── Общее ───────────────────────────────────────────── */
  function initModals() {
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      $$(".modal").forEach(function (m) { m.hidden = true; });
    });
  }

  function initApp() {
    if (initApp._done) {
      renderAppointments();
      renderWeek();
      renderServicesEditor();
      renderSettings();
      return;
    }
    initApp._done = true;

    initNav();
    initAppointments();
    initAppointmentModal();
    initWeek();
    initServices();
    initSettings();
    initModals();
    setView("appointments");
  }

  /* ── Старт ───────────────────────────────────────────── */
  function init() {
    initLogin();
    if (isAuthed()) showApp();
    else showLogin();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
