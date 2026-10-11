# Expand Studio — product specification

Status: working baseline for implementation.

## Product goal

Build a Windows desktop application that reproduces the practical workflow of generative editing in Photoshop: select an area, describe or reference a change, generate alternatives, refine the result, and keep it as a reversible edit.

The main task is editing an existing image. The application supplies its own canvas, selection tools, masks, layers, history, project files, and recovery. External AI providers supply generation. Provider output quality and available controls will vary.

The planned stack is React and TypeScript for the interface, with Tauri and Rust for desktop integration and native processing. The browser build is a development preview initially. Windows packaging and native integrations require Windows validation.

## First-release scope

| Action            | Required behavior                                                                                                                   |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Generative Fill   | Edit a selection with a prompt and optional reference images. Inpainting uses this same action.                                     |
| Remove            | Reconstruct the background in a selected or painted area.                                                                           |
| Generative Expand | Extend the canvas while preserving the scale of the existing image; support optional prompts and references.                        |
| Local Repair      | Copy a sampled region into a selected area using Patch, with inward feathering or Poisson seam blending. This is a local operation. |

Supporting functionality includes import/export, crop and orientation tools, image placement as a layer, selections, masks, variations, edit layers, comparisons, undo/redo, projects, recovery, and provider settings.

## Workspace and onboarding

- Open an image through a file picker, drag-and-drop, or clipboard where supported. Local editing works before provider configuration.
- Use a central canvas, grouped selection tools, contextual editing controls, a variation browser, and accessible Layers and References panels.
- Provide Fit, wheel zoom, panning, Space-drag, keyboard shortcuts, and adjustable interface text size.
- Request provider configuration when generation needs it. Clearly distinguish API access and billing from any consumer subscription.
- Present advanced model controls only when the selected model supports them.

## Images and basic editing

- First-release imports: PNG, JPEG, and WebP. Exports: PNG and JPEG, including JPEG quality and an explicit background choice when flattening transparency.
- Handle EXIF orientation and color profiles consistently. Establish a documented working color representation; retain the imported source asset.
- Include crop, rotate, flip, and image placement with move, resize, and rotate controls. Preserve source assets so edits remain reversible.
- Support basic brightness, contrast, saturation, and color adjustment for accepted edit layers.
- Treat 64 megapixels as a target to benchmark, not an established performance guarantee. Define actual pixel, side-length, and memory limits from measurements, including projects with layers and alternatives.
- Keep document dimensions distinct from provider generation dimensions. Report returned dimensions and any enlargement applied to generated content.

## Selections and masks

- Include freehand and polygonal lasso, rectangular and elliptical marquee, selection brush, replace/add/subtract, select all/invert/clear, grow/shrink, movement, and inward feathering.
- Provide mask visualization and selection undo/redo. Support mask import/export with dimension and placement validation.
- Use one document-coordinate system for selections and edits, independent of viewing zoom and pan.
- Prioritize Smart Select with include/exclude corrections. MobileSAM is the proposed local implementation and must be evaluated for selection quality, distribution requirements, and performance before adoption.
- Keep manual tools usable when Smart Select is unavailable.
- Allow users to paint and refine an accepted edit's mask without another AI request.

## Generative Fill and reference-guided inpainting

The current visible document supplies the destination image and scene context. The active selection identifies the approved editing area.

Users can add references through files or clipboard, crop them, enable or disable them, and assign stable labels. Start with up to four references, further restricted by the model's verified total input limit. Base images and additional context images count toward that limit.

Optional reference roles are object/subject, material/texture, style, and structure/pose. Several images may depict different views of the same subject. Roles and groupings help construct instructions; they are guidance unless the model exposes dedicated controls.

All enabled references guide each requested alternative. Reference count and alternative count are independent. A model must support the required combination of image inputs and editing controls; the application must not silently drop references or substitute a collage.

Only expose reference strength, fidelity, seed, or similar settings when they have a meaningful supported implementation. Reference guidance does not promise exact likeness, product details, text, or logos. Ordinary image placement provides an option for retaining exact source content.

## Generative Expand

- Drag any edge or corner, enter per-edge distances, choose an aspect ratio, or enter target canvas dimensions.
- Position the existing image within the proposed canvas without automatically scaling it. Expansion presets retain the full existing image; cropping is a separate explicit operation.
- Preview existing and proposed areas distinctly, with dimensions visible before submission. Canvas adjustment alone does not submit a paid request.
- Support natural continuation without a prompt, optional descriptive prompts, and optional references. The existing image remains the main scene context.
- Generate several sides coherently where supported. Larger requests may need staged processing, with additional calls and costs explained before submission.
- Preserve existing pixels by default. An optional blending band inside the existing image must be visibly included in the approved editing area.
- Permit subsequent selection and regeneration of an unwanted part of the expansion using Generative Fill.
- Alternatives for one expansion use the same canvas bounds and source placement. Cancel restores the pre-operation canvas and content; accepting an expansion creates one undoable operation.

## Pixel preservation and compositing

For each operation, preserve the visible pre-edit composite outside the approved editing mask. This refers to pixels in the application's working image representation, rather than identical compressed source-file bytes.

Enforce this during compositing even if a provider modifies other parts of its output. Translate masks to each provider's format. Inward feathering must not alter pixels outside the approved area.

Provide Poisson seam blending as an explicit alternative to feathered compositing. It matches gradients to the destination boundary inside the approved mask, and may shift source colors. Keep a color-preserving feather option. The shared solver must accept a separate source image so later generated edits can use it. Run expensive solves away from the interface thread, support cancellation, and report failed convergence without silently accepting an unfinished result. The initial local implementation supports opaque areas and caps selection bounds at 262,144 pixels; benchmark larger domains before raising that limit.

Map generated content back using explicit dimensions and coordinates. Cropping context for a provider, changing view zoom, or receiving a different output resolution must not resample the entire document or move unrelated content. Protected pixels alone do not establish visual quality: alignment, perspective, lighting, and seams need separate evaluation.

## Layers, alternatives, and history

- Retain the original and accepted edits with names, visibility, applicable opacity controls, editable masks, and basic adjustments.
- Maintain an ordered layer stack initially. Arbitrary reordering and complex blend modes are later work.
- Keep alternatives grouped by operation, including earlier groups when the user revises a prompt. Support inspection at document scale, regeneration, acceptance, and explicit disposal.
- Preserve the prompt, provider/model, effective settings, mask, reference assets and crops, and placement information with an accepted generation. Saved context supports future regeneration but does not guarantee identical output.
- Later AI edits reflect the context used when they were generated. Hiding earlier edits does not regenerate later content.
- Canvas geometry belongs to document history. Hiding expansion content does not shrink the canvas; undoing geometry follows the history sequence.
- Compare Original and Before edit at aligned positions and the same viewing scale, including after expansion.

## Providers and generation jobs

The intended provider roadmap includes Kie.ai, OpenAI, Google Gemini, OpenRouter, and Stability AI. Implement one complete provider path before extending coverage. OpenAI is the initial candidate because its documented edit interface accepts multiple input images and applies a mask to the first image; live integration and visual quality remain unverified.

Use explicit capabilities for each tested model: operations, reference support and limits, mask behavior, dimensions, output count, job polling, supported controls, and available cost information. Named models in the original outline, including Kie Seedream 5 Flash, remain candidates until their endpoints and behavior are verified.

The initial interface offers one or two alternatives; the planned extension supports up to four with bounded concurrency. Show job state and elapsed time. Show cost estimates only where reliable; otherwise state that cost is unavailable before submission.

Track queued, submitted, processing, completed, failed, and stopped-locally states. Stop prevents queued submissions and ends local waiting; it must not imply provider cancellation or avoided charges unless confirmed. Preserve task identifiers and uncertain submission states. Recovery must avoid silently resubmitting an operation that may already have incurred charges.

Store API keys separately using Windows Credential Manager. Keep keys out of projects, exports, and diagnostic logs. Explain which image or cropped region is sent for generation.

## Projects and recovery

An `.expand` project is versioned and self-contained. It retains the original image, accepted edits, masks, references and crops, settings, canvas geometry, and the assets needed to reproduce the saved composite without another provider call.

Use safe save replacement and workspace recovery. Preserve available generated alternatives and recoverable job metadata. Reopening must not depend on moved source files or expired provider download links. Recovery instructions must distinguish inspecting an existing job from creating a new generation.

## Deferred scope

- A separately supported browser product.
- Magnetic Lasso and advanced selection tools beyond the initial set.
- Broad automatic model-catalog discovery before compatibility validation.
- Arbitrary layer reordering, complex blend modes, extensive filters, typography, and vector drawing systems.
- Batch expansion, independent prompts for each canvas edge, and multiple independently assigned reference groups within one generation.

## Release evidence

Before release, demonstrate: protected pixels remain unchanged; selections align across zoom and pan; expansion preserves image scale and placement; history and layer visibility remain predictable; references survive reopening; project composites reopen correctly; interrupted jobs do not silently duplicate submissions; and realistic large documents stay within tested resource limits.

Run visual evaluations for object replacement, material guidance, removal, multi-edge expansion, and boundary repair. Document provider-specific limitations. Validate the Windows installer, credential storage, native dialogs, local Smart Select, and recovery on Windows.

## Reference

OpenAI's public SDK documents the multi-image edit input and first-image mask behavior: https://github.com/openai/openai-python/blob/main/src/openai/types/image_edit_params.py . This is interface evidence, not a completed generation test.
