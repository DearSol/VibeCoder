# Expand Studio

A standalone image-editing workspace built with React, TypeScript, and a Tauri desktop shell. The npm development app provides Generative Fill, Remove, Generative Expand, reference images, and local Patch through separate editing modes. AI adapters are implemented for OpenAI, Google Gemini, OpenRouter, and an experimental Kie Nano Banana Pro path. Provider payloads and app behavior are tested with simulated responses; live generation and visual quality have not been verified with real credentials.

## Run the editor

Use Node.js 24 and npm from the repository root:

```sh
npm ci
npm run dev
```

Open the development server reported by Vite in your browser. The cloud onboarding interface does not provide a user-facing local preview. The editor includes a bundled sample illustration; no external image service is required.

In this cloud workspace, if npm's default cache is unwritable, use `npm --cache /workspace/.npm-cache ci`.

On your Windows PC, clone the preview branch once:

```sh
git clone --branch codex/expand-studio-preview https://github.com/DearSol/VibeCoder.git
cd VibeCoder
npm ci
npm run dev
```

To update an existing clone, stop the running server with Ctrl+C, run `git pull origin codex/expand-studio-preview`, then `npm ci` and `npm run dev` again. Open the address printed by Vite. The AI service accepts requests from this PC's localhost editor only.

## Test AI editing

Choose **Generative Fill**, **Remove**, or **Generative Expand** above the canvas. In the right panel, choose your provider and an image-capable model. Open **API key**, enter your own key, and click **Use key**. Each provider has a separate key. A configured key means one is present, not that the provider accepted it.

Keys entered in the app live in the local Node server's memory until it stops. They are not saved in browser storage, project files, screenshots, or exports. To reuse keys across server restarts, copy `.env.example` to `.env.local`, fill in only the providers you use, and restart the server. This optional local file is plaintext and ignored by Git; never share it. Do not put keys in variables prefixed with `VITE_`.

For Fill, select an area and enter a prompt. Remove can use an empty prompt to reconstruct the background. Expand provides edge/corner handles and exact pixel margins, and can use an empty prompt for natural continuation. Bounds changes are previews and do not submit a request. Up to four optional reference images guide the same request. Results open for review before being accepted as a layer; you can discard them without changing the document.

AI input is currently normalized to a 1,024-pixel square context image. Small selections send a crop around the selected region; expansion sends the proposed canvas, padded to a square where necessary. All listed references are sent too, normalized to at most 1,024 pixels on their longest side. Document/export dimensions remain independent of AI input size. OpenAI receives a native mask; the other adapters receive a black/white selection guide. The app enforces the approved mask on returned content for every provider. Non-square results are rejected rather than guessing their placement. Content alignment and reference fidelity still depend on the model.

Provider charges apply when you submit. One result is requested per operation; no automatic retries occur. **Stop local waiting** stops the local wait and attempts to stop the local request, but the provider may continue and charge. A stopped/failed Kie task with a known ID can be checked again without uploading or submitting a new task. Jobs expire after 30 minutes or a server restart; persistent job recovery is not implemented yet.

| Provider      | Current adapter                                                       | Limitations                                                                                                                                                         |
| ------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenAI        | `/v1/images/edits`; default `gpt-image-1.5`                           | Requires access to the selected GPT Image editing model.                                                                                                            |
| Google Gemini | `generateContent` with image output; default `gemini-2.5-flash-image` | Visual selection guidance rather than a native mask; use an available image-generation model.                                                                       |
| OpenRouter    | Multimodal chat completions with image output                         | The chosen model must support both image input and image output.                                                                                                    |
| Kie.ai        | Upload, create/poll task, download result for `nano-banana-pro`       | Experimental. Its current official docs were inaccessible in the development environment; this adapter still needs a live check. Other Kie schemas are not enabled. |

Model IDs for OpenAI, Gemini, and OpenRouter are editable because account availability changes. This does not imply every model on those providers supports the adapter. Kie is restricted to the implemented schema. Stability AI, automatic compatible-model discovery, multiple alternatives, native Windows credential storage, and persistent generation recovery remain planned.

## What works

To make a portable browser preview for another PC, run `npm run package:preview`.
Extract `release/Expand-Studio-PC-Preview.zip` on that PC, install Node.js 24 LTS,
then double-click `Start Expand Studio.bat`. The package includes the built app
and requires no dependency installation or API key. Keep its command window open
while editing. This static package is for local editing; **AI testing requires
the source checkout and `npm run dev`**. It is not a native Windows installer.

- PNG, JPEG, and WebP import, file drop, and image paste.
- Zoom, Fit, 100% view, and Space-drag panning.
- Grouped rectangular/elliptical marquee and freehand/polygonal/magnetic lasso tools; selection brush, replace/add/subtract, clear/select-all/invert, mask overlay, and inward feathering. The magnetic lasso uses basic local edge snapping; it is not a Smart Select model.
- Larger interface text with Standard, Large, and Larger settings, independent of image zoom.
- Separate Fill, Remove, Expand, and Local Repair modes, with provider/model/key controls for AI operations.
- Local Patch: select the repair area, choose Patch, then drag **inside the selection** toward clean source pixels.
- **Poisson seam blending**, calculated in a cancellable background worker. It solves source gradients against the destination boundary and preserves pixels outside the approved mask. A faster feathered-copy mode is also available.
- Separate repair layers with visibility, opacity, naming, original comparison, and undo/redo.
- Self-contained `.expand` projects retaining original bytes, normalized image layers, selection, and accepted generation prompts/models/reference assets. Save/reopen does not require the source or reference files.
- PNG export at document dimensions, including transparency.

Poisson uses a fast copied-pixel preview while positioning the sample, then calculates the actual blend on **Blend & apply repair**. Its result can differ from that preview because boundary matching changes source tones. Use Feather when exact sampled colors or transparency matter. Failed solves do not create a layer.

For AI Fill/Remove, seam blending defaults to **None**, with optional Feather or Poisson. Expansion preserves all existing pixels and adds generated content only outside the old canvas; an optional inward overlap band remains planned.

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

Validate native dialogs, project save behavior, closing with unsaved work, and the installer on Windows before calling the desktop build ready. The production Tauri build does not yet include the Node AI service or Windows Credential Manager integration. Use the npm browser app for AI testing. No credentials are required for local repair.

## Checks

```sh
npm run build
npm test
npx playwright install chromium
npm run test:e2e
```

When a system Chromium is available, use `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e` instead of downloading one.

Unit checks exercise selection geometry, protected holes, alpha, sampling, Poisson solving, provider payload translation, authentication errors, cancellation, Kie polling/resume, local-origin access, and key separation. Browser checks perform real image import, local repair, pixel-by-pixel PNG comparisons, simulated AI review/acceptance, expansion placement, grouped selections, readable text, project save/reopen, reference persistence, and invalid-project handling. Simulated responses do not prove provider connectivity or generation quality.

## Product documents

- [Product specification](docs/product-spec.md)
- [Implementation plan](docs/implementation-plan.md)
- [Guide audit and current gaps](docs/guide-audit.md)
