/* Nico icon set - stroke icons to replace the emoji used on buttons.
   Each icon is a 16x16 grid, stroke=currentColor, fill=none, 1.6 line.
   Inlined (not a sprite) so they inherit colour and need no extra request. */
(function () {
  "use strict";

  var PATHS = {
    settings:
      '<circle cx="8" cy="8" r="2.1"/><path d="M8 1.6v1.5M8 12.9v1.5M14.4 8h-1.5M3.1 8H1.6M12.5 3.5l-1.1 1.1M4.6 11.4l-1.1 1.1M12.5 12.5l-1.1-1.1M4.6 4.6L3.5 3.5"/>',
    menu: '<path d="M2 4h12M2 8h12M2 12h12"/>',
    bell: '<path d="M4 6.5a4 4 0 0 1 8 0c0 3 1 4 1 4H3s1-1 1-4z"/><path d="M6.5 13a1.6 1.6 0 0 0 3 0"/>',
    download: '<path d="M8 2v8M5 7l3 3 3-3"/><path d="M2.5 12.5h11"/>',
    document:
      '<path d="M4 1.8h5l3 3v9.4H4z"/><path d="M9 1.8V5h3"/><path d="M6 8h4M6 10.5h4"/>',
    braces: '<path d="M6.5 2.5c-1.4 0-1.5.8-1.5 1.8v1.4c0 .9-.5 1.3-1.2 1.3.7 0 1.2.4 1.2 1.3v1.4c0 1 .1 1.8 1.5 1.8"/><path d="M9.5 2.5c1.4 0 1.5.8 1.5 1.8v1.4c0 .9.5 1.3 1.2 1.3-.7 0-1.2.4-1.2 1.3v1.4c0 1-.1 1.8-1.5 1.8"/>',
    printer:
      '<path d="M4.5 6V2.5h7V6"/><path d="M4.5 11.5h-2V7.5h11v4h-2"/><path d="M4.5 9.5h7v4h-7z"/>',
    eye: '<path d="M1.5 8s2.4-4 6.5-4 6.5 4 6.5 4-2.4 4-6.5 4-6.5-4-6.5-4z"/><circle cx="8" cy="8" r="1.8"/>',
    image:
      '<rect x="2" y="3" width="12" height="10" rx="1.6"/><circle cx="5.8" cy="6.4" r="1"/><path d="M2.4 11.2l3-2.8 2.4 2.2 2.3-2 3.4 2.9"/>',
    sparkle: '<path d="M8 1.8l1.5 4.2 4.2 1.5-4.2 1.5L8 13.2 6.5 9 2.3 7.5 6.5 6z"/>',
    plus: '<path d="M8 3.5v9M3.5 8h9"/>',
    mic: '<rect x="6" y="1.8" width="4" height="7" rx="2"/><path d="M3.8 7.2a4.2 4.2 0 0 0 8.4 0"/><path d="M8 11.4V14"/>',
    panel:
      '<rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.6"/><path d="M9.6 2.8v10.4"/>',
  };

  /**
   * Replace emoji glyphs inside an element with a matching inline SVG.
   * Only touches text nodes, so it never disturbs existing <svg> or ids.
   */
  function iconify(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    nodes.forEach(function (node) {
      var text = node.nodeValue;
      if (!text || !text.trim()) return;
      if (!/[^\x20-\x7E]/.test(text)) return; // ascii only, nothing to do

      var frag = document.createDocumentFragment();
      var changed = false;
      // Match each non-ascii run, then map it to an icon by name.
      text.split(/([^\x20-\x7E]+)/).forEach(function (part) {
        if (!part) return;
        var name = glyphMap(part);
        if (name && PATHS[name]) {
          var span = document.createElement("span");
          span.className = "ico";
          span.setAttribute("aria-hidden", "true");
          span.innerHTML =
            '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" ' +
            'stroke-linecap="round" stroke-linejoin="round">' + PATHS[name] + "</svg>";
          frag.appendChild(span);
          changed = true;
        } else {
          frag.appendChild(document.createTextNode(part));
        }
      });
      if (changed) node.parentNode.replaceChild(frag, node);
    });
  }

  // Glyph -> icon name. Kept narrow on purpose: only map glyphs we intend to
  // replace, so real emoji inside user content are left alone.
  function glyphMap(part) {
    var t = part.trim();
    var map = {
      "\u2699": "settings", // gear
      "\u2630": "menu", // hamburger
      "\uD83D\uDCC4": "document", // memo
      "\uD83D\uDCC3": "document", // page
      "\uD83D\uDCCD": "document", // spiral notebook
      "\uD83D\uDCDD": "printer", // printer
      "\uD83D\uDC41": "image", // eye
      "\uD83D\uDDBC": "image", // framed picture
      "\uD83D\uDDE1": "panel", // memo pad
      "\uD83D\uDCCC": "document", // spiral notebook
      "\uD83D\uDCCB": "document", // clipboard
      "\u2726": "sparkle", // black four-pointed star
      "\u2727": "sparkle", // white four-pointed star
      "\u270E": "download", // pencil
      "\u2731": "plus", // open centre star
      "\uD83D\uDD25": "sparkle", // fire
      "\uD83D\uDD14": "bell", // bell
      "\u2B07": "download", // down arrow to bar
      "\uD83D\uDDA8": "printer", // printer with tray
      "\uD83D\uDCF1": "image", // camera
      "\uD83D\uDCC1": "document", // page with curl
      "\u270F": "plus", // pencil
      "\u2712": "plus", // check
    };
    // A run may carry a variation selector (U+FE0F) or zero-width joiner, and
    // the console/markup may show a glyph as either surrogate half. Normalise
    // all of that away before looking the glyph up.
    var normalised = t
      .replace(/[\uFE0F\u200D\u20E3]/g, "")
      .replace(/[\uD83C-\uDBFF][\uDC00-\uDFFF]/g, function (pair) {
        return String.fromCodePoint(pair.codePointAt(0));
      });
    return map[normalised] || map[t] || null;
  }

  function boot() {
    // Only chrome we own: buttons, links, menu icons. Never chat content.
    var chrome = document.querySelectorAll(
      "button, .dropdown-icon, .drop-overlay-icon, .composer-menu-heading"
    );
    Array.prototype.forEach.call(chrome, function (el) {
      if (el.dataset.icoDone === "1") return;
      el.dataset.icoDone = "1";
      iconify(el);
    });

    // data-icon slots declared in markup (quick-access rail, sidebar).
    Array.prototype.forEach.call(document.querySelectorAll("[data-icon]"), function (el) {
      var name = el.getAttribute("data-icon");
      if (!PATHS[name] || el.querySelector("svg")) return;
      el.innerHTML =
        '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        PATHS[name] + "</svg>";
    });

    wireQuickAccess();
    window.NicoIcons = { PATHS: PATHS, iconify: iconify };
  }

  /* Quick-access rail: route each link to the feature it names. Anything that
     has no real destination yet stays inert and says so, rather than opening
     an empty screen. */
  function wireQuickAccess() {
    var reminderCount = document.getElementById("quickReminderCount");

    function renderBadge() {
      if (!reminderCount) return;
      try {
        // Prefer the app's own reader so the count matches what is shown.
        var pending = 0;
        if (typeof readReminders === "function") {
          pending = readReminders().filter(function (r) { return r && !r.done; }).length;
        } else {
          var raw = localStorage.getItem("nico_reminders");
          var list = raw ? JSON.parse(raw) : [];
          pending = Array.isArray(list)
            ? list.filter(function (r) { return r && !r.done; }).length
            : 0;
        }
        reminderCount.textContent = String(pending);
        reminderCount.hidden = pending === 0;
      } catch (error) {
        reminderCount.hidden = true;
      }
    }

    Array.prototype.forEach.call(document.querySelectorAll(".quick-link"), function (link) {
      link.addEventListener("click", function (event) {
        event.preventDefault();
        var kind = link.getAttribute("data-quick");
        if (kind === "reminders") {
          var btn = document.getElementById("reminderBtn");
          if (btn) btn.click();
          return;
        }
        if (kind === "artifacts") {
          if (window.NicoArtifacts && window.NicoArtifacts.list().length) {
            window.NicoArtifacts.open(window.NicoArtifacts.list().slice(-1)[0]);
          } else {
            notify("No artifacts yet. Ask for a self-contained document, page or component.");
          }
          return;
        }
        notify(
          kind === "gallery"
            ? "Gallery is coming next."
            : "Projects are coming next."
        );
      });
    });

    renderBadge();
    document.addEventListener("visibilitychange", renderBadge);
    window.NicoIcons.renderBadge = renderBadge;
  }

  function notify(message) {
    if (typeof showComposerToast === "function") {
      showComposerToast(message);
      return;
    }
    console.info("[Nico]", message);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();