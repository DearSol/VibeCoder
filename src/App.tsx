import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleHelp,
  Eye,
  EyeOff,
  FileImage,
  FolderOpen,
  Hand,
  ImagePlus,
  Layers3,
  LoaderCircle,
  Maximize,
  Minus,
  MousePointer2,
  Paintbrush,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  Scan,
  SlidersHorizontal,
  SquareDashed,
  Undo2,
  X,
} from 'lucide-react';
import { EditorCanvas, type CanvasHandle, type Tool } from './components/EditorCanvas';
import {
  assertLayerBudget,
  commit,
  composite,
  context,
  emptyHistory,
  importImage,
  pixelsToCanvas,
  redo,
  toPng,
  undo,
  type EditorDocument,
  type Layer,
} from './model/document';
import {
  createPatch,
  featherMask,
  selectionBounds,
  type Point,
  type SelectionMode,
} from './model/pixels';
import { blendInWorker } from './model/blend-worker';
import { createDemo, loadProject, saveProject } from './io/project';
import { isTauri, openNativeFile, saveFile } from './io/files';

function IconButton({
  label,
  children,
  active,
  ...props
}: {
  label: string;
  children: ReactNode;
  active?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`icon-button ${active ? 'active' : ''}`}
      title={label}
      aria-label={label}
      {...props}
    >
      {children}
    </button>
  );
}
function Thumbnail({ surface }: { surface: HTMLCanvasElement }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const output = ref.current!,
      ctx = context(output);
    ctx.clearRect(0, 0, 88, 68);
    const scale = Math.min(88 / surface.width, 68 / surface.height);
    ctx.drawImage(
      surface,
      (88 - surface.width * scale) / 2,
      (68 - surface.height * scale) / 2,
      surface.width * scale,
      surface.height * scale,
    );
  }, [surface]);
  return <canvas width={88} height={68} ref={ref} className="layer-thumbnail" aria-hidden="true" />;
}

const tools: { id: Tool; label: string; key: string; icon: ReactNode }[] = [
  { id: 'marquee', label: 'Marquee selection', key: 'M', icon: <SquareDashed /> },
  { id: 'brush', label: 'Selection brush', key: 'B', icon: <Paintbrush /> },
  { id: 'patch', label: 'Local patch', key: 'P', icon: <Scan /> },
  { id: 'hand', label: 'Hand tool', key: 'H', icon: <Hand /> },
];

export default function App() {
  const [history, setHistory] = useState(emptyHistory),
    doc = history.present;
  const [tool, setTool] = useState<Tool>('marquee');
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('replace');
  const [brushSize, setBrushSize] = useState(64),
    [feather, setFeather] = useState(0);
  const [showMask, setShowMask] = useState(true),
    [compare, setCompare] = useState(false);
  const [blendMode, setBlendMode] = useState<'poisson' | 'feather'>('poisson');
  const [patchOffset, setPatchOffset] = useState<Point>({ x: 0, y: 0 });
  const [selectedLayer, setSelectedLayer] = useState('');
  const [opacityPreview, setOpacityPreview] = useState<{ id: string; value: number } | undefined>();
  const [zoom, setZoom] = useState(1),
    [pointer, setPointer] = useState<Point | null>(null);
  const [status, setStatus] = useState('A little room for your next idea.');
  const [busy, setBusy] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null);
  const [savedRevision, setSavedRevision] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null),
    [help, setHelp] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const input = useRef<HTMLInputElement>(null),
    canvasRef = useRef<CanvasHandle>(null),
    abortRef = useRef<AbortController | null>(null);
  const dirty = !!doc && doc.revision !== savedRevision;
  const bounds = useMemo(
    () => (doc ? selectionBounds(doc.selection, doc.width, doc.height) : null),
    [doc?.selection, doc?.width, doc?.height],
  );
  const visible = useMemo(
    () => (doc ? composite(doc, opacityPreview) : null),
    [doc?.layers, doc?.width, doc?.height, opacityPreview],
  );
  const sourcePixels = useMemo(
    () => (visible ? context(visible).getImageData(0, 0, visible.width, visible.height) : null),
    [visible],
  );
  const effectiveMask = useMemo(
    () => (doc ? featherMask(doc.selection, doc.width, doc.height, feather) : null),
    [doc?.selection, doc?.width, doc?.height, feather],
  );
  const patchPreview = useMemo(() => {
    if (
      !doc ||
      !sourcePixels ||
      !effectiveMask ||
      tool !== 'patch' ||
      (!patchOffset.x && !patchOffset.y)
    )
      return null;
    try {
      const patch = createPatch(sourcePixels, effectiveMask, patchOffset.x, patchOffset.y);
      return patch ? { canvas: pixelsToCanvas(patch), x: patch.x, y: patch.y } : null;
    } catch {
      return null;
    }
  }, [doc?.width, doc?.height, sourcePixels, effectiveMask, patchOffset, tool]);
  const activeLayer = doc?.layers.find((layer) => layer.id === selectedLayer) || doc?.layers.at(-1);

  useEffect(() => {
    setPatchOffset({ x: 0, y: 0 });
    setOpacityPreview(undefined);
  }, [doc?.revision]);
  useEffect(() => {
    const listener = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', listener);
    return () => window.removeEventListener('beforeunload', listener);
  }, [dirty]);

  const changeDocument = (next: EditorDocument) => {
    setHistory((current) => commit(current, next));
    setCompare(false);
  };
  const chooseTool = (next: Tool) => {
    setTool(next);
    setCompare(false);
    setPatchOffset({ x: 0, y: 0 });
  };
  const run = async (label: string, operation: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await operation();
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError')
        setStatus('Blending cancelled. Your image is unchanged.');
      else
        setError(
          caught instanceof Error ? caught.message : 'The operation could not be completed.',
        );
    } finally {
      setBusy(null);
      abortRef.current = null;
    }
  };
  const openFile = (file: File) =>
    run('Opening document…', async () => {
      const project = /\.expand$/i.test(file.name);
      const next = project ? await loadProject(file) : await importImage(file);
      setHistory({ past: [], present: next, future: [] });
      setSavedRevision(project ? next.revision : null);
      setSelectedLayer(next.layers.at(-1)!.id);
      setCompare(false);
      setTool('marquee');
      setFeather(0);
      setStatus(
        project
          ? 'Project restored. All image assets are included.'
          : 'Image opened. Select an area to begin.',
      );
    });
  const requestOpen = async (file: File) => {
    if (dirty) setPendingFile(file);
    else await openFile(file);
  };
  const pickFile = () => {
    if (isTauri())
      void run('Reading file…', async () => {
        const file = await openNativeFile();
        if (file) await requestOpen(file);
      });
    else input.current?.click();
  };
  const demo = () =>
    void run('Opening sample…', async () => {
      const file = await createDemo();
      await requestOpen(file);
    });
  const save = () => {
    if (doc)
      void run('Saving project…', async () => {
        const bytes = await saveProject(doc);
        const success = await saveFile(
          new Blob([new Uint8Array(bytes)], { type: 'application/zip' }),
          `${safeName(doc.name)}.expand`,
          'expand',
        );
        if (success) {
          setSavedRevision(doc.revision);
          setStatus(
            isTauri()
              ? 'Project saved with layers and selection.'
              : 'Project download started. Keep the .expand file to continue editing.',
          );
        }
      });
  };
  const exportImage = () => {
    if (doc && visible)
      void run('Exporting image…', async () => {
        if (await saveFile(await toPng(visible), `${safeName(doc.name)}.png`, 'png'))
          setStatus(
            `PNG exported at ${doc.width.toLocaleString()} × ${doc.height.toLocaleString()} pixels.`,
          );
      });
  };
  const select = (mask: Uint8ClampedArray) => {
    if (doc) {
      changeDocument({ ...doc, selection: mask });
      setStatus('Selection updated. Use Patch to repair this area.');
    }
  };
  const clearSelection = () => {
    if (doc && bounds) select(new Uint8ClampedArray(doc.selection.length));
  };
  const modifyLayer = (
    id: string,
    changes: Partial<Pick<Layer, 'name' | 'visible' | 'opacity'>>,
  ) => {
    if (doc)
      changeDocument({
        ...doc,
        layers: doc.layers.map((layer) => (layer.id === id ? { ...layer, ...changes } : layer)),
      });
  };
  const commitOpacity = () => {
    if (
      opacityPreview &&
      doc?.layers.find((layer) => layer.id === opacityPreview.id)?.opacity !== opacityPreview.value
    )
      modifyLayer(opacityPreview.id, { opacity: opacityPreview.value });
    setOpacityPreview(undefined);
  };
  const applyPatch = () => {
    if (!doc || !sourcePixels || !effectiveMask || !patchPreview) return;
    void run(blendMode === 'poisson' ? 'Blending seam…' : 'Applying repair…', async () => {
      assertLayerBudget(doc, patchPreview.canvas.width * patchPreview.canvas.height);
      const controller = new AbortController();
      abortRef.current = controller;
      const patch =
        blendMode === 'poisson'
          ? await blendInWorker(
              sourcePixels,
              effectiveMask,
              patchOffset.x,
              patchOffset.y,
              controller.signal,
              setBusy,
            )
          : createPatch(sourcePixels, effectiveMask, patchOffset.x, patchOffset.y);
      if (!patch) return;
      const count = doc.layers.filter((layer) => layer.kind === 'patch').length + 1;
      const layer: Layer = {
        id: crypto.randomUUID(),
        name: `${blendMode === 'poisson' ? 'Poisson' : 'Patch'} repair ${count}`,
        kind: 'patch',
        canvas: pixelsToCanvas(patch),
        x: patch.x,
        y: patch.y,
        opacity: 1,
        visible: true,
      };
      changeDocument({ ...doc, layers: [...doc.layers, layer] });
      setSelectedLayer(layer.id);
      setTool('marquee');
      setStatus('Repair added as a layer. Pixels outside your selection are preserved.');
    });
  };

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest('input, textarea, select, [contenteditable]'))
        return;
      const command = event.ctrlKey || event.metaKey,
        lower = event.key.toLowerCase();
      if (command && ['o', 's', 'z', 'y', 'a', 'd'].includes(lower)) event.preventDefault();
      if (busy || pendingFile || help) return;
      if (command) {
        if (lower === 'o') pickFile();
        if (lower === 's') event.shiftKey ? exportImage() : save();
        if (lower === 'z')
          setHistory((current) => (event.shiftKey ? redo(current) : undo(current)));
        if (lower === 'y') setHistory(redo);
        if (lower === 'a' && doc) select(new Uint8ClampedArray(doc.selection.length).fill(255));
        if (lower === 'd') clearSelection();
        return;
      }
      if (doc) {
        const next = tools.find((entry) => entry.key.toLowerCase() === lower);
        if (next) chooseTool(next.id);
        if (lower === 'escape') {
          setPatchOffset({ x: 0, y: 0 });
          setCompare(false);
          if (tool === 'patch') setTool('marquee');
          else clearSelection();
        }
        if (lower === '0') canvasRef.current?.fit();
        if (lower === '+' || lower === '=') canvasRef.current?.zoomBy(1.25);
        if (lower === '-') canvasRef.current?.zoomBy(0.8);
      }
    };
    const paste = (event: ClipboardEvent) => {
      if (busy || (event.target as HTMLElement).closest('input, textarea, [contenteditable]'))
        return;
      const file = Array.from(event.clipboardData?.files || []).find((file) =>
        file.type.startsWith('image/'),
      );
      if (file) {
        event.preventDefault();
        requestOpen(file);
      }
    };
    window.addEventListener('keydown', key);
    window.addEventListener('paste', paste);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('paste', paste);
    };
  });

  const selectedOpacity =
    opacityPreview && opacityPreview.id === activeLayer?.id
      ? opacityPreview.value
      : (activeLayer?.opacity ?? 0);
  return (
    <div
      className="app"
      aria-busy={!!busy}
      onDragOver={(event) => {
        event.preventDefault();
        if (!busy) setDragOver(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragOver(false);
        const file = event.dataTransfer.files[0];
        if (file && !busy) requestOpen(file);
      }}
    >
      <input
        ref={input}
        type="file"
        accept=".png,.jpg,.jpeg,.webp,.expand"
        className="file-input"
        aria-label="Open image or project"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) requestOpen(file);
          event.target.value = '';
        }}
      />
      <header className="app-header">
        <a
          className="brand"
          href="#"
          onClick={(event) => event.preventDefault()}
          aria-label="Expand Studio"
        >
          <span className="brand-mark">
            <Maximize size={23} strokeWidth={1.7} />
          </span>
          <span>
            expand<span className="brand-studio">STUDIO</span>
          </span>
        </a>
        <div className="header-divider" />
        <button className="text-button open-button" onClick={pickFile} disabled={!!busy}>
          <FolderOpen size={16} />
          <span>Open</span>
          <ChevronDown size={12} />
        </button>
        <div className="document-title">
          <span className={dirty ? 'unsaved-dot' : 'saved-dot'} />
          {doc?.name || 'Untitled workspace'}
          {doc && <span className="document-extension">.expand</span>}
        </div>
        <div className="header-actions">
          <IconButton
            label="Undo (Ctrl+Z)"
            onClick={() => setHistory(undo)}
            disabled={!history.past.length || !!busy}
          >
            <Undo2 size={17} />
          </IconButton>
          <IconButton
            label="Redo (Ctrl+Shift+Z)"
            onClick={() => setHistory(redo)}
            disabled={!history.future.length || !!busy}
          >
            <Redo2 size={17} />
          </IconButton>
          <span className="header-divider small" />
          <button className="button secondary save-button" onClick={save} disabled={!doc || !!busy}>
            <Save size={15} />
            Save project
          </button>
          <button className="button primary" onClick={exportImage} disabled={!doc || !!busy}>
            <ArrowDownToLine size={15} />
            Export PNG
          </button>
        </div>
      </header>

      <div className="editor-layout">
        <nav className="tool-rail" aria-label="Editing tools">
          <div className="rail-top">
            <MousePointer2 size={15} />
          </div>
          {tools.map((entry) => (
            <button
              key={entry.id}
              className={`tool-button ${tool === entry.id ? 'active' : ''}`}
              title={`${entry.label} (${entry.key})`}
              aria-label={entry.label}
              aria-pressed={tool === entry.id}
              onClick={() => chooseTool(entry.id)}
              disabled={!doc || !!busy}
            >
              {entry.icon}
              <span className="tool-key">{entry.key}</span>
            </button>
          ))}
          <span className="rail-line" />
          <button
            className={`tool-button ${showMask ? 'mask-active' : ''}`}
            title="Show selection overlay"
            aria-label="Show selection overlay"
            aria-pressed={showMask}
            disabled={!doc || !!busy}
            onClick={() => setShowMask((value) => !value)}
          >
            <Layers3 />
          </button>
          <div className="rail-bottom">
            <IconButton label="Keyboard shortcuts" onClick={() => setHelp(true)}>
              <CircleHelp size={19} />
            </IconButton>
            <span className="rail-version">01</span>
          </div>
        </nav>

        <main className="workspace">
          <div className="context-bar">
            <div className="context-title">
              <span className="tiny-square" />
              {tool === 'patch' ? 'LOCAL REPAIR' : tool === 'hand' ? 'NAVIGATION' : 'SELECTION'}
              <span className="context-divider">/</span>
              <span className="context-tool">
                {tool === 'patch'
                  ? 'Patch'
                  : tool === 'brush'
                    ? 'Brush'
                    : tool === 'hand'
                      ? 'Hand'
                      : 'Marquee'}
              </span>
            </div>
            {doc && (
              <div className="context-options">
                {['marquee', 'brush'].includes(tool) && (
                  <div className="segmented" aria-label="Selection operation">
                    {(['replace', 'add', 'subtract'] as const).map((mode, index) => (
                      <button
                        key={mode}
                        aria-label={`${mode[0].toUpperCase() + mode.slice(1)} selection`}
                        aria-pressed={selectionMode === mode}
                        className={selectionMode === mode ? 'selected' : ''}
                        disabled={!!busy}
                        title={`${mode[0].toUpperCase() + mode.slice(1)} selection`}
                        onClick={() => setSelectionMode(mode)}
                      >
                        {index === 0 ? (
                          <SquareDashed size={14} />
                        ) : index === 1 ? (
                          <Plus size={14} />
                        ) : (
                          <Minus size={14} />
                        )}
                      </button>
                    ))}
                  </div>
                )}
                {tool === 'brush' && (
                  <label className="inline-number">
                    Size{' '}
                    <input
                      aria-label="Brush size"
                      type="number"
                      min={1}
                      max={512}
                      value={brushSize}
                      disabled={!!busy}
                      onChange={(e) =>
                        setBrushSize(Math.max(1, Math.min(512, Number(e.target.value) || 1)))
                      }
                    />
                    px
                  </label>
                )}
                {tool === 'patch' && (
                  <span className="context-note">
                    <span className="green-dot" />
                    {blendMode === 'poisson' ? 'Poisson seam blending' : 'Local pixel sampling'}
                  </span>
                )}
                <span className="context-separator" />
                <button
                  className={`compare-button ${compare ? 'active' : ''}`}
                  onClick={() => setCompare((value) => !value)}
                  disabled={!!busy}
                  aria-pressed={compare}
                >
                  <Eye size={15} />
                  Original
                </button>
              </div>
            )}
          </div>

          <div className="canvas-area">
            {doc && visible ? (
              <EditorCanvas
                ref={canvasRef}
                doc={doc}
                composite={visible}
                tool={tool}
                selectionMode={selectionMode}
                brushSize={brushSize}
                showMask={showMask}
                compare={compare}
                busy={!!busy}
                patchOffset={patchOffset}
                patchPreview={patchPreview}
                onSelection={select}
                onPatchOffset={setPatchOffset}
                onZoom={setZoom}
                onPointer={setPointer}
                onHint={setStatus}
              />
            ) : (
              <div className="empty-workspace">
                <div className="empty-art">
                  <div className="art-frame frame-back" />
                  <div className="art-frame frame-front">
                    <div className="art-sun" />
                    <div className="art-dune dune-back" />
                    <div className="art-dune dune-front" />
                    <span className="art-corner top-left" />
                    <span className="art-corner bottom-right" />
                  </div>
                  <span className="art-plus">
                    <Plus size={17} />
                  </span>
                </div>
                <span className="eyebrow">A LITTLE MORE POSSIBILITY</span>
                <h1>
                  Your image.
                  <br />
                  <span>A new perspective.</span>
                </h1>
                <p>
                  A precise space to select, repair, and refine.
                  <br />
                  Drop an image here to make it yours.
                </p>
                <button className="button primary large" onClick={pickFile} disabled={!!busy}>
                  <ImagePlus size={17} />
                  Open an image
                  <ArrowUpRight size={15} />
                </button>
                <button className="sample-button" onClick={demo} disabled={!!busy}>
                  Or explore with a sample <span>↗</span>
                </button>
                <span className="format-note">PNG, JPG, WEBP &nbsp;·&nbsp; .EXPAND PROJECTS</span>
              </div>
            )}

            {doc && (
              <div className="canvas-controls">
                <span className="image-size">
                  <FileImage size={13} />
                  {((doc.width * doc.height) / 1_000_000).toFixed(1)} MP
                </span>
                <div className="zoom-control">
                  <IconButton
                    label="Zoom out"
                    onClick={() => canvasRef.current?.zoomBy(0.8)}
                    disabled={!!busy}
                  >
                    <Minus size={14} />
                  </IconButton>
                  <button
                    className="zoom-value"
                    title="View at 100%"
                    onClick={() => canvasRef.current?.actualSize()}
                    disabled={!!busy}
                  >
                    {Math.round(zoom * 100)}%
                  </button>
                  <IconButton
                    label="Zoom in"
                    onClick={() => canvasRef.current?.zoomBy(1.25)}
                    disabled={!!busy}
                  >
                    <Plus size={14} />
                  </IconButton>
                  <span className="zoom-divider" />
                  <button
                    className="fit-button"
                    onClick={() => canvasRef.current?.fit()}
                    disabled={!!busy}
                  >
                    <Maximize size={13} />
                    Fit
                  </button>
                </div>
              </div>
            )}
            {doc && bounds && tool !== 'patch' && !compare && (
              <div className="selection-float">
                <span>
                  <SquareDashed size={14} />
                  {bounds.width} × {bounds.height} px
                </span>
                <span className="float-divider" />
                <button onClick={() => chooseTool('patch')} disabled={!!busy}>
                  <Scan size={14} />
                  Repair selection
                </button>
                <IconButton label="Clear selection" onClick={clearSelection} disabled={!!busy}>
                  <X size={14} />
                </IconButton>
              </div>
            )}
            {busy && (
              <div className="busy-overlay" role="status">
                <LoaderCircle className="spin" size={22} />
                <span>{busy}</span>
                {abortRef.current && (
                  <button className="text-button" onClick={() => abortRef.current?.abort()}>
                    Cancel blending
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="workspace-footer">
            <span className="footer-hint">
              {tool === 'patch' ? (
                <>
                  <Scan size={13} />
                  Drag the selection to clean pixels
                </>
              ) : (
                <>
                  <Hand size={13} />
                  <kbd>Space</kbd> to pan<span className="footer-dot">·</span>Scroll to zoom
                </>
              )}
            </span>
            <span className="coordinates">
              {pointer
                ? `X ${Math.floor(pointer.x)}   Y ${Math.floor(pointer.y)}`
                : 'DOCUMENT COORDINATES'}
            </span>
          </div>
        </main>

        <aside className="inspector" aria-label="Document inspector">
          <section className="inspector-section properties-section">
            <div className="section-heading">
              <span>{tool === 'patch' ? 'Repair settings' : 'Selection'}</span>
              <SlidersHorizontal size={15} />
            </div>
            <p className="section-description">
              {tool === 'patch'
                ? 'Borrow clean pixels. Keep every edit reversible.'
                : 'Good edits start with a little precision.'}
            </p>
            <div className="selection-summary">
              <span className="summary-icon">
                {tool === 'patch' ? <Scan size={18} /> : <SquareDashed size={18} />}
              </span>
              <div>
                <strong>
                  {bounds ? `${bounds.width} × ${bounds.height} px` : 'No selection yet'}
                </strong>
                <span>{bounds ? 'Selected area' : 'Draw or brush on the canvas'}</span>
              </div>
              {bounds && <span className="selection-live" />}
            </div>
            <label className="setting-label" htmlFor="feather">
              Feather inward <span>{feather} px</span>
            </label>
            <input
              id="feather"
              aria-label="Feather inward"
              className="range"
              type="range"
              min={0}
              max={32}
              value={feather}
              disabled={!doc || !!busy}
              onChange={(e) => setFeather(Number(e.target.value))}
            />
            <div className="range-labels">
              <span>Precise edge</span>
              <span>Soft edge</span>
            </div>
            {tool === 'patch' ? (
              <div className="repair-settings">
                <label className="setting-label" htmlFor="blend-mode">
                  Seam blending
                </label>
                <div className="select-wrap">
                  <select
                    id="blend-mode"
                    aria-label="Seam blending"
                    value={blendMode}
                    disabled={!!busy}
                    onChange={(e) => setBlendMode(e.target.value as 'poisson' | 'feather')}
                  >
                    <option value="poisson">Poisson · match the boundary</option>
                    <option value="feather">Feather · preserve sampled colors</option>
                  </select>
                  <ChevronDown size={13} />
                </div>
                <p className="setting-help">
                  {blendMode === 'poisson'
                    ? 'Blends sampled texture into surrounding tones. The fast preview is blended when you apply.'
                    : 'Copies the sample with your inward feather setting. Works with transparency.'}
                </p>
                <div className="sample-offset">
                  <span>Sample offset</span>
                  <code>
                    {patchOffset.x}, {patchOffset.y} px
                  </code>
                </div>
                <button
                  className="button primary full"
                  onClick={applyPatch}
                  disabled={!patchPreview || !!busy}
                >
                  <Check size={15} />
                  {blendMode === 'poisson' ? 'Blend & apply repair' : 'Apply repair'}
                </button>
                <button
                  className="reset-button"
                  onClick={() => setPatchOffset({ x: 0, y: 0 })}
                  disabled={!!busy || (!patchOffset.x && !patchOffset.y)}
                >
                  <RotateCcw size={12} />
                  Reset sample
                </button>
              </div>
            ) : (
              <div className="selection-actions">
                <button
                  className="button secondary"
                  disabled={!doc || !!busy}
                  onClick={() =>
                    doc && select(new Uint8ClampedArray(doc.selection.length).fill(255))
                  }
                >
                  Select all
                </button>
                <button
                  className="button secondary"
                  disabled={!bounds || !!busy}
                  onClick={clearSelection}
                >
                  Clear
                </button>
              </div>
            )}
          </section>

          <section className="layers-section">
            <div className="section-heading layers-heading">
              <span>
                Layers <small>{doc?.layers.length || 0}</small>
              </span>
              <Layers3 size={15} />
            </div>
            <div className="layer-opacity">
              <label htmlFor="opacity">Opacity</label>
              <input
                id="opacity"
                aria-label="Layer opacity"
                type="range"
                min={0}
                max={100}
                value={Math.round(selectedOpacity * 100)}
                disabled={!activeLayer || !!busy}
                onChange={(e) =>
                  activeLayer &&
                  setOpacityPreview({ id: activeLayer.id, value: Number(e.target.value) / 100 })
                }
                onPointerUp={commitOpacity}
                onKeyUp={commitOpacity}
                onBlur={commitOpacity}
              />
              <span>{Math.round(selectedOpacity * 100)}%</span>
            </div>
            <div className="layer-list">
              {doc ? (
                [...doc.layers].reverse().map((layer) => (
                  <div
                    key={layer.id}
                    className={`layer-row ${activeLayer?.id === layer.id ? 'selected' : ''} ${!layer.visible ? 'hidden-layer' : ''}`}
                    role="button"
                    tabIndex={0}
                    aria-label={`Select layer ${layer.name}`}
                    aria-pressed={activeLayer?.id === layer.id}
                    onClick={() => setSelectedLayer(layer.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') setSelectedLayer(layer.id);
                    }}
                  >
                    <Thumbnail surface={layer.canvas} />
                    <div className="layer-info">
                      <input
                        key={`${layer.id}/${layer.name}`}
                        aria-label={`Layer name: ${layer.name}`}
                        defaultValue={layer.name}
                        disabled={!!busy}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={(e) => {
                          const name = e.target.value.trim().slice(0, 80) || layer.name;
                          if (name !== layer.name) modifyLayer(layer.id, { name });
                        }}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === 'Enter') e.currentTarget.blur();
                        }}
                      />
                      <span>{layer.kind === 'original' ? 'Source image' : 'Masked edit'}</span>
                    </div>
                    <IconButton
                      label={`${layer.visible ? 'Hide' : 'Show'} ${layer.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        modifyLayer(layer.id, { visible: !layer.visible });
                      }}
                      disabled={!!busy}
                    >
                      {layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                    </IconButton>
                  </div>
                ))
              ) : (
                <div className="empty-layers">
                  <Layers3 size={27} strokeWidth={1} />
                  <span>A place for every possibility.</span>
                  <small>Your image and edits will appear here.</small>
                </div>
              )}
            </div>
            <div className="layer-note">
              <span className="green-dot" />
              {doc ? 'Edits stay on their own layers' : 'Your original stays yours'}
            </div>
          </section>
          <div className="inspector-bottom">
            <span className="local-badge">
              <span className="green-dot" />
              LOCAL EDITING
            </span>
            <span>Made for a closer look.</span>
          </div>
        </aside>
      </div>

      <footer className="status-bar">
        <span className="status-message" role="status">
          <span className="status-indicator" />
          {status}
        </span>
        <span className="status-right">
          {doc
            ? `${doc.width.toLocaleString()} × ${doc.height.toLocaleString()} px`
            : 'Ready when you are'}
          <span className="footer-dot">·</span>sRGB
        </span>
      </footer>
      {error && (
        <div className="error-toast" role="alert">
          <div>
            <strong>Something needs a closer look</strong>
            <p>{error}</p>
          </div>
          <IconButton label="Dismiss error" onClick={() => setError(null)}>
            <X size={16} />
          </IconButton>
        </div>
      )}
      {dragOver && (
        <div className="drop-overlay">
          <ImagePlus size={36} />
          <strong>Drop it into your workspace</strong>
          <span>Image or .expand project</span>
        </div>
      )}
      {pendingFile && (
        <div className="modal-backdrop">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="replace-title">
            <span className="eyebrow">UNSAVED WORK</span>
            <h2 id="replace-title">Open another document?</h2>
            <p>
              Save your current project first if you want to keep its editable layers and selection.
            </p>
            <div className="modal-actions">
              <button className="button secondary" autoFocus onClick={() => setPendingFile(null)}>
                Keep editing
              </button>
              <button
                className="button primary"
                onClick={() => {
                  const next = pendingFile;
                  setPendingFile(null);
                  void openFile(next);
                }}
              >
                Open anyway
              </button>
            </div>
          </div>
        </div>
      )}
      {help && (
        <div className="modal-backdrop" onClick={() => setHelp(false)}>
          <div
            className="modal shortcuts-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="shortcuts-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="section-heading">
              <h2 id="shortcuts-title">A few useful shortcuts</h2>
              <IconButton label="Close shortcuts" onClick={() => setHelp(false)}>
                <X size={18} />
              </IconButton>
            </div>
            {[
              ['Open image or project', 'Ctrl O'],
              ['Save project', 'Ctrl S'],
              ['Export PNG', 'Ctrl Shift S'],
              ['Undo / redo', 'Ctrl Z / Ctrl Shift Z'],
              ['Marquee / brush / patch / hand', 'M / B / P / H'],
              ['Pan temporarily', 'Space + drag'],
              ['Select all / clear selection', 'Ctrl A / Ctrl D'],
              ['Fit the image', '0'],
            ].map(([label, shortcut]) => (
              <div className="shortcut-row" key={label}>
                <span>{label}</span>
                <kbd>{shortcut}</kbd>
              </div>
            ))}
            <p className="setting-help">
              This version supports local editing, projects, and Poisson repair. AI generation will
              be added in the next development stages.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function safeName(name: string) {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 120) || 'Untitled';
}
