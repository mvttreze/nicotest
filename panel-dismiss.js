/* ============================================================================
   Nico - dismissible side panels

   Lets the Artifacts and Gallery panels be dismissed by tapping the empty
   space beside them, which is the behaviour people already expect from a
   drawer. On phones the panels become bottom sheets, so the strip of screen
   above the sheet is the same "space beside it".

   One shared implementation instead of a copy in each panel module:

     NicoPanelDismiss.register({
       panel:    element,
       scrimZ:   number,      // sits directly below the panel
       isOpen:   function,    // -> boolean
       close:    function,    // called when the user taps outside
       triggers: [element]    // controls that open it; never dismissed by them
     })

   Uses pointerdown rather than click so the sheet starts dismissing on the
   finger-lift-free touch, and ignores taps that began inside the panel.
   Safe on pages without any registered panel.
   ========================================================================== */
(function () {
  "use strict";

  var registry = [];

  /* The tap must both start and end outside the panel. A drag that begins in
     the panel (selecting text, moving the resizer) must not dismiss it. */
  function startedInside(entry) {
    return entry.startTarget && entry.panel.contains(entry.startTarget);
  }

  function scrimFor(entry) {
    if (entry.scrim) return entry.scrim;
    var scrim = document.createElement("div");
    scrim.className = "panel-scrim";
    scrim.setAttribute("aria-hidden", "true");
    scrim.dataset.panelScrim = entry.panel.id || "";
    // Just below the panel so the sheet keeps its shadow on top of the dim.
    scrim.style.zIndex = String(entry.scrimZ);
    if (entry.panel.parentNode) {
      entry.panel.parentNode.insertBefore(scrim, entry.panel);
    } else {
      document.body.appendChild(scrim);
    }
    entry.scrim = scrim;
    return scrim;
  }

  function setScrimVisible(entry, visible) {
    var scrim = scrimFor(entry);
    scrim.classList.toggle("is-on", !!visible);
    // Keep it out of the tab order and off the accessibility tree.
    scrim.setAttribute("aria-hidden", visible ? "false" : "true");
    scrim.style.pointerEvents = visible ? "auto" : "none";
  }

  function register(options) {
    if (!options || !options.panel) return null;
    var entry = {
      panel: options.panel,
      scrimZ: options.scrimZ || 59,
      isOpen: options.isOpen || function () {
        return options.panel.classList.contains("is-open");
      },
      close: options.close || function () {},
      triggers: (options.triggers || []).filter(Boolean),
      scrim: null,
      startTarget: null,
    };
    registry.push(entry);

    // Tapping the dim area itself dismisses. It sits outside the panel, so
    // the document handler below would catch it too, but stopping here keeps
    // the behaviour obvious and avoids ordering surprises.
    entry.scrimReady = scrimFor(entry);
    entry.scrimReady.addEventListener("pointerdown", function (event) {
      event.preventDefault();
      if (entry.isOpen()) entry.close();
    });

    return entry;
  }

  /* Every panel re-evaluates its scrim when it opens or closes. Panels call
     this instead of touching the scrim themselves. */
  function sync() {
    registry.forEach(function (entry) {
      if (!entry.scrim) return;
      setScrimVisible(entry, entry.isOpen());
    });
  }

  /* Two right-side drawers stacked on top of each other is not a state worth
     supporting, and it makes dismissal ambiguous: tapping one panel's scrim
     lands on the other's scrim too, so both close. A panel calls this as it
     opens and the previous one gets out of the way first. */
  function closeOthers() {
    registry.forEach(function (entry) {
      if (!entry.isOpen()) return;
      entry.close();
    });
    sync();
  }

  document.addEventListener(
    "pointerdown",
    function (event) {
      registry.forEach(function (entry) {
        entry.startTarget = event.target;
      });
    },
    true,
  );

  document.addEventListener("pointerup", function (event) {
    registry.forEach(function (entry) {
      var started = startedInside(entry);
      entry.startTarget = null;
      if (started) return;
      if (!entry.isOpen()) return;
      if (entry.panel.contains(event.target)) return;
      var onTrigger = entry.triggers.some(function (trigger) {
        return trigger.contains(event.target);
      });
      if (onTrigger) return;
      entry.close();
    });
  });

  window.NicoPanelDismiss = { register: register, sync: sync, closeOthers: closeOthers };
})();
