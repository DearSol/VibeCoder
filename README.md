# Expand Studio

A standalone image-editing workspace built with React, TypeScript, and a Tauri desktop shell. This first implementation provides local editing. Generative Fill, reference-guided AI editing, and Generative Expand are planned and are not connected to providers yet.

## Run the editor

Use Node.js 24 and npm from the repository root:

```sh
npm ci
npm run dev
```

Open the development server reported by Vite in your browser. The cloud onboarding interface does not provide a user-facing local preview. The editor includes a bundled sample illustration; no external image service is required.

In this cloud workspace, if npm's default cache is unwritable, use `npm --cache /workspace/.npm-cache ci`.

## What works

To make a portable browser preview for another PC, run `npm run package:preview`.
Extract `release/Expand-Studio-PC-Preview.zip` on that PC, install Node.js 24 LTS,
then double-click `Start Expand Studio.bat`. The package includes the built app
and requires no dependency installation or API key. Keep its command window open
while editing. This package is not a native Windows installer; API-key settings
and AI generation are not implemented yet.

- PNG, JPEG, and WebP import, file drop, and image paste.
- Zoom, Fit, 100% view, and Space-drag panning.
- Rectangle and brush selections, replace/add/subtract, clear/select-all, mask overlay, and inward feathering.
- Local Patch: select the repair area, choose Patch, then drag **inside the selection** toward clean source pixels.
- **Poisson seam blending**, calculated in a cancellable background worker. It solves source gradients against the destination boundary and preserves pixels outside the approved mask. A faster feathered-copy mode is also available.
- Separate repair layers with visibility, opacity, naming, original comparison, and undo/redo.
- Self-contained `.expand` projects retaining original bytes, normalized image layers, and selection. Save/reopen does not require the source file.
- PNG export at document dimensions, including transparency.

Poisson uses a fast copied-pixel preview while positioning the sample, then calculates the actual blend on **Blend & apply repair**. Its result can differ from that preview because boundary matching changes source tones. Use Feather when exact sampled colors or transparency matter. Failed solves do not create a layer.

Current resource limits are 16 megapixels per document, 8,192 pixels per side, 32 layers, and 67,108,864 combined layer pixels. Poisson selection bounds are limited to 262,144 pixels, such as 512 × 512, and require opaque destination/sample pixels and an available destination boundary. The earlier 64-megapixel goal remains a later performance milestone.

Projects are versioned ZIP archives containing a JSON manifest and image assets. Browser saves download a new file; desktop builds use native open/save dialogs. Browser download initiation does not confirm that the user kept the file. Crash recovery, native atomic-save replacement, and full color-profile fidelity testing remain later work. Editing history is session-local; saved layers and the active selection persist across reopening.

## Desktop development

The Tauri shell includes user-selected file access and Windows installer configuration. Native compilation has not been validated in the current Linux environment, which lacks Rust and the required GTK/WebKit development packages.

On Windows, install the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) including Rust, the C++ build tools, and WebView2, then run:

```sh
npm ci
npm run desktop
```

To build the configured Windows installer:

```sh
npm run tauri -- build
```

Validate native dialogs, project save behavior, closing with unsaved work, and the installer on Windows before calling the desktop build ready. No AI credentials are required for the current local editor.

## Checks

```sh
npm run build
npm test
npx playwright install chromium
npm run test:e2e
```

When a system Chromium is available, use `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e` instead of downloading one.

Unit checks exercise selection geometry, protected holes, alpha, sampling, and the Poisson boundary-value solver. Browser checks perform real image import, local repair, pixel-by-pixel PNG comparison, undo/redo, layer visibility, project save/reopen, and invalid-project handling.

## Product documents

- [Product specification](docs/product-spec.md)
- [Implementation plan](docs/implementation-plan.md)
