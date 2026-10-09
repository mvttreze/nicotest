const chatBox = document.getElementById("chatBox");
const micBtn = document.getElementById("micBtn");
const userInput = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");
const addBtn = document.getElementById("addBtn");
const addFilesDropdown = document.getElementById("addFilesDropdown");
const attachmentList = document.getElementById("attachmentList");
const filePickers = {
  files: document.getElementById("filePicker"),
  images: document.getElementById("imagePicker"),
  code: document.getElementById("codePicker"),
};
let selectedAttachments = [];
const configuredApiUrl = document
  .querySelector('meta[name="nico-api-url"]')
  ?.content.trim();
const host = window.location.hostname || "";
const isLocalHost = host === "" || host === "localhost" || host === "127.0.0.1";
const apiBaseUrl = isLocalHost
  ? "http://127.0.0.1:8000"
  : configuredApiUrl || "https://nicotest-1.onrender.com";
const supabaseUrl = document.querySelector(
  'meta[name="supabase-url"]',
)?.content;
const supabaseAnonKey = document.querySelector(
  'meta[name="supabase-anon-key"]',
)?.content;
const authClient =
  window.supabase &&
  supabaseUrl &&
  supabaseAnonKey &&
  supabaseAnonKey !== "YOUR_SUPABASE_PUBLISHABLE_KEY"
    ? window.supabase.createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      })
    : null;
let currentUser = null;
let authUiInitialized = false;
let conversationLoadToken = 0;
const settingsStorageKey = "nico_settings";
const developerModeStorageKey = "nico_developer_mode";
const defaultSettings = {
  personality: "professional",
  length: "short",
  theme: "midnight",
  mode: "dark",
  font: "sans",
  fontScale: 100,
  model: "light",
  memory: true,
  memoryText: "",
  context: true,
  sound: false,
  avatar: "✦",
  customBackgroundImage: "",
  wake: false,
  briefCity: "",
};
let settings = { ...defaultSettings };

function syncDeveloperModePreference() {
  const value = settings.personality === "developer" ? "1" : "0";
  storageSet(developerModeStorageKey, value);
}
let visionStream = null;
let capturedVisionDataUrl = "";
let visionAutoAnalyzeLock = false;

try {
  settings = {
    ...defaultSettings,
    ...JSON.parse(localStorage.getItem(settingsStorageKey) || "{}"),
  };
  if (localStorage.getItem(developerModeStorageKey) === "1") {
    settings.personality = "developer";
  }
} catch {
  settings = { ...defaultSettings };
}

function saveSettings() {
  storageSet(settingsStorageKey, JSON.stringify(settings));
  syncDeveloperModePreference();
}

// Quota-guarded storage: image history can fill the ~5MB localStorage
// budget, and an unguarded setItem throw silently kills flows like New chat.
// On failure we evict regenerable image caches once, then retry.
function storageSet(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    evictAttachmentCaches();
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (retryError) {
      console.warn("Storage write failed:", key);
      return false;
    }
  }
}

function evictAttachmentCaches() {
  try {
    const doomed = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && k.startsWith("conversation_attachments:")) doomed.push(k);
    }
    doomed.forEach((k) => localStorage.removeItem(k));
    // Still full? Trim every local message log to its latest 30 entries.
    if (doomed.length === 0) {
      for (let i = 0; i < localStorage.length; i += 1) {
        const k = localStorage.key(i);
        if (k && k.startsWith("nico_local_messages:")) {
          try {
            const messages = JSON.parse(localStorage.getItem(k) || "[]");
            localStorage.setItem(k, JSON.stringify(messages.slice(-30)));
          } catch {}
        }
      }
    }
  } catch {}
}

const NICO_MIDNIGHT_BLUE = "#6ea8ff";

function nicoLogoInner(A, personality) {
  const outer = `<rect x="42" y="172" width="15" height="78" rx="7.5" style="fill:${A}"/><rect x="455" y="172" width="15" height="78" rx="7.5" style="fill:${A}"/><path d="M30 238 C12 268 12 330 66 364 L84 334 C58 314 56 272 64 246 Z" style="fill:${A}"/><path d="M482 238 C500 268 500 330 446 364 L428 334 C454 314 456 272 448 246 Z" style="fill:${A}"/><path d="M256 108 C158 108 80 178 80 272 C80 340 128 394 196 416 L172 452 C170 456 174 461 179 459 L228 440 C237 442 247 443 256 443 C354 443 432 373 432 279 C432 185 354 108 256 108 Z" style="fill:${A}"/><rect x="128" y="168" width="256" height="196" rx="86" fill="#FFFFFF"/>`;
  const FACES = {
    professional: `<path d="M168 258 C168 236 188 222 210 222 C232 222 252 236 252 258 C252 266 246 271 238 271 L184 271 C176 271 168 266 168 258 Z" style="fill:${A}"/><path d="M260 258 C260 236 280 222 302 222 C324 222 344 236 344 258 C344 266 338 271 330 271 L276 271 C268 271 260 266 260 258 Z" style="fill:${A}"/><path d="M238 296 Q256 312 274 296" fill="none" style="stroke:${A}" stroke-width="11" stroke-linecap="round"/>`,
    casual: `<circle cx="210" cy="250" r="16" style="fill:${A}"/><circle cx="302" cy="250" r="16" style="fill:${A}"/><path d="M232 292 Q256 310 280 292" fill="none" style="stroke:${A}" stroke-width="11" stroke-linecap="round"/>`,
    hype: `<path d="M186 232 L210 250 L186 268" fill="none" style="stroke:${A}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/><path d="M326 232 L302 250 L326 268" fill="none" style="stroke:${A}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/><ellipse cx="256" cy="302" rx="22" ry="26" style="fill:${A}"/>`,
    mica: `<path d="M168 258 C168 236 188 222 210 222 C232 222 252 236 252 258 C252 266 246 271 238 271 L184 271 C176 271 168 266 168 258 Z" style="fill:${A}"/><path d="M292 250 Q312 262 332 248" fill="none" style="stroke:${A}" stroke-width="11" stroke-linecap="round"/><path d="M234 294 Q256 312 278 294" fill="none" style="stroke:${A}" stroke-width="11" stroke-linecap="round"/><ellipse cx="168" cy="290" rx="16" ry="10" style="fill:${A}" opacity="0.25"/><ellipse cx="344" cy="290" rx="16" ry="10" style="fill:${A}" opacity="0.25"/>`,
    brainrot: `<circle cx="210" cy="252" r="14" style="fill:${A}"/><circle cx="302" cy="252" r="14" style="fill:${A}"/><rect x="176" y="224" width="68" height="56" rx="16" fill="none" stroke="#10151d" stroke-width="10"/><rect x="268" y="224" width="68" height="56" rx="16" fill="none" stroke="#10151d" stroke-width="10"/><path d="M244 246 Q256 238 268 246" fill="none" stroke="#10151d" stroke-width="10" stroke-linecap="round"/><path d="M238 300 L274 295" fill="none" style="stroke:${A}" stroke-width="10" stroke-linecap="round"/>`,
    developer: `<rect x="150" y="222" width="212" height="64" rx="32" fill="#10151d"/><rect x="190" y="246" width="44" height="12" rx="6" style="fill:${A}"/><rect x="278" y="246" width="44" height="12" rx="6" style="fill:${A}"/><path d="M228 294 L240 302 L228 310" fill="none" style="stroke:${A}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/><path d="M248 310 h16" fill="none" style="stroke:${A}" stroke-width="8" stroke-linecap="round"/>`,
  };
  const face = FACES[personality] || FACES.professional;
  if (personality === "mica") return `<g transform="rotate(-8 256 256)">${outer}${face}</g>`;
  return `${outer}${face}`;
}

function nicoIconSvg(accent, personality) {
  const c = (accent || NICO_MIDNIGHT_BLUE).trim() || NICO_MIDNIGHT_BLUE;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${nicoLogoInner(c, personality || "professional")}</svg>`;
}

function updateNicoFaces() {
  try {
    const inner = nicoLogoInner("var(--accent)", settings.personality || "professional");
    const authSvg = document.querySelector(".auth-logo svg");
    if (authSvg) authSvg.innerHTML = inner;
    const brandSvg = document.querySelector("#brandLogo svg");
    if (brandSvg) brandSvg.innerHTML = inner;
  } catch (error) {
    console.warn("Could not update Nico faces:", error);
  }
}

function resolveNicoAccent() {
  const computed = getComputedStyle(document.body).getPropertyValue("--accent").trim();
  if (computed) return computed;
  const root = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
  return root || NICO_MIDNIGHT_BLUE;
}

function updateNicoIcon() {
  try {
    const accent = resolveNicoAccent();
    const url = `data:image/svg+xml,${encodeURIComponent(nicoIconSvg(accent, settings.personality))}`;
    document.getElementById("nicoFavicon")?.setAttribute("href", url);
    const touch = document.getElementById("nicoTouchIcon");
    if (touch) touch.setAttribute("href", url);
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) themeMeta.setAttribute("content", accent);
  } catch (error) {
    console.warn("Could not update Nico icon:", error);
  }
}

function applySettings() {
  document.body.classList.toggle("theme-light", settings.mode === "light");
  document.body.classList.toggle(
    "theme-cyberpunk",
    settings.theme === "cyberpunk",
  );
  document.body.classList.toggle("theme-sunset", settings.theme === "sunset");
  document.body.classList.toggle("theme-aurora", settings.theme === "aurora");
  document.body.classList.toggle("theme-ocean", settings.theme === "ocean");
  document.body.classList.toggle("theme-forest", settings.theme === "forest");
  document.body.classList.toggle(
    "theme-graphite",
    settings.theme === "graphite",
  );
  document.body.classList.toggle(
    "theme-cotton-candy",
    settings.personality === "mica" && settings.theme === "midnight",
  );
  document.body.classList.toggle(
    "theme-brainrot",
    settings.personality === "brainrot" && settings.theme === "midnight",
  );
  document.body.classList.toggle("font-mono", settings.font === "mono");
  document.documentElement.style.setProperty(
    "--font-scale",
    settings.fontScale / 100,
  );
  document.documentElement.style.fontSize = `${settings.fontScale}%`;
  const hasCustomBackground =
    settings.customBackgroundImage.startsWith("data:image/");
  document.body.classList.toggle("custom-background", hasCustomBackground);
  if (hasCustomBackground) {
    document.body.style.setProperty(
      "--custom-background-image",
      `url("${settings.customBackgroundImage}")`,
    );
  } else {
    document.body.style.removeProperty("--custom-background-image");
  }
  const mascotLogo = document.getElementById("mascotLogo");
  const brandName = document.getElementById("brandName");
  const modelBadge = document.querySelector(".model-badge");
  const mascotPreview = document.getElementById("mascotPreview");
  if (mascotLogo) mascotLogo.textContent = settings.avatar;
  if (brandName) {
    brandName.textContent =
      settings.personality === "mica"
        ? "MICA"
        : settings.personality === "brainrot"
          ? "BRAINROT"
          : "NICO";
  }
  if (modelBadge)
    modelBadge.textContent =
      settings.personality === "mica"
        ? "Mica • Nurturing mode"
        : settings.personality === "brainrot"
          ? "Brainrot • Dry nerd mode"
          : settings.personality === "developer"
            ? "Developer • Matt Andrei"
            : "Nico v2 • System OS";
  if (mascotPreview)
    mascotPreview.firstChild.textContent = `${settings.avatar} `;
  document.querySelectorAll(".avatar-tag").forEach((tag) => {
    tag.textContent = settings.avatar;
  });
  const typingIndicator = document.getElementById("typingIndicator");
  if (typingIndicator) typingIndicator.innerText = getAssistantThinkingLabel();
  const customBackgroundStatus = document.getElementById(
    "customBackgroundStatus",
  );
  if (customBackgroundStatus) {
    customBackgroundStatus.textContent = hasCustomBackground
      ? "Image active"
      : "No image selected";
  }
  updateNicoIcon();
  updateNicoFaces();
  syncWakeWord();
}

function readCustomBackground(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const scale = Math.min(1, 1920 / image.width, 1080 / image.height);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        canvas
          .getContext("2d")
          .drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.78));
      };
      image.onerror = () => reject(new Error("Could not read that image."));
      image.src = reader.result;
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function getDesktopScreenSourceId() {
  try {
    if (!window.nicoDesktop?.pickScreenSource) return null;
    const sources = await window.nicoDesktop.pickScreenSource();
    if (!sources || !sources.length) return null;
    const screen =
      sources.find((s) => String(s.id || "").startsWith("screen:")) ||
      sources.find((s) => /screen|display|monitor|entire/i.test(s.name || "")) ||
      sources[0];
    return screen.id;
  } catch {
    return null;
  }
}

async function startVisionMode() {
  const overlay = document.getElementById("visionOverlay");
  const preview = document.getElementById("visionPreview");
  const status = document.getElementById("visionStatus");
  const captureButton = document.getElementById("captureVisionBtn");
  const analyzeButton = document.getElementById("analyzeVisionBtn");
  overlay.hidden = false;
  overlay.setAttribute("aria-hidden", "false");
  status.textContent = "Choose a window or screen to begin.";
  captureButton.disabled = true;
  analyzeButton.disabled = true;

  if (!navigator.mediaDevices?.getDisplayMedia) {
    // Desktop app (Electron): getDisplayMedia is unavailable, so capture
    // through the shell's screen sources instead.
    const sourceId = await getDesktopScreenSourceId();
    if (!sourceId) {
      status.textContent = "Screen capture is not supported in this browser.";
      return;
    }
    try {
      visionStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId: sourceId },
        },
      });
      preview.srcObject = visionStream;
      status.textContent = "Screen sharing is active";
      captureButton.disabled = false;
      analyzeButton.disabled = false;
      visionStream
        .getVideoTracks()[0]
        ?.addEventListener("ended", stopVisionMode, { once: true });
    } catch (error) {
      status.textContent =
        error?.name === "NotAllowedError"
          ? "Access was canceled. Close this view or try again."
          : "Could not start screen capture. Try again.";
      if (error?.name !== "NotAllowedError") {
        console.error("Could not start screen reader:", error);
      }
    }
    return;
  }

  try {
    visionStream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: "always" },
      audio: false,
    });
    preview.srcObject = visionStream;
    status.textContent = "Screen sharing is active";
    captureButton.disabled = false;
    analyzeButton.disabled = false;
    visionStream
      .getVideoTracks()[0]
      ?.addEventListener("ended", stopVisionMode, { once: true });
  } catch (error) {
    status.textContent =
      error?.name === "NotAllowedError"
        ? "Access was canceled. Close this view or try again."
        : "Could not start screen capture. Try again.";
    if (error?.name !== "NotAllowedError") {
      console.error("Could not start screen reader:", error);
    }
  }
}

function stopVisionMode() {
  visionStream?.getTracks().forEach((track) => track.stop());
  visionStream = null;
  const preview = document.getElementById("visionPreview");
  if (preview) preview.srcObject = null;
  document.getElementById("captureVisionBtn")?.setAttribute("disabled", "");
  document.getElementById("analyzeVisionBtn")?.setAttribute("disabled", "");
  const overlay = document.getElementById("visionOverlay");
  if (overlay) {
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");
  }
}

function captureVisionFrame() {
  const preview = document.getElementById("visionPreview");
  if (!preview?.videoWidth) return "";
  const canvas = document.createElement("canvas");
  canvas.width = preview.videoWidth;
  canvas.height = preview.videoHeight;
  canvas.getContext("2d").drawImage(preview, 0, 0);
  capturedVisionDataUrl = canvas.toDataURL("image/jpeg", 0.82);
  document.getElementById("visionStatus").textContent =
    "Frame captured. Ready for Nico.";
  return capturedVisionDataUrl;
}

async function analyzeVisionFrame() {
  const dataUrl = capturedVisionDataUrl || captureVisionFrame();
  if (!dataUrl) return;
  const blob = await (await fetch(dataUrl)).blob();
  selectedAttachments.push({
    file: new File([blob], "nico-screen-capture.jpg", { type: "image/jpeg" }),
    kind: "images",
    icon: "◉",
    previewUrl: dataUrl,
  });
  stopVisionMode();
  userInput.value =
    "Describe what is visible on my screen and help me understand it.";
  renderAttachments();
  await sendMessage();
}

async function handleVisionVisibilityChange() {
  const autoAnalyze = document.getElementById("visionAutoAnalyze")?.checked;
  if (
    !document.hidden ||
    !visionStream ||
    !autoAnalyze ||
    visionAutoAnalyzeLock
  ) {
    return;
  }
  visionAutoAnalyzeLock = true;
  try {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await analyzeVisionFrame();
  } finally {
    visionAutoAnalyzeLock = false;
  }
}

document.addEventListener("visibilitychange", handleVisionVisibilityChange);

async function apiFetch(url, options = {}) {
  const { allowGuest = false, ...fetchOptions } = options;
  const headers = new Headers(fetchOptions.headers || {});

  const demoToken = localStorage.getItem("nico_demo_auth_token");
  if (demoToken) {
    headers.set("Authorization", `Bearer ${demoToken}`);
    return fetch(url, { ...fetchOptions, headers });
  }

  if (authClient) {
    const { data } = await authClient.auth.getSession();
    if (!data.session) {
      if (!allowGuest) throw new Error("Sign-in required");
      return fetch(url, { ...fetchOptions, headers });
    }

    headers.set("Authorization", `Bearer ${data.session.access_token}`);
    return fetch(url, { ...fetchOptions, headers });
  }

  if (!allowGuest) throw new Error("Sign-in required");
  return fetch(url, { ...fetchOptions, headers });
}

function conversationStorageKey() {
  return currentUser ? `active_chat_id:${currentUser.id}` : "active_chat_id";
}

function localConversationListKey() {
  return currentUser
    ? `nico_local_conversations:${currentUser.id}`
    : "nico_local_conversations:guest";
}

function localConversationMessagesKey(conversationId = currentConversationId) {
  return `nico_local_messages:${conversationId}`;
}

function readLocalConversationList() {
  try {
    return JSON.parse(localStorage.getItem(localConversationListKey()) || "[]");
  } catch {
    return [];
  }
}

function writeLocalConversationList(list) {
  storageSet(
    localConversationListKey(),
    JSON.stringify(list.slice(0, 50)),
  );
}

function upsertLocalConversation(conversation) {
  const list = readLocalConversationList();
  const next = { ...conversation, updated_at: new Date().toISOString() };
  const index = list.findIndex((item) => item.id === next.id);
  if (index >= 0) {
    list[index] = { ...list[index], ...next };
  } else {
    list.unshift(next);
  }
  writeLocalConversationList(list);
}

function readLocalConversationMessages(conversationId = currentConversationId) {
  try {
    return JSON.parse(
      localStorage.getItem(localConversationMessagesKey(conversationId)) ||
        "[]",
    );
  } catch {
    return [];
  }
}

function writeLocalConversationMessages(conversationId, messages) {
  storageSet(
    localConversationMessagesKey(conversationId),
    JSON.stringify(messages.slice(-200)),
  );
}

function appendLocalConversationMessage(conversationId, role, content, attachments = []) {
  const messages = readLocalConversationMessages(conversationId);
  messages.push({
    role,
    content,
    attachments,
    created_at: new Date().toISOString(),
    conversation_id: conversationId,
  });
  writeLocalConversationMessages(conversationId, messages);
}

function persistCurrentConversationId() {
  storageSet("active_chat_id", currentConversationId);
  if (currentUser) {
    storageSet(
      `active_chat_id:${currentUser.id}`,
      currentConversationId,
    );
  }
}

function attachmentStorageKey(conversationId = currentConversationId) {
  return `conversation_attachments:${conversationId}`;
}

async function createStoredImagePreview(dataUrl) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, 640 / image.width, 640 / image.height);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      canvas
        .getContext("2d")
        .drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.78));
    };
    image.onerror = () => resolve(dataUrl);
    image.src = dataUrl;
  });
}

async function saveConversationAttachments(attachments) {
  try {
    const stored = JSON.parse(
      localStorage.getItem(attachmentStorageKey()) || "[]",
    );
    const normalized = await Promise.all(
      attachments.map(async (attachment) => {
        if (attachment.mime_type.startsWith("image/")) {
          return {
            name: attachment.name,
            mime_type: attachment.mime_type,
            data_url: await createStoredImagePreview(attachment.data_url),
          };
        }
        return {
          name: attachment.name,
          mime_type: attachment.mime_type,
          data_url: attachment.data_url || "",
        };
      }),
    );

    stored.push(normalized);
    storageSet(
      attachmentStorageKey(),
      JSON.stringify(stored.slice(-50)),
    );
  } catch (error) {
    console.warn("Could not persist attachments:", error);
  }
}

function loadConversationAttachments() {
  try {
    return JSON.parse(localStorage.getItem(attachmentStorageKey()) || "[]");
  } catch {
    return [];
  }
}

function createConversationId() {
  if (crypto.randomUUID) return crypto.randomUUID();

  if (crypto.getRandomValues) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return [...bytes]
      .map((byte, index) =>
        [4, 6, 8, 10].includes(index)
          ? `-${byte.toString(16).padStart(2, "0")}`
          : byte.toString(16).padStart(2, "0"),
      )
      .join("")
      .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
  }

  return "00000000-0000-4000-8000-000000000000";
}

const savedConversationId = localStorage.getItem("active_chat_id");
function isValidConversationId(value) {
  return Boolean(
    value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    ),
  );
}
let currentConversationId = isValidConversationId(savedConversationId)
  ? savedConversationId
  : createConversationId();
storageSet("active_chat_id", currentConversationId);

let recognition = null;
let isListening = false;
let silenceTimer;
let voiceTranscript = "";
let currentAbortController = null;

// TTS Queue State & Master Toggle
let speechQueue = [];
let isSpeaking = false;
let ttsEnabled = false;

const isMobileVoice =
  /Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(navigator.userAgent || "") ||
  (window.matchMedia && window.matchMedia("(pointer: coarse)").matches);

function voiceSupported() {
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

function setupVoiceRecognition() {
  if (!voiceSupported()) return;
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SpeechRecognition();
  // Mobile Chrome handles single-utterance mode far better than continuous.
  recognition.continuous = !isMobileVoice;
  recognition.interimResults = !isMobileVoice;
  recognition.maxAlternatives = 1;
  recognition.lang = "en-US";

  recognition.onstart = () => {
    isListening = true;
    voiceTranscript = "";
    if (micBtn) {
      micBtn.classList.add("recording");
      micBtn.setAttribute("aria-pressed", "true");
    }
    showComposerToast(isMobileVoice ? "Listening… speak now" : "Listening…");
  };

  recognition.onend = () => {
    isListening = false;
    clearTimeout(silenceTimer);
    if (micBtn) {
      micBtn.classList.remove("recording");
      micBtn.setAttribute("aria-pressed", "false");
    }
    autoGrowComposer();
    if (userInput.value.trim()) sendMessage();
    maybeResumeWake();
  };

  recognition.onerror = (event) => {
    isListening = false;
    clearTimeout(silenceTimer);
    if (micBtn) {
      micBtn.classList.remove("recording");
      micBtn.setAttribute("aria-pressed", "false");
    }
    const kind = event?.error || "unknown";
    if (kind === "not-allowed" || kind === "service-not-allowed") {
      showComposerToast("Mic blocked — allow microphone access");
    } else if (kind === "no-speech") {
      showComposerToast("Didn't catch that — try again");
    } else if (kind === "audio-capture") {
      showComposerToast("No microphone found");
    } else if (kind !== "aborted") {
      showComposerToast("Voice input failed — try again");
    }
  };

  recognition.onresult = (event) => {
    let currentTranscript = "";
    for (let i = 0; i < event.results.length; ++i) {
      currentTranscript += event.results[i][0].transcript;
    }

    if (currentTranscript.trim()) {
      currentTranscript = currentTranscript.replace(
        /\b(niko|miko|neeko|neko)\b/gi,
        "Nico",
      );
      userInput.value = currentTranscript;
      voiceTranscript = currentTranscript;
      autoGrowComposer();

      clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => {
        try {
          recognition.stop();
        } catch {}
      }, 1200);
    }
  };
}

setupVoiceRecognition();

function toggleSpeech() {
  if (!voiceSupported() || !recognition) {
    showComposerToast("Voice input needs Chrome or Edge");
    return;
  }
  if (!window.isSecureContext) {
    showComposerToast("Voice input needs HTTPS or localhost");
    return;
  }
  if (isListening) {
    clearTimeout(silenceTimer);
    try {
      recognition.stop();
    } catch {}
    return;
  }
  try {
    userInput.value = "";
    voiceTranscript = "";
    autoGrowComposer();
    recognition.start();
  } catch (error) {
    isListening = false;
    if (micBtn) micBtn.classList.remove("recording");
    showComposerToast("Voice input failed — try again");
  }
}

if (micBtn) {
  if (!voiceSupported()) {
    micBtn.title = "Voice input needs Chrome or Edge";
    micBtn.setAttribute("aria-label", "Voice input (needs Chrome or Edge)");
  }
  micBtn.onclick = toggleSpeech;
}

function getAttachMenu() {
  return document.getElementById("addFilesDropdown");
}

function getAddBtn() {
  return document.getElementById("addBtn");
}

function setAttachMenu(open) {
  const menu = getAttachMenu();
  const btn = getAddBtn();
  if (!menu || !btn) {
    showComposerToast("Attach menu unavailable — hard-refresh the page");
    return false;
  }
  menu.classList.toggle("open", open);
  // Inline display backs up the stylesheet: even a stale cached CSS file
  // without the .open rule can't keep the bubble hidden.
  menu.style.display = open ? "flex" : "";
  menu.setAttribute("aria-hidden", String(!open));
  btn.setAttribute("aria-expanded", String(open));
  return true;
}

function closeAttachMenu() {
  const menu = getAttachMenu();
  if (!menu) return;
  menu.classList.remove("open");
  menu.style.display = "";
  menu.setAttribute("aria-hidden", "true");
  getAddBtn()?.setAttribute("aria-expanded", "false");
}

document.addEventListener("click", (event) => {
  if (
    !event.target.closest("#addBtn") &&
    !event.target.closest("#addFilesDropdown")
  ) {
    closeAttachMenu();
  }
});

if (addBtn) {
  addBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    const menu = getAttachMenu();
    setAttachMenu(!(menu && menu.classList.contains("open")));
  });
}

function clearSelectedAttachments() {
  selectedAttachments.forEach((a) => {
    if (a?.previewUrl) {
      try { URL.revokeObjectURL(a.previewUrl); } catch {}
    }
  });
  selectedAttachments = [];
  renderAttachments();
}

function renderAttachments() {
  if (!attachmentList) return;
  attachmentList.innerHTML = "";
  attachmentList.classList.toggle("has-items", selectedAttachments.length > 0);
  selectedAttachments.forEach((attachment, index) => {
    const isImage = isImageFile(attachment.file);
    const chip = document.createElement("div");
    chip.className = "attachment-chip";
    if (isImage) chip.classList.add("is-image");

    if (isImage && attachment.previewUrl) {
      const preview = document.createElement("img");
      preview.className = "attachment-thumb";
      preview.src = attachment.previewUrl;
      preview.alt = attachment.file.name || "Attached image";
      chip.appendChild(preview);
    }

    const meta = document.createElement("span");
    meta.className = "attachment-meta";
    const nameSpan = document.createElement("span");
    nameSpan.className = "attachment-name";
    nameSpan.title = attachment.file.name;
    nameSpan.textContent = attachment.file.name;
    meta.appendChild(nameSpan);
    if (attachment.file.size) {
      const sizeSpan = document.createElement("span");
      sizeSpan.className = "attachment-size";
      const kb = attachment.file.size / 1024;
      sizeSpan.textContent = kb > 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(kb))} KB`;
      meta.appendChild(sizeSpan);
    }
    chip.appendChild(meta);

    const removeButton = document.createElement("button");
    removeButton.className = "attachment-remove";
    removeButton.type = "button";
    removeButton.setAttribute("aria-label", `Remove ${attachment.file.name}`);
    removeButton.textContent = "×";
    removeButton.addEventListener("click", () => {
      const [removed] = selectedAttachments.splice(index, 1);
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      renderAttachments();
      userInput?.focus();
    });

    chip.appendChild(removeButton);
    attachmentList.appendChild(chip);
  });
}

function selectFiles(kind) {
  filePickers[kind]?.click();
  closeAttachMenu();
}

function isImageFile(file) {
  const mime = (file?.type || "").toLowerCase();
  if (mime.startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|webp|bmp|svg|avif|ico|heic|heif)$/i.test(file?.name || "");
}

function addSelectedFiles(kind, event) {
  const files = Array.from(event.target.files || []);
  event.target.value = "";
  if (files.length === 0) return;
  // Images go through the shared pipeline (HEIC conversion, previews).
  const images = files.filter((file) => isImageFile(file));
  const others = files.filter((file) => !isImageFile(file));
  if (images.length) addImageAttachments(images);
  const icon = kind === "code" ? "⌘" : "📄";
  let added = 0;
  others.forEach((file) => {
    if (selectedAttachments.length >= 10) return;
    if (
      !selectedAttachments.some(
        (attachment) =>
          attachment.file.name === file.name &&
          attachment.file.size === file.size,
      )
    ) {
      selectedAttachments.push({ file, kind, icon, previewUrl: null });
      added += 1;
    }
  });
  if (others.length) renderAttachments();
  if (added > 0 && images.length === 0) showComposerToast(added === 1 ? "File attached" : `${added} files attached`);
}

function getPastedImageExtension(mimeType) {
  const extension = (mimeType || "").split("/")[1]?.split(";")[0]?.toLowerCase();
  return extension === "jpeg" ? "jpg" : extension || "png";
}

function showComposerToast(text) {
  const toast = document.getElementById("composerToast");
  if (!toast) return;
  toast.textContent = text;
  toast.classList.add("show");
  clearTimeout(showComposerToast._t);
  showComposerToast._t = setTimeout(() => toast.classList.remove("show"), 2200);
}

function autoGrowComposer() {
  if (!userInput) return;
  userInput.style.height = "auto";
  userInput.style.height = Math.min(userInput.scrollHeight, 160) + "px";
}

function isHeicFile(file) {
  const mime = (file?.type || "").toLowerCase();
  if (
    mime === "image/heic" ||
    mime === "image/heif" ||
    mime === "image/heic-sequence" ||
    mime === "image/heif-sequence"
  ) {
    return true;
  }
  return /\.(heic|heif)$/i.test(file?.name || "");
}

async function convertHeicToJpeg(file) {
  if (!window.heic2any) return null;
  try {
    const out = await window.heic2any({
      blob: file,
      toType: "image/jpeg",
      quality: 0.85,
    });
    const blob = Array.isArray(out) ? out[0] : out;
    if (!blob) return null;
    const base = (file.name || "photo").replace(/\.(heic|heif)$/i, "") || "photo";
    return new File([blob], `${base}.jpg`, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } catch (error) {
    console.warn("HEIC conversion failed:", error);
    return null;
  }
}

async function addImageAttachments(imageFiles) {
  let added = 0;
  let index = 0;
  for (let file of imageFiles) {
    index += 1;
    if (!file) continue;
    if (selectedAttachments.length >= 10) {
      showComposerToast("Max 10 attachments");
      break;
    }
    if (file.size && file.size > 12 * 1024 * 1024) {
      showComposerToast(`${file.name || "Image"} is too large (12MB max)`);
      continue;
    }
    // iPhone photos arrive as HEIC, which browsers can't preview and vision
    // APIs often reject — convert to JPEG so preview and analysis both work.
    if (isHeicFile(file)) {
      showComposerToast("Converting iPhone photo…");
      const converted = await convertHeicToJpeg(file);
      if (converted) {
        file = converted;
      } else {
        showComposerToast("Couldn't convert — sending original");
      }
    }
    const extension = getPastedImageExtension(file.type);
    const baseName = (file.name && !file.name.startsWith("image.") && !file.name.startsWith("blob"))
      ? file.name
      : `pasted-image-${Date.now()}-${index}.${extension}`;
    const pastedFile = file instanceof File
      ? file
      : new File([file], baseName, {
        type: file.type || "image/png",
        lastModified: Date.now(),
      });

    selectedAttachments.push({
      file: pastedFile,
      kind: "images",
      icon: "🖼️",
      previewUrl: URL.createObjectURL(pastedFile),
    });
    added += 1;
  }

  renderAttachments();
  autoGrowComposer();
  if (added > 0) {
    showComposerToast(added === 1 ? "Image attached — press Send" : `${added} images attached`);
    userInput?.focus();
  }
}

function getClipboardImageFiles(clipboard) {
  if (!clipboard) return [];
  const clipboardItems = Array.from(clipboard?.items || []);
  const itemImages = clipboardItems
    .filter((item) => item.kind === "file" && (item.type || "").startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter(Boolean);
  const fileImages = Array.from(clipboard?.files || []).filter((file) =>
    (file.type || "").startsWith("image/"),
  );
  return itemImages.length > 0 ? itemImages : fileImages;
}

function isEditableTarget(target) {
  if (!target || !target.closest) return false;
  return Boolean(
    target.closest(
      "#authScreen, #settingsPanel, .settings-panel, input:not(#userInput), textarea:not(#userInput)",
    ),
  );
}

function addPastedImages(event) {
  const imageFiles = getClipboardImageFiles(event.clipboardData);
  if (imageFiles.length === 0) return;
  // Don't hijack pastes in auth / settings fields
  if (isEditableTarget(event.target)) return;

  event.preventDefault();
  event.stopPropagation();
  addImageAttachments(imageFiles);
}

function addDroppedFiles(dataTransfer) {
  if (!dataTransfer) return false;
  const files = Array.from(dataTransfer.files || []);
  if (files.length === 0) return false;
  const images = files.filter((f) => (f.type || "").startsWith("image/"));
  const others = files.filter((f) => !(f.type || "").startsWith("image/"));
  if (images.length) addImageAttachments(images);
  others.forEach((file) => {
    if (selectedAttachments.length >= 10) return;
    selectedAttachments.push({
      file,
      kind: /\.(c|cpp|css|html?|java|js|json|jsx|md|py|sql|ts|tsx|txt|xml|ya?ml)$/i.test(file.name) || (file.type || "").startsWith("text/")
        ? "code"
        : "files",
      icon: "📄",
      previewUrl: null,
    });
  });
  if (others.length) renderAttachments();
  return images.length > 0 || others.length > 0;
}

function initComposerDragDrop() {
  const pill = document.getElementById("inputPill");
  const overlay = document.getElementById("dropOverlay");
  if (!pill) return;
  let dragDepth = 0;
  ["dragenter", "dragover"].forEach((name) =>
    pill.addEventListener(name, (e) => {
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes("Files")) return;
      e.preventDefault();
      dragDepth += 1;
      pill.classList.add("drag-over");
      if (overlay) overlay.setAttribute("aria-hidden", "false");
    }),
  );
  ["dragleave", "drop"].forEach((name) =>
    pill.addEventListener(name, (e) => {
      if (name === "dragleave") dragDepth = Math.max(0, dragDepth - 1);
      else dragDepth = 0;
      if (dragDepth === 0) {
        pill.classList.remove("drag-over");
        if (overlay) overlay.setAttribute("aria-hidden", "true");
      }
      if (name === "drop") {
        e.preventDefault();
        if (addDroppedFiles(e.dataTransfer)) showComposerToast("Files attached");
      }
    }),
  );
}

document
  .getElementById("addFilesBtn")
  ?.addEventListener("click", () => selectFiles("files"));
document
  .getElementById("addImagesBtn")
  ?.addEventListener("click", () => selectFiles("images"));
document
  .getElementById("pasteImageBtn")
  ?.addEventListener("click", async () => {
    closeAttachMenu();

    if (!navigator.clipboard?.read) {
      alert(
        "Image paste is not supported by this browser. Use the chat input paste action instead.",
      );
      return;
    }

    try {
      const clipboardItems = await navigator.clipboard.read();
      const imageFiles = [];
      for (const clipboardItem of clipboardItems) {
        const imageType = clipboardItem.types.find((type) =>
          type.startsWith("image/"),
        );
        if (!imageType) continue;
        const blob = await clipboardItem.getType(imageType);
        imageFiles.push(blob);
      }

      if (imageFiles.length === 0) {
        alert("No image was found in the clipboard.");
        return;
      }
      addImageAttachments(imageFiles);
    } catch (error) {
      console.error("Could not read an image from the clipboard:", error);
      alert(
        "Clipboard access was blocked. Paste the image into the chat input instead.",
      );
    }
  });
document
  .getElementById("addCodeBtn")
  ?.addEventListener("click", () => selectFiles("code"));
Object.entries(filePickers).forEach(([kind, picker]) => {
  picker?.addEventListener("change", (event) => addSelectedFiles(kind, event));
});

function readImageDataUrl(file, maxDim = 1568, quality = 0.85) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      try {
        const tooBig =
          image.width > maxDim ||
          image.height > maxDim ||
          (file.size || 0) > 1500 * 1024;
        // Keep GIFs untouched so animation survives.
        if (!tooBig || (file.type || "").toLowerCase() === "image/gif") {
          URL.revokeObjectURL(url);
          readFileAsDataUrl(file).then(resolve);
          return;
        }
        const scale = Math.min(1, maxDim / image.width, maxDim / image.height);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve({ dataUrl: canvas.toDataURL("image/jpeg", quality), converted: true });
      } catch {
        URL.revokeObjectURL(url);
        readFileAsDataUrl(file).then((dataUrl) => resolve({ dataUrl, converted: false }));
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      readFileAsDataUrl(file).then((dataUrl) => resolve({ dataUrl, converted: false }));
    };
    image.src = url;
  });
}

async function buildMessageWithAttachments(message) {
  if (selectedAttachments.length === 0) {
    return { message, displayMessage: message, attachments: [], failed: false };
  }
  const attachmentContext = [];
  const attachments = [];
  for (const attachment of selectedAttachments) {
    // Any image counts as an image no matter which picker added it, so a
    // JPG via "Upload files" never degrades to an "[Attached binary file]" note.
    if (isImageFile(attachment.file)) {
      const { dataUrl, converted } = await readImageDataUrl(attachment.file);
      attachments.push({
        name: attachment.file.name,
        mime_type: converted
          ? "image/jpeg"
          : attachment.file.type || "image/*",
        data_url: dataUrl,
      });
      continue;
    }

    if (isTextAttachment(attachment.file)) {
      try {
        const text = await attachment.file.text();
        const truncatedText =
          text.length > 12000
            ? `${text.slice(0, 12000)}\n[File truncated]`
            : text;
        attachmentContext.push(
          `Attached file: ${attachment.file.name}\n\`\`\`\n${truncatedText}\n\`\`\``,
        );
      } catch {
        attachmentContext.push(
          `[Could not read file: ${attachment.file.name}]`,
        );
      }
      continue;
    }

    const dataUrl = await readFileAsDataUrl(attachment.file);
    attachments.push({
      name: attachment.file.name,
      mime_type: attachment.file.type || "application/octet-stream",
      data_url: dataUrl,
    });
    attachmentContext.push(`[Attached binary file: ${attachment.file.name}]`);
  }
  const failed =
    selectedAttachments.length > 0 &&
    attachments.length === 0 &&
    attachmentContext.length === 0;
  return {
    message: `${message}\n\n${attachmentContext.join("\n\n")}`.trim(),
    displayMessage: message,
    attachments,
    failed,
  };
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function isTextAttachment(file) {
  return (
    file.type.startsWith("text/") ||
    /\.(c|cpp|css|html?|java|js|json|jsx|md|py|sql|ts|tsx|txt|xml|ya?ml)$/i.test(
      file.name,
    )
  );
}

/* Event-driven TTS Queueing - Updated to speak introductory text before code blocks */
function queueSentence(text) {
  if (!ttsEnabled || !("speechSynthesis" in window)) return;

  // Only strip markdown formatting symbols, but keep introductory text and explanations readable
  const cleanText = text
    .replace(/<[^>]*>/g, "")
    .replace(/```[\s\S]*?```/g, " Here is the code block.") // Speak a spoken cue instead of silently dropping or reading raw code
    .replace(/[\*\_`#]/g, "")
    .trim();

  if (!cleanText) return;

  speechQueue.push(cleanText);
  processSpeechQueue();
}

function processSpeechQueue() {
  if (isSpeaking || speechQueue.length === 0) return;

  isSpeaking = true;
  const textToSpeak = speechQueue.shift();
  const utterance = new SpeechSynthesisUtterance(textToSpeak);

  utterance.rate = 1.0;
  utterance.pitch = 1.0;

  const voices = window.speechSynthesis.getVoices();
  const preferredVoice =
    voices.find(
      (v) =>
        v.lang.includes("en") &&
        (v.name.includes("Natural") || v.name.includes("Google")),
    ) || voices[0];

  if (preferredVoice) utterance.voice = preferredVoice;

  utterance.onend = () => {
    isSpeaking = false;
    processSpeechQueue();
  };

  utterance.onerror = () => {
    isSpeaking = false;
    processSpeechQueue();
  };

  window.speechSynthesis.speak(utterance);
}

function stopSpeech() {
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
  speechQueue = [];
  isSpeaking = false;
}

function getAssistantThinkingLabel() {
  if (settings.personality === "mica") return "Mica is thinking...";
  if (settings.personality === "brainrot") return "Brainrot is compiling...";
  if (settings.personality === "developer")
    return "Developer mode is active...";
  return "Nico is thinking...";
}

function ensureTypingIndicator() {
  let indicator = document.getElementById("typingIndicator");
  if (!indicator) {
    indicator = document.createElement("div");
    indicator.id = "typingIndicator";
    indicator.className = "message assistant thinking-indicator";
    indicator.innerText = getAssistantThinkingLabel();
    chatBox.appendChild(indicator);
  }
  indicator.innerText = getAssistantThinkingLabel();
  // The bubble may only ever show during a live send (setResponsePhase
  // "thinking"). History renders, refreshes and chat switches keep it hidden.
  setThinkingIndicator(indicator, false);
}

function setThinkingIndicator(indicator, visible) {
  if (!indicator) return;
  indicator.innerText = getAssistantThinkingLabel();
  indicator.classList.toggle("is-visible", visible);
  indicator.style.display = visible ? "block" : "none";
  indicator.setAttribute("aria-hidden", String(!visible));
}

function setResponsePhase(indicator, contentDiv, phase) {
  const isThinking = phase === "thinking";
  setThinkingIndicator(indicator, isThinking);
  if (contentDiv) {
    contentDiv.style.visibility = isThinking ? "hidden" : "visible";
  }
}

function startTypewriterReveal(
  contentDiv,
  getLatestText,
  isStreamComplete,
  onComplete,
) {
  if (!contentDiv) return;

  let displayedText = "";
  let writerTimer = null;
  let animationFrame = null;
  let lastFrameTime = 0;
  contentDiv.style.visibility = "hidden";

  const renderNextFrame = (timestamp) => {
    const latestText = getLatestText() || "";

    if (!latestText) {
      animationFrame = requestAnimationFrame(renderNextFrame);
      return;
    }

    if (!lastFrameTime) lastFrameTime = timestamp;
    const elapsed = timestamp - lastFrameTime;
    if (elapsed < 16) {
      animationFrame = requestAnimationFrame(renderNextFrame);
      return;
    }

    lastFrameTime = timestamp;
    if (latestText.length <= displayedText.length && !isStreamComplete()) {
      animationFrame = requestAnimationFrame(renderNextFrame);
      return;
    }

    if (latestText.length <= displayedText.length) {
      contentDiv.innerHTML = renderMarkdown(latestText);
      contentDiv.style.visibility = "visible";
      attachCodeCopyButtons(contentDiv.closest(".message"));
      if (typeof onComplete === "function") onComplete();
      return;
    }

    const charactersToReveal = Math.max(1, Math.round(elapsed * 0.035));
    displayedText = latestText.slice(
      0,
      Math.min(latestText.length, displayedText.length + charactersToReveal),
    );
    contentDiv.textContent = displayedText;
    contentDiv.style.visibility = "visible";
    chatBox.scrollTop = chatBox.scrollHeight;
    animationFrame = requestAnimationFrame(renderNextFrame);
  };

  writerTimer = setTimeout(() => {
    animationFrame = requestAnimationFrame(renderNextFrame);
  }, 1200);

  return () => {
    if (writerTimer) clearTimeout(writerTimer);
    if (animationFrame) cancelAnimationFrame(animationFrame);
  };
}

function renderMarkdown(text) {
  if (typeof marked === "undefined") return escapeHtml(text);
  const rendered = marked.parse(text);
  return typeof DOMPurify !== "undefined"
    ? DOMPurify.sanitize(rendered)
    : escapeHtml(text);
}

function escapeHtml(text) {
  const element = document.createElement("div");
  element.textContent = text;
  return element.innerHTML;
}

function attachCodeCopyButtons(messageDiv) {
  messageDiv.querySelectorAll("pre").forEach((pre) => {
    if (pre.parentNode.classList.contains("code-container")) return;
    const container = document.createElement("div");
    container.className = "code-container";
    pre.parentNode.insertBefore(container, pre);
    container.appendChild(pre);

    const copyBtn = document.createElement("button");
    copyBtn.className = "copy-code-btn";
    copyBtn.innerText = "Copy";
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(pre.innerText);
      copyBtn.innerText = "Copied!";
      setTimeout(() => (copyBtn.innerText = "Copy"), 2000);
    };
    container.appendChild(copyBtn);
  });
}

function timeAgo(timestamp) {
  const diff = Date.now() - timestamp;
  if (diff < 45 * 1000) return "just now";
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins === 1) return "1 minute ago";
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.floor(mins / 60);
  if (hours === 1) return "1 hour ago";
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

function refreshTimestamps() {
  document.querySelectorAll(".msg-timestamp").forEach((el) => {
    const ts = Number(el.dataset.timestamp || 0);
    if (ts) el.textContent = timeAgo(ts);
  });
}
setInterval(refreshTimestamps, 30000);

function speakText(text) {
  if (!("speechSynthesis" in window)) {
    showComposerToast("Voice playback not supported");
    return;
  }
  window.speechSynthesis.cancel();
  const clean = (text || "").replace(/<[^>]*>/g, "").slice(0, 2000);
  if (!clean.trim()) return;
  const utterance = new SpeechSynthesisUtterance(clean);
  utterance.rate = 1;
  window.speechSynthesis.speak(utterance);
}

function getLastUserText() {
  const users = Array.from(chatBox.querySelectorAll(".message.user .content"));
  if (!users.length) return "";
  // Strip image alts - content includes text + images; use dataset raw if present
  const last = users[users.length - 1].closest(".message");
  return last?.dataset?.raw || users[users.length - 1].innerText || "";
}

async function streamAssistantResponse(apiMessage, apiAttachments = []) {
  ensureTypingIndicator();
  const indicator = document.getElementById("typingIndicator");
  if (indicator) {
    setResponsePhase(indicator, null, "thinking");
    chatBox.appendChild(indicator);
  }
  chatBox.scrollTop = chatBox.scrollHeight;
  if (sendBtn) {
    sendBtn.innerText = "Stop";
    sendBtn.onclick = stopGeneration;
  }
  currentAbortController = new AbortController();
  const assistantMsgDiv = document.createElement("div");
  assistantMsgDiv.className = "message assistant";
  assistantMsgDiv.innerHTML = `<span class="avatar-tag">${settings.avatar}</span><div class="content"></div>`;
  const contentDiv = assistantMsgDiv.querySelector(".content");
  contentDiv.style.visibility = "hidden";
  if (indicator) chatBox.insertBefore(assistantMsgDiv, indicator);
  else chatBox.appendChild(assistantMsgDiv);
  let accumulatedText = "";
  let sentenceBuffer = "";
  let typingStarted = false;
  let streamComplete = false;
  let typewriterCleanup = null;
  let typingDelayTimer = null;
  try {
    const response = await apiFetch(`${apiBaseUrl}/chat/stream`, {
      allowGuest: true,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: currentAbortController.signal,
      body: JSON.stringify({
        message: apiMessage,
        conversation_id: currentConversationId,
        attachments: apiAttachments,
        settings,
      }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || `Request failed with status ${response.status}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const triggerTypingFlow = () => {
      if (typingStarted) return;
      typingStarted = true;
      if (typingDelayTimer) {
        clearTimeout(typingDelayTimer);
        typingDelayTimer = null;
      }
      setResponsePhase(indicator, contentDiv, "typing");
      indicator?.remove();
      typewriterCleanup = startTypewriterReveal(
        contentDiv,
        () => accumulatedText,
        () => streamComplete,
        () => {
          attachCodeCopyButtons(assistantMsgDiv);
          attachMessageFooter(assistantMsgDiv, "assistant", accumulatedText);
          chatBox.scrollTop = chatBox.scrollHeight;
        },
      );
      setTimeout(() => {
        if (!assistantMsgDiv.querySelector(":scope > .msg-actions") && accumulatedText) {
          attachMessageFooter(assistantMsgDiv, "assistant", accumulatedText);
        }
      }, 4000);
    };
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      accumulatedText += chunk;
      sentenceBuffer += chunk;
      chatBox.scrollTop = chatBox.scrollHeight;
      let match;
      const sentenceRegex = /([^.!?\n]+[.!?\n]+)/g;
      while ((match = sentenceRegex.exec(sentenceBuffer)) !== null) {
        const sentence = match[0];
        queueSentence(sentence);
        sentenceBuffer = sentenceBuffer.slice(match.index + sentence.length);
        sentenceRegex.lastIndex = 0;
      }
    }
    if (sentenceBuffer.trim()) queueSentence(sentenceBuffer);
    streamComplete = true;
    typingDelayTimer = setTimeout(triggerTypingFlow, 1400);
    if (!authClient && currentUser) {
      appendLocalConversationMessage(currentConversationId, "assistant", accumulatedText);
      upsertLocalConversation({ id: currentConversationId, title: "Untitled Chat", user_id: currentUser.id });
    }
    if (settings.sound) playCompletionChime();
    loadRecentConversations();
  } catch (error) {
    if (typingDelayTimer) {
      clearTimeout(typingDelayTimer);
      typingDelayTimer = null;
    }
    if (typewriterCleanup) typewriterCleanup();
    setResponsePhase(indicator, contentDiv, "error");
    indicator?.remove();
    if (error.name === "AbortError") {
      contentDiv.innerHTML += " <i>[Generation stopped]</i>";
      contentDiv.style.visibility = "visible";
      attachMessageFooter(assistantMsgDiv, "assistant", accumulatedText || "[stopped]");
    } else {
      contentDiv.innerText = `Error: ${error.message || "Could not connect to Nico backend."}`;
      contentDiv.style.visibility = "visible";
      attachMessageFooter(assistantMsgDiv, "assistant", contentDiv.innerText);
    }
  } finally {
    currentAbortController = null;
    resetSendButton();
  }
}

async function retryLastMessage() {
  const lastUserText = getLastUserText();
  if (!lastUserText && selectedAttachments.length === 0) {
    showComposerToast("Nothing to retry yet");
    return;
  }
  // Claude-style regenerate: remove last assistant reply, do NOT duplicate user bubble
  const allMsgs = Array.from(chatBox.querySelectorAll(".message"));
  const userMsgs = allMsgs.filter((m) => m.classList.contains("user"));
  const lastUser = userMsgs[userMsgs.length - 1];
  if (lastUser) {
    const lastUserIdx = allMsgs.indexOf(lastUser);
    for (let i = allMsgs.length - 1; i > lastUserIdx; i -= 1) {
      if (allMsgs[i].classList.contains("assistant") && !allMsgs[i].classList.contains("thinking-indicator")) {
        allMsgs[i].remove();
        break;
      }
    }
    const retryText = lastUser.dataset?.raw || lastUser.querySelector(".content")?.innerText || lastUserText;
    const retryImgs = Array.from(lastUser.querySelectorAll("img.message-image-preview"))
      .map((img) => ({ name: img.alt || "attached-image.jpg", mime_type: "image/jpeg", data_url: img.src }))
      .filter((a) => a.data_url && a.data_url.startsWith("data:"));
    showComposerToast("Regenerating…");
    await streamAssistantResponse(retryText, retryImgs);
    return;
  }
  userInput.value = lastUserText;
  autoGrowComposer();
  await sendMessage();
}

function attachMessageFooter(msgDiv, role, rawText) {
  if (msgDiv.querySelector(":scope > .msg-actions")) return;
  const timestamp = Date.now();
  msgDiv.dataset.timestamp = String(timestamp);
  msgDiv.dataset.raw = (rawText || "").slice(0, 8000);
  msgDiv.dataset.role = role;

  const bar = document.createElement("div");
  bar.className = "msg-actions";
  bar.setAttribute("aria-label", "Message actions");

  const mkBtn = (label, title, svg, fn, extraClass = "") => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `msg-action-btn ${extraClass}`.trim();
    b.title = title;
    b.setAttribute("aria-label", label);
    b.innerHTML = svg;
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      fn(b);
    });
    return b;
  };

  const ICONS = {
    copy: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>',
    speak: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>',
    good: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/></svg>',
    bad: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"/></svg>',
    retry: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
    edit: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>',
  };

  const contentEl = msgDiv.querySelector(".content");
  const getText = () => contentEl?.innerText || msgDiv.dataset.raw || "";

  bar.appendChild(
    mkBtn("Copy", "Copy", ICONS.copy, (btn) => {
      navigator.clipboard.writeText(getText()).then(() => {
        btn.classList.add("done");
        setTimeout(() => btn.classList.remove("done"), 1200);
      });
    }),
  );

  if (role === "assistant") {
    bar.appendChild(mkBtn("Read aloud", "Read aloud", ICONS.speak, () => speakText(getText())));
    const goodBtn = mkBtn("Good response", "Good response", ICONS.good, (btn) => {
      const active = btn.classList.toggle("active");
      badBtn.classList.remove("active");
      try { localStorage.setItem(`nico_feedback:${msgDiv.dataset.timestamp}`, active ? "up" : ""); } catch {}
    });
    const badBtn = mkBtn("Bad response", "Bad response", ICONS.bad, (btn) => {
      const active = btn.classList.toggle("active");
      goodBtn.classList.remove("active");
      try { localStorage.setItem(`nico_feedback:${msgDiv.dataset.timestamp}`, active ? "down" : ""); } catch {}
    });
    bar.append(goodBtn, badBtn);
    bar.appendChild(mkBtn("Retry", "Retry", ICONS.retry, () => retryLastMessage()));
  } else {
    bar.appendChild(
      mkBtn("Edit and resend", "Edit and resend", ICONS.edit, () => {
        userInput.value = getText();
        autoGrowComposer();
        userInput.focus();
      }),
    );
  }

  const time = document.createElement("span");
  time.className = "msg-timestamp";
  time.dataset.timestamp = String(timestamp);
  time.textContent = "just now";
  bar.appendChild(time);

  msgDiv.appendChild(bar);
}

function appendMessage(role, text, attachments = []) {
  // Update state for non-empty chats
  appLayout?.classList.remove("new-chat-mode");
  appLayout?.classList.add("active-chat-mode");

  const msgDiv = document.createElement("div");
  msgDiv.className = `message ${role}`;
  let footerText = text;

  if (role === "assistant") {
    msgDiv.innerHTML = `<span class="avatar-tag"></span><div class="content">${renderMarkdown(text)}</div>`;
    msgDiv.querySelector(".avatar-tag").textContent = settings.avatar;
    attachCodeCopyButtons(msgDiv);
  } else {
    const content = document.createElement("div");
    content.className = "content";
    content.textContent = text;
    const renderedImages = attachments.filter((attachment) =>
      (attachment.mime_type || "").startsWith("image/"),
    );
    renderedImages.forEach((attachment) => {
      const image = document.createElement("img");
      image.className = "message-image-preview";
      image.src = attachment.data_url;
      image.alt = attachment.name || "Attached image";
      image.loading = "lazy";
      // Never show a raw-filename box: unreadable bytes (e.g. HEIC photos
      // browsers can't decode) become a labeled placeholder instead.
      image.onerror = () => {
        const note = document.createElement("div");
        note.className = "message-image-unavailable";
        note.textContent = `🖼 ${attachment.name || "Attached image"} (preview unavailable — Nico still received the file)`;
        image.replaceWith(note);
      };
      content.appendChild(image);
    });
    // Heal old messages saved as "[Attached binary file: photo.jpg]" when the
    // image itself is available: drop the stale marker line for each rendered
    // image so history shows the picture instead of the placeholder text.
    if (renderedImages.length > 0) {
      const names = new Set(
        renderedImages.map((attachment) => attachment.name).filter(Boolean),
      );
      const cleaned = String(content.firstChild?.textContent ?? text)
        .split("\n")
        .filter((line) => {
          const marker = line.match(/^\[Attached binary file:\s*(.+?)\]$/);
          return !marker || !names.has(marker[1].trim());
        })
        .join("\n")
        .trim();
      if (content.firstChild) content.firstChild.textContent = cleaned;
      footerText = cleaned;
    }
    msgDiv.appendChild(content);
  }

  attachMessageFooter(msgDiv, role, footerText);

  ensureTypingIndicator();
  const indicator = document.getElementById("typingIndicator");
  if (indicator) {
    chatBox.insertBefore(msgDiv, indicator);
  } else {
    chatBox.appendChild(msgDiv);
  }

  chatBox.scrollTop = chatBox.scrollHeight;
}

function clearChatBox() {
  chatBox.innerHTML = "";
  appLayout?.classList.add("new-chat-mode");
  appLayout?.classList.remove("active-chat-mode");
  ensureTypingIndicator();
}

function focusInput() {
  if (userInput) userInput.focus();
}

function startNewChat() {
  stopSpeech();
  currentConversationId = createConversationId();
  persistCurrentConversationId();
  clearChatBox();
  loadRecentConversations();
  focusInput();
}

async function switchConversation(id) {
  stopSpeech();
  currentConversationId = id;
  persistCurrentConversationId();
  document.querySelectorAll(".recent-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.conversationId === id);
  });
  clearChatBox();
  appLayout?.classList.add("conversation-loading");
  await loadMessages();
  appLayout?.classList.remove("conversation-loading");
  focusInput();
}

async function renameConversation(id, oldTitle, e) {
  e.stopPropagation();
  const newTitle = prompt("Enter new title:", oldTitle);
  if (!newTitle || newTitle.trim() === "") return;

  const nextTitle = newTitle.trim();

  if (!authClient && currentUser) {
    const list = readLocalConversationList();
    const updated = list.map((conv) =>
      conv.id === id
        ? { ...conv, title: nextTitle, updated_at: new Date().toISOString() }
        : conv,
    );
    writeLocalConversationList(updated);
    loadRecentConversations();
    return;
  }

  try {
    await apiFetch(`${apiBaseUrl}/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: nextTitle }),
    });
    loadRecentConversations();
  } catch (err) {
    console.error("Failed to rename conversation:", err);
  }
}

async function deleteConversation(id, e) {
  e.stopPropagation();
  if (!confirm("Delete this conversation?")) return;

  if (!authClient && currentUser) {
    const list = readLocalConversationList().filter((conv) => conv.id !== id);
    writeLocalConversationList(list);
    localStorage.removeItem(localConversationMessagesKey(id));
    if (id === currentConversationId) {
      startNewChat();
    } else {
      loadRecentConversations();
    }
    return;
  }

  try {
    await apiFetch(`${apiBaseUrl}/conversations/${id}`, {
      method: "DELETE",
    });
    if (id === currentConversationId) {
      startNewChat();
    } else {
      loadRecentConversations();
    }
  } catch (err) {
    console.error("Failed to delete conversation:", err);
  }
}

function getPinnedConversationIds() {
  try {
    return JSON.parse(localStorage.getItem("pinned_conversations") || "[]");
  } catch {
    return [];
  }
}

function setPinnedConversation(id, pinned) {
  const pinnedIds = getPinnedConversationIds().filter((value) => value !== id);
  if (pinned) pinnedIds.unshift(id);
  storageSet("pinned_conversations", JSON.stringify(pinnedIds));
  loadRecentConversations();
}

function closeConversationMenus() {
  document.querySelectorAll(".conversation-menu.is-open").forEach((menu) => {
    menu.classList.remove("is-open", "fixed");
    menu.hidden = true;
    menu.style.left = "";
    menu.style.top = "";
    menu.style.visibility = "";
    menu._trigger?.setAttribute("aria-expanded", "false");
    // Drop stale menus whose conversation row was re-rendered away.
    if (menu._home && !menu._home.isConnected) {
      menu.remove();
    } else if (menu._home && menu.parentElement !== menu._home) {
      menu._home.appendChild(menu);
    }
  });
}

function openConversationMenu(menu, trigger) {
  closeConversationMenus();
  menu._home = menu._home || trigger.parentElement;
  menu._trigger = trigger;
  // Render in <body> with viewport-fixed coords so the sidebar's
  // overflow-x clipping can never trap it underneath.
  document.body.appendChild(menu);
  menu.hidden = false;
  menu.classList.add("is-open", "fixed");
  menu.style.visibility = "hidden";
  const rect = trigger.getBoundingClientRect();
  const w = menu.offsetWidth || 200;
  const h = menu.offsetHeight || 170;
  let left = rect.right - w;
  left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
  let top = rect.bottom + 6;
  if (top + h > window.innerHeight - 8) {
    top = Math.max(8, rect.top - h - 6);
  }
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.style.visibility = "";
  trigger.setAttribute("aria-expanded", "true");
}

document.addEventListener("click", (event) => {
  if (
    !event.target.closest(".conversation-actions") &&
    !event.target.closest(".conversation-menu")
  ) {
    closeConversationMenus();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeConversationMenus();
});

document.addEventListener(
  "scroll",
  (event) => {
    if (event.target.closest && event.target.closest(".conversation-menu")) {
      return;
    }
    closeConversationMenus();
  },
  true,
);

window.addEventListener("resize", closeConversationMenus);

async function shareConversation(id, title) {
  const shareUrl = `${window.location.href.split("#")[0]}#chat=${encodeURIComponent(id)}`;
  const shareData = { title: title || "Nico conversation", url: shareUrl };

  try {
    if (navigator.share) {
      await navigator.share(shareData);
    } else {
      await navigator.clipboard.writeText(shareUrl);
      alert("Conversation link copied.");
    }
  } catch (error) {
    if (error?.name !== "AbortError") {
      console.error("Failed to share conversation:", error);
    }
  }
}

function createConversationMenu(item, conversation) {
  const actions = document.createElement("div");
  actions.className = "conversation-actions";

  const trigger = document.createElement("button");
  trigger.className = "conversation-menu-trigger";
  trigger.type = "button";
  trigger.innerText = "⋮";
  trigger.title = "Conversation actions";
  trigger.setAttribute("aria-label", "Conversation actions");
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-expanded", "false");

  const menu = document.createElement("div");
  menu.className = "conversation-menu";
  menu.hidden = true;
  menu.setAttribute("role", "menu");

  const addMenuItem = (label, icon, handler, danger = false) => {
    const button = document.createElement("button");
    button.className = `conversation-menu-item${danger ? " danger" : ""}`;
    button.type = "button";
    button.setAttribute("role", "menuitem");
    button.innerHTML = `<span class="conversation-menu-icon">${icon}</span><span>${label}</span>`;
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      closeConversationMenus();
      await handler(event);
    });
    menu.appendChild(button);
  };

  addMenuItem("Share conversation", "↗", () =>
    shareConversation(conversation.id, conversation.title),
  );
  const isPinned = getPinnedConversationIds().includes(conversation.id);
  addMenuItem(isPinned ? "Unpin" : "Pin", "⚑", () =>
    setPinnedConversation(conversation.id, !isPinned),
  );
  addMenuItem("Rename", "✎", (event) =>
    renameConversation(conversation.id, conversation.title, event),
  );
  addMenuItem(
    "Delete",
    "⌫",
    (event) => deleteConversation(conversation.id, event),
    true,
  );

  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    if (menu.classList.contains("is-open")) {
      closeConversationMenus();
    } else {
      openConversationMenu(menu, trigger);
    }
  });
  actions.addEventListener("click", (event) => event.stopPropagation());
  actions.append(trigger, menu);
  item.appendChild(actions);
}

async function loadRecentConversations() {
  const recentsList = document.getElementById("recent-chats");
  if (!recentsList) return;

  try {
    if (!authClient && !currentUser) {
      recentsList.innerHTML = "";
      return;
    }

    if (!authClient && currentUser) {
      const conversations = readLocalConversationList();
      recentsList.innerHTML = "";
      const pinnedIds = getPinnedConversationIds();
      conversations
        .slice()
        .sort(
          (left, right) =>
            pinnedIds.indexOf(right.id) - pinnedIds.indexOf(left.id),
        )
        .forEach((conv) => {
          const item = document.createElement("div");
          item.className = "recent-item";
          item.dataset.conversationId = conv.id;
          if (conv.id === currentConversationId) item.classList.add("active");

          const titleWrap = document.createElement("span");
          titleWrap.className = "recent-title-wrap";
          const titleSpan = document.createElement("span");
          titleSpan.className = "recent-title";
          titleSpan.innerText = conv.title || "Untitled Chat";
          titleWrap.appendChild(titleSpan);
          item.appendChild(titleWrap);
          createConversationMenu(item, conv);

          item.addEventListener("click", (event) => {
            if (!event.target.closest(".conversation-actions")) {
              switchConversation(conv.id);
            }
          });
          recentsList.appendChild(item);
        });
      return;
    }

    const response = await apiFetch(`${apiBaseUrl}/conversations`);
    const conversations = await response.json();
    recentsList.innerHTML = "";

    const pinnedIds = getPinnedConversationIds();
    conversations.sort(
      (left, right) => pinnedIds.indexOf(right.id) - pinnedIds.indexOf(left.id),
    );

    conversations.forEach((conv) => {
      const item = document.createElement("div");
      item.className = "recent-item";
      item.dataset.conversationId = conv.id;
      if (conv.id === currentConversationId) item.classList.add("active");

      const isPinned = pinnedIds.includes(conv.id);
      const titleWrap = document.createElement("span");
      titleWrap.className = "recent-title-wrap";
      const titleSpan = document.createElement("span");
      titleSpan.className = "recent-title";
      titleSpan.innerText = conv.title || "Untitled Chat";
      if (isPinned) {
        const pinFlag = document.createElement("span");
        pinFlag.className = "pinned-flag";
        pinFlag.innerText = "⚑";
        pinFlag.title = "Pinned conversation";
        pinFlag.setAttribute("aria-label", "Pinned conversation");
        titleWrap.appendChild(pinFlag);
      }
      titleWrap.appendChild(titleSpan);

      item.appendChild(titleWrap);
      createConversationMenu(item, conv);

      item.addEventListener("click", (event) => {
        if (!event.target.closest(".conversation-actions")) {
          switchConversation(conv.id);
        }
      });
      recentsList.appendChild(item);
    });
  } catch (err) {
    if (err?.message !== "Sign-in required") {
      console.error("Failed to render recents:", err);
    }
  }
}

async function loadMessages() {
  const loadToken = ++conversationLoadToken;
  const conversationId = currentConversationId;
  try {
    if (!authClient && currentUser) {
      const data = readLocalConversationMessages(conversationId);
      if (
        loadToken !== conversationLoadToken ||
        conversationId !== currentConversationId
      ) {
        return;
      }
      clearChatBox();
      if (Array.isArray(data)) {
        data.forEach((msg) => {
          appendMessage(msg.role, msg.content, msg.attachments || []);
        });
      }
      return;
    }

    if (!authClient) {
      clearChatBox();
      return;
    }

    const res = await apiFetch(`${apiBaseUrl}/messages/${conversationId}`);
    const data = await res.json();
    if (
      loadToken !== conversationLoadToken ||
      conversationId !== currentConversationId
    ) {
      return;
    }
    clearChatBox();
    if (Array.isArray(data)) {
      // Server-saved attachments win; the localStorage cache is only a
      // fallback for messages written before the backend stored them.
      const storedAttachments = loadConversationAttachments();
      let userMessageIndex = 0;
      data.forEach((msg) => {
        let attachments = [];
        if (Array.isArray(msg.attachments)) {
          attachments = msg.attachments;
        } else if (msg.role === "user") {
          attachments = storedAttachments[userMessageIndex++] || [];
        }
        appendMessage(msg.role, msg.content, attachments);
      });
    }
  } catch (err) {
    if (loadToken === conversationLoadToken) {
      if (err?.message !== "Sign-in required") {
        console.error("Failed to load messages:", err);
      }
      appLayout?.classList.remove("conversation-loading");
    }
  }
}

function stopGeneration() {
  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
  }
  stopSpeech();
  const indicator = document.getElementById("typingIndicator");
  setThinkingIndicator(indicator, false);
  resetSendButton();
}

function resetSendButton() {
  if (sendBtn) {
    sendBtn.innerText = "Send";
    sendBtn.onclick = sendMessage;
  }
}

if (sendBtn) {
  sendBtn.onclick = sendMessage;
}

if (userInput) {
  autoGrowComposer();
  userInput.addEventListener("input", autoGrowComposer);
  userInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      sendMessage();
    }
  });
}

// Capture-phase paste: accepts Ctrl+V images anywhere in chat except auth/settings
document.addEventListener("paste", addPastedImages, true);
initComposerDragDrop();

/* ================= Jarvis pack: reminders, memory, briefing, wake word ================= */
const REMINDER_KEY = "nico_reminders";
const reminderTimers = new Map();

function readReminders() {
  try {
    return JSON.parse(localStorage.getItem(REMINDER_KEY) || "[]");
  } catch {
    return [];
  }
}

function writeReminders(list) {
  storageSet(REMINDER_KEY, JSON.stringify(list.slice(0, 50)));
}

function fmtCountdown(ms) {
  if (ms <= 0) return "due now";
  const s = Math.round(ms / 1000);
  if (s < 60) return `in ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `in ${h}h ${m % 60}m`;
  return `in ${Math.floor(h / 24)}d`;
}

function fmtWhen(ts) {
  const diff = ts - Date.now();
  const d = new Date(ts);
  const t = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (diff < 12 * 36e5) return fmtCountdown(diff);
  const tom = new Date(Date.now() + 864e5);
  if (d.toDateString() === tom.toDateString()) return `tomorrow at ${t}`;
  if (d.toDateString() === new Date().toDateString()) return `today at ${t}`;
  return `on ${d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} at ${t}`;
}

function scheduleReminder(r) {
  clearTimeout(reminderTimers.get(r.id));
  const delay = r.dueAt - Date.now();
  if (delay <= 0) {
    fireReminder(r.id);
    return;
  }
  if (delay > 2147483647) return; // far future: the sweep catches it later
  reminderTimers.set(r.id, setTimeout(() => fireReminder(r.id), delay));
}

function scheduleAllReminders() {
  readReminders()
    .filter((r) => !r.done)
    .forEach(scheduleReminder);
  updateReminderBadge();
}

function fireReminder(id) {
  const list = readReminders();
  const r = list.find((x) => x.id === id && !x.done);
  if (!r) {
    updateReminderBadge();
    return;
  }
  r.done = true;
  r.firedAt = Date.now();
  writeReminders(list);
  scheduleAllReminders();
  playCompletionChime();
  showComposerToast(`⏰ ${r.label}`);
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("Nico reminder", { body: r.label });
    }
  } catch {}
  appendMessage("assistant", `⏰ **Reminder:** ${r.label}`, []);
  if (currentUser && !authClient) {
    appendLocalConversationMessage(currentConversationId, "assistant", `⏰ Reminder: ${r.label}`);
  }
  renderReminderPanel();
}

function addReminder(label, dueAt) {
  const list = readReminders();
  const r = {
    id: `rem-${Date.now().toString(36)}`,
    label,
    dueAt,
    done: false,
    createdAt: Date.now(),
  };
  list.push(r);
  writeReminders(list);
  scheduleReminder(r);
  updateReminderBadge();
  renderReminderPanel();
  return r;
}

function cancelReminder(id) {
  writeReminders(readReminders().filter((r) => r.id !== id));
  clearTimeout(reminderTimers.get(id));
  reminderTimers.delete(id);
  updateReminderBadge();
  renderReminderPanel();
}

const DURATION_RE = "(\\d+\\s*(?:seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d))";
const UNIT_MS = {
  s: 1e3, sec: 1e3, second: 1e3,
  m: 6e4, min: 6e4, minute: 6e4,
  h: 36e5, hr: 36e5, hour: 36e5,
  d: 864e5, day: 864e5,
};

function parseDurationToMs(text) {
  const m = String(text || "").match(
    /(\d+)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d)\b/i,
  );
  if (!m) return 0;
  const key = m[2].toLowerCase().replace(/s$/, "");
  return (UNIT_MS[key] || 0) * parseInt(m[1], 10);
}

function parseClockTime(expr, ref) {
  const lower = String(expr || "").toLowerCase();
  const tomorrow = /\btomorrow\b/.test(lower);
  let h;
  let min = 0;
  if (/\bnoon\b/.test(lower)) {
    h = 12;
  } else if (/\bmidnight\b/.test(lower)) {
    h = 0;
  } else {
    const m = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
    if (!m) return null;
    h = parseInt(m[1], 10);
    min = parseInt(m[2] || "0", 10);
    const ap = m[3];
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    if (h > 23 || min > 59) return null;
  }
  const d = new Date(ref.getTime());
  d.setHours(h, min, 0, 0);
  if (tomorrow) d.setDate(d.getDate() + 1);
  else if (d.getTime() <= ref.getTime()) d.setDate(d.getDate() + 1);
  return d.getTime();
}

function capKind(kind) {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

function parseReminderCommand(raw) {
  const text = raw.trim();
  let m;
  if ((m = text.match(new RegExp(`^remind me to (.+?) in ${DURATION_RE}\\b`, "i")))) {
    const ms = parseDurationToMs(m[2]);
    if (!ms) return null;
    return { label: m[1].trim(), dueAt: Date.now() + ms };
  }
  if ((m = text.match(new RegExp(`^remind me in ${DURATION_RE}(?: to (.+))?$`, "i")))) {
    const ms = parseDurationToMs(m[1]);
    if (!ms) return null;
    return { label: (m[2] || "Reminder").trim(), dueAt: Date.now() + ms };
  }
  if ((m = text.match(/^remind me to (.+?) (?:at|on) (.+)$/i))) {
    const at = parseClockTime(m[2], new Date());
    if (at == null) return { error: true };
    return { label: m[1].trim(), dueAt: at };
  }
  if ((m = text.match(/^remind me (?:at|on) (.+?)(?: to (.+))?$/i))) {
    const at = parseClockTime(m[1], new Date());
    if (at == null) return { error: true };
    return { label: (m[2] || "Reminder").trim(), dueAt: at };
  }
  if ((m = text.match(new RegExp(`^in ${DURATION_RE} remind me to (.+)$`, "i")))) {
    const ms = parseDurationToMs(m[1]);
    if (!ms) return null;
    return { label: m[2].trim(), dueAt: Date.now() + ms };
  }
  if ((m = text.match(/^set an? (alarm|timer|reminder)(?: for (.+))?$/i))) {
    const kind = m[1].toLowerCase();
    const rest = (m[2] || "").trim();
    if (!rest) return { error: true };
    const durM = rest.match(
      /(\d+\s*(?:seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d))/i,
    );
    if (durM) {
      const ms = parseDurationToMs(durM[1]);
      if (!ms) return { error: true };
      const label = rest
        .replace(durM[1], "")
        .replace(/^(for|to)\s+/i, "")
        .trim();
      return { label: label || capKind(kind), dueAt: Date.now() + ms };
    }
    const at = parseClockTime(rest, new Date());
    if (at == null) return { error: true };
    const label = rest
      .replace(/(\d{1,2}(?::\d{2})?\s*(?:am|pm)?|noon|midnight|tomorrow)/gi, "")
      .trim()
      .replace(/^(for|to|at|on)\s+/i, "")
      .trim();
    return { label: label || capKind(kind), dueAt: at };
  }
  if (/^remind me to (.+)$/i.test(text)) return { needTime: true };
  if (/^(remind me|set (an? )?(alarm|timer|reminder))\b/i.test(text)) return { error: true };
  return null;
}

async function handleReminderSend(raw) {
  const parsed = parseReminderCommand(raw);
  if (!parsed) return false;
  appendMessage("user", raw, []);
  if (parsed.error) {
    appendMessage("assistant", "Got it — what time? Try `in 20 minutes` or `at 7pm`.", []);
    return true;
  }
  if (parsed.needTime) {
    appendMessage(
      "assistant",
      "Sure — when should I remind you? (e.g. `in 20 minutes` or `tomorrow at 8am`)",
      [],
    );
    return true;
  }
  if ("Notification" in window && Notification.permission === "default") {
    try {
      await Notification.requestPermission();
    } catch {}
  }
  const r = addReminder(parsed.label, parsed.dueAt);
  appendMessage("assistant", `Done — I'll remind you ${fmtWhen(r.dueAt)}: **${r.label}**`, []);
  return true;
}

function updateReminderBadge() {
  const pending = readReminders().filter((r) => !r.done).length;
  const badge = document.getElementById("reminderBadge");
  if (badge) {
    badge.textContent = pending > 9 ? "9+" : String(pending);
    badge.hidden = pending === 0;
  }
}

function renderReminderPanel() {
  const panel = document.getElementById("reminderDropdown");
  if (!panel) return;
  const pending = readReminders()
    .filter((r) => !r.done)
    .sort((a, b) => a.dueAt - b.dueAt);
  panel.innerHTML = "";
  const head = document.createElement("p");
  head.className = "composer-menu-heading";
  head.textContent = "Reminders";
  panel.appendChild(head);
  if (!pending.length) {
    const empty = document.createElement("p");
    empty.className = "dropdown-hint";
    empty.textContent = "No reminders — try “remind me in 20 minutes”";
    panel.appendChild(empty);
    return;
  }
  pending.forEach((r) => {
    const row = document.createElement("div");
    row.className = "reminder-row";
    const txt = document.createElement("span");
    txt.className = "reminder-text";
    const strong = document.createElement("strong");
    strong.textContent = r.label;
    const small = document.createElement("small");
    small.textContent = fmtCountdown(r.dueAt - Date.now());
    txt.append(strong, small);
    const del = document.createElement("button");
    del.type = "button";
    del.className = "reminder-del";
    del.textContent = "×";
    del.title = "Cancel reminder";
    del.setAttribute("aria-label", `Cancel reminder: ${r.label}`);
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      cancelReminder(r.id);
    });
    row.append(txt, del);
    panel.appendChild(row);
  });
}

function toggleReminderPanel(force) {
  const panel = document.getElementById("reminderDropdown");
  const btn = document.getElementById("reminderBtn");
  if (!panel) return;
  const open = force !== undefined ? force : !panel.classList.contains("open");
  closeAttachMenu();
  renderReminderPanel();
  panel.classList.toggle("open", open);
  panel.setAttribute("aria-hidden", String(!open));
  btn?.setAttribute("aria-expanded", String(open));
}

function bootReminders() {
  scheduleAllReminders();
  renderReminderPanel();
  document.getElementById("reminderBtn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleReminderPanel();
  });
  document.addEventListener("click", (event) => {
    if (
      !event.target.closest("#reminderBtn") &&
      !event.target.closest("#reminderDropdown")
    ) {
      toggleReminderPanel(false);
    }
  });
  // Sweep for reminders missed while asleep; keeps countdowns fresh.
  setInterval(() => {
    readReminders()
      .filter((r) => !r.done && r.dueAt <= Date.now())
      .forEach((r) => fireReminder(r.id));
    updateReminderBadge();
  }, 30000);
  scheduleAllReminders();
}

/* ---------- long-term memory (client) ---------- */
async function loadMemoryList() {
  const box = document.getElementById("memoryList");
  if (!box) return;
  const count = document.getElementById("memoryCount");
  box.innerHTML = `<p class="dropdown-hint">Loading…</p>`;
  try {
    const res = await apiFetch(`${apiBaseUrl}/memory`);
    if (!res.ok) {
      throw new Error(
        (await res.json().catch(() => ({}))).detail || "Could not load memory",
      );
    }
    const items = await res.json();
    if (count) count.textContent = `${items.length}/50`;
    box.innerHTML = "";
    if (!items.length) {
      box.innerHTML = `<p class="dropdown-hint">Nothing stored yet — say “remember that…”</p>`;
      return;
    }
    items.forEach((m) => {
      const row = document.createElement("div");
      row.className = "memory-row";
      const txt = document.createElement("span");
      txt.textContent = m.content;
      const del = document.createElement("button");
      del.type = "button";
      del.className = "memory-del";
      del.textContent = "×";
      del.title = "Forget";
      del.setAttribute("aria-label", `Forget: ${m.content}`);
      del.addEventListener("click", async () => {
        try {
          await apiFetch(`${apiBaseUrl}/memory/${m.id}`, { method: "DELETE" });
          loadMemoryList();
        } catch {
          showComposerToast("Couldn't delete that memory");
        }
      });
      row.append(txt, del);
      box.appendChild(row);
    });
  } catch (err) {
    if (count) count.textContent = "";
    box.innerHTML = `<p class="dropdown-hint">${
      err?.message === "Sign-in required"
        ? "Sign in to use long-term memory."
        : "Couldn't load memory."
    }</p>`;
  }
}

async function handleRememberCommand(raw) {
  const m = raw.trim().match(/^remember(?: that| this)?\s+(.+)$/i);
  if (!m) return false;
  const content = m[1].trim();
  if (content.length < 3) return false;
  appendMessage("user", raw, []);
  try {
    const res = await apiFetch(`${apiBaseUrl}/memory`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) {
      throw new Error(
        (await res.json().catch(() => ({}))).detail || "Couldn't save that",
      );
    }
    appendMessage("assistant", "Got it — I'll remember that.", []);
    loadMemoryList();
  } catch (err) {
    appendMessage(
      "assistant",
      err?.message === "Sign-in required"
        ? "I can only keep long-term memories once you're signed in."
        : "I couldn't save that — try again.",
      [],
    );
  }
  return true;
}

async function handleRecallCommand(raw) {
  if (
    !/^(what do you remember|list (your )?memories|show (your )?memories|my memories)\b/i.test(
      raw.trim(),
    )
  ) {
    return false;
  }
  appendMessage("user", raw, []);
  try {
    const res = await apiFetch(`${apiBaseUrl}/memory`);
    if (!res.ok) throw new Error("load");
    const items = await res.json();
    appendMessage(
      "assistant",
      items.length
        ? `Here's what I remember:\n${items.map((i) => `- ${i.content}`).join("\n")}`
        : "Nothing stored yet — tell me something with “remember that…”.",
      [],
    );
  } catch {
    appendMessage("assistant", "Sign in first and I'll keep memories for you.", []);
  }
  return true;
}

/* ---------- morning briefing (no keys needed) ---------- */
function wmoText(code) {
  const c = Number(code);
  if (c === 0) return { icon: "☀️", label: "clear sky" };
  if (c <= 2) return { icon: "🌤️", label: "mostly clear" };
  if (c === 3) return { icon: "☁️", label: "overcast" };
  if (c <= 48) return { icon: "🌫️", label: "foggy" };
  if (c <= 57) return { icon: "🌦️", label: "drizzle" };
  if (c <= 67) return { icon: "🌧️", label: "rain" };
  if (c <= 77) return { icon: "🌨️", label: "snow" };
  if (c <= 82) return { icon: "🌦️", label: "showers" };
  if (c <= 86) return { icon: "🌨️", label: "snow showers" };
  return { icon: "⛈️", label: "thunderstorms" };
}

async function runBriefing() {
  appendMessage("user", "Morning briefing", []);
  const lines = [];
  const now = new Date();
  lines.push(
    `**${now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })} — ${now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}**`,
  );
  const city = (settings.briefCity || "").trim();
  if (city) {
    try {
      const geo = await (
        await fetch(
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`,
        )
      ).json();
      const place = geo?.results?.[0];
      if (!place) throw new Error("no-place");
      const wx = await (
        await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=auto`,
        )
      ).json();
      const w = wmoText(wx.current.weather_code);
      lines.push(
        `\n**Weather in ${place.name}** — ${w.icon} ${Math.round(wx.current.temperature_2m)}°C, ${w.label}. High ${Math.round(wx.daily.temperature_2m_max[0])}° / low ${Math.round(wx.daily.temperature_2m_min[0])}°.`,
      );
    } catch {
      lines.push(
        `\n**Weather** — couldn't load “${city}”. Check the city name in Settings → Behavior.`,
      );
    }
  } else {
    lines.push(`\n**Weather** — set your city in Settings → Behavior to get forecasts.`);
  }
  const todays = readReminders()
    .filter((r) => !r.done && new Date(r.dueAt).toDateString() === now.toDateString())
    .sort((a, b) => a.dueAt - b.dueAt);
  lines.push(
    todays.length
      ? `\n**Today's reminders**\n${todays.map((r) => `- ${r.label} (${fmtWhen(r.dueAt)})`).join("\n")}`
      : `\n**Reminders** — nothing due today.`,
  );
  try {
    const ids = await (
      await fetch("https://hacker-news.firebaseio.com/v0/topstories.json")
    ).json();
    const stories = await Promise.all(
      ids.slice(0, 5).map(async (id) => {
        try {
          return await (
            await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)
          ).json();
        } catch {
          return null;
        }
      }),
    );
    const titles = stories.filter(Boolean).map((s, i) => `${i + 1}. ${s.title}`);
    lines.push(
      titles.length
        ? `\n**Tech headlines**\n${titles.join("\n")}`
        : `\n**Tech headlines** — unavailable right now.`,
    );
  } catch {
    lines.push(`\n**Tech headlines** — unavailable right now.`);
  }
  appendMessage("assistant", lines.join("\n"), []);
}

/* ---------- wake word ("Hey Nico") ---------- */
let wakeRecognition = null;
let wakeSuspended = false;

function updateMicWakeState() {
  if (micBtn) {
    micBtn.classList.toggle("wake-on", !!settings.wake && voiceSupported());
  }
}

function syncWakeWord() {
  updateMicWakeState();
  if (settings.wake && !wakeRecognition) startWakeLoop();
  else if (!settings.wake && wakeRecognition) stopWakeLoop();
}

function startWakeLoop() {
  if (!voiceSupported() || !window.isSecureContext || wakeRecognition) return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  wakeRecognition = new SR();
  wakeRecognition.continuous = !isMobileVoice;
  wakeRecognition.interimResults = true;
  wakeRecognition.maxAlternatives = 1;
  wakeRecognition.lang = "en-US";
  wakeRecognition.onresult = (event) => {
    let t = "";
    for (let i = 0; i < event.results.length; ++i) {
      t += event.results[i][0].transcript;
    }
    if (/hey[\s,\-]*nico|ok[\s,\-]*nico/i.test(t)) triggerVoiceCapture();
  };
  wakeRecognition.onend = () => {
    wakeRecognition = null;
    updateMicWakeState();
    if (settings.wake && !wakeSuspended && !isListening) {
      try {
        startWakeLoop();
      } catch {
        setTimeout(() => {
          if (settings.wake && !wakeSuspended && !isListening) startWakeLoop();
        }, 1500);
      }
    }
  };
  wakeRecognition.onerror = (event) => {
    const kind = event?.error || "";
    if (kind === "not-allowed" || kind === "service-not-allowed") {
      settings.wake = false;
      saveSettings();
      stopWakeLoop();
      const box = document.getElementById("wakeSetting");
      if (box) box.checked = false;
      showComposerToast("Wake word needs mic permission — turned off");
    }
  };
  try {
    wakeRecognition.start();
    updateMicWakeState();
  } catch {
    wakeRecognition = null;
  }
}

function stopWakeLoop() {
  if (!wakeRecognition) return;
  try {
    wakeRecognition.stop();
  } catch {}
  wakeRecognition = null;
  updateMicWakeState();
}

function triggerVoiceCapture() {
  if (isListening || !recognition) return;
  wakeSuspended = true;
  stopWakeLoop();
  playCompletionChime();
  showComposerToast("Yes? Listening…");
  try {
    userInput.value = "";
    autoGrowComposer();
    recognition.start();
  } catch {
    wakeSuspended = false;
    startWakeLoop();
  }
}

function maybeResumeWake() {
  wakeSuspended = false;
  updateMicWakeState();
  if (settings.wake && !wakeRecognition && !isListening) {
    setTimeout(() => {
      if (settings.wake && !wakeSuspended && !isListening) startWakeLoop();
    }, 1500);
  }
}

/* ---------- local command dispatcher (before the backend) ---------- */
async function maybeHandleLocalCommand(raw) {
  const text = (raw || "").trim();
  if (!text) return false;
  if (
    /^(remind me|set an? (alarm|timer|reminder)|in \d+\s*\w+ remind me)\b/i.test(text)
  ) {
    return await handleReminderSend(text);
  }
  if (/^cancel all reminders$/i.test(text)) {
    appendMessage("user", text, []);
    const n = readReminders().filter((r) => !r.done).length;
    writeReminders([]);
    reminderTimers.forEach((t) => clearTimeout(t));
    reminderTimers.clear();
    updateReminderBadge();
    renderReminderPanel();
    appendMessage(
      "assistant",
      n ? `Cleared ${n} reminder${n === 1 ? "" : "s"}.` : "No active reminders to clear.",
      [],
    );
    return true;
  }
  if (/^remember\s/i.test(text) && !/^remember to\b/i.test(text)) {
    return await handleRememberCommand(text);
  }
  if (
    /^(what do you remember|list (your )?memories|show (your )?memories|my memories)\b/i.test(
      text,
    )
  ) {
    return await handleRecallCommand(text);
  }
  const cityM = text.match(/^(?:set(?: my)? city (?:to|as) |my city is )(.{2,60})$/i);
  if (cityM) {
    appendMessage("user", text, []);
    settings.briefCity = cityM[1].trim();
    saveSettings();
    appendMessage(
      "assistant",
      `City set to **${settings.briefCity}** — I'll use it for briefings.`,
      [],
    );
    return true;
  }
  if (/^(good morning|morning|briefing|daily briefing|morning briefing)!?\s*$/i.test(text)) {
    await runBriefing();
    return true;
  }
  return false;
}

async function sendMessage() {
  const typedMessage = userInput.value.trim();
  if (!typedMessage && selectedAttachments.length === 0) return;
  if (!selectedAttachments.length && (await maybeHandleLocalCommand(typedMessage))) {
    userInput.value = "";
    autoGrowComposer();
    return;
  }
  const attachmentRequest = await buildMessageWithAttachments(typedMessage);
  // Never silently drop the files: if nothing usable could be read, stop
  // here instead of sending a text-only message Nico will misread.
  if (attachmentRequest.failed) {
    showComposerToast("Couldn't read the attached file — try JPG or PNG");
    return;
  }
  const message = attachmentRequest.message;
  const displayMessage = attachmentRequest.displayMessage;

  if (
    message.startsWith("disable:") ||
    message.startsWith("/") ||
    message.startsWith("enable:")
  ) {
    appendMessage("user", displayMessage, attachmentRequest.attachments);
    userInput.value = "";
    autoGrowComposer();
    clearSelectedAttachments();
    handleCommand(message);
    return;
  }

  stopSpeech();
  appendMessage("user", displayMessage, attachmentRequest.attachments);
  if (currentUser) {
    await saveConversationAttachments(attachmentRequest.attachments);
    if (!authClient) {
      upsertLocalConversation({
        id: currentConversationId,
        title: "Untitled Chat",
        user_id: currentUser.id,
      });
      appendLocalConversationMessage(
        currentConversationId,
        "user",
        displayMessage,
        attachmentRequest.attachments,
      );
    }
  }
  userInput.value = "";
  autoGrowComposer();
  selectedAttachments.forEach((a) => {
    if (a?.previewUrl) {
      try { URL.revokeObjectURL(a.previewUrl); } catch {}
    }
  });
  selectedAttachments = [];
  renderAttachments();

  ensureTypingIndicator();
  const indicator = document.getElementById("typingIndicator");
  if (indicator) {
    setResponsePhase(indicator, null, "thinking");
    chatBox.appendChild(indicator);
  }
  chatBox.scrollTop = chatBox.scrollHeight;

  if (sendBtn) {
    sendBtn.innerText = "Stop";
    sendBtn.onclick = stopGeneration;
  }

  currentAbortController = new AbortController();

  const assistantMsgDiv = document.createElement("div");
  assistantMsgDiv.className = "message assistant";
  assistantMsgDiv.innerHTML = `<span class="avatar-tag">${settings.avatar}</span><div class="content"></div>`;
  const contentDiv = assistantMsgDiv.querySelector(".content");
  contentDiv.style.visibility = "hidden";

  if (indicator) {
    chatBox.insertBefore(assistantMsgDiv, indicator);
  } else {
    chatBox.appendChild(assistantMsgDiv);
  }

  let accumulatedText = "";
  let sentenceBuffer = "";
  let typingStarted = false;
  let streamComplete = false;
  let typewriterCleanup = null;
  let typingDelayTimer = null;

  try {
    const response = await apiFetch(`${apiBaseUrl}/chat/stream`, {
      allowGuest: true,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: currentAbortController.signal,
      body: JSON.stringify({
        message: message,
        conversation_id: currentConversationId,
        attachments: attachmentRequest.attachments,
        settings,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        errorText || `Request failed with status ${response.status}`,
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    const triggerTypingFlow = () => {
      if (typingStarted) return;
      typingStarted = true;
      if (typingDelayTimer) {
        clearTimeout(typingDelayTimer);
        typingDelayTimer = null;
      }
      setResponsePhase(indicator, contentDiv, "typing");
      indicator?.remove();
      typewriterCleanup = startTypewriterReveal(
        contentDiv,
        () => accumulatedText,
        () => streamComplete,
        () => {
          attachCodeCopyButtons(assistantMsgDiv);
          attachMessageFooter(assistantMsgDiv, "assistant", accumulatedText);
          chatBox.scrollTop = chatBox.scrollHeight;
        },
      );
      // Fallback: if stream was empty, still add footer so quick buttons show
      setTimeout(() => {
        if (!assistantMsgDiv.querySelector(":scope > .msg-actions") && accumulatedText) {
          attachMessageFooter(assistantMsgDiv, "assistant", accumulatedText);
        }
      }, 4000);
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      accumulatedText += chunk;
      sentenceBuffer += chunk;

      chatBox.scrollTop = chatBox.scrollHeight;

      let match;
      const sentenceRegex = /([^.!?\n]+[.!?\n]+)/g;

      while ((match = sentenceRegex.exec(sentenceBuffer)) !== null) {
        const sentence = match[0];
        queueSentence(sentence);
        sentenceBuffer = sentenceBuffer.slice(match.index + sentence.length);
        sentenceRegex.lastIndex = 0;
      }
    }

    if (sentenceBuffer.trim()) {
      queueSentence(sentenceBuffer);
    }

    streamComplete = true;
    typingDelayTimer = setTimeout(triggerTypingFlow, 1400);

    if (!authClient && currentUser) {
      appendLocalConversationMessage(
        currentConversationId,
        "assistant",
        accumulatedText,
      );
      upsertLocalConversation({
        id: currentConversationId,
        title: "Untitled Chat",
        user_id: currentUser.id,
      });
    }

    if (settings.sound) playCompletionChime();
    loadRecentConversations();
  } catch (error) {
    if (typingDelayTimer) {
      clearTimeout(typingDelayTimer);
      typingDelayTimer = null;
    }
    if (typewriterCleanup) typewriterCleanup();
    setResponsePhase(indicator, contentDiv, "error");
    indicator?.remove();
    if (error.name === "AbortError") {
      contentDiv.innerHTML += " <i>[Generation stopped]</i>";
      contentDiv.style.visibility = "visible";
      attachMessageFooter(assistantMsgDiv, "assistant", contentDiv.innerText || "[Generation stopped]");
    } else {
      contentDiv.innerText = `Error: ${error.message || "Could not connect to Nico backend."}`;
      contentDiv.style.visibility = "visible";
      attachMessageFooter(assistantMsgDiv, "assistant", contentDiv.innerText);
    }
  } finally {
    currentAbortController = null;
    resetSendButton();
  }
}

// Mobile Menu Toggle & Universal Pointer Handling
const menuToggle =
  document.getElementById("menu-toggle") ||
  document.querySelector(".mobile-menu-btn");
const sidebar = document.querySelector(".sidebar");
const appLayout = document.querySelector(".app-layout");

if (menuToggle && menuToggle.parentElement !== document.body) {
  document.body.appendChild(menuToggle);
}

let sidebarOverlay = document.querySelector(".sidebar-overlay");
if (!sidebarOverlay) {
  sidebarOverlay = document.createElement("div");
  sidebarOverlay.className = "sidebar-overlay";
  document.body.appendChild(sidebarOverlay);
}

function setMobileSidebar(open, e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  if (!sidebar) return;

  const isMobile = window.matchMedia(
    "(max-width: 768px), (max-height: 500px)",
  ).matches;
  sidebar.classList.toggle("mobile-open", isMobile && open);
  appLayout?.classList.toggle("sidebar-collapsed", !isMobile && !open);

  if (isMobile) {
    sidebar.style.transform = open ? "translateX(0)" : "translateX(-100%)";
  } else {
    sidebar.style.transform = open
      ? "translateX(0)"
      : "translateX(calc(-100% - 8px))";
  }

  sidebarOverlay.classList.toggle("active", isMobile && open);
  sidebarOverlay.setAttribute("aria-hidden", String(!(isMobile && open)));
  if (menuToggle) {
    menuToggle.classList.toggle("is-sidebar-open", isMobile && open);
    menuToggle.setAttribute("aria-expanded", String(open));
    menuToggle.setAttribute(
      "aria-label",
      open ? "Close sidebar" : "Open sidebar",
    );
    menuToggle.setAttribute("title", open ? "Close sidebar" : "Open sidebar");
    menuToggle.textContent = open ? "×" : "☰";
  }
}

function toggleMobileSidebar(e) {
  const isMobile = window.matchMedia(
    "(max-width: 768px), (max-height: 500px)",
  ).matches;
  const isOpen = isMobile
    ? sidebar?.classList.contains("mobile-open")
    : !appLayout?.classList.contains("sidebar-collapsed");
  setMobileSidebar(!isOpen, e);
}

// IMPORTANT: use ONE event per control.
// The previous version used pointerdown + click + inline onclick, so one tap
// could toggle the sidebar multiple times and immediately close it again.
if (menuToggle) {
  menuToggle.addEventListener("click", toggleMobileSidebar);
}

if (sidebarOverlay) {
  sidebarOverlay.addEventListener("click", (e) => setMobileSidebar(false, e));
}

// Unified Command Handler
function handleCommand(commandText) {
  const parts = commandText.trim().toLowerCase().split(/\s+/);
  const action = parts[0];
  const target = parts[1];
  const param = parts[2];

  const assistantMsgDiv = document.createElement("div");
  assistantMsgDiv.className = "message assistant";
  assistantMsgDiv.innerHTML = `<span class="avatar-tag">${settings.avatar}</span><div class="content"></div>`;
  const contentDiv = assistantMsgDiv.querySelector(".content");

  if (
    (action === "disable:" && target === "tts") ||
    (action === "/disable" && target === "tts")
  ) {
    ttsEnabled = false;
    stopSpeech();
    contentDiv.innerHTML = `<i>[E.V.E. Protocol: TTS module disabled. Ref: ${param || "001"}]</i>`;
  } else if (
    (action === "enable:" && target === "tts") ||
    (action === "/enable" && target === "tts")
  ) {
    ttsEnabled = true;
    contentDiv.innerHTML = `<i>[E.V.E. Protocol: TTS module enabled. Ref: ${param || "001"}]</i>`;
    if ("speechSynthesis" in window) {
      window.speechSynthesis.resume();
      const unlockUtterance = new SpeechSynthesisUtterance("Audio active.");
      window.speechSynthesis.speak(unlockUtterance);
    }
  } else {
    contentDiv.innerHTML = `<i>[Unknown command sequence: "${commandText}"]</i>`;
  }

  chatBox.appendChild(assistantMsgDiv);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function exportChat() {
  const messages = Array.from(chatBox.querySelectorAll(".message:not(.thinking-indicator)")).map(
    (msg) => {
      const isUser = msg.classList.contains("user");
      const role = isUser ? "User" : "Nico";
      const content = msg.querySelector(".content")?.innerText || "";
      return `**${role}:**\n${content}\n`;
    },
  );

  if (messages.length === 0) return alert("No messages to export.");

  const blob = new Blob([messages.join("\n---\n\n")], {
    type: "text/markdown",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `chat-${currentConversationId}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadFile(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function exportChatJson() {
  const messages = Array.from(chatBox.querySelectorAll(".message:not(.thinking-indicator)")).map(
    (msg) => ({
      role: msg.classList.contains("user") ? "user" : "assistant",
      content: msg.querySelector(".content")?.innerText || "",
    }),
  );
  if (!messages.length) return alert("No messages to export.");
  downloadFile(
    `chat-${currentConversationId}.json`,
    JSON.stringify(messages, null, 2),
    "application/json",
  );
}

function playCompletionChime() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  const context = new AudioContextClass();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.frequency.value = 660;
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.04, context.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.18);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.2);
}

function initializeSettingsPanel() {
  const panel = document.getElementById("settingsPanel");
  const button = document.getElementById("settingsBtn");
  const closeButton = document.getElementById("closeSettingsBtn");
  const customBackgroundBtn = document.getElementById("customBackgroundBtn");
  const customBackgroundInput = document.getElementById(
    "customBackgroundInput",
  );
  const clearBackgroundBtn = document.getElementById("clearBackgroundBtn");
  document
    .getElementById("openVisionBtn")
    ?.addEventListener("click", startVisionMode);
  document
    .getElementById("closeVisionBtn")
    ?.addEventListener("click", stopVisionMode);
  document
    .getElementById("stopVisionBtn")
    ?.addEventListener("click", stopVisionMode);
  document
    .getElementById("captureVisionBtn")
    ?.addEventListener("click", captureVisionFrame);
  document
    .getElementById("analyzeVisionBtn")
    ?.addEventListener("click", analyzeVisionFrame);
  const controls = {
    personality: document.getElementById("personalitySetting"),
    length: document.getElementById("lengthSetting"),
    theme: document.getElementById("themeSetting"),
    mode: document.getElementById("modeSetting"),
    font: document.getElementById("fontSetting"),
    fontScale: document.getElementById("fontSizeSetting"),
    model: document.getElementById("modelSetting"),
    memory: document.getElementById("memorySetting"),
    memoryText: document.getElementById("memoryInput"),
    context: document.getElementById("contextSetting"),
    sound: document.getElementById("soundSetting"),
    avatar: document.getElementById("avatarSetting"),
    wake: document.getElementById("wakeSetting"),
    briefCity: document.getElementById("briefCity"),
  };

  Object.entries(controls).forEach(([key, control]) => {
    // Skip controls missing from this HTML version so a stale cached page
    // can never kill settings init (and everything after it).
    if (!control) return;
    control.value = settings[key] ?? control.value;
    if (control.type === "checkbox") control.checked = settings[key];
    control.addEventListener("input", () => {
      settings[key] =
        control.type === "checkbox" ? control.checked : control.value;
      if (key === "fontScale") settings.fontScale = Number(control.value);
      if (key === "personality") {
        syncDeveloperModePreference();
      }
      saveSettings();
      applySettings();
    });
  });

  customBackgroundBtn.addEventListener("click", () =>
    customBackgroundInput.click(),
  );
  customBackgroundInput.addEventListener("change", async () => {
    const [file] = customBackgroundInput.files || [];
    if (!file) return;
    try {
      settings.customBackgroundImage = await readCustomBackground(file);
      saveSettings();
      applySettings();
    } catch (error) {
      console.error("Could not apply custom background:", error);
    } finally {
      customBackgroundInput.value = "";
    }
  });
  clearBackgroundBtn.addEventListener("click", () => {
    settings.customBackgroundImage = "";
    saveSettings();
    applySettings();
  });

  document.querySelectorAll(".settings-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".settings-tab").forEach((candidate) => {
        const active = candidate === tab;
        candidate.classList.toggle("is-active", active);
        candidate.setAttribute("aria-selected", String(active));
      });
      document.querySelectorAll(".settings-tab-panel").forEach((panel) => {
        const active = panel.id === tab.dataset.settingsTab;
        panel.classList.toggle("is-active", active);
        panel.hidden = !active;
      });
    });
  });

  const setOpen = (open) => {
    panel.classList.toggle("open", open);
    panel.setAttribute("aria-hidden", String(!open));
    button.setAttribute("aria-expanded", String(open));
  };
  button.addEventListener("click", () => {
    const willOpen = !panel.classList.contains("open");
    setOpen(willOpen);
    if (willOpen) loadMemoryList();
  });
  closeButton.addEventListener("click", () => setOpen(false));
  document.addEventListener("click", (event) => {
    if (
      !event.target.closest("#settingsPanel") &&
      !event.target.closest("#settingsBtn")
    )
      setOpen(false);
  });
  document
    .getElementById("exportMarkdownBtn")
    .addEventListener("click", exportChat);
  document
    .getElementById("exportJsonBtn")
    .addEventListener("click", exportChatJson);
  document.getElementById("clearContextBtn").addEventListener("click", () => {
    settings.context = false;
    controls.context.checked = false;
    saveSettings();
    clearChatBox();
  });
  applySettings();
}

function setAuthScreenVisible(visible) {
  const authScreen = document.getElementById("authScreen");
  const appView = document.querySelector(".app-layout");

  if (authScreen) authScreen.classList.toggle("is-visible", visible);
  if (appView) appView.classList.toggle("auth-visible", visible);
}

function finishDemoSignIn(username, token = null) {
  const safeUsername = (username || "User").trim();
  const displayName = safeUsername.includes("@")
    ? safeUsername.split("@")[0]
    : safeUsername || "User";

  const demoUser = {
    id: `demo-${Date.now()}`,
    email: safeUsername.includes("@")
      ? safeUsername
      : `${safeUsername}@nico.local`,
    user_metadata: {
      full_name: displayName,
      name: displayName,
    },
  };

  if (token) {
    storageSet("nico_demo_auth_token", token);
    storageSet("nico_demo_user", JSON.stringify(demoUser));
  } else {
    storageSet("nico_demo_auth_token", "demo-local");
    storageSet("nico_demo_user", JSON.stringify(demoUser));
  }

  updateAuthUi(demoUser);
}

function isDeveloperAccountUser(user) {
  if (!user) return false;
  const email = (user.email || "").toLowerCase();
  const role = (user.user_metadata?.role || "").toLowerCase();
  return email === "admin@nico.local" || role === "developer";
}

function setDeveloperDashboardVisibility(user) {
  const dashboardButton = document.getElementById("openAdminDashboardBtn");
  if (!dashboardButton) return;
  const visible = isDeveloperAccountUser(user);
  dashboardButton.hidden = !visible;
  dashboardButton.disabled = !visible;
}

function updateAuthUi(user) {
  const userName = document.getElementById("user-name");
  const welcomeName = document.getElementById("welcomeName");
  const userAvatar = document.getElementById("user-avatar");
  const userStatus = document.getElementById("user-status");
  const signInButton = document.getElementById("sign-in-btn");
  const signOutButton = document.getElementById("sign-out-btn");
  const developerBadge = document.getElementById("developerBadge");
  const ownerBadge = document.getElementById("ownerBadge");

  appLayout?.classList.toggle("guest-mode", !user);
  appLayout?.classList.toggle("logged-in-mode", !!user);

  currentUser = user;
  if (!user) {
    setAuthScreenVisible(true);
    authUiInitialized = false;
    userName.textContent = "Not signed in";
    if (welcomeName) welcomeName.textContent = "User";
    userAvatar.textContent = "?";
    userStatus.textContent = "Guest mode - chats are not saved";
    signInButton.hidden = false;
    signOutButton.hidden = true;
    if (developerBadge) developerBadge.hidden = true;
    if (ownerBadge) ownerBadge.hidden = true;
    currentUser = null;
    const restored = localStorage.getItem("active_chat_id");
    if (isValidConversationId(restored)) {
      currentConversationId = restored;
    } else {
      currentConversationId = createConversationId();
    }
    persistCurrentConversationId();
    if (document.getElementById("typingIndicator")) {
      document.getElementById("typingIndicator").innerText =
        getAssistantThinkingLabel();
    }
    setDeveloperDashboardVisibility(null);
    return;
  }

  if (user.id && user.id.startsWith("demo-")) {
    storageSet("nico_demo_user", JSON.stringify(user));
  }

  setAuthScreenVisible(false);

  const displayName =
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    user.email?.split("@")[0] ||
    "User";
  const isDeveloper = isDeveloperAccountUser(user);
  const developerLabel = isDeveloper ? "Matt Andrei" : displayName;
  userName.textContent = isDeveloper ? "Matt Andrei" : displayName;
  if (welcomeName) welcomeName.textContent = developerLabel;
  userAvatar.textContent = isDeveloper
    ? "M"
    : displayName.charAt(0).toUpperCase();
  userStatus.textContent = isDeveloper
    ? "Developer account • Matt Andrei"
    : "Online";
  if (developerBadge) {
    developerBadge.hidden = !isDeveloper;
    developerBadge.textContent = "Developer";
  }
  if (ownerBadge) {
    ownerBadge.hidden = !isDeveloper;
    ownerBadge.textContent = "Owner";
  }
  signInButton.hidden = true;
  signOutButton.hidden = false;
  setDeveloperDashboardVisibility(user);

  if (!authUiInitialized) {
    const savedUserConversationId = localStorage.getItem(
      `active_chat_id:${user.id}`,
    );
    currentConversationId = isValidConversationId(savedUserConversationId)
      ? savedUserConversationId
      : createConversationId();
    authUiInitialized = true;
    clearChatBox();
  }
  persistCurrentConversationId();
  loadRecentConversations();
}

async function submitDemoAuth(action = "login", username, password) {
  const endpoint = action === "signup" ? "/auth/signup" : "/auth/login";
  const response = await fetch(`${apiBaseUrl}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username_or_email: username, password }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.detail || "Authentication failed");
  }

  const demoUser = payload.user || {};
  const token = payload.token || null;
  const refreshToken = payload.refresh_token || null;
  if (token && refreshToken && authClient) {
    localStorage.removeItem("nico_demo_auth_token");
    localStorage.removeItem("nico_demo_user");
    const { data, error } = await authClient.auth.setSession({
      access_token: token,
      refresh_token: refreshToken,
    });
    if (error)
      throw new Error(error.message || "Could not restore sign-in session");
    updateAuthUi(data.session?.user || demoUser);
  } else {
    if (token) {
      storageSet("nico_demo_auth_token", token);
      storageSet("nico_demo_user", JSON.stringify(demoUser));
    }
    updateAuthUi(demoUser);
  }
  return demoUser;
}

function initializeAuthScreen() {
  const form = document.getElementById("authForm");
  const usernameInput = document.getElementById("authUsername");
  const passwordInput = document.getElementById("authPassword");
  const passwordToggle = document.getElementById("authPasswordToggle");
  const submitButton = document.getElementById("authSubmitBtn");
  const createAccountLink = document.getElementById("createAccountLink");
  const googleButton = document.getElementById("authGoogleBtn");
  const appleButton = document.getElementById("authAppleBtn");

  if (!form || !usernameInput || !passwordInput) return;

  passwordToggle?.addEventListener("click", () => {
    const willShow = passwordInput.type === "password";
    passwordInput.type = willShow ? "text" : "password";
    passwordToggle.setAttribute("aria-pressed", String(willShow));
    passwordToggle.setAttribute(
      "aria-label",
      willShow ? "Hide password" : "Show password",
    );
    passwordToggle.title = willShow ? "Hide password" : "Show password";
    const icon = passwordToggle.querySelector("span");
    if (icon) {
      icon.textContent = willShow ? "🙈" : "👁";
    }
    passwordInput.focus();
  });

  let authMode = "login";

  const setAuthMode = (mode) => {
    authMode = mode;
    if (submitButton) {
      submitButton.textContent =
        mode === "signup" ? "Create account" : "Sign in";
    }
    if (createAccountLink) {
      createAccountLink.textContent =
        mode === "signup"
          ? "Already have an account? Sign in"
          : "Create an account";
    }
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const value = usernameInput.value.trim();
    const password = passwordInput.value.trim();

    if (!value || !password) {
      passwordInput.focus();
      return;
    }

    try {
      if (submitButton) submitButton.disabled = true;
      submitButton.textContent =
        authMode === "signup" ? "Creating account..." : "Signing in...";

      await submitDemoAuth(authMode, value, password);
      form.reset();
    } catch (error) {
      alert(error.message || "Authentication failed");
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent =
          authMode === "signup" ? "Create account" : "Sign in";
      }
    }
  });

  createAccountLink?.addEventListener("click", (event) => {
    event.preventDefault();
    setAuthMode(authMode === "login" ? "signup" : "login");
  });

  setAuthMode("login");

  googleButton?.addEventListener("click", () => {
    if (authClient) {
      signInWithGoogle();
      return;
    }
    alert("Google sign-in is not configured yet.");
  });

  appleButton?.addEventListener("click", () => {
    alert("Apple sign-in is not configured yet.");
  });
}

async function signInWithGoogle() {
  if (!authClient) {
    alert("Supabase authentication is not configured yet.");
    return;
  }
  const { error } = await authClient.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.href.split("#")[0] },
  });
  if (error) alert(`Sign-in failed: ${error.message}`);
}

async function initializeAuth() {
  const storedDemoUser = localStorage.getItem("nico_demo_user");
  const storedDemoToken = localStorage.getItem("nico_demo_auth_token");

  if (storedDemoToken && storedDemoUser) {
    try {
      const parsedUser = JSON.parse(storedDemoUser);
      updateAuthUi(parsedUser);
      return;
    } catch {
      localStorage.removeItem("nico_demo_user");
    }
  }

  if (!authClient) {
    updateAuthUi(null);
    return;
  }

  authClient.auth.onAuthStateChange((_event, session) => {
    updateAuthUi(session?.user || null);
  });

  const { data, error } = await authClient.auth.getSession();
  if (error) {
    console.error("Failed to load sign-in session:", error);
    document.getElementById("user-status").textContent =
      `Sign-in error: ${error.message}`;
    return;
  }
  updateAuthUi(data.session?.user || null);
}

async function adminFetch(path, options = {}) {
  const response = await apiFetch(`${apiBaseUrl}${path}`, options);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail || `Request failed (${response.status})`);
  }
  return response.json().catch(() => ({}));
}

function adminEsc(value) {
  const element = document.createElement("div");
  element.textContent = value ?? "";
  return element.innerHTML;
}

let adminActiveTab = "overview";

async function openDeveloperDashboard() {
  const panel = document.getElementById("adminDashboardPanel");
  const content = document.getElementById("adminDashboardContent");
  if (!panel || !content) return;

  content.innerHTML = `<div class="admin-loading">Loading dashboard…</div>`;
  panel.classList.add("is-open");
  panel.hidden = false;
  panel.setAttribute("aria-hidden", "false");

  try {
    const [overview, stats] = await Promise.all([
      adminFetch("/admin/overview"),
      adminFetch("/admin/stats"),
    ]);
    renderAdminTabs(content, overview, stats);
    await renderAdminTab(content, adminActiveTab, stats, overview);
  } catch (error) {
    content.innerHTML = `
      <div class="admin-section">
        <h3>Dashboard unavailable</h3>
        <div class="admin-log-item"><time>error</time>${adminEsc(error.message)}</div>
      </div>
    `;
  }
}

function renderAdminTabs(content, overview, stats) {
  const tabs = document.createElement("div");
  tabs.className = "admin-tabs";
  tabs.setAttribute("role", "tablist");
  ["overview", "chats", "users", "controls", "logs"].forEach((name) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `admin-tab${adminActiveTab === name ? " is-active" : ""}`;
    btn.textContent = name.charAt(0).toUpperCase() + name.slice(1);
    btn.setAttribute("role", "tab");
    btn.addEventListener("click", async () => {
      adminActiveTab = name;
      tabs.querySelectorAll(".admin-tab").forEach((t) =>
        t.classList.toggle("is-active", t === btn),
      );
      await renderAdminTab(content, name, stats, overview);
    });
    tabs.appendChild(btn);
  });
  const body = document.createElement("div");
  body.id = "adminTabBody";
  body.className = "admin-tab-body";
  content.innerHTML = "";
  content.append(tabs, body);
}

async function renderAdminTab(content, name, stats, overview) {
  const body = content.querySelector("#adminTabBody") || content;
  body.innerHTML = `<div class="admin-loading">Loading…</div>`;
  try {
    if (name === "overview") return renderAdminOverview(body, stats, overview);
    if (name === "chats") return await renderAdminChats(body);
    if (name === "users") return await renderAdminUsers(body);
    if (name === "controls") return renderAdminControls(body, stats);
    if (name === "logs") return await renderAdminLogs(body);
  } catch (error) {
    body.innerHTML = `<div class="admin-log-item"><time>error</time>${adminEsc(error.message)}</div>`;
  }
}

function renderAdminOverview(body, stats, overview = {}) {
  const counts = stats.counts || {};
  const activity = stats.activity || [];
  const peak = Math.max(1, ...activity.map((a) => a.messages));
  const cards = [
    ["Conversations", counts.conversations ?? "—"],
    ["Messages", counts.messages ?? "—"],
    ["Users", counts.auth_users ?? counts.demo_users ?? "—"],
    ["Memories", counts.memories ?? "—"],
  ]
    .map(
      ([label, value]) =>
        `<div class="admin-card status-ok"><small>${label}</small><strong>${adminEsc(String(value))}</strong></div>`,
    )
    .join("");
  body.innerHTML = `
    <div class="admin-dashboard-grid">${cards}</div>
    <div class="admin-section">
      <h3>Messages / day</h3>
      <div class="admin-chart">
        ${activity.length ? activity.map((a) => `
          <div class="admin-bar" title="${adminEsc(a.date)}: ${a.messages}">
            <span style="height:${Math.max(4, Math.round((a.messages / peak) * 72))}px"></span>
            <small>${adminEsc(a.date.slice(5))}</small>
          </div>`).join("") : '<div class="admin-log-item"><time>—</time>No activity yet.</div>'}
      </div>
    </div>
    <div class="admin-section">
      <h3>Status</h3>
      <div class="admin-log-list">
        <div class="admin-log-item"><time>mode</time>Maintenance ${stats.maintenance?.enabled ? "ON" : "off"}</div>
        <div class="admin-log-item"><time>note</time>${stats.announcement?.text ? adminEsc(stats.announcement.text) : "No announcement set."}</div>
      </div>
    </div>
    <div class="admin-section">
      <h3>Environment</h3>
      <div class="admin-log-list">
        <div class="admin-log-item"><time>render</time>${overview.render?.enabled ? `Enabled (${adminEsc(overview.render.status || "")})` : "Not configured"}</div>
        <div class="admin-log-item"><time>supabase</time>${overview.supabase?.enabled ? "Connected" : "Not configured"}</div>
        <div class="admin-log-item"><time>groq</time>${overview.services?.groq ? "Configured" : "Missing"}</div>
        <div class="admin-log-item"><time>gemini</time>${overview.services?.gemini ? "Configured" : "Missing"}</div>
        <div class="admin-log-item"><time>url</time>${adminEsc(overview.app?.service_url || "n/a")}</div>
      </div>
    </div>
  `;
}

async function renderAdminChats(body, query = "") {
  const data = await adminFetch(
    `/admin/conversations?q=${encodeURIComponent(query)}&limit=20`,
  );
  const rows = data.conversations || [];
  body.innerHTML = "";
  const toolbar = document.createElement("div");
  toolbar.className = "admin-toolbar";
  const search = document.createElement("input");
  search.className = "admin-search";
  search.placeholder = "Search chats…";
  search.value = query;
  search.setAttribute("aria-label", "Search conversations");
  let debounce;
  search.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => renderAdminChats(body, search.value), 350);
  });
  toolbar.appendChild(search);
  body.appendChild(toolbar);
  const list = document.createElement("div");
  list.className = "admin-log-list";
  if (!rows.length) {
    list.innerHTML = '<div class="admin-log-item"><time>—</time>No conversations found.</div>';
  }
  rows.forEach((convo) => {
    const item = document.createElement("div");
    item.className = "admin-chat-row";
    const info = document.createElement("button");
    info.type = "button";
    info.className = "admin-chat-info";
    const title = document.createElement("strong");
    title.textContent = convo.title || "Untitled";
    const meta = document.createElement("small");
    meta.textContent = `${convo.message_count ?? "?"} msgs · ${String(convo.created_at || "").slice(0, 10)}`;
    info.append(title, meta);
    const detail = document.createElement("div");
    detail.className = "admin-chat-detail";
    detail.hidden = true;
    info.addEventListener("click", async () => {
      if (!detail.hidden) {
        detail.hidden = true;
        return;
      }
      detail.hidden = false;
      detail.innerHTML = `<div class="admin-loading">Loading messages…</div>`;
      try {
        const data = await adminFetch(`/admin/conversations/${convo.id}/messages`);
        detail.innerHTML = "";
        (data.messages || []).forEach((m) => {
          const row = document.createElement("div");
          row.className = "admin-log-item";
          const when = document.createElement("time");
          when.textContent = m.role;
          const txt = document.createElement("span");
          txt.textContent = (m.content || "").slice(0, 400);
          row.append(when, txt);
          detail.appendChild(row);
        });
        if (!data.messages?.length) {
          detail.innerHTML = '<div class="admin-log-item"><time>—</time>No messages.</div>';
        }
      } catch (error) {
        detail.innerHTML = `<div class="admin-log-item"><time>error</time>${adminEsc(error.message)}</div>`;
      }
    });
    const actions = document.createElement("div");
    actions.className = "admin-row-actions";
    const rename = document.createElement("button");
    rename.type = "button";
    rename.textContent = "Rename";
    rename.addEventListener("click", async () => {
      const next = prompt("New title:", convo.title || "");
      if (!next?.trim()) return;
      await adminFetch(`/admin/conversations/${convo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: next.trim() }),
      });
      title.textContent = next.trim();
    });
    const del = document.createElement("button");
    del.type = "button";
    del.className = "danger";
    del.textContent = "Delete";
    del.addEventListener("click", async () => {
      if (!confirm(`Delete "${convo.title || "Untitled"}" and all its messages?`)) return;
      await adminFetch(`/admin/conversations/${convo.id}`, { method: "DELETE" });
      item.remove();
    });
    actions.append(rename, del);
    item.append(info, actions, detail);
    list.appendChild(item);
  });
  body.appendChild(list);
}

async function renderAdminUsers(body) {
  const data = await adminFetch("/admin/users");
  body.innerHTML = `
    <div class="admin-section">
      <h3>Demo accounts (${(data.demo_users || []).length})</h3>
      <div class="admin-log-list" id="adminDemoUsers"></div>
    </div>
    <div class="admin-section">
      <h3>Supabase auth</h3>
      <div class="admin-log-list">
        <div class="admin-log-item"><time>users</time>${
          data.supabase_users ? `${data.supabase_users.length} listed` : "Unavailable (needs service key or migration)"
        }</div>
        ${(data.supabase_users || []).slice(0, 20).map((u) => `
          <div class="admin-log-item"><time>user</time>${adminEsc(u.email || u.id)}</div>`).join("")}
      </div>
    </div>
  `;
  const list = body.querySelector("#adminDemoUsers");
  (data.demo_users || []).forEach((u) => {
    const row = document.createElement("div");
    row.className = "admin-log-item";
    const when = document.createElement("time");
    when.textContent = u.role || "user";
    const txt = document.createElement("span");
    txt.textContent = `${u.name} (${u.email}) — ${u.conversations} chats, ${u.messages} msgs, ${u.memories} memories`;
    row.append(when, txt);
    list.appendChild(row);
  });
  if (!data.demo_users?.length) {
    list.innerHTML = '<div class="admin-log-item"><time>—</time>No demo accounts.</div>';
  }
}

function renderAdminControls(body, stats) {
  const maintenance = !!stats.maintenance?.enabled;
  const announcement = stats.announcement?.text || "";
  body.innerHTML = "";
  const maintSection = document.createElement("div");
  maintSection.className = "admin-section";
  const maintTitle = document.createElement("h3");
  maintTitle.textContent = "Maintenance mode";
  const maintBtn = document.createElement("button");
  maintBtn.type = "button";
  maintBtn.className = `admin-control-btn${maintenance ? " danger" : ""}`;
  const paintMaint = (on) => {
    maintBtn.textContent = on ? "Disable maintenance" : "Enable maintenance";
    maintNote.textContent = on
      ? "ON — only admins can chat right now."
      : "Off — everyone can chat.";
  };
  const maintNote = document.createElement("p");
  maintNote.className = "dropdown-hint";
  let maintOn = maintenance;
  paintMaint(maintOn);
  maintBtn.addEventListener("click", async () => {
    const next = !maintOn;
    await adminFetch("/admin/maintenance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    });
    maintOn = next;
    stats.maintenance = { enabled: next };
    paintMaint(next);
  });
  maintSection.append(maintTitle, maintBtn, maintNote);

  const noteSection = document.createElement("div");
  noteSection.className = "admin-section";
  const noteTitle = document.createElement("h3");
  noteTitle.textContent = "Announcement banner";
  const noteInput = document.createElement("textarea");
  noteInput.className = "memory-input";
  noteInput.rows = 2;
  noteInput.maxLength = 300;
  noteInput.placeholder = "Shown to everyone at the top of the app…";
  noteInput.value = announcement;
  const noteRow = document.createElement("div");
  noteRow.className = "admin-row-actions";
  const publish = document.createElement("button");
  publish.type = "button";
  publish.textContent = "Publish";
  publish.addEventListener("click", async () => {
    if (!noteInput.value.trim()) return;
    const data = await adminFetch("/admin/announcement", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: noteInput.value.trim() }),
    });
    stats.announcement = data;
    showComposerToast("Announcement published");
    refreshAnnouncement();
  });
  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "danger";
  clear.textContent = "Clear";
  clear.addEventListener("click", async () => {
    await adminFetch("/admin/announcement", { method: "DELETE" });
    noteInput.value = "";
    stats.announcement = { text: "" };
    refreshAnnouncement();
  });
  noteRow.append(publish, clear);
  noteSection.append(noteTitle, noteInput, noteRow);
  body.append(maintSection, noteSection);
}

async function renderAdminLogs(body) {
  const data = await adminFetch("/admin/logs");
  body.innerHTML = "";
  const toolbar = document.createElement("div");
  toolbar.className = "admin-toolbar";
  const refresh = document.createElement("button");
  refresh.type = "button";
  refresh.textContent = "Refresh";
  refresh.addEventListener("click", () => renderAdminLogs(body));
  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "danger";
  clear.textContent = "Clear logs";
  clear.addEventListener("click", async () => {
    if (!confirm("Clear all admin logs?")) return;
    await adminFetch("/admin/logs", { method: "DELETE" });
    renderAdminLogs(body);
  });
  toolbar.append(refresh, clear);
  body.appendChild(toolbar);
  const list = document.createElement("div");
  list.className = "admin-log-list";
  (data.logs || []).slice().reverse().forEach((item) => {
    const row = document.createElement("div");
    row.className = "admin-log-item";
    const when = document.createElement("time");
    when.textContent = (item.time || "").slice(11, 19) || item.time || "";
    const txt = document.createElement("span");
    txt.textContent = item.message || "";
    row.append(when, txt);
    list.appendChild(row);
  });
  if (!data.logs?.length) {
    list.innerHTML = '<div class="admin-log-item"><time>—</time>No logs yet.</div>';
  }
  body.appendChild(list);
}

async function refreshAnnouncement() {
  const banner = document.getElementById("announceBanner");
  if (!banner) return;
  try {
    const res = await fetch(`${apiBaseUrl}/announcement`);
    const data = await res.json().catch(() => ({}));
    if (data?.text) {
      banner.textContent = data.text;
      banner.hidden = false;
    } else {
      banner.hidden = true;
    }
  } catch {
    banner.hidden = true;
  }
}

function closeDeveloperDashboard() {
  const panel = document.getElementById("adminDashboardPanel");
  if (!panel) return;
  panel.classList.remove("is-open");
  panel.hidden = true;
  panel.setAttribute("aria-hidden", "true");
}

const newChatBtn =
  document.querySelector(".new-chat-btn") ||
  document.getElementById("newChatBtn");
if (newChatBtn) {
  newChatBtn.onclick = startNewChat;
}

document
  .getElementById("sign-in-btn")
  ?.addEventListener("click", signInWithGoogle);
document.getElementById("sign-out-btn")?.addEventListener("click", async () => {
  if (authClient) {
    await authClient.auth.signOut();
  }
  localStorage.removeItem("nico_demo_auth_token");
  localStorage.removeItem("nico_demo_user");
  updateAuthUi(null);
});
document
  .getElementById("openAdminDashboardBtn")
  ?.addEventListener("click", openDeveloperDashboard);
document
  .getElementById("closeAdminDashboardBtn")
  ?.addEventListener("click", closeDeveloperDashboard);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeDeveloperDashboard();
  }
});

// Initial setup
ensureTypingIndicator();
initializeSettingsPanel();
initializeAuthScreen();
initializeAuth();
bootReminders();
refreshAnnouncement();
setInterval(refreshAnnouncement, 60000);
focusInput();
