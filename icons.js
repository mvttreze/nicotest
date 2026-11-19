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
    'eye-closed':
      '<path d="M1.5 6c0-1.103 1.397-2 3-2s3 .897 3 2-1.397 2-3 2-3-.897-3-2z"/><path d="M1 12a6 6 0 1 1 12 0A6 6 0 0 1 1 12z"/><circle cx="8" cy="6" r="1"/>',
    google:
      '<path d="M8 3A5 5 0 0 0 3 8A5 5 0 0 0 8 13M11 8H5"/>',
    apple:
      '<path d="M8 2C7 2 6 4 6 6C6 8 8 10 10 10C12 10 12 6 11 4C12 2 9 2 8 2Z"/>',
    user:
      '<circle cx="8" cy="5.4" r="2.6"/><path d="M2.8 13.8c.7-2.9 2.7-4.3 5.2-4.3s4.5 1.4 5.2 4.3"/>',
    logout:
      '<path d="M7 2.5H3.5v11H7"/><path d="M10.5 5.5L13 8l-2.5 2.5"/><path d="M13 8H6.5"/>',
    copy:
      '<rect x="5.8" y="5.8" width="7.4" height="7.4" rx="1.3"/><path d="M10.2 3.2H4.5A1.3 1.3 0 0 0 3.2 4.5v5.7"/>',
    x: '<path d="M4 4l8 8M12 4l-8 8"/>',
    trash:
      '<path d="M2.5 4.5h11"/><path d="M5.5 4.5V3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5"/><path d="M4 4.5l.7 8.6a1.2 1.2 0 0 0 1.2 1.1h4.2a1.2 1.2 0 0 0 1.2-1.1l.7-8.6"/><path d="M6.6 7.2v4.4M9.4 7.2v4.4"/>',
    'chevron-left': '<path d="M10 3.5L5.5 8l4.5 4.5"/>',
    'chevron-right': '<path d="M6 3.5L10.5 8L6 12.5"/>',
    'arrow-up': '<path d="M8 13V3"/><path d="M3.5 7.5L8 3l4.5 4.5"/>',
    square: '<rect x="4" y="4" width="8" height="8" rx="1.2"/>',
    eraser:
      '<path d="M5.2 13.6L2.4 10.8a1.3 1.3 0 0 1 0-1.8l6-6a1.3 1.3 0 0 1 1.8 0l2.8 2.8a1.3 1.3 0 0 1 0 1.8l-6 6z"/><path d="M8.5 4.8l3.3 3.3"/><path d="M4.5 13.6H13"/>',
    type:
      '<path d="M3 4.5V3h10v1.5"/><path d="M8 3v10"/><path d="M5.8 13h4.4"/>',
    palette:
      '<path d="M8 14A6 6 0 1 1 14 8c0 1.8-1.4 2.4-2.6 2.4h-1.2c-.9 0-1.6.7-1.6 1.6 0 .4.2.8.4 1.1.3.4.5.7.5 1.1 0 .5-.5.8-1.5.8z"/><circle cx="5.4" cy="7.2" r=".8" fill="currentColor" stroke="none"/><circle cx="7.8" cy="4.9" r=".8" fill="currentColor" stroke="none"/><circle cx="10.6" cy="6" r=".8" fill="currentColor" stroke="none"/>',
    bookmark: '<path d="M4.5 2.5h7v11L8 10.8l-3.5 2.7z"/>',
    minus: '<path d="M3.5 8h9"/>',
    search: '<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/>',
    link: '<path d="M6.2 9.8 9.8 6.2"/><path d="M5.2 11.8H4a2.5 2.5 0 0 1 0-5h2M10 4h2a2.5 2.5 0 0 1 0 5h-1.2"/>',
    lock: '<rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>',
    unlock: '<rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 4.7-1.2"/>',
    'cloud-upload': '<path d="M4 11.5a3 3 0 0 1 .2-6A4.5 4.5 0 0 1 12.8 7 2.5 2.5 0 0 1 12 12h-1"/><path d="M8 14V8m-2.5 2.5L8 8l2.5 2.5"/>',
    star: '<path d="m8 1.8 1.8 4.4 4.7.3-3.6 3 1.2 4.6L8 11.6l-4.1 2.5 1.2-4.6-3.6-3 4.7-.3z"/>',
    heart: '<path d="M8 13.7 2.5 8.4C-.5 5.1 4.4 1.4 8 5 11.6 1.4 16.5 5.1 13.5 8.4z"/>',
    zap: '<path d="M9 1.8 3.5 8.5h4l-.5 5.7 5.5-7h-4z"/>',
    shield: '<path d="M8 1.8 13 4v3.5c0 3-1.8 5.2-5 6.7-3.2-1.5-5-3.7-5-6.7V4z"/><path d="m5.8 7.8 1.5 1.5 3-3"/>',
    cloud: '<path d="M4 12.5a3 3 0 0 1 .2-6A4.5 4.5 0 0 1 12.8 8 2.3 2.3 0 0 1 12 12.5z"/>',
    'download-cloud': '<path d="M4 11.5a3 3 0 0 1 .2-6A4.5 4.5 0 0 1 12.8 7 2.5 2.5 0 0 1 12 12h-1"/><path d="M8 8v5m-2-2 2 2 2-2"/>',
    history: '<path d="M2.5 7.5A5.5 5.5 0 1 1 3 11"/><path d="M2.5 3.5v4h4M8 4.5V8l2.5 1.5"/>',
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
      "\uD83D\uDCDD": "document", // memo
      "\uD83D\uDC41": "eye", // eye
      "\uD83D\uDDBC": "image", // framed picture
      "\uD83D\uDDE1": "panel", // memo pad
      "\uD83D\uDCCC": "document", // spiral notebook
      "\uD83D\uDCCB": "document", // clipboard
      "\u2726": "sparkle", // black four-pointed star
      "\u2727": "sparkle", // white four-pointed star
      "\u2731": "plus", // open centre star
      "\uD83D\uDD25": "sparkle", // fire
      "\uD83D\uDD14": "bell", // bell
      "\u2B07": "download", // down arrow to bar
      "\uD83D\uDDA8": "printer", // printer with tray
      "\uD83D\uDCF1": "image", // camera
      "\uD83D\uDCC1": "document", // page with curl
      "\u270F": "plus", // pencil
      "\u2712": "plus", // check
      "\u00D7": "x", // multiplication sign used as a close affordance
      "\u22EE": "document", // vertical menu
      "\u2197": "link", // external link
      "\u2691": "bookmark", // flag pin
      "\u270E": "type", // edit pencil
      "\u2193": "download", // down arrow
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

  function buttonIconName(button) {
    var label = [button.getAttribute("aria-label"), button.title, button.textContent]
      .filter(Boolean).join(" ").toLowerCase();
    if (/close|dismiss|remove/.test(label)) return "x";
    if (/delete|trash|forget|clear|revoke/.test(label)) return "trash";
    if (/copy|clipboard/.test(label)) return "copy";
    if (/download|export|save file/.test(label)) return "download";
    if (/upload|attach|add file|add photo/.test(label)) return "cloud-upload";
    if (/snapshot|capture version/.test(label)) return "cloud-upload";
    if (/preview|diff/.test(label)) return "eye";
    if (/restore|history|patch/.test(label)) return "history";
    if (/search|find/.test(label)) return "search";
    if (/settings|preferences/.test(label)) return "settings";
    if (/reminder|notification|bell/.test(label)) return "bell";
    if (/gallery|image|photo|picture/.test(label)) return "image";
    if (/link|share|open in new tab/.test(label)) return "link";
    if (/lock|privacy/.test(label)) return "lock";
    if (/unlock/.test(label)) return "unlock";
    if (/stop|cancel generation/.test(label)) return "square";
    if (/send|sign in|sign-in/.test(label)) return "arrow-up";
    if (/new chat|add|create|grant|publish/.test(label)) return "plus";
    if (/pin|bookmark/.test(label)) return "bookmark";
    if (/favorite|favourite|like/.test(label)) return "heart";
    if (/star/.test(label)) return "star";
    if (/theme|appearance|color/.test(label)) return "palette";
    if (/font|text|rename|edit/.test(label)) return "type";
    if (/vision|screen|capture/.test(label)) return "eye";
    if (/project|artifact|document|module/.test(label)) return "document";
    if (/refresh|retry|reload/.test(label)) return "download";
    return "sparkle";
  }

  function ensureButtonIcon(button) {
    if (!button || button.tagName !== "BUTTON" || button.querySelector("svg")) return;
    var name = buttonIconName(button);
    if (!PATHS[name]) return;
    var span = document.createElement("span");
    span.className = "nico-inline-icon";
    span.setAttribute("aria-hidden", "true");
    span.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + PATHS[name] + "</svg>";
    button.insertBefore(span, button.firstChild);
  }

  function enhanceButtons(root) {
    if (root.nodeType === 1 && root.matches("button")) {
      iconify(root);
      ensureButtonIcon(root);
    }
    if (!root.querySelectorAll) return;
    root.querySelectorAll("button").forEach(function (button) {
      iconify(button);
      ensureButtonIcon(button);
    });
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
      ensureButtonIcon(el);
    });

    // Static controls already carry inline SVG in index.html. This observer
    // covers buttons created later for chat actions, rows, and panel content.
    if (document.body && typeof MutationObserver !== "undefined") {
      new MutationObserver(function (records) {
        records.forEach(function (record) {
          record.addedNodes.forEach(function (node) {
            if (node.nodeType === 1) enhanceButtons(node);
          });
        });
      }).observe(document.body, { childList: true, subtree: true });
    }

    wireQuickAccess();
    // The other two panels own their own badges; refresh whichever loaded.
    if (window.NicoArtifacts) window.NicoArtifacts.refreshBadge();
    if (window.NicoGallery) window.NicoGallery.refreshBadge();
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

    Array.prototype.forEach.call(
      document.querySelectorAll("a.quick-link, button.quick-link"),
      function (link) {
      link.addEventListener("click", function (event) {
        event.preventDefault();
        var kind = link.getAttribute("data-quick");
        if (kind === "reminders") {
          var btn = document.getElementById("reminderBtn");
          if (btn) btn.click();
          return;
        }
        if (kind === "artifacts") {
          // Always show the library, so you pick from everything you have made
          // rather than being dropped into whichever one came last.
          if (window.NicoArtifacts && typeof window.NicoArtifacts.browse === "function") {
            window.NicoArtifacts.browse();
          } else {
            notify("Artifacts are still loading.");
          }
          return;
        }
        if (kind === "gallery") {
          if (window.NicoGallery && typeof window.NicoGallery.open === "function") {
            window.NicoGallery.open();
          } else {
            notify("Gallery is still loading.");
          }
          return;
        }
        notify("Projects are coming next.");
      });
      }
    );

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
