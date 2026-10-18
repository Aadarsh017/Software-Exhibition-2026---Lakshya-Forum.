# Health Chat Helper

An installable conversational AI medical and wellness assistant powered by **DeepSeek-V4.1-Flash** via **River AI**, deeply grounded in live clinical data from the **U.S. National Library of Medicine (NIH MedlinePlus)** and **U.S. Food and Drug Administration (OpenFDA)**.

All dummy and static data have been eliminated in favor of direct natural language interaction:
- **Conversational Intelligence:** Directly interacts with **DeepSeek-V4.1-Flash** on River AI for empathetic, nuanced, and context-aware dialogue.
- **Clinical Database Grounding:** Live, automated queries to NIH MedlinePlus (clinical conditions, red flags, causes) and OpenFDA (OTC drug label monographs, active ingredients, warnings) ground every response.
- **Safety & Triage:** Automatic real-time detection of high-risk red flags (chest pain, stroke signs, respiratory distress) with immediate emergency guidance.
- **Modern UI & Accessibility:** Full light/dark mode, text-to-speech (read aloud), voice dictation (speech-to-text), one-click clipboard copying, and a doctor-ready consultation report print/PDF exporter.
- **Privacy & Storage:** User conversations remain 100% private and stored locally on your device in `localStorage` under `health-chat-helper-records-v1`.
- **Zero-Dependency Architecture:** A lightweight, pure Node.js backend server with no external npm runtime dependencies securely handles LLM inference and live database requests.

---

## Getting Started

1. **Start the application:**
   ```bash
   npm start
   ```
2. Open [http://localhost:4173/](http://localhost:4173/) in your web browser.
3. Open [http://localhost:4173/dashboard.html](http://localhost:4173/dashboard.html) to view stored consultations on this device.

---

## Build and Benchmark

- Build optimized production bundle:
  ```bash
  npm run build
  ```
- Run compression and size benchmark:
  ```bash
  npm run benchmark
  ```
- Serve the compressed production build from `dist/`:
  ```bash
  npm run start:dist
  ```

---

## Key Files

- `index.html` — Modern conversational chat interface with dark mode, voice dictation, and doctor export modal.
- `styles.css` — Modern responsive design system with light/dark theme variables and glassmorphism styling.
- `app.js` — Client-side conversational controller, markdown parser, TTS, speech recognition, and API integration.
- `dashboard.html` & `dashboard.css` & `dashboard.js` — Private on-device consultation records manager.
- `service-worker.js` & `manifest.webmanifest` — Offline PWA support and application installation metadata.
- `icons/` — Application icons (SVG and PNG formats).
- `tools/serve.mjs` — Zero-dependency HTTP & API server with proxying for River AI, MedlinePlus, and OpenFDA.
- `tools/medical-api.mjs` — Clinical knowledge engine, concurrency retry/backoff, and emergency triage detector.
- `tools/build.mjs` — Production minification and gzip/Brotli pre-compression builder.
- `tools/benchmark.mjs` — Performance and bundle size measurement tool.
- `tools/generate-icons.mjs` — Native PNG icon generator.

---

## Clinical Disclaimer

This assistant provides evidence-based health and wellness information and is not a substitute for professional medical advice, diagnosis, or treatment. Always consult a qualified healthcare provider with any questions you may have regarding a medical condition. In case of a medical emergency, call emergency services (911 / 112) immediately.