# Keep Nico + gateway online (Hugging Face Spaces, free, no card)

Goal: two programs running in the cloud so testers work while your
laptop sleeps. Same plan as before, different host: Koyeb killed its
free tier for new signups in Feb 2026 (Mistral acquisition, $29/mo
minimum), so do NOT pay there. Spaces are still free with just an email.

What you get: 2 CPUs / 16 GB per Space, sleeps after 48h with no
visitors (UptimeRobot below prevents that), disk forgets everything on
restart (both services below are built to survive that).

## 0. Make the accounts (5 minutes)

1. Go to huggingface.co, sign up with email. No card asked.
2. Go to uptimerobot.com, sign up with email. No card asked.

## 1. Put the gateway online (the freellmapi thing)

1. On Hugging Face, click your avatar, New Space.
2. Name it `nico-gateway`, license MIT, visibility Private (keeps the
   dashboard off Google), SDK: Docker.
3. In the Space, go to Files, Add file, Create a new file named
   `Dockerfile` with exactly this inside:
   `FROM ghcr.io/tashfeenahmed/freellmapi:latest`
4. Go to the Space Settings, find Variables and secrets. Add:
   - `PORT` = `7860` (Spaces only talk to this port)
   - `ENCRYPTION_KEY` = any long random text. Make one in a terminal:
     `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
   - `FREEAPI_CONFIG_JSON` = your provider keys, re-added every boot:
     `{"keys":[{"platform":"groq","key":"PASTE-GROQ-KEY","label":"main"},{"platform":"google","key":"PASTE-GEMINI-KEY","label":"main"}],"routing":{"strategy":"balanced"}}`
5. The Space rebuilds by itself (a minute or two). Open its URL at once
   and create the admin account (setup code is in the Build logs).
6. On its Keys page, copy the unified key (starts with `freellmapi-`).
   Send me two things: the Space URL and that unified key.

Safety note: this page is on the public internet now. Strong admin
password, never share the URL. The backend below works without it,
just without the gateway legs.

## 2. Put the Nico backend online

1. Create a second Space: name `nico-backend`, Private, SDK Docker.
2. Add a file named `Dockerfile` with exactly this inside:
   ```
   FROM python:3.11-slim
   ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
   WORKDIR /app
   RUN apt-get update && apt-get install -y --no-install-recommends git \
     && rm -rf /var/lib/apt/lists \
     && git clone --depth 1 https://github.com/mvttreze/nicotest.git . \
     && pip install --no-cache-dir --upgrade pip \
     && pip install --no-cache-dir -r requirements.txt
   CMD ["sh", "-c", "python3 -m gunicorn -w 1 -k uvicorn.workers.UvicornWorker main:app --bind 0.0.0.0:7860 --timeout 180"]
   ```
   (It clones this repo at build time, so pushes keep flowing in on
   every rebuild. Factory-reset the Space to pull the latest `main`.)
3. In Settings, Variables and secrets, add the same settings Render
   has (copy each value from your Render dashboard):
   SUPABASE_URL, SUPABASE_KEY, SUPABASE_SERVICE_ROLE_KEY,
   SUPABASE_ANON_KEY, GROQ_API_KEY, GEMINI_API_KEY, OPENCODE_API_KEY,
   ADMIN_LOGIN, ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_EMAILS,
   ALLOWED_ORIGINS. Then add:
   - `FREELLMAPI_BASE_URL` = gateway Space URL from step 1
   - `FREELLMAPI_API_KEY` = unified key from step 1
   - `FREELLMAPI_CHAT_MODEL` = `auto`
   - `FREELLMAPI_IMAGE_MODEL` = `auto`
4. Open `https://YOUR-SPACE-URL/health` - expect `"status":"ok"`
   with `"freellmapi":true`.

Note: free accounts are limited on Docker Spaces (currently two
running). These two are exactly the allowance - if Space creation
blocks Docker, tell me and we switch to the phone-Termux plan.

## 3. Stop the Spaces from sleeping (UptimeRobot)

1. Add Monitor, type HTTP(s):
   Monitor 1: `https://YOUR-BACKEND-SPACE/health`, every 5 minutes.
   Monitor 2: `https://YOUR-GATEWAY-SPACE/`, every 5 minutes.
2. Done. A missed visit only causes a slow first reply, not an outage.

## 4. Test it

The website still talks to Render by default. Tell me when both URLs
are live and I flip the website address over temporarily: you retest
as the tester account, then I flip it back. Production stays on
Render until you say otherwise.

## If a build fails

Open the Space, Build logs tab, copy the red text and send it to me.
Usual fixes: a mistyped secret (step 1.4 / 2.3) or broken JSON quotes
in FREEAPI_CONFIG_JSON (every quote and bracket must stay).
