# Keeping Nico online for testers (free, no card)

Situation: every free compute host either charges now (Koyeb: paid-only
since the Mistral deal; Hugging Face: Docker/Gradio creation needs PRO
since July 2026) or sleeps. So the plan uses what still works free:

- Backend: stays on Render. One awake service fits the 750 free
  hours/month (a month is 744h max). UptimeRobot below keeps it awake.
- Gateway: your Android phone via Termux (no card, no new hardware,
  nothing against anyone's terms).

## 1. Keep the Render backend awake (10 minutes)

Render sleeps free services after 15 min with no visitors, and waking
takes about a minute. A free UptimeRobot monitor fixes that:

1. Sign up at uptimerobot.com (email only, no card).
2. Add Monitor, type HTTP(s):
   URL `https://nicotest-1.onrender.com/health`, every 5 minutes.
3. Done. The backend now stays warm around the clock on the free
   allowance. Static frontend was never the problem (static is free).

Gray area, stated plainly: Render docs do not ban uptime monitors,
but sleeping is how they control free costs. Worst realistic case is
hitting the 750h cap late in a 31-day month and napping until the
1st. If that ever bites, the $7/mo plan is the honest fix.

## 2. Put the gateway on your phone (Termux)

The laptop gateway dies with the laptop. A plugged-in phone does not.
FreeLLMAPI documents a Termux install (Node SQLite driver, no extra
toolkit needed).

On the phone:

1. Install Termux and Termux:API from F-Droid (not the dead Play
   Store build), plus the Tailscale app. Tailscale personal is free.
2. In Termux:
   `pkg update && pkg install nodejs git`
   `git clone https://github.com/tashfeenahmed/freellmapi.git`
   `cd freellmapi && npm install`
3. Copy the gateway `.env` values from the laptop install
   (ENCRYPTION_KEY and PORT=3001; never the database file).
   Provider keys go on the Keys page or via FREEAPI_CONFIG_JSON.
4. Start it: `node server/dist/index.js` (build first with
   `npm run build` if `server/dist` is missing).
5. Keep Termux alive: run `termux-wake-lock`, and in Android settings
   turn OFF battery optimization for Termux and Termux:API.
6. For Reachability from Render: `pkg install tailscale && tailscale up`,
   then expose it (Tailscale Serve/Funnel gives a public https URL).
   Set the Render backend env `FREELLMAPI_BASE_URL` to that URL and
   `FREELLMAPI_API_KEY` to the phone gateway's unified key.

Caveats: I have not run this exact stack on your phone model - the
gateway documents Termux, the Nico backend on Termux is try-it-and-see
(pillow/reportlab may want extra packages). Phone stays plugged in.

## 3. What testers get

- Backend + direct legs: 24/7 via Render + keepalive (step 1 works
  the day you add the monitor).
- Gateway legs (/cli models, gateway images): 24/7 once the phone
  gateway is up and wired into Render env (step 2). Until then they
  work whenever the laptop gateway runs, same as today.

## If a step fails

Send me the exact error text (Termux output, Tailscale status, or the
Render log line) and which step number. Do not paste private keys.
