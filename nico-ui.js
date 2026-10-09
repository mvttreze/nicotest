/* Adds prompt starters + mode chips that mirror the existing settings selects (no changes to script.js). */
(function () {
  const $ = (id) => document.getElementById(id);
  const input = $("userInput");

  document.querySelectorAll(".welcome-suggestions button").forEach((btn) =>
    btn.addEventListener("click", () => {
      input.value = btn.dataset.prompt;
      input.focus();
    }),
  );

  const chips = $("modeChips");
  const defs = [
    ["personalitySetting", "Tone"],
    ["lengthSetting", "Length"],
    ["modelSetting", "Model"],
  ];
  const pairs = [];
  defs.forEach(([id, label]) => {
    const src = $(id);
    if (!src || !chips) return;
    const wrap = document.createElement("label");
    const sel = document.createElement("select");
    sel.setAttribute("aria-label", label);
    wrap.append(label, sel);
    [...src.options].forEach((o) => sel.add(new Option(o.text, o.value)));
    sel.addEventListener("change", () => {
      src.value = sel.value;
      // script.js saves settings on "input", so fire that (plus "change" for anything else listening)
      src.dispatchEvent(new Event("input", { bubbles: true }));
      src.dispatchEvent(new Event("change", { bubbles: true }));
    });
    src.addEventListener("change", () => (sel.value = src.value));
    chips.append(wrap);
    pairs.push([src, sel]);
  });
  // Settings load after script.js runs; sync once it has.
  const sync = () => pairs.forEach(([src, sel]) => (sel.value = src.value));
  window.addEventListener("load", () => {
    sync();
    setTimeout(sync, 600);
  });
})();

/* ---------- v3: command palette, credits easter egg, copy + scroll helpers ---------- */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, cls, txt) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  };

  // ===== EDIT ME: contributors shown in the secret credits screen =====
  const CREDITS = [
    { role: "Creator & Developer", name: "Matt Andrei Crisostomo" },
    { role: "UI Design", name: "Matt Andrei Crisostomo" },
    { role: "Major Supporter", name: "Anika" },
    { role: "Major Supporter", name: "Carl" },
    { role: "Major Supporter", name: "Mikael" },
    { role: "Major Supporter", name: "Isaac" },
    { role: "Supporter", name: "Yuzi" },
    { role: "Supporter", name: "Reii" },
    { role: "Supporter", name: "Virtual" },
    { role: "Supporter", name: "Amelia" },
    // { role: "Testing", name: "Your friend here" },
  ];

  const closeOverlay = (id) => {
    const o = document.getElementById(id);
    if (o) o.remove();
  };

  function openCredits() {
    if (document.getElementById("nicoCredits")) return;
    const ov = el("div", "nico-overlay credits-overlay");
    ov.id = "nicoCredits";
    const card = el("div", "credits-card");
    const x = el("button", "credits-x", "✕");
    x.setAttribute("aria-label", "Close credits");
    card.append(
      x,
      el("div", "credits-mark", "✦"),
      el("h2", "credits-title", "Made with love for Nico"),
      el("p", "credits-sub", "The people behind this build"),
    );
    const list = el("div", "credits-list");
    CREDITS.forEach((c, i) => {
      const row = el("div", "credits-row");
      row.style.animationDelay = 0.25 + i * 0.18 + "s";
      row.append(
        el("span", "credits-role", c.role),
        el("span", "credits-name", c.name),
      );
      list.append(row);
    });
    card.append(list, el("p", "credits-foot", "Nico v2 · press Esc to close"));
    ov.append(card);
    document.body.append(ov);
    const close = () => ov.remove();
    x.addEventListener("click", close);
    ov.addEventListener("click", (e) => {
      if (e.target === ov) close();
    });
  }

  // Secret: click the logo 5 times quickly
  const logo = $(".sidebar .logo");
  let clicks = 0,
    timer;
  if (logo)
    logo.addEventListener("click", () => {
      clicks++;
      clearTimeout(timer);
      timer = setTimeout(() => (clicks = 0), 1500);
      if (clicks >= 5) {
        clicks = 0;
        openCredits();
      }
    });

  // ===== Command palette (Ctrl/Cmd + K) =====
  function setSelect(id, value) {
    const s = document.getElementById(id);
    if (!s) return;
    s.value = value;
    s.dispatchEvent(new Event("input", { bubbles: true }));
    s.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function commands() {
    const c = [];
    const add = (g, label, fn) => c.push({ g, label, fn });
    add("Chat", "New chat", () => $(".new-chat-btn")?.click());
    add("Chat", "Focus message box", () => $("#userInput")?.focus());
    add("Chat", "Morning briefing", () => {
      const i = $("#userInput");
      if (i) i.value = "Briefing";
      $("#sendBtn")?.click();
    });
    add("Chat", "New reminder…", () => {
      const i = $("#userInput");
      if (i) {
        i.value = "Remind me in ";
        i.focus();
      }
    });
    add("Chat", "What Nico remembers", () => {
      const i = $("#userInput");
      if (i) i.value = "What do you remember?";
      $("#sendBtn")?.click();
    });
    add("Chat", "Clear context", () => $("#clearContextBtn")?.click());
    add("Chat", "Export as Markdown", () => $("#exportMarkdownBtn")?.click());
    add("App", "Open settings", () => $("#settingsBtn")?.click());
    add("App", "Toggle sidebar", () => $("#menu-toggle")?.click());
    [
      ["personalitySetting", "Tone"],
      ["lengthSetting", "Length"],
      ["modelSetting", "Model"],
    ].forEach(([id, g]) => {
      const s = document.getElementById(id);
      if (s)
        [...s.options].forEach((o) =>
          add(g, g + ": " + o.text, () => setSelect(id, o.value)),
        );
    });
    add("App", "Credits", openCredits);
    return c;
  }
  function openPalette() {
    if (document.getElementById("nicoPalette"))
      return closeOverlay("nicoPalette");
    const ov = el("div", "nico-overlay palette-overlay");
    ov.id = "nicoPalette";
    const box = el("div", "palette-box");
    const input = el("input", "palette-input");
    input.placeholder = "Type a command…  (tone, model, new chat, settings)";
    input.setAttribute("aria-label", "Command search");
    const list = el("div", "palette-list");
    box.append(input, list);
    ov.append(box);
    document.body.append(ov);
    const all = commands();
    let shown = [],
      idx = 0;
    const run = (cmd) => {
      ov.remove();
      cmd.fn();
    };
    const render = () => {
      const q = input.value.trim().toLowerCase();
      shown = all
        .filter((c) => (c.g + " " + c.label).toLowerCase().includes(q))
        .slice(0, 9);
      idx = Math.min(idx, Math.max(shown.length - 1, 0));
      list.replaceChildren(
        ...shown.map((c, i) => {
          const r = el(
            "button",
            "palette-item" + (i === idx ? " is-active" : ""),
          );
          r.type = "button";
          r.append(el("span", "", c.label), el("kbd", "", c.g));
          r.addEventListener("click", () => run(c));
          r.addEventListener("mousemove", () => {
            idx = i;
            render();
          });
          return r;
        }),
      );
      if (!shown.length)
        list.append(el("div", "palette-empty", "No matching command"));
    };
    input.addEventListener("input", () => {
      idx = 0;
      render();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        idx = (idx + 1) % Math.max(shown.length, 1);
        render();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        idx = (idx - 1 + shown.length) % Math.max(shown.length, 1);
        render();
      } else if (e.key === "Enter" && shown[idx]) {
        e.preventDefault();
        run(shown[idx]);
      }
    });
    ov.addEventListener("click", (e) => {
      if (e.target === ov) ov.remove();
    });
    render();
    input.focus();
  }
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      openPalette();
    } else if (e.key === "Escape") {
      closeOverlay("nicoPalette");
      closeOverlay("nicoCredits");
    }
  });
  const actions = $(".top-header-actions");
  if (actions) {
    const hint = el("button", "palette-hint", "Ctrl K");
    hint.type = "button";
    hint.title = "Command palette";
    hint.addEventListener("click", openPalette);
    actions.prepend(hint);
  }

  // ===== Legacy copy button disabled: script.js now renders Claude-style .msg-actions footer =====
  const chatBox = document.getElementById("chatBox");
  function decorate() {
    if (!chatBox) return;
    // Remove any legacy absolute copy buttons to avoid duplication with new footer
    chatBox.querySelectorAll(".message .msg-copy").forEach((b) => b.remove());
  }
  if (chatBox) {
    new MutationObserver(decorate).observe(chatBox, {
      childList: true,
      subtree: true,
    });
    decorate();
  }

  // ===== Scroll-to-latest button =====
  const container = $(".chat-container");
  if (container && chatBox) {
    const jump = el("button", "scroll-jump", "↓");
    jump.type = "button";
    jump.setAttribute("aria-label", "Scroll to latest");
    container.append(jump);
    const scroller = () =>
      chatBox.scrollHeight > chatBox.clientHeight + 4 ? chatBox : container;
    const check = () => {
      const s = scroller();
      jump.classList.toggle(
        "show",
        s.scrollHeight - s.scrollTop - s.clientHeight > 240,
      );
    };
    document.addEventListener("scroll", check, true);
    jump.addEventListener("click", () => {
      const s = scroller();
      s.scrollTo({ top: s.scrollHeight, behavior: "smooth" });
    });
  }
})();
