/* =========================================================
   site.js — публичная часть: услуги, календарь, запись
   ========================================================= */
(function () {
  "use strict";

  var S = window.EK;
  var state = {
    step: 1,
    service: null,
    month: null,
    date: null,
    time: null
  };

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function el(tag, cls, html) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (html != null) node.innerHTML = html;
    return node;
  }

  /* ── Тост ────────────────────────────────────────────── */
  var toastTimer = null;
  function toast(message) {
    var node = $("#toast");
    if (!node) return;
    node.textContent = message;
    node.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { node.classList.remove("is-visible"); }, 3200);
  }

  /* ── Появление секций ────────────────────────────────── */
  function initReveal() {
    var items = $$(".reveal");
    if (!("IntersectionObserver" in window)) {
      items.forEach(function (i) { i.classList.add("is-visible"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -60px 0px" });
    items.forEach(function (i) { io.observe(i); });
  }

  /* ── Хедер и мобильное меню ──────────────────────────── */
  function initHeader() {
    var header = $(".site-header");
    var burger = $(".burger");
    var mobileNav = $("#mobile-nav");

    function onScroll() {
      header.classList.toggle("is-stuck", window.scrollY > 24);
      var cta = $("#mobile-cta");
      if (cta) cta.classList.toggle("is-visible", window.scrollY > 520);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    function closeNav() {
      if (!mobileNav || mobileNav.hidden) return;
      mobileNav.hidden = true;
      burger.setAttribute("aria-expanded", "false");
      document.body.classList.remove("no-scroll");
    }

    burger.addEventListener("click", function () {
      var isOpen = burger.getAttribute("aria-expanded") === "true";
      burger.setAttribute("aria-expanded", String(!isOpen));
      mobileNav.hidden = isOpen;
      document.body.classList.toggle("no-scroll", !isOpen);
    });

    $$("#mobile-nav a").forEach(function (link) {
      link.addEventListener("click", closeNav);
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeNav();
    });
  }

  /* ── Данные на странице ──────────────────────────────── */
  function renderServices() {
    var grid = $("#service-grid");
    if (!grid) return;

    var services = S.getServices().filter(function (s) { return s.active; });
    grid.innerHTML = "";

    services.forEach(function (service, index) {
      var card = el("article", "service-card reveal");
      card.style.setProperty("--d", index * 60 + "ms");
      card.innerHTML =
        '<div class="service-top">' +
          '<span class="service-num">' + String(index + 1).padStart(2, "0") + '</span>' +
          '<span class="service-dur">' + S.formatDuration(service.durationMin) + '</span>' +
        '</div>' +
        "<h3>" + escapeHtml(service.title) + "</h3>" +
        "<p>" + escapeHtml(service.description) + "</p>" +
        '<div class="service-bottom">' +
          '<span class="service-price">' + S.formatPrice(service.price) + '</span>' +
          '<button class="service-pick" type="button">Выбрать ' +
            '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
          '</button>' +
        '</div>';
      card.querySelector(".service-pick").addEventListener("click", function () {
        selectService(service.id);
        document.getElementById("booking").scrollIntoView({ behavior: "smooth", block: "start" });
      });
      grid.appendChild(card);
    });

    // заново наблюдаем за новыми .reveal
    initReveal();
    buildServiceChoices(services);
    applySingleService(services);
  }

  /* Если услуга одна — незачем спрашивать, какую выбрать:
     выбираем её сразу и открываем календарь. */
  function applySingleService(services) {
    var card = $("#booking-card");
    if (!card) return;

    var single = services.length === 1;
    card.classList.toggle("is-single", single);

    var dots = $$(".step");
    dots.forEach(function (dot, i) {
      dot.classList.toggle("is-hidden", single && i === 0);
      var num = dot.querySelector("i");
      if (num) num.textContent = single && i > 0 ? String(i) : String(i + 1);
    });

    if (single) {
      selectService(services[0].id);
      goStep(2, true);
    }
  }

  function buildServiceChoices(services) {
    var wrap = $("#service-choice");
    if (!wrap) return;
    wrap.innerHTML = "";
    services.forEach(function (service) {
      var btn = el("button", "choice");
      btn.type = "button";
      btn.dataset.id = service.id;
      btn.innerHTML =
        '<span class="choice-name">' + escapeHtml(service.title) + '</span>' +
        '<span class="choice-meta"><span>' + S.formatDuration(service.durationMin) + '</span>' +
        "<b>" + S.formatPrice(service.price) + "</b></span>";
      btn.addEventListener("click", function () { selectService(service.id); });
      wrap.appendChild(btn);
    });
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /* ── Выбор услуги ────────────────────────────────────── */
  function selectService(id) {
    var services = S.getServices().filter(function (s) { return s.active; });
    state.service = services.filter(function (s) { return s.id === id; })[0] || null;
    $$(".choice").forEach(function (b) {
      b.classList.toggle("is-selected", b.dataset.id === id);
    });
    var next = $("#to-step-2");
    if (next) next.disabled = !state.service;
    if (state.date && !S.dayIsAvailable(state.date, state.service, S.getSettings())) {
      state.date = null;
      state.time = null;
    }
  }

  /* ── Шаги ────────────────────────────────────────────── */
  function goStep(step, silent) {
    state.step = step;
    $$(".booking-pane").forEach(function (pane) {
      pane.classList.toggle("is-active", Number(pane.dataset.step) === step);
    });
    $$(".step").forEach(function (dot) {
      var n = Number(dot.dataset.stepDot);
      dot.classList.toggle("is-active", n === step);
      dot.classList.toggle("is-done", n < step);
    });
    if (step === 2) renderCalendar();
    if (step === 3) renderSlots();
    if (step === 4) renderSummary();

    if (silent) return;

    var card = $("#booking-card");
    if (card) {
      var y = card.getBoundingClientRect().top + window.scrollY - 100;
      if (window.scrollY > y || window.scrollY < y - window.innerHeight) {
        window.scrollTo({ top: y, behavior: "smooth" });
      }
    }
  }

  /* ── Календарь ───────────────────────────────────────── */
  function renderCalendar() {
    var settings = S.getSettings();
    var today = S.startOfDay(new Date());
    var first = new Date(today.getFullYear(), today.getMonth(), 1);
    if (!state.month) state.month = new Date(first.getTime());

    var month = state.month;
    var year = month.getFullYear();
    var m = month.getMonth();

    $("#cal-month").textContent = S.MONTHS[m] + " " + year;

    var prev = $("#cal-prev");
    var next = $("#cal-next");
    prev.disabled = year === first.getFullYear() && m <= first.getMonth();

    var limit = S.addDays(today, Number(settings.maxDaysAhead) || 60);
    next.disabled = year > limit.getFullYear() || (year === limit.getFullYear() && m >= limit.getMonth());

    var grid = $("#cal-grid");
    grid.innerHTML = "";

    var offset = S.mondayIndex(new Date(year, m, 1));
    for (var i = 0; i < offset; i++) {
      var empty = el("span", "cal-day is-empty");
      empty.setAttribute("aria-hidden", "true");
      grid.appendChild(empty);
    }

    var total = S.daysInMonth(year, m);
    for (var day = 1; day <= total; day++) {
      var date = new Date(year, m, day);
      var iso = S.toISO(date);
      var btn = el("button", "cal-day");
      btn.type = "button";
      btn.textContent = String(day);
      btn.dataset.date = iso;
      btn.setAttribute("role", "gridcell");

      var available = state.service
        ? S.dayIsAvailable(iso, state.service, settings)
        : false;
      var free = available && S.slotsForDay(iso, state.service, settings).length > 0;

      if (!available) btn.disabled = true;
      if (free) btn.classList.add("is-free");
      if (iso === S.toISO(today)) btn.classList.add("is-today");
      if (iso === state.date) btn.classList.add("is-selected");

      btn.setAttribute("aria-label", S.formatDateRu(iso) + (available ? ", есть свободное время" : ", запись недоступна"));

      btn.addEventListener("click", function (event) {
        var isoDate = event.currentTarget.dataset.date;
        state.date = isoDate;
        state.time = null;
        $$(".cal-day").forEach(function (d) { d.classList.remove("is-selected"); });
        event.currentTarget.classList.add("is-selected");
        $("#to-step-3").disabled = false;
        renderSlots();
        updateCalHint();
      });

      grid.appendChild(btn);
    }

    updateCalHint();
    $("#to-step-3").disabled = !state.date;
  }

  function updateCalHint() {
    var hint = $("#cal-hint");
    if (!hint) return;
    var settings = S.getSettings();
    if (!state.service) {
      hint.textContent = "Сначала выберите услугу.";
      return;
    }
    if (state.date) {
      var count = S.slotsForDay(state.date, state.service, settings).length;
      hint.textContent = count
        ? S.formatDateRu(state.date) + " — свободно " + count + " " + plural(count, "окно", "окна", "окон")
        : "На этот день свободных окон нет.";
    } else {
      hint.textContent = "Дни с золотой точкой доступны для записи.";
    }
  }

  function plural(n, one, few, many) {
    var mod10 = n % 10;
    var mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
    return many;
  }

  /* ── Слоты ───────────────────────────────────────────── */
  function renderSlots() {
    var grid = $("#slot-grid");
    var empty = $("#slots-empty");
    if (!grid) return;

    var settings = S.getSettings();
    grid.innerHTML = "";
    empty.hidden = true;

    if (!state.service || !state.date) {
      $("#to-step-4").disabled = true;
      return;
    }

    $("#slots-sub").textContent =
      S.formatDateRu(state.date) + " · " + state.service.title + " · " + S.formatDuration(state.service.durationMin);

    var slots = S.slotsForDay(state.date, state.service, settings);
    if (!slots.length) {
      empty.hidden = false;
      $("#to-step-4").disabled = true;
      return;
    }

    if (state.time && slots.indexOf(state.time) === -1) state.time = null;

    slots.forEach(function (time) {
      var b = el("button", "slot");
      b.type = "button";
      b.textContent = time;
      if (time === state.time) b.classList.add("is-selected");
      b.addEventListener("click", function () {
        state.time = time;
        $$(".slot").forEach(function (s) { s.classList.remove("is-selected"); });
        b.classList.add("is-selected");
        $("#to-step-4").disabled = false;
      });
      grid.appendChild(b);
    });

    $("#to-step-4").disabled = !state.time;
  }

  /* ── Сводка и отправка ───────────────────────────────── */
  function renderSummary() {
    var box = $("#booking-summary");
    if (!box || !state.service) return;
    box.innerHTML =
      "<span>" + escapeHtml(state.service.title) + "</span>" +
      "<span>" + S.formatDateRu(state.date) + "</span>" +
      "<span>" + state.time + "</span>" +
      "<span>" + S.formatPrice(state.service.price) + "</span>";
  }

  function selectedContacts() {
    return $$('.contact-options input[type="checkbox"]:checked').map(function (c) { return c.value; });
  }

  function setContactFields() {
    var chosen = selectedContacts();
    $$("[data-for]").forEach(function (field) {
      var on = chosen.indexOf(field.dataset.for) !== -1;
      field.hidden = !on;
      if (!on) {
        var input = field.querySelector("input");
        if (input) { input.value = ""; field.classList.remove("has-error"); }
      }
    });
  }

  function showError(message) {
    var box = $("#form-error");
    box.textContent = message;
    box.hidden = false;
    box.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function clearError() {
    var box = $("#form-error");
    if (box) box.hidden = true;
    $$(".field.has-error").forEach(function (f) { f.classList.remove("has-error"); });
  }

  function validate() {
    clearError();
    var name = $("#client-name");
    if (!name.value.trim() || name.value.trim().length < 2) {
      name.closest(".field").classList.add("has-error");
      showError("Напишите, пожалуйста, как к вам обращаться.");
      name.focus();
      return null;
    }

    var contacts = selectedContacts();
    if (!contacts.length) {
      showError("Выберите хотя бы один способ связи — телефон или Telegram.");
      return null;
    }

    var result = {};
    if (contacts.indexOf("phone") !== -1) {
      var phone = $("#client-phone");
      var digits = phone.value.replace(/\D/g, "");
      if (digits.length < 10) {
        phone.closest(".field").classList.add("has-error");
        showError("Проверьте номер телефона — нужно не меньше 10 цифр.");
        phone.focus();
        return null;
      }
      result.phone = phone.value.trim();
    }
    if (contacts.indexOf("telegram") !== -1) {
      var tg = $("#client-telegram");
      if (!tg.value.trim()) {
        tg.closest(".field").classList.add("has-error");
        showError("Укажите ник или номер телефона в Telegram.");
        tg.focus();
        return null;
      }
      result.telegram = tg.value.trim();
    }

    if (!$("#consent").checked) {
      showError("Поставьте галочку согласия на обработку данных — без неё я не смогу принять заявку.");
      return null;
    }

    return { name: name.value.trim(), contacts: result, comment: $("#client-comment").value.trim() };
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (!state.service || !state.date || !state.time) {
      toast("Выберите услугу, дату и время.");
      return;
    }

    var data = validate();
    if (!data) return;

    var settings = S.getSettings();
    if (!S.isSlotFree(state.date, state.time, state.service.durationMin, settings)) {
      showError("Это время только что заняли. Выберите, пожалуйста, другое окно.");
      renderSlots();
      goStep(3);
      return;
    }

    var appointment = S.createAppointment({
      date: state.date,
      time: state.time,
      serviceId: state.service.id,
      serviceTitle: state.service.title,
      durationMin: state.service.durationMin,
      price: state.service.price,
      name: data.name,
      contacts: data.contacts,
      comment: data.comment
    });

    showSuccess(appointment);
    renderCalendar();
    updateMobileCta();
    toast("Заявка сохранена");
  }

  function showSuccess(appointment) {
    var details = $("#success-details");
    if (details) {
      details.innerHTML =
        "<span><b>" + escapeHtml(appointment.serviceTitle) + "</b></span>" +
        "<span>" + S.formatDateRu(appointment.date) + " · " + appointment.time + "</span>" +
        "<span>Стоимость: " + S.formatPrice(appointment.price) + "</span>" +
        "<span>Статус: ожидает подтверждения</span>";
    }
    $$(".booking-pane").forEach(function (pane) {
      pane.classList.toggle("is-active", pane.dataset.step === "done");
    });
    $$(".step").forEach(function (dot) { dot.classList.add("is-done"); dot.classList.remove("is-active"); });
    var card = $("#booking-card");
    if (card) {
      window.scrollTo({
        top: card.getBoundingClientRect().top + window.scrollY - 90,
        behavior: "smooth"
      });
    }
  }

  function resetBooking() {
    state.step = 1;
    state.date = null;
    state.time = null;
    $("#booking-form").reset();
    setContactFields();
    $$(".field.has-error").forEach(function (f) { f.classList.remove("has-error"); });
    $("#form-error").hidden = true;
    $("#to-step-3").disabled = true;
    $("#to-step-4").disabled = true;
    var single = $("#booking-card") && $("#booking-card").classList.contains("is-single");
    goStep(single ? 2 : 1, true);
  }

  function initBooking() {
    var form = $("#booking-form");
    if (!form) return;

    $("#to-step-2").addEventListener("click", function () {
      if (!state.service) return;
      goStep(2);
    });
    $("#to-step-3").addEventListener("click", function () {
      if (!state.date) return;
      goStep(3);
    });
    $("#to-step-4").addEventListener("click", function () {
      if (!state.time) return;
      goStep(4);
    });
    $$("[data-back]").forEach(function (btn) {
      btn.addEventListener("click", function () { goStep(Number(btn.dataset.back)); });
    });

    $("#cal-prev").addEventListener("click", function () {
      state.month = new Date(state.month.getFullYear(), state.month.getMonth() - 1, 1);
      renderCalendar();
    });
    $("#cal-next").addEventListener("click", function () {
      state.month = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1);
      renderCalendar();
    });

    $$('.contact-options input[type="checkbox"]').forEach(function (cb) {
      cb.addEventListener("change", setContactFields);
    });

    form.addEventListener("submit", handleSubmit);
    $("#book-again").addEventListener("click", resetBooking);

    // телефон: мягкое форматирование
    var phone = $("#client-phone");
    if (phone) {
      phone.addEventListener("input", function () {
        var d = phone.value.replace(/\D/g, "").slice(0, 11);
        if (!d) { phone.value = ""; return; }
        if (d[0] === "8") d = "7" + d.slice(1);
        if (d[0] !== "7") d = "7" + d;
        var out = "+7";
        if (d.length > 1) out += " (" + d.slice(1, 4);
        if (d.length >= 5) out += ") " + d.slice(4, 7);
        if (d.length >= 8) out += "-" + d.slice(7, 9);
        if (d.length >= 10) out += "-" + d.slice(9, 11);
        phone.value = out;
      });
    }

    // синхронизация между вкладками (сайт + админка)
    window.addEventListener("storage", function (e) {
      if (!e.key || e.key.indexOf("ek_") !== 0) return;
      renderCalendar();
      renderSlots();
      updateMobileCta();
    });
  }

  function scheduleText(settings) {
    var groups = [];
    var order = [1, 2, 3, 4, 5, 6, 0];
    var names = { 0: "Вс", 1: "Пн", 2: "Вт", 3: "Ср", 4: "Чт", 5: "Пт", 6: "Сб" };

    order.forEach(function (day) {
      var wd = settings.workDays[day];
      if (!wd || !wd.enabled) return;
      var label = names[day] + " " + wd.start + "–" + wd.end;
      var last = groups[groups.length - 1];
      if (last && last.label === label) last.days.push(names[day]);
      else groups.push({ label: label, days: [names[day]] });
    });

    return groups.map(function (g) {
      var days = g.days.length > 1
        ? g.days[0] + "–" + g.days[g.days.length - 1]
        : g.days[0];
      return days + " " + g.label.slice(g.label.indexOf(" ") + 1);
    }).join(" · ");
  }

  function updateMobileCta() {
    var sub = $("#mobile-cta-sub");
    if (!sub) return;
    var settings = S.getSettings();
    var services = S.getServices().filter(function (s) { return s.active; });
    if (!services.length) { sub.textContent = "запись по телефону"; return; }
    var today = S.startOfDay(new Date());
    for (var i = 0; i <= Math.min(Number(settings.maxDaysAhead) || 60, 30); i++) {
      var iso = S.toISO(S.addDays(today, i));
      var any = services.some(function (s) { return S.slotsForDay(iso, s, settings).length > 0; });
      if (any) {
        sub.textContent = "ближайшее — " + S.formatDateShort(iso);
        return;
      }
    }
    sub.textContent = "по записи";
  }

  function initContacts() {
    var settings = S.getSettings();
    var line = $("#schedule-line");
    if (line) line.textContent = scheduleText(settings) || "по записи";

    /* контакты из настроек админки */
    if (settings.phone) {
      var tel = "tel:" + String(settings.phone).replace(/[^\d+]/g, "");
      $$('a[href^="tel:"]').forEach(function (a) { a.href = tel; });
      $$('.header-phone, .mobile-nav-contacts a[href^="tel:"], .contact-row[href^="tel:"] .contact-value')
        .forEach(function (a) { a.textContent = settings.phone; });
    }

    if (settings.telegram) {
      var tg = String(settings.telegram).replace(/^@/, "").replace(/^https?:\/\/t\.me\//i, "");
      if (tg) {
        $$('a[href*="t.me/"]').forEach(function (a) { a.href = "https://t.me/" + tg; });
        $$('.contact-row[href*="t.me/"] .contact-value').forEach(function (a) { a.textContent = "@" + tg; });
      }
    }
  }

  /* ── Старт ───────────────────────────────────────────── */
  function init() {
    renderServices();
    initBooking();
    initHeader();
    initReveal();
    initContacts();
    updateMobileCta();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
