/* ============================================================================
   Nico - Settings interactions
   Progressive enhancement for the settings panel: theme swatches, segmented
   controls, an animated tab indicator, and a live text-size readout.

   The original <select> elements are kept in the DOM (hidden) as the single
   source of truth. Every control here writes to them and dispatches "input",
   so script.js keeps one code path for applying and saving settings.

   Safe to load anywhere: if the panel is missing it does nothing.
   ========================================================================== */
(function () {
  "use strict";

  var THEME_LABELS = {
    midnight: "Default",
    cyberpunk: "Cyberpunk neon",
    sunset: "Sunset orange",
    aurora: "Aurora glass",
    ocean: "Deep ocean",
    forest: "Forest signal",
    graphite: "Graphite studio",
  };

  var booted = false;

  /* Fire the same event script.js listens for. */
  function commit(control) {
    if (!control) return;
    control.dispatchEvent(new Event("input", { bubbles: true }));
  }

  /* ------------------------------------------------------- theme swatches */

  function wireSwatches() {
    var wrap = document.getElementById("themeSwatches");
    var select = document.getElementById("themeSetting");
    if (!wrap || !select) return;

    function reflect(value) {
      Array.prototype.forEach.call(wrap.querySelectorAll(".theme-swatch"), function (btn) {
        var on = btn.dataset.theme === value;
        btn.classList.toggle("is-active", on);
        btn.setAttribute("aria-checked", on ? "true" : "false");
      });
      var label = document.getElementById("themeSettingLabel");
      if (label) label.textContent = THEME_LABELS[value] || value;
    }

    // Hover previews the palette without committing, so you can browse.
    var previewTimer = null;
    var committed = select.value;

    wrap.addEventListener("click", function (event) {
      var btn = event.target.closest(".theme-swatch");
      if (!btn) return;
      select.value = btn.dataset.theme;
      committed = select.value;
      reflect(select.value);
      commit(select);
      panelPulse();
    });

    wrap.addEventListener("pointerover", function (event) {
      var btn = event.target.closest(".theme-swatch");
      if (!btn || btn.dataset.theme === committed) return;
      if (previewTimer) clearTimeout(previewTimer);
      previewTimer = setTimeout(function () {
        document.body.dataset.themePreview = btn.dataset.theme;
        document.body.classList.add("is-previewing");
      }, 90);
    });

    wrap.addEventListener("pointerleave", function () {
      if (previewTimer) clearTimeout(previewTimer);
      document.body.classList.remove("is-previewing");
      delete document.body.dataset.themePreview;
    });

    reflect(select.value);
  }

  function panelPulse() {
    var panel = document.getElementById("settingsPanel");
    if (!panel) return;
    panel.classList.remove("just-changed");
    // Force reflow so the animation restarts on rapid changes.
    void panel.offsetWidth;
    panel.classList.add("just-changed");
  }

  /* -------------------------------------------------- segmented controls */

  function wireSegment(id, selectId, dataKey) {
    var wrap = document.getElementById(id);
    var select = document.getElementById(selectId);
    if (!wrap || !select) return;

    function reflect(value) {
      Array.prototype.forEach.call(wrap.querySelectorAll(".seg-btn"), function (btn) {
        var on = btn.dataset[dataKey] === value;
        btn.classList.toggle("is-active", on);
        btn.setAttribute("aria-checked", on ? "true" : "false");
      });
    }

    wrap.addEventListener("click", function (event) {
      var btn = event.target.closest(".seg-btn");
      if (!btn) return;
      var value = btn.dataset[dataKey];
      if (select.value === value) {
        reflect(value);
        return;
      }
      select.value = value;
      reflect(value);
      commit(select);
    });

    reflect(select.value);
    return reflect;
  }

  /* ------------------------------------------------------- text size range */

  function wireRange() {
    var range = document.getElementById("fontSizeSetting");
    var output = document.getElementById("fontSizeValue");
    if (!range || !output) return;

    function reflect() {
      var pct = Math.round(Number(range.value) / 100 * 100);
      output.textContent = pct + "%";
      var min = Number(range.min || 90);
      var max = Number(range.max || 120);
      var ratio = (Number(range.value) - min) / (max - min);
      // Fill the track up to the thumb for a live-progress feel.
      range.style.setProperty("--fill", (ratio * 100).toFixed(1) + "%");
    }

    range.addEventListener("input", function () {
      reflect();
      commit(range);
    });
    range.addEventListener("change", panelPulse);
    reflect();
  }

  /* ------------------------------------------------------ animated tabs */

  function wireTabs() {
    var panel = document.getElementById("settingsPanel");
    if (!panel) return;
    var tabs = panel.querySelectorAll("[data-settings-tab]");
    var list = panel.querySelector(".settings-tabs");
    if (!tabs.length || !list) return;

    var indicator = document.createElement("span");
    indicator.className = "settings-tab-indicator";
    indicator.setAttribute("aria-hidden", "true");
    list.appendChild(indicator);

    function moveIndicator(activeTab) {
      if (!activeTab) return;
      // offsetLeft/Width are layout-relative, which is what we want here.
      indicator.style.transform = "translateX(" + activeTab.offsetLeft + "px)";
      indicator.style.width = activeTab.offsetWidth + "px";
    }

    function syncIndicator() {
      var active = list.querySelector(".settings-tab.is-active");
      moveIndicator(active);
    }

    Array.prototype.forEach.call(tabs, function (tab) {
      tab.addEventListener("click", function () {
        Array.prototype.forEach.call(tabs, function (other) {
          var on = other === tab;
          other.classList.toggle("is-active", on);
          other.setAttribute("aria-selected", on ? "true" : "false");
          var panelEl = document.getElementById(other.dataset.settingsTab);
          if (panelEl) panelEl.hidden = !on;
        });
        syncIndicator();
        // Stagger the rows in so panels feel alive rather than static.
        staggerActivePanel();
      });
    });

    // The tab strip scrolls horizontally on narrow screens; keep the
    // indicator glued to the active tab.
    list.addEventListener("scroll", syncIndicator, { passive: true });
    window.addEventListener("resize", syncIndicator);
    syncIndicator();

    // Panels animate in as they become visible.
    var observer = new MutationObserver(function () {
      staggerActivePanel();
    });
    Array.prototype.forEach.call(panel.querySelectorAll(".settings-tab-panel"), function (p) {
      observer.observe(p, { attributes: true, attributeFilter: ["hidden"] });
    });
  }

  function staggerActivePanel() {
    var panel = document.getElementById("settingsPanel");
    if (!panel) return;
    var active = panel.querySelector(".settings-tab-panel:not([hidden])");
    if (!active) return;
    var rows = active.children;
    Array.prototype.forEach.call(rows, function (row, index) {
      row.classList.remove("row-enter");
      row.style.setProperty("--enter-delay", (index * 38) + "ms");
      void row.offsetWidth;
      row.classList.add("row-enter");
    });
  }

  /* ------------------------------------------------------------------ boot */

  /* Re-sync every custom widget from the underlying <select> values, so the
     panel stays correct if settings are changed from anywhere else. */
  function syncAll() {
    var theme = document.getElementById("themeSetting");
    if (theme) {
      Array.prototype.forEach.call(
        document.querySelectorAll(".theme-swatch"),
        function (btn) {
          var on = btn.dataset.theme === theme.value;
          btn.classList.toggle("is-active", on);
          btn.setAttribute("aria-checked", on ? "true" : "false");
        },
      );
      var label = document.getElementById("themeSettingLabel");
      if (label) label.textContent = THEME_LABELS[theme.value] || theme.value;
    }
    reflectSeg("modeSeg", "mode");
    reflectSeg("fontSeg", "font");

    var range = document.getElementById("fontSizeSetting");
    if (range) {
      var out = document.getElementById("fontSizeValue");
      if (out) out.textContent = Math.round(Number(range.value)) + "%";
      var min = Number(range.min || 90);
      var max = Number(range.max || 120);
      var ratio = (Number(range.value) - min) / (max - min);
      range.style.setProperty("--fill", (ratio * 100).toFixed(1) + "%");
    }
  }

  function reflectSeg(wrapId, key) {
    var wrap = document.getElementById(wrapId);
    var selectId = wrapId === "modeSeg" ? "modeSetting" : "fontSetting";
    var select = document.getElementById(selectId);
    if (!wrap || !select) return;
    Array.prototype.forEach.call(wrap.querySelectorAll(".seg-btn"), function (btn) {
      var on = btn.dataset[key] === select.value;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-checked", on ? "true" : "false");
    });
  }

  function init() {
    if (booted) return;
    if (!document.getElementById("settingsPanel")) return;
    booted = true;

    wireSwatches();
    wireSegment("modeSeg", "modeSetting", "mode");
    wireSegment("fontSeg", "fontSetting", "font");
    wireRange();
    wireTabs();
    syncAll();

    // The panel's own control handlers run on the same "input" event, so a
    // short-lived class toggle on the panel body is enough to re-sync.
    var panel = document.getElementById("settingsPanel");
    if (panel && typeof MutationObserver !== "undefined") {
      var observer = new MutationObserver(function (records) {
        records.forEach(function (record) {
          if (record.target && record.target.tagName === "SELECT") syncAll();
        });
      });
      observer.observe(panel, {
        subtree: true,
        characterData: true,
        childList: true,
      });
      panel.addEventListener("input", function (event) {
        if (event.target && event.target.tagName === "SELECT") syncAll();
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.NicoSettings = { init: init, pulse: panelPulse };
})();