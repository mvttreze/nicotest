/* ============================================================================
   Nico - Gallery
   Every image Nico generates (or you attach) in one browsable grid, across
   every conversation. Mirrors the artifact library: the grid is global, each
   item remembers which chat it came from.

   Images are captured from the transcript by observing rendered
   img.message-image-preview nodes, so this works for live generations and for
   conversations reloaded from history - no backend change.

   Thumbnails are downscaled before storage (createStoredImagePreview in
   script.js) because raw generated images blow the localStorage budget.
   ========================================================================== */
(function () {
  "use strict";

  var STORE_KEY = "nico_gallery_v1";
  var MAX_ITEMS = 120;
  var THUMB_MAX = 512;

  var grid, viewer, viewerImg, viewerCaption, panel, countEl;
  var items = [];
  var booted = false;

  /* ------------------------------------------------------------- utilities */

  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  function save() {
    if (typeof storageSet === "function") {
      if (storageSet(STORE_KEY, JSON.stringify(items))) return;
    }
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(items));
    } catch (error) {
      // Out of room: drop the oldest half and try once more.
      items = items.slice(0, Math.floor(items.length / 2));
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(items));
      } catch (retry) {
        items = items.slice(0, 6);
        try { localStorage.setItem(STORE_KEY, JSON.stringify(items)); } catch (e) { /* give up */ }
      }
    }
  }

  function currentConversation() {
    try {
      if (typeof currentConversationId !== "undefined" && currentConversationId) {
        return String(currentConversationId);
      }
    } catch (error) { /* not loaded */ }
    return "default";
  }

  function conversationTitleOf(conversationId) {
    if (typeof getConversationTitle === "function") {
      var title = getConversationTitle(conversationId);
      if (title) return title;
    }
    return "Untitled chat";
  }

  // Cheap stable id from the image bytes, so re-rendering the same message
  // does not add a duplicate.
  function hashOf(text) {
    var h = 5381;
    var s = String(text || "");
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  function downscale(dataUrl) {
    if (typeof createStoredImagePreview !== "function") {
      return Promise.resolve(dataUrl);
    }
    return createStoredImagePreview(dataUrl).then(function (out) {
      return out || dataUrl;
    }).catch(function () {
      return dataUrl;
    });
  }

  /* ---------------------------------------------------------------- capture */

  function captionFrom(messageEl) {
    if (!messageEl) return "";
    var content = messageEl.querySelector(".content");
    if (!content) return "";
    // Prefer a short bolded caption (how generated images arrive), else the
    // first line of text.
    var bold = content.querySelector("strong");
    if (bold && bold.textContent.trim()) return bold.textContent.trim().slice(0, 120);
    var text = (content.innerText || "").trim().split("\n")[0] || "";
    return text.slice(0, 120);
  }

  function addImage(imgEl, messageEl) {
    var src = imgEl.getAttribute("src") || "";
    if (!src) return;
    if (src.indexOf("data:image/") !== 0 && src.indexOf("blob:") !== 0) return;

    var id = hashOf(src.length + ":" + src.slice(0, 512) + src.slice(-256));
    if (items.some(function (item) { return item.id === id; })) return;

    var entry = {
      id: id,
      src: src,
      thumb: null,
      caption: captionFrom(messageEl),
      conversationId: currentConversation(),
      createdAt: Date.now(),
    };
    entry.conversationTitle = conversationTitleOf(entry.conversationId);

    // Show a placeholder row immediately, fill the thumbnail in when ready.
    items.unshift(entry);
    if (items.length > MAX_ITEMS) items.length = MAX_ITEMS;
    refreshBadge();

    if (src.indexOf("blob:") === 0) {
      // Blobs die with the page; convert so the gallery keeps the pixels.
      fetch(src)
        .then(function (r) { return r.blob(); })
        .then(function (blob) {
          return new Promise(function (resolve) {
            var reader = new FileReader();
            reader.onload = function () { resolve(reader.result); };
            reader.readAsDataURL(blob);
          });
        })
        .then(function (dataUrl) {
          entry.src = dataUrl;
          return downscale(dataUrl).then(function (t) { entry.thumb = t; });
        })
        .then(function () { save(); if (!viewer.hidden) renderGrid(); })
        .catch(function () { save(); });
      return;
    }

    downscale(src)
      .then(function (t) { entry.thumb = t || src; })
      .catch(function () { entry.thumb = src; })
      .then(function () { save(); if (grid && !grid.hidden) renderGrid(); });
  }

  /* ------------------------------------------------------------------ grid */

  function renderGrid() {
    if (!grid) return;
    grid.innerHTML = "";

    if (countEl) {
      countEl.textContent = items.length
        ? items.length + (items.length === 1 ? " image" : " images")
        : "";
    }

    if (!items.length) {
      var empty = document.createElement("div");
      empty.className = "gallery-empty";
      empty.innerHTML =
        "<p>No images yet.</p>" +
        "<p>Try <code>draw a robot at sunset</code> or attach a photo.</p>";
      grid.appendChild(empty);
      return;
    }

    var currentConv = currentConversation();
    items.forEach(function (item) {
      var card = document.createElement("button");
      card.type = "button";
      card.className = "gallery-item";
      card.dataset.id = item.id;
      if (item.conversationId === currentConv) card.classList.add("is-this-chat");

      var img = document.createElement("img");
      img.src = item.thumb || item.src;
      img.alt = item.caption || "Generated image";
      img.loading = "lazy";
      card.appendChild(img);

      var meta = document.createElement("span");
      meta.className = "gallery-item-meta";
      meta.textContent =
        (item.conversationId === currentConv ? "This chat" : item.conversationTitle) +
        " - " + new Date(item.createdAt).toLocaleDateString();
      card.appendChild(meta);

      card.addEventListener("click", function () { openViewer(item.id); });
      grid.appendChild(card);
    });
  }

  function openViewer(id) {
    var item = items.filter(function (i) { return i.id === id; })[0];
    if (!item || !viewer) return;
    viewerImg.src = item.src;
    viewerImg.alt = item.caption || "Generated image";
    viewerCaption.textContent =
      (item.caption || "Untitled") + " - " + item.conversationTitle;
    viewer.dataset.id = id;
    viewer.hidden = false;
    grid.hidden = true;
  }

  function closeViewer() {
    if (!viewer) return;
    viewer.hidden = true;
    viewerImg.removeAttribute("src");
    grid.hidden = false;
  }

  function downloadCurrent() {
    var id = viewer && viewer.dataset.id;
    var item = id && items.filter(function (i) { return i.id === id; })[0];
    if (!item) return;
    var name = (item.caption || "nico-image").replace(/[^\w.-]+/g, "-").slice(0, 60) || "nico-image";
    if (typeof downloadBlob === "function") {
      fetch(item.src)
        .then(function (r) { return r.blob(); })
        .then(function (blob) { downloadBlob(blob, name + ".jpg"); })
        .catch(function () { /* ignore */ });
    }
  }

  function deleteCurrent() {
    var id = viewer && viewer.dataset.id;
    if (!id) return;
    items = items.filter(function (i) { return i.id !== id; });
    save();
    refreshBadge();
    closeViewer();
    renderGrid();
  }

  /* ------------------------------------------------------------------- UI */

  function refreshBadge() {
    var badge = document.getElementById("quickGalleryCount");
    if (!badge) return;
    badge.textContent = String(items.length);
    badge.hidden = items.length === 0;
  }

  function openGallery() {
    if (!panel) return;
    closeViewer();
    renderGrid();
    panel.hidden = false;
    panel.setAttribute("aria-hidden", "false");
    panel.classList.add("is-open");
    document.documentElement.classList.add("gallery-open");
  }

  function closeGallery() {
    if (!panel) return;
    closeViewer();
    panel.classList.remove("is-open");
    panel.setAttribute("aria-hidden", "true");
    document.documentElement.classList.remove("gallery-open");
  }

  function wire() {
    document.getElementById("galleryClose").addEventListener("click", closeGallery);
    document.getElementById("galleryViewerClose").addEventListener("click", closeViewer);
    document.getElementById("galleryDownload").addEventListener("click", downloadCurrent);
    document.getElementById("galleryDelete").addEventListener("click", deleteCurrent);
    viewer.addEventListener("click", function (event) {
      if (event.target === viewer) closeViewer();
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        if (!viewer.hidden) { closeViewer(); return; }
        if (panel && panel.classList.contains("is-open")) closeGallery();
      }
      if (!viewer.hidden && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
        var idx = items.findIndex(function (i) { return i.id === viewer.dataset.id; });
        if (idx < 0) return;
        var next = event.key === "ArrowRight" ? idx + 1 : idx - 1;
        if (next >= 0 && next < items.length) openViewer(items[next].id);
      }
    });

    // Resize handle, same behaviour as the artifact panel.
    var resizer = document.getElementById("galleryResizer");
    var dragging = false;
    resizer.addEventListener("pointerdown", function (event) {
      dragging = true;
      resizer.setPointerCapture(event.pointerId);
    });
    resizer.addEventListener("pointermove", function (event) {
      if (!dragging) return;
      var width = Math.min(Math.max(window.innerWidth - event.clientX, 380), window.innerWidth * 0.8);
      panel.style.width = width + "px";
    });
    resizer.addEventListener("pointerup", function (event) {
      dragging = false;
      try { resizer.releasePointerCapture(event.pointerId); } catch (error) { /* ignore */ }
    });

    var chatBox = document.getElementById("chatBox");
    if (chatBox && window.MutationObserver) {
      var observer = new MutationObserver(function (mutations) {
        mutations.forEach(function (mutation) {
          Array.prototype.forEach.call(mutation.addedNodes, handleNode);
        });
      });
      observer.observe(chatBox, { childList: true, subtree: true });
      // Catch anything already rendered before this script loaded.
      Array.prototype.forEach.call(chatBox.querySelectorAll("img.message-image-preview"), function (img) {
        addImage(img, img.closest(".message"));
      });
    }

    function handleNode(node) {
      if (!node || node.nodeType !== 1) return;
      if (node.tagName === "IMG" && node.classList.contains("message-image-preview")) {
        addImage(node, node.closest(".message"));
        return;
      }
      if (!node.querySelectorAll) return;
      Array.prototype.forEach.call(node.querySelectorAll("img.message-image-preview"), function (img) {
        addImage(img, img.closest(".message"));
      });
    }
  }

  function init() {
    if (booted) return;
    panel = document.getElementById("galleryPanel");
    if (!panel) return;
    booted = true;
    grid = document.getElementById("galleryGrid");
    viewer = document.getElementById("galleryViewer");
    viewerImg = document.getElementById("galleryViewerImg");
    viewerCaption = document.getElementById("galleryViewerCaption");
    items = load();
    wire();
    refreshBadge();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.NicoGallery = {
    open: openGallery,
    close: closeGallery,
    list: function () { return items.slice(); },
    refreshBadge: refreshBadge,
  };
})();