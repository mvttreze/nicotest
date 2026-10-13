# Keeping Nico online for testers (free, no card)

Decision: everything stays on Render + the laptop. No new hosts.
(Koyeb went paid-only; Hugging Face paywalled compute; no spare phone.)

## 1. Keep the Render backend awake (do this today)

Render sleeps free services after 15 min with no visitors, and waking
takes about a minute. One awake service fits the 750 free hours/month
(a month is 744h max), so a single keepalive monitor covers it:

1. Sign up at uptimerobot.com (email only, no card).
2. Add Monitor, type HTTP(s):
   URL `https://nicotest-1.onrender.com/health`, every 5 minutes.
3. Done. Direct legs (Groq/Zen) now serve testers around the clock.

Gray area, stated plainly: Render docs do not ban uptime monitors,
but sleeping is how they control free costs. Worst realistic case is
hitting the 750h cap in a 31-day month and napping until the 1st. If
that ever bites, the $7/mo plan is the honest fix.

## 2. Gateway legs (laptop-dependent, by design)

The gateway runs on the laptop (`NicoStack` logon task from
`install_nico_autostart.ps1`). Tester gateway legs - gateway chat
fallback, gateway images, and anything the local backend serves -
work while the laptop is on and stop when it sleeps. That is accepted:
direct legs cover testers 24/7 via step 1.

Do NOT set FREELLMAPI_* env vars on Render: Render cannot reach
`localhost:3001`, and the code correctly stays dormant without them
(health shows `freellmapi:false` there, `true` locally).

## 3. What testers get

- 24/7: chat (Groq/Zen), titles, memory, all standard features.
- Laptop-on hours: gateway fallback chat, gateway images, `/cli`
  in the desktop app.
- The tester role stays scoped as built: tester unlocks gateway + CLI
  only, never Zen.

## If something fails

- Backend slow first thing in the morning: normal cold start, or the
  UptimeRobot monitor paused - check its dashboard first.
- Gateway legs failing locally: `http://localhost:3001` must load;
  if not, `node server/dist/index.js` in `%USERPROFILE%\freellmapi`.
