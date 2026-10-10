// Capacitor config: native iOS + Android shell around the Nico web app.
// Source of truth for web assets is the repo root (index.html, script.js,
// style.css, ...). Run `npm run sync:web` to copy them into ./www before
// `npx cap sync`. Do NOT hand-edit ./www — it is generated (gitignored).
const config = {
  appId: "dev.nico.os",
  appName: "Nico",
  webDir: "www",
  backgroundColor: "#07050f",
  server: {
    // Bundled-file mode (offline shell, API calls go to Render over https).
    // No `url` here on purpose: a raw URL loader risks Apple rejection.
    androidScheme: "https",
    iosScheme: "https",
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      backgroundColor: "#07050f",
      showSpinner: false,
      launchShowDuration: 800,
    },
    StatusBar: {
      style: "dark",
      backgroundColor: "#07050f",
    },
    Keyboard: {
      resize: "body",
      resizeOnFullScreen: true,
    },
    LocalNotifications: {
      smallIcon: "ic_stat_nico",
      iconColor: "#6ea8ff",
    },
  },
};

module.exports = config;
