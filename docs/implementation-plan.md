# Expand Studio — implementation plan

This plan implements [the product specification](product-spec.md). The local editor foundation and npm AI testing paths are implemented, including visible modes, grouped selections, optional Poisson blending, references, exact expansion geometry, history, projects, and PNG export. OpenAI, Gemini, OpenRouter, and experimental Kie Nano Banana Pro adapters have simulated-response checks; no live provider calls have been validated. The Tauri Windows shell is scaffolded; native AI access, credential storage, compilation, and Windows behavior remain unverified. See the README and [guide audit](guide-audit.md) for current commands, scope, and gaps.

## Development approach

Use the existing isolated checkout. Do not create another Git worktree unless requested. Inspect repository instructions before implementation and preserve existing user work.

Build working editing paths in small stages. Each stage must exercise real document behavior before the next adds more surface area. A styled interface with placeholder image operations is not a completed milestone.

Keep document operations independent of the React interface and AI providers. Put provider translation, credentials, jobs, and native file operations behind explicit boundaries. Build a browser preview for interface development, while retaining Windows desktop validation as a release requirement.

## 1. Document foundation and usable workspace

Set up React, TypeScript, Tauri, and Rust using compatible maintained releases and checked-in lockfiles. Establish the canvas, layer/asset representation, coordinate transforms, and a versioned project manifest before implementing AI operations.

Implement opening an image, correct orientation, Fit/zoom/pan, marquee and selection brush, mask display, add/subtract, basic undo/redo, and PNG export. Add project save/reopen for this initial document state. Provide real Poisson seam blending for local Patch, with a feather alternative and protected-pixel checks.

Completion evidence:

- Open a real PNG or JPEG and select the same document pixels at different viewing zoom levels.
- Apply a deterministic local patch through a mask; verify pixels outside the approved area remain unchanged.
- Undo and redo the patch; save, close, reopen, and compare the resulting composite.
- Export at the expected document dimensions.

Use deterministic fixtures for document-engine checks. Fixtures do not establish that an AI provider works.

## 2. First complete Generative Fill integration

Evaluate the current OpenAI editing endpoint and choose a supported model after checking actual capabilities, credentials, cost, and limits. Obtain credentials through supported secure settings when live testing becomes necessary; do not place them in source or project files.

Implement provider configuration, submission, result decoding, one or two alternatives, acceptance as a masked layer, and regeneration. Add the native credential-storage path and useful error states. Compose results against the pre-edit document using the saved mask and coordinates.

Completion evidence:

- Perform a real prompted edit and accept an alternative as a layer.
- Verify protected pixels, result placement, undo, and project reopening.
- Exercise authentication failure, provider error, stopped local waiting, and an uncertain submission without silently duplicating a request.
- Distinguish tests using simulated responses from live provider tests in the validation report.

## 3. Reference-guided inpainting and Remove

Add reference import, cropping, stable labels, enable/disable, optional roles, and same-subject groupings. Validate total input limits. Preserve reference assets and effective settings with generation records and projects.

Implement Remove through the shared selection, generation, comparison, and layer workflow. Add retained variation groups so revising a prompt does not discard earlier results.

Completion evidence:

- Replace an object using one reference and guide an edit using multiple references with different roles.
- Evaluate more than one view of the same object; record fidelity limitations.
- Check that each alternative receives the intended inputs and unsupported combinations fail before submission.
- Reopen the project after the external reference files have moved and recover the saved composite and reference context.

## 4. Generative Expand

Add proposed canvas bounds, edge/corner handles, numeric margins, aspect ratios, target dimensions, source positioning, and cancel/accept behavior. Connect natural continuation, prompts, and references to the provider adapter.

Implement original-pixel protection and an explicitly approved optional blending band. Coordinate multi-edge generation and define staged processing only where needed and tested.

Completion evidence:

- Expand one edge, a corner, and multiple sides while preserving scale and alignment.
- Verify that changing proposed dimensions does not submit requests.
- Compare alternatives on identical geometry; cancel or accept and then undo/redo.
- Hide expansion content without changing canvas bounds.
- Regenerate one unwanted expanded region while retaining the rest.

## 5. Selection and local editing completeness

Complete freehand and polygonal lasso, ellipse, selection transforms, inward feathering, mask import/export, and kept-mask refinement. Evaluate and integrate local Smart Select with a dependable manual fallback.

Complete Patch, crop/rotate/flip, placed-image layers and transforms, basic per-layer adjustments, and JPEG export with transparency handling. Keep operations consistent with the shared history and project model.

Completion evidence includes difficult object edges, mask refinement without generation, exact source-image placement, and local editing with no configured provider.

## 6. Recovery, performance, and Windows release

Extend recovery to complete projects, pending jobs, and available alternatives. Benchmark actual memory use with realistic large images, several layers, and alternatives. Establish supported pixel and side-length limits from evidence rather than assuming the 64-megapixel target is achieved.

Validate project compatibility, safe saving, color/orientation handling, shortcuts, text scaling, installation, credential storage, native file access, Smart Select, and recovery on Windows. Confirm source files and secrets are not required inside exported image data.

The first release is complete when the supported workflow passes functional and visual checks, known limitations are documented, and the Windows application can be installed and used through the complete edit/save/reopen/export sequence.

## 7. Extend provider coverage and advanced features

Add Kie.ai, Google Gemini, OpenRouter, and Stability AI using the same capability and job contracts. Test each model/operation combination before exposing it. Do not infer compatibility from provider membership or a model's ability to generate images.

Then evaluate four alternatives with bounded concurrency, magnetic selection, additional models, and other deferred functions against actual user needs and measured performance.

## Next implementation task

Validate the npm adapters with live provider keys on the user's PC, including difficult selections, reference fidelity, and expansion alignment. Then complete native Windows AI/credential integration, job recovery, retained alternatives, and the remaining guide requirements. Milestones are not complete merely because their initial UI and adapter paths exist.
