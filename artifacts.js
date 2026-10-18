/* ============================================================================
   Nico - Artifacts
   A substantial self-contained document inside a reply moves out of the
   transcript into a side panel where it renders live, versions and exports.

   Detection is frontend-only via MutationObserver, so no backend change is
   required. Loads after script.js and reuses its helpers: storageSet,
   renderMarkdown, escapeHtml, downloadBlob, attachCodeCopyButtons.
   ========================================================================== */
(function () {
  "use strict";

  var STORE_KEY = "nico_artifacts_v1";
  var MAX_VERSIONS = 12;
  var MIN_LINES = 40;
  var MIN_CHARS = 1200;
  var LOAD_TIMEOUT_MS = 8000;

  var EXT = {
    html: "html",
    xml: "html",
    svg: "svg",
    markdown: "md",
    md: "md",
  };

  var panel, body, titleEl, versionsEl, metaEl, errorEl, resizer, toggleBtn;
  var store = {};
  var openKey = null;
  var lastConversation = null;
  var booted = false;

  /* ------------------------------------------------------ conversation scope */

  // Artifacts belong to the conversation that produced them. currentConversationId
  // is a top-level binding in script.js, shared across classic scripts.
  function currentConversation() {
    try {
      if (typeof currentConversationId !== "undefined" && currentConversationId) {
        return String(currentConversationId);
      }
    } catch (error) {
      /* not loaded yet */
    }
    return "default";
  }

  function scopedKey(type, title) {
    return currentConversation() + "::" + type + "::" + title.toLowerCase().trim();
  }

  function keysInCurrentConversation() {
    var prefix = currentConversation() + "::";
    return Object.keys(store).filter(function (key) {
      return key.indexOf(prefix) === 0;
    });
  }

  function conversationTitleOf(conversationId) {
    if (typeof getConversationTitle === "function") {
      var title = getConversationTitle(conversationId);
      if (title) return title;
    }
    return "Untitled chat";
  }

  /* Every artifact across every conversation, newest first. */
  function allArtifacts() {
    return Object.keys(store)
      .map(function (key) {
        var entry = store[key];
        return {
          key: key,
          type: entry.type,
          title: entry.title,
          conversationId: entry.conversationId || "",
          conversationTitle: entry.conversationTitle || "Untitled chat",
          versionCount: entry.versions.length,
          updated: entry.updated || 0,
        };
      })
      .sort(function (a, b) {
        return b.updated - a.updated;
      });
  }

  function entryByKey(key) {
    return store[key] || null;
  }

  /* ---------------------------------------------------------------- store */

  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      var parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  function save() {
    // storageSet is quota-guarded; if it fails, drop the oldest versions once.
    if (typeof storageSet === "function") {
      if (storageSet(STORE_KEY, JSON.stringify(store))) return;
    }
    try {
      Object.keys(store).forEach(function (key) {
        var entry = store[key];
        if (entry && entry.versions && entry.versions.length > 3) {
          entry.versions = entry.versions.slice(-3);
        }
      });
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch (error) {
      /* give up quietly: artifacts are a convenience, not data */
    }
  }

  /* ------------------------------------------------------------- detection */

  function languageOf(codeEl, preEl) {
    var cls = codeEl.className || "";
    var match = cls.match(/language-([\w+-]+)/i);
    if (match) return match[1].toLowerCase();
    var label = (preEl && preEl.dataset && preEl.dataset.lang) || "";
    return label.toLowerCase();
  }

  function titleFor(type, code) {
    var text = code || "";
    if (type === "html") {
      var t = text.match(/<title[^>]*>([^<]{1,80})<\/title>/i);
      if (t) return t[1].trim();
      var h = text.match(/<h1[^>]*>([^<]{1,80})<\/h1>/i);
      if (h) return h[1].trim();
    }
    if (type === "svg") {
      var tx = text.match(/<text[^>]*>([^<]{1,80})<\/text>/i);
      if (tx) return tx[1].trim();
    }
    if (type === "markdown") {
      var h1 = text.match(/^#\s+(.+)$/m);
      if (h1) return h1[1].trim();
    }
    var file = text.match(/^\s*(?:\/\/|#|\/\*)\s*(?:file:\s*)?([\w.-]+\.\w{1,6})/im);
    if (file) return file[1];
    var first = text.split("\n").find(function (line) { return line.trim(); });
    return (first || "Untitled").trim().slice(0, 48) || "Untitled";
  }

  function classify(rawLang, code) {
    var lang = (rawLang || "").replace(/^artifact-/, "");
    if (lang === "html" || lang === "xml") return "html";
    if (lang === "svg") return "svg";
    if (lang === "markdown" || lang === "md") return "markdown";
    if (/^(js|javascript|ts|typescript|py|python|css|scss|json|sh|bash|sql|java|c|cpp|cs|go|rs|php|rb|swift|kt|yaml|yml|toml|html|xml|md|markdown)$/.test(lang)) {
      return "code";
    }
    return null;
  }

  function isSubstantial(code) {
    if (!code) return false;
    var lines = code.split("\n").length;
    return lines >= MIN_LINES || code.length >= MIN_CHARS;
  }

  function codeBlocksIn(messageEl) {
    var content = messageEl.querySelector(".content");
    if (!content) return [];
    var blocks = content.querySelectorAll("pre > code");
    var out = [];
    Array.prototype.forEach.call(blocks, function (codeEl) {
      out.push({ codeEl: codeEl, preEl: codeEl.parentNode });
    });
    return out;
  }

  function scanMessage(messageEl) {
    if (!messageEl) return;
    var content = messageEl.querySelector(".content");
    if (!content || !content.textContent || !content.textContent.trim()) return;
    // The message node is inserted BEFORE its content streams in, so a scan on
    // insertion sees an empty div. Only latch once real content has been parsed
    // into at least one code block, otherwise the artifact is never detected.
    var hasCode = content.querySelector("pre > code");
    if (!hasCode) return;
    if (messageEl.dataset.artifactScanned === "1") return;

    var blocks = codeBlocksIn(messageEl);
    if (!blocks.length) return;

    var autoOpenKey = null;

    blocks.forEach(function (block) {
      var codeEl = block.codeEl;
      var preEl = block.preEl;
      var rawLang = languageOf(codeEl, preEl);
      var type = classify(rawLang, codeEl.textContent);
      if (!type) return;
      var code = codeEl.textContent || "";
      if (!isSubstantial(code)) return;

      var title = titleFor(type, code);
      var key = scopedKey(type, title);

      addVersion(key, { type: type, title: title, code: code });

      var host = preEl.closest(".code-container") || preEl;
      if (!host.parentNode) return;
      // Re-rendering replaces the block, so clear any stale marker first.
      var staleOffer = host.parentNode.querySelector(".artifact-offer");
      if (staleOffer) staleOffer.remove();

      var offer = document.createElement("div");
      offer.className = "artifact-offer";
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "artifact-offer-btn";
      btn.textContent = "Open in artifact";
      btn.addEventListener("click", function () { openArtifact(key); });
      offer.appendChild(btn);

      if (type === "html" || type === "svg") {
        var card = document.createElement("div");
        card.className = "artifact-teaser";
        var frame = document.createElement("iframe");
        frame.setAttribute("sandbox", "allow-scripts allow-forms allow-popups");
        frame.setAttribute("scrolling", "no");
        frame.setAttribute("tabindex", "-1");
        frame.setAttribute("aria-hidden", "true");
        frame.srcdoc = "<style>html,body{margin:0;height:100%;}body{transform:scale(.6);transform-origin:top left;width:166%;height:166%;}</style>" + code;
        card.appendChild(frame);
        offer.appendChild(card);
      }
      host.parentNode.insertBefore(offer, host.nextSibling);

      if (/^artifact-/.test(rawLang)) autoOpenKey = key;
    });

    messageEl.dataset.artifactScanned = "1";
    if (autoOpenKey) openArtifact(autoOpenKey);
  }

  /** Language of the single fenced block in a raw reply. Used by tests and by
   *  the typewriter fast path so detection can run before markdown rendering. */
  function classifyReply(rawText) {
    if (!rawText) return null;
    var fences = rawText.match(/```([a-zA-Z0-9+-]*)\n([\s\S]*?)```/g);
    if (!fences) return null;
    for (var i = 0; i < fences.length; i++) {
      var m = fences[i].match(/```([a-zA-Z0-9+-]*)\n([\s\S]*?)```/);
      if (!m) continue;
      var type = classify(m[1], m[2]);
      if (type && isSubstantial(m[2])) return type;
    }
    return null;
  }

  /* -------------------------------------------------------------- versions */

  function addVersion(key, meta) {
    var entry = store[key];
    if (!entry) {
      entry = store[key] = {
        type: meta.type,
        title: meta.title,
        conversationId: currentConversation(),
        conversationTitle: conversationTitleOf(currentConversation()),
        versions: [],
        active: 0,
        updated: Date.now(),
      };
    }
    var last = entry.versions[entry.versions.length - 1];
    if (last && last.code === meta.code) return;
    entry.versions.push({ code: meta.code, at: Date.now() });
    if (entry.versions.length > MAX_VERSIONS) entry.versions.shift();
    entry.active = entry.versions.length - 1;
    entry.updated = Date.now();
    save();
    refreshBadge();
  }

  /* -------------------------------------------------------------- rendering */

  function currentVersion() {
    if (!openKey || !store[openKey]) return null;
    var entry = store[openKey];
    entry.active = Math.max(0, Math.min(entry.active, entry.versions.length - 1));
    return entry.versions[entry.active];
  }

  function openArtifact(key) {
    if (!store[key]) return;
    openKey = key;
    save();
    showPanel();
    closeBrowser();
    renderPanel();
  }

  function showPanel() {
    if (!panel) return;
    panel.hidden = false;
    panel.setAttribute("aria-hidden", "false");
    panel.classList.add("is-open");
    document.documentElement.classList.add("artifacts-open");
    if (toggleBtn) toggleBtn.hidden = true;
  }

  function hidePanel() {
    if (!panel) return;
    panel.classList.remove("is-open");
    panel.setAttribute("aria-hidden", "true");
    document.documentElement.classList.remove("artifacts-open");
    if (toggleBtn) toggleBtn.hidden = false;
  }

  function renderPanel() {
    var entry = openKey && store[openKey];
    var version = currentVersion();
    if (!entry || !version) return;

    titleEl.value = entry.title;
    body.innerHTML = "";
    errorEl.hidden = true;

    if (entry.type === "html" || entry.type === "svg") {
      var frame = document.createElement("iframe");
      frame.className = "artifact-frame";
      frame.title = entry.title;
      // No allow-same-origin: the frame stays isolated from this origin.
      frame.setAttribute("sandbox", "allow-scripts allow-forms allow-popups");
      frame.setAttribute("referrerpolicy", "no-referrer");
      var loaded = false;
      var timer = window.setTimeout(function () {
        if (!loaded) errorEl.hidden = false;
      }, LOAD_TIMEOUT_MS);
      frame.addEventListener("load", function () {
        loaded = true;
        window.clearTimeout(timer);
      });
      frame.srcdoc = version.code;
      body.appendChild(frame);
    } else if (entry.type === "markdown") {
      var doc = document.createElement("div");
      doc.className = "artifact-doc";
      doc.innerHTML = typeof renderMarkdown === "function" ? renderMarkdown(version.code) : "";
      body.appendChild(doc);
    } else {
      var pre = document.createElement("pre");
      pre.innerHTML = "<code>" + (typeof escapeHtml === "function" ? escapeHtml(version.code) : version.code) + "</code>";
      body.appendChild(pre);
      if (typeof attachCodeCopyButtons === "function") attachCodeCopyButtons(body);
    }

    renderVersions();
    var when = new Date(version.at);
    metaEl.textContent = entry.type.toUpperCase() + " · v" + (entry.active + 1) + " of " + entry.versions.length + " · " + when.toLocaleString();
  }

  function renderVersions() {
    versionsEl.innerHTML = "";
    var entry = store[openKey];
    if (!entry || entry.versions.length < 2) return;
    entry.versions.forEach(function (version, index) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "artifact-version" + (index === entry.active ? " is-active" : "");
      btn.textContent = "v" + (index + 1);
      btn.addEventListener("click", function () {
        entry.active = index;
        save();
        renderPanel();
      });
      versionsEl.appendChild(btn);
    });
  }

  /* -------------------------------------------------------------- library */

  function renderBrowser() {
    var list = allArtifacts();
    var countEl = document.getElementById("artifactBrowserCount");
    var listEl = document.getElementById("artifactBrowserList");
    if (!listEl) return;
    listEl.innerHTML = "";
    if (countEl) {
      countEl.textContent = list.length
        ? list.length + (list.length === 1 ? " artifact" : " artifacts")
        : "";
    }

    if (!list.length) {
      var empty = document.createElement("p");
      empty.className = "artifact-browser-empty";
      empty.textContent =
        "No artifacts yet. Ask Nico for a self-contained document, page or component.";
      listEl.appendChild(empty);
      return;
    }

    var currentConv = currentConversation();
    list.forEach(function (item) {
      var row = document.createElement("button");
      row.type = "button";
      row.className = "artifact-row";
      if (item.key === openKey) row.classList.add("is-current");
      if (item.conversationId === currentConv) row.classList.add("is-this-chat");

      var head = document.createElement("span");
      head.className = "artifact-row-head";
      var name = document.createElement("span");
      name.className = "artifact-row-title";
      name.textContent = item.title;
      head.appendChild(name);

      var badge = document.createElement("span");
      badge.className = "artifact-row-type";
      badge.textContent = item.type.toUpperCase();
      head.appendChild(badge);

      var meta = document.createElement("span");
      meta.className = "artifact-row-meta";
      var chatName =
        item.conversationId === currentConv
          ? "This chat"
          : item.conversationTitle;
      meta.textContent =
        chatName + " · " + item.versionCount + (item.versionCount === 1 ? " version" : " versions");
      if (item.key === openKey) meta.textContent += " · open";

      row.appendChild(head);
      row.appendChild(meta);

      row.addEventListener("click", function () {
        openArtifact(item.key);
      });
      listEl.appendChild(row);
    });
  }

  function openBrowser() {
    if (!panel) return;
    var browser = document.getElementById("artifactBrowser");
    if (!browser) return;
    renderBrowser();
    browser.hidden = false;
    showPanel();
  }

  function closeBrowser() {
    var browser = document.getElementById("artifactBrowser");
    if (browser) browser.hidden = true;
  }

  function refreshBadge() {
    var badge = document.getElementById("quickArtifactCount");
    if (!badge) return;
    var total = Object.keys(store).length;
    badge.textContent = String(total);
    badge.hidden = total === 0;
  }

  /* ---------------------------------------------------------------- exports */

  function selfContainedHtml(code) {
    var styles =
      "body{margin:0;padding:24px;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#fff;color:#1f1e1d;}" +
      "@media (prefers-color-scheme: dark){body{background:#1f1e1d;color:#f5f4f2;}}";
    if (/<head[^>]*>/i.test(code)) {
      return code.replace(/<\/head>/i, "<style>" + styles + "</style></head>");
    }
    return "<!doctype html><html><head><meta charset=\"utf-8\"><title>Artifact</title><style>" + styles + "</style></head><body>" + code + "</body></html>";
  }

  function downloadArtifact() {
    var entry = openKey && store[openKey];
    var version = currentVersion();
    if (!entry || !version) return;

    var filename = (entry.title || "artifact").replace(/[^\w.-]+/g, "-").slice(0, 60) || "artifact";
    if (entry.type === "html") {
      if (typeof downloadBlob === "function") {
        downloadBlob(new Blob([selfContainedHtml(version.code)], { type: "text/html" }), filename + ".html");
      }
    } else if (entry.type === "svg") {
      if (typeof downloadBlob === "function") {
        downloadBlob(new Blob([version.code], { type: "image/svg+xml" }), filename + ".svg");
      }
    } else if (entry.type === "markdown") {
      if (typeof downloadBlob === "function") {
        downloadBlob(new Blob([version.code], { type: "text/markdown" }), filename + ".md");
      }
    } else {
      var match = version.code.match(/\.\w{1,6}/);
      var ext = match ? match[0].slice(1) : "txt";
      if (typeof downloadBlob === "function") {
        downloadBlob(new Blob([version.code], { type: "text/plain" }), filename + "." + ext);
      }
    }
  }

  function copyArtifact() {
    var version = currentVersion();
    if (!version) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(version.code);
    }
  }

  function openInNewTab() {
    var entry = openKey && store[openKey];
    var version = currentVersion();
    if (!entry || !version) return;
    if (entry.type !== "html" && entry.type !== "svg") return;
    var blob = new Blob([selfContainedHtml(version.code)], { type: "text/html" });
    var url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener");
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  /* ------------------------------------------------------------------ boot */

  var rescanTimer = null;

  function scheduleRescan() {
    if (rescanTimer) clearTimeout(rescanTimer);
    rescanTimer = setTimeout(function () {
      rescanTimer = null;
      var messages = document.querySelectorAll("#chatBox .message.assistant");
      for (var i = messages.length - 1; i >= 0; i--) scanMessage(messages[i]);
    }, 900);
  }

  function wire() {
    document.getElementById("artifactClose").addEventListener("click", function () {
      closeBrowser();
      hidePanel();
    });
    document.getElementById("artifactBrowserClose").addEventListener("click", closeBrowser);
    // "All artifacts" in the panel header reopens the library.
    var titleInput = document.getElementById("artifactTitle");
    if (titleInput) {
      var browseBtn = document.createElement("button");
      browseBtn.type = "button";
      browseBtn.className = "artifact-btn";
      browseBtn.textContent = "All";
      browseBtn.title = "Browse every artifact";
      browseBtn.addEventListener("click", openBrowser);
      titleInput.parentNode.insertBefore(browseBtn, titleInput.nextSibling);
    }
    document.getElementById("artifactCopy").addEventListener("click", copyArtifact);
    document.getElementById("artifactDownload").addEventListener("click", downloadArtifact);
    document.getElementById("artifactErrorOpen").addEventListener("click", openInNewTab);
    document.getElementById("artifactErrorDownload").addEventListener("click", downloadArtifact);
    toggleBtn.addEventListener("click", function () {
      var keys = keysInCurrentConversation();
      if (keys.length) openArtifact(keys[keys.length - 1]);
    });

    titleEl.addEventListener("input", function () {
      if (!openKey || !store[openKey]) return;
      store[openKey].title = titleEl.value || "Untitled";
      save();
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && panel && !panel.hidden && panel.classList.contains("is-open")) {
        hidePanel();
      }
    });

    // Drag the left edge to resize.
    var dragging = false;
    resizer.addEventListener("pointerdown", function (event) {
      dragging = true;
      resizer.setPointerCapture(event.pointerId);
    });
    resizer.addEventListener("pointermove", function (event) {
      if (!dragging) return;
      var width = Math.min(Math.max(window.innerWidth - event.clientX, 360), window.innerWidth * 0.75);
      panel.style.width = width + "px";
    });
    resizer.addEventListener("pointerup", function (event) {
      dragging = false;
      try { resizer.releasePointerCapture(event.pointerId); } catch (error) { /* ignore */ }
    });

    lastConversation = currentConversation();

    var chatBox = document.getElementById("chatBox");
    if (chatBox && window.MutationObserver) {
      var observer = new MutationObserver(function (mutations) {
        // Switching chats clears the transcript: drop a panel showing another
        // conversation's artifact rather than leaving it stranded.
        var now = currentConversation();
        if (now !== lastConversation) {
          lastConversation = now;
          if (panel && panel.classList.contains("is-open")) hidePanel();
        }
        mutations.forEach(function (mutation) {
          Array.prototype.forEach.call(mutation.addedNodes, function (node) {
            if (node.nodeType !== 1) return;
            if (node.classList && node.classList.contains("message")) scanMessage(node);
            if (node.querySelectorAll) {
              Array.prototype.forEach.call(node.querySelectorAll(".message.assistant"), scanMessage);
            }
          });
        });
        // Streaming writes text first and only parses to <pre><code> at the end,
        // so also give the newest assistant message a debounced re-check.
        scheduleRescan();
      });
      observer.observe(chatBox, { childList: true, subtree: true });
    }
  }

  function init() {
    if (booted) return;
    panel = document.getElementById("artifactPanel");
    if (!panel) return; // not on this page
    booted = true;
    body = document.getElementById("artifactBody");
    titleEl = document.getElementById("artifactTitle");
    versionsEl = document.getElementById("artifactVersions");
    metaEl = document.getElementById("artifactMeta");
    errorEl = document.getElementById("artifactError");
    resizer = document.getElementById("artifactResizer");
    toggleBtn = document.getElementById("artifactToggle");
    store = load();
    wire();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.NicoArtifacts = {
    open: openArtifact,
    close: function () { closeBrowser(); hidePanel(); },
    browse: openBrowser,
    list: function () { return keysInCurrentConversation(); },
    all: allArtifacts,
    entry: entryByKey,
    refreshBadge: refreshBadge,
    conversation: currentConversation,
    classifyReply: classifyReply,
    scanMessage: scanMessage,
  };
})();