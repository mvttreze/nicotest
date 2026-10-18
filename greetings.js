/* ============================================================================
   Nico - Dynamic greetings

   The welcome headline used to be a hardcoded "Hello, <name>". This module
   owns the whole line: it picks a variation that fits the time of day and
   the person, wraps the name in a span so the existing styles still apply,
   and animates the swap.

   Subtitles rotate too, so the whole welcome block feels alive rather than
   static. Public API:

     NicoGreetings.apply(name)   re-pick and render for this name
     NicoGreetings.reroll()      pick a new variation for the current name
     NicoGreetings.setSubtitles(bool)

   Safe to load anywhere: if #welcomeTitle is missing it does nothing.
   ========================================================================== */
(function () {
  "use strict";

  /* ---------------------------------------------------------- variations */

  /* Each entry is a template. {name} is replaced by the user's name and the
     whole string is used verbatim, so punctuation is authored per line. */
  var ANYTIME = [
    "Hello, {name}",
    "Hey, {name}!",
    "Sup, {name}",
    "Yo, {name}!",
    "Hiya, {name}",
    "Greetings, {name}",
    "Hey {name}",
    "Hey hey, {name}!",
    "Hi, {name}!",
    "Hello there, {name}",
    "Hello, {name}.",
    "Well, look who's here: {name}",
    "Good to see you, {name}",
    "Welcome back, {name}",
    "{name} has arrived",
    "Ah, {name}",
    "Oh it's you, {name}",
    "You made it, {name}",
    "{name}. Good.",
    "The stage is yours, {name}",
    "Hi hi hi, {name}",
    "{name}, ready when you are",
    "You've reached {name}",
    "Calling {name} to the desk",
    "Nico reporting for duty, {name}",
    "Somebody call {name}",
    "Attention, {name}",
    "Curious how this works? Ask {name}",
    "Half the fun is watching {name} figure it out",
    "It's {name}, folks",
    "{name}, let's make something good",
    "Welcome, {name}. Everything is fine now.",
  ];

  /* Grand, absurd, a bit theatrical. Mixed into the rotation on purpose. */
  var REGAL = [
    "It's the Almighty {name}",
    "Behold, {name}",
    "The one and only {name}",
    "All hail {name}",
    "Ladies and gentlemen, {name}",
    "The legend returns: {name}",
    "The magnificent {name} approaches",
    "Enter {name}, dispenser of good questions",
    "{name}. Supreme. Formidable. Ready.",
    "Long live {name}",
    "The stars have aligned: {name}",
    "Make way for {name}",
    "Hail to thee, {name}",
    "A great burden falls on {name}",
    "Nico kneels to {name}",
    "The heavens part for {name}",
  ];

  var MORNING = [
    "Good morning, {name}",
    "Morning, {name}",
    "Early bird, {name}",
    "The sun is up and so are you, {name}",
    "Fresh start, {name}",
    "First light, {name}",
    "There's coffee and there's {name}",
  ];

  var AFTERNOON = [
    "Good afternoon, {name}",
    "Afternoon, {name}",
    "Midday already, {name}",
    "The day's half gone, {name}",
    "Afternoon, {name}. Don't let the clock win.",
  ];

  var EVENING = [
    "Good evening, {name}",
    "Evening, {name}",
    "Winding down, {name}?",
    "The lights are low, {name}",
    "Evening, {name}. One more thing?",
  ];

  var NIGHT = [
    "Still up, {name}?",
    "Burning the midnight oil, {name}",
    "Late night, {name}",
    "Night owl hours, {name}",
    "It's late, {name}. Worth it?",
    "{name}, the world is asleep. You're not.",
  ];

  /* Used when the account is recognised as the developer. */
  var DEV = [
    "Ship something today, {name}",
    "{name}, the codebase awaits",
    "Hey boss, {name}",
    "{name}. The stack is hot.",
    "Morning, {name}. Anything to break?",
    "{name}, let's go fix something",
  ];

  var SUBTITLES = [
    "What should we focus on?",
    "What are we building?",
    "Where do you want to start?",
    "Ask anything. Start anywhere.",
    "What needs thinking through?",
    "Pick a thread and pull.",
    "What's on your mind today?",
    "Ready when you are.",
    "A blank page and a whole afternoon.",
    "What would make today easier?",
  ];

  /* ------------------------------------------------------------- helpers */

  /* Deterministic-ish randomness that still varies per visit. */
  var seed = (Date.now() % 100000) + Math.floor(Math.random() * 997);
  function rand() {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  }
  function pick(list) {
    return list[Math.floor(rand() * list.length)];
  }

  function bucket() {
    var h = new Date().getHours();
    if (h >= 5 && h < 12) return MORNING;
    if (h >= 12 && h < 17) return AFTERNOON;
    if (h >= 17 && h < 22) return EVENING;
    return NIGHT;
  }

  /* Build the pool for this moment. Time bucket first, then the general set,
     with a slice of the theatrical entries folded in. */
  function buildPool(name, isDev) {
    if (isDev) return DEV.concat(ANYTIME);
    var pool = bucket().slice();
    pool.push.apply(pool, ANYTIME);
    // Roughly one in four greetings is the extravagant kind.
    var regalCount = 2 + Math.floor(rand() * 3);
    for (var i = 0; i < regalCount; i += 1) {
      pool.push(REGAL[Math.floor(rand() * REGAL.length)]);
    }
    return pool;
  }

  /* ---------------------------------------------------------------- state */

  var currentName = "User";
  var currentIsDev = false;
  var lastTemplate = "";
  var lastSubtitle = "";
  var titleEl = null;
  var subtitleEl = null;
  var subtitlesOn = true;

  function title() {
    if (!titleEl) titleEl = document.getElementById("welcomeTitle");
    return titleEl;
  }

  function subtitle() {
    if (!subtitleEl) subtitleEl = document.getElementById("welcomeSubtitle");
    return subtitleEl;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[c];
    });
  }

  /* Swap in a new line with a short, cheap animation. The animation is a
     class toggle plus a forced reflow so it restarts every time. */
  function swap(node, html) {
    if (!node) return;
    node.innerHTML = html;
    node.classList.remove("is-swapping");
    void node.offsetWidth;
    node.classList.add("is-swapping");
  }

  /* --------------------------------------------------------------- public */

  function draw() {
    var el = title();
    if (!el) return;

    var pool = buildPool(currentName, currentIsDev);
    var template = pick(pool);
    // Avoid saying the same thing twice in a row.
    var guard = 0;
    while (template === lastTemplate && pool.length > 1 && guard < 8) {
      template = pick(pool);
      guard += 1;
    }
    lastTemplate = template;

    // Split on the placeholder so the name always gets its own span and the
    // original .welcome-name styling keeps working. Only the OUTER edges are
    // trimmed: the inner spaces must survive or the text runs together.
    var parts = template.split("{name}");
    var lead = parts[0].replace(/^\s+/, "");
    var tail = parts.length > 1 ? parts.slice(1).join("{name}").replace(/\s+$/, "") : "";

    var html = "";
    if (lead) html += '<span class="greet-lead">' + escapeHtml(lead) + "</span>";
    html +=
      '<span class="welcome-name" id="welcomeName">' +
      escapeHtml(currentName) +
      "</span>";
    if (tail) html += '<span class="greet-tail">' + escapeHtml(tail) + "</span>";

    el.dataset.greeted = "1";
    swap(el, html);

    var sub = subtitle();
    if (sub && subtitlesOn) {
      var next = pick(SUBTITLES);
      var tries = 0;
      while (next === lastSubtitle && tries < 5) {
        next = pick(SUBTITLES);
        tries += 1;
      }
      lastSubtitle = next;
      swap(sub, escapeHtml(next));
    }
  }

  function apply(name, isDev) {
    var clean = String(name || "User").trim();
    if (!clean) clean = "User";
    currentName = clean;
    currentIsDev = !!isDev;
    draw();
  }

  function reroll() {
    draw();
  }

  function setSubtitles(on) {
    subtitlesOn = !!on;
  }

  /* Re-picking on a new chat is driven straight from startNewChat() rather
     than watched for on the layout class: startNewChat toggles two classes at
     once, and a class observer cannot tell that apart from unrelated layout
     changes. This function just boots the first line. */
  function init() {
    var el = title();
    if (!el) return;
    // Preserve whatever script.js already set before this ran.
    var existing = document.getElementById("welcomeName");
    currentName = (existing && existing.textContent.trim()) || currentName;
    draw();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.NicoGreetings = {
    apply: apply,
    reroll: reroll,
    setSubtitles: setSubtitles,
    init: init,
  };
})();
