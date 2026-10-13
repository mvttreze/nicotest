# Keep Nico + gateway online (Koyeb free, no card)

Goal: two programs running in the cloud so testers work while your
laptop sleeps. You will make two accounts and click through two setups.
Nothing here touches your laptop setup - that keeps working as-is.

## 0. Make the accounts (5 minutes)

1. Go to koyeb.com, sign up with GitHub. No card asked.
2. Go to uptimerobot.com, sign up with your email. No card asked.

## 1. Put the gateway online (the freellmapi thing)

This is the program that routes free AI models. In Koyeb:

1. Click Create Service (or Create App).
2. When it asks for the source, choose Docker image (NOT GitHub).
3. Paste exactly this: `ghcr.io/tashfeenahmed/freellmapi:latest`
4. Set the port to `3001`.
5. Find Health Check and set its path to `/`.
6. Open Environment Variables and add two:
   - Name `ENCRYPTION_KEY`. Value: any long random text. Make one here:
     open a terminal and run
     `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
     then paste what it prints.
   - Name `FREEAPI_CONFIG_JSON`. Value: your provider keys in this shape
     (swap in your real keys, keep the quotes and brackets):
     `{"keys":[{"platform":"groq","key":"PASTE-GROQ-KEY","label":"main"},{"platform":"google","key":"PASTE-GEMINI-KEY","label":"main"}],"routing":{"strategy":"balanced"}}`
7. Click Deploy. Wait until it says Running/Healthy (a few minutes).
8. Open the public URL Koyeb gives you. Create the admin account right away
   (the setup code it asks for is in the deploy log page).
9. On its Keys page, copy the unified key (starts with `freellmapi-`).
   Send me two things: the public URL and that unified key.

Why the keys go in step 6: this cloud disk forgets everything on restart,
so the keys are re-added automatically every boot from that setting.

Safety note: this page is on the public internet now. Strong admin
password, never share the URL. If that worries you, skip the gateway -
the Nico backend below still works, just without the gateway legs.

## 2. Put the Nico backend online

1. In Koyeb, Create Service again. This time choose GitHub and pick
   `mvttreze/nicotest`, branch `main`.
2. It finds the `Dockerfile` by itself. If it asks for the Dockerfile
   location, answer: `./Dockerfile` (repo root).
3. Set the port to `8000`. Health check path: `/health`.
4. Open Environment Variables and add the same settings Render has
   (copy each value from your Render dashboard):
   SUPABASE_URL, SUPABASE_KEY, SUPABASE_SERVICE_ROLE_KEY,
   SUPABASE_ANON_KEY, GROQ_API_KEY, GEMINI_API_KEY, OPENCODE_API_KEY,
   ADMIN_LOGIN, ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_EMAILS,
   ALLOWED_ORIGINS. Then add:
   - `FREELLMAPI_BASE_URL` = gateway URL from step 1 (no `/v1` at the end)
   - `FREELLMAPI_API_KEY` = unified key from step 1
   - `FREELLMAPI_CHAT_MODEL` = `auto`
   - `FREELLMAPI_IMAGE_MODEL` = `auto`
5. Click Deploy. Open `https://YOUR-BACKEND-URL/health` - you should see
   `"status":"ok"` with `"freellmapi":true`.

## 3. Stop Koyeb from sleeping (UptimeRobot)

Free services nap after 1 hour with no visitors. A free monitor that
visits every 5 minutes prevents that:

1. In UptimeRobot, Add Monitor, type HTTP(s).
2. Monitor 1: `https://YOUR-BACKEND-URL/health`, every 5 minutes.
3. Monitor 2: `https://YOUR-GATEWAY-URL/`, every 5 minutes.
4. Done. If a visit ever fails, worst case is a slow first reply
   (cold start), not an outage.

## 4. Test it

The website still talks to Render by default. To test through Koyeb,
tell me and I will flip the website address over temporarily, you
retest as the tester account, then I flip it back. Production stays
on Render until you say otherwise.

## If a deploy fails

Copy the red text from Koyeb's build/deploy log and send it to me.
The usual fixes are a missing env var (step 1.6 / 2.4) or a mistyped
key in the JSON (every quote and bracket must stay).
