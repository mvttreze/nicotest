# Nico on Koyeb (free, no card) + UptimeRobot keepalive

Two services. The Nico backend AND the FreeLLMAPI gateway both need hosting:
a backend on Koyeb pointing at a laptop gateway would lose the gateway legs
the moment the laptop sleeps.

## Service 1: gateway (public image, no build)

- Type: Web Service. Source: Docker image
  `ghcr.io/tashfeenahmed/freellmapi:latest`.
- Port: `3001`. Health check path: `/`.
- Env vars:
  - `ENCRYPTION_KEY` = fresh random hex (generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
  - `FREEAPI_CONFIG_JSON` = your provider keys, re-applied every boot
    (disk is ephemeral, so this is how keys survive restarts):
    `{"keys":[{"platform":"groq","key":"gsk_...","label":"main"},{"platform":"google","key":"AIza...","label":"main"}],"routing":{"strategy":"balanced"}}`
- After first deploy, open its URL immediately and create the admin account
  (setup code is in the deploy logs). Copy the unified `freellmapi-...` key
  from its Keys page header - you need it for Service 2.
- Security note: this gateway is designed local-first. Public exposure is
  guarded only by the dashboard password + unified key. Use a strong admin
  password, never share the URL, and skip this service if that bothers you
  (the backend keeps working on direct legs without it).

## Service 2: Nico backend (this repo)

- Type: Web Service. Source: GitHub repo `mvttreze/nicotest`, branch `main`,
  Dockerfile at repo root (`./Dockerfile`).
- Port: `8000`. Health check path: `/health`.
- Env vars: same values as Render - `SUPABASE_URL`, `SUPABASE_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `GROQ_API_KEY`,
  `GEMINI_API_KEY`, `OPENCODE_API_KEY`, `ADMIN_LOGIN`, `ADMIN_EMAIL`,
  `ADMIN_PASSWORD`, `ADMIN_EMAILS`, `ALLOWED_ORIGINS`, plus:
  - `FREELLMAPI_BASE_URL` = Service 1 public URL (no trailing slash, no `/v1`)
  - `FREELLMAPI_API_KEY` = Service 1 unified key
  - `FREELLMAPI_CHAT_MODEL` = `auto`, `FREELLMAPI_IMAGE_MODEL` = `auto`

## Keepalive (both services)

UptimeRobot (free, no card): two HTTP monitors, 5-minute interval:
- `https://<nico-service>/health` (expect 200)
- `https://<gateway-service>/` (expect 200)

Without this, Koyeb sleeps free services after 1h idle. Worst case on a
missed ping is a cold start, not an outage.

## Pointing a frontend at Koyeb (test windows only)

The web bundle targets Render by default. To test through Koyeb, temporarily
set the `nico-api-url` meta in `index.html` to the Service 2 URL, push,
retest, then revert. Production stays on Render until you say otherwise.
