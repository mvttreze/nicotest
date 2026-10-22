# mvtt | student developer

Personal portfolio of **mvtt**, a front-end & full-stack developer based in Dagupan City, Philippines.

Built with plain HTML/CSS/JavaScript — no frameworks, no build step. Just open `index.html`.

## Features
- Dark mode (system + manual toggle, persisted in `localStorage`)
- Canvas fireworks on click / "Pull the pin"
- Scroll spy, back-to-top, reading progress bar
- Work project filter with live counts
- Music toggle (optimized audio)
- Reveal-on-scroll animations, respects `prefers-reduced-motion`
- Manila (PHT) live clock in the hero

## Folder structure
```
index.html    # markup
style.css     # styles (custom properties, dark mode, animations)
script.js     # vanilla JS interactions
reze.png      # favicon
hh.png        # asset
background-optimized.mp4   # hero background (optimized)
music-optimized.mp3        # background track (optimized)
```

## Deploy
This is a static site — deploy anywhere that hosts static files:
- GitHub Pages
- Netlify Drop
- Vercel
- Render static

## Notes
- Unoptimized originals (`background.mp4`, `music.mp3`) were removed; the HTML references the `-optimized` versions only.
- In `script.js`, replace `you@domain.com` (the `TO` variable) with your real email so the contact form's mailto works.

— mvtt · 2026
