# Nico Mobile (Capacitor — Android + iOS)

Electron equivalent for phones: wraps the existing Nico web app (repo root)
in a native WebView. One web codebase, native shells for both stores.

## How it works

- Web source of truth stays at the repo root (`index.html`, `script.js`,
  `style.css`, `nico-redesign.css`, `nico-ui.js`, `sw.js`, icons).
- `npm run sync:web` copies those into `nico-mobile/www/` (generated,
  gitignored — never hand-edit).
- Capacitor (`capacitor.config.js`, `appId: dev.nico.os`) bundles `www/`
  into native Android/iOS apps. API calls still hit
  `https://nicotest-1.onrender.com` over https.
- This folder is NOT part of the Render deploy (`render.yaml` copies an
  explicit file list only).

## Prereqs

- Node 20+ and npm
- Android builds: Android Studio + SDK (works on Windows)
- iOS builds: macOS + Xcode (Apple requirement — cannot build iOS on Windows)

## Quickstart

```sh
cd nico-mobile
npm install
npm run sync:web
npx cap add android   # once per machine (creates android/, gitignored)
npx cap add ios       # once per machine, on a Mac (creates ios/, gitignored)
npm run sync          # copy www + sync native projects
npx cap open android  # Android Studio
npx cap open ios      # Xcode (Mac only)
```

After any web change at the repo root, re-run `npm run sync` before
rebuilding in Android Studio / Xcode.

## Native features

Included plugins: App (deep links), Browser (OAuth), Keyboard, StatusBar,
SplashScreen, LocalNotifications (reminders/alarms), Share.

Still TODO before store submission:

1. **OAuth redirect**: Supabase Google/Apple sign-in needs a custom scheme
   (`nico://`) + universal/app links added to the native projects and to
   Supabase URL config. Currently sign-in works in-browser/PWA only.
2. **Push notifications**: local reminders work via plugin; remote push needs
   Firebase (Android) + APNs (iOS) keys.
3. **Icons/splash**: generate via `npx capacitor-assets` or Android
   Studio / Xcode asset catalogs (source: `icon-512.png`, `icon.svg`).
4. **Apple review**: the app must not be a raw URL loader — it bundles `www/`
   (offline shell) with native chrome, which is why `server.url` is unset.

## Conventions

- Never commit `node_modules/`, `www/`, `android/`, `ios/`, `dist/`, `.env`.
- Web fixes go in the repo root with `?v=fixNN` bumps, then `npm run sync`.
