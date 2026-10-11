import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { context, maskToCanvas, type EditorDocument } from '../model/document';
import {
  combineMasks,
  paintMask,
  rectangleMask,
  selectionBounds,
  type Point,
  type SelectionMode,
} from '../model/pixels';

export type Tool = 'marquee' | 'brush' | 'hand' | 'patch';
export type CanvasHandle = {
  fit: () => void;
  zoomBy: (factor: number) => void;
  actualSize: () => void;
};
type View = { x: number; y: number; zoom: number };
type Drag = {
  kind: 'pan' | 'marquee' | 'brush' | 'patch';
  start: Point;
  last: Point;
  view: View;
  base: Uint8ClampedArray;
  stroke: Uint8ClampedArray;
  offset: Point;
  mode: SelectionMode;
};
type Props = {
  doc: EditorDocument;
  composite: HTMLCanvasElement;
  tool: Tool;
  selectionMode: SelectionMode;
  brushSize: number;
  showMask: boolean;
  compare: boolean;
  busy: boolean;
  patchOffset: Point;
  patchPreview: { canvas: HTMLCanvasElement; x: number; y: number } | null;
  onSelection: (mask: Uint8ClampedArray) => void;
  onPatchOffset: (point: Point) => void;
  onZoom: (zoom: number) => void;
  onPointer: (point: Point | null) => void;
  onHint: (text: string) => void;
};

export const EditorCanvas = forwardRef<CanvasHandle, Props>(function EditorCanvas(props, ref) {
  const { doc, tool, busy } = props;
  const viewport = useRef<HTMLDivElement>(null),
    element = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [view, setView] = useState<View>({ x: 0, y: 0, zoom: 1 });
  const [draft, setDraft] = useState<Uint8ClampedArray | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [space, setSpace] = useState(false);
  const drag = useRef<Drag | null>(null),
    draftRef = useRef<Uint8ClampedArray | null>(null);
  const fit = () => {
    const zoom = Math.max(
      0.01,
      Math.min(4, (size.width - 100) / doc.width, (size.height - 110) / doc.height),
    );
    setView({
      zoom,
      x: (size.width - doc.width * zoom) / 2,
      y: (size.height - doc.height * zoom) / 2,
    });
  };
  const zoomTo = (next: number, anchor = { x: size.width / 2, y: size.height / 2 }) =>
    setView((current) => {
      const zoom = Math.max(0.01, Math.min(16, next));
      return {
        zoom,
        x: anchor.x - ((anchor.x - current.x) * zoom) / current.zoom,
        y: anchor.y - ((anchor.y - current.y) * zoom) / current.zoom,
      };
    });
  useImperativeHandle(ref, () => ({
    fit,
    zoomBy: (factor) => zoomTo(view.zoom * factor),
    actualSize: () => zoomTo(1),
  }));
  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );
    observer.observe(viewport.current!);
    return () => observer.disconnect();
  }, []);
  useEffect(fit, [doc.id, size.width, size.height]);
  useEffect(() => props.onZoom(view.zoom), [view.zoom]);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return;
      if (e.code === 'Space') {
        e.preventDefault();
        setSpace(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpace(false);
    };
    const blur = () => {
      setSpace(false);
      drag.current = null;
      setDraft(null);
      draftRef.current = null;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);
  useEffect(() => {
    const surface = element.current!;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (busy) return;
      const rect = surface.getBoundingClientRect();
      zoomTo(view.zoom * Math.exp(-event.deltaY * 0.0015), {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
    };
    surface.addEventListener('wheel', wheel, { passive: false });
    return () => surface.removeEventListener('wheel', wheel);
  }, [view, size, busy]);

  const activeMask = draft || doc.selection;
  const checker = useMemo(() => {
    const tile = document.createElement('canvas');
    tile.width = 24;
    tile.height = 24;
    const ctx = context(tile);
    ctx.fillStyle = '#c9c8c4';
    ctx.fillRect(0, 0, 24, 24);
    ctx.fillStyle = '#e7e5e0';
    ctx.fillRect(0, 0, 12, 12);
    ctx.fillRect(12, 12, 12, 12);
    return tile;
  }, []);
  const overlay = useMemo(
    () => maskToCanvas(activeMask, doc.width, doc.height),
    [activeMask, doc.width, doc.height],
  );
  const bounds = useMemo(
    () => selectionBounds(activeMask, doc.width, doc.height),
    [activeMask, doc.width, doc.height],
  );
  useEffect(() => {
    const surface = element.current!;
    const ratio = window.devicePixelRatio || 1;
    surface.width = Math.round(size.width * ratio);
    surface.height = Math.round(size.height * ratio);
    const ctx = context(surface);
    ctx.scale(ratio, ratio);
    ctx.clearRect(0, 0, size.width, size.height);
    ctx.save();
    ctx.translate(view.x, view.y);
    ctx.scale(view.zoom, view.zoom);
    ctx.shadowColor = 'rgba(0,0,0,.45)';
    ctx.shadowBlur = 26 / view.zoom;
    ctx.fillStyle = '#c9c8c4';
    ctx.fillRect(0, 0, doc.width, doc.height);
    ctx.shadowBlur = 0;
    const pattern = ctx.createPattern(checker, 'repeat')!;
    pattern.setTransform(new DOMMatrix().scale(1 / view.zoom));
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, doc.width, doc.height);
    ctx.imageSmoothingEnabled = view.zoom < 2;
    ctx.drawImage(props.compare ? doc.layers[0].canvas : props.composite, 0, 0);
    if (!props.compare && props.patchPreview)
      ctx.drawImage(props.patchPreview.canvas, props.patchPreview.x, props.patchPreview.y);
    if (!props.compare && props.showMask && bounds) {
      ctx.globalAlpha = tool === 'patch' ? 0.11 : 0.27;
      ctx.drawImage(overlay, 0, 0);
      ctx.globalAlpha = 1;
    }
    if (!props.compare && bounds) {
      ctx.lineWidth = 1 / view.zoom;
      ctx.strokeStyle = '#101917';
      ctx.setLineDash([]);
      ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
      ctx.strokeStyle = '#b6f5e3';
      ctx.setLineDash([5 / view.zoom, 4 / view.zoom]);
      ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
      if (tool === 'patch' && (props.patchOffset.x || props.patchOffset.y)) {
        ctx.strokeStyle = '#ffce85';
        ctx.setLineDash([6 / view.zoom, 4 / view.zoom]);
        ctx.strokeRect(
          bounds.x + props.patchOffset.x,
          bounds.y + props.patchOffset.y,
          bounds.width,
          bounds.height,
        );
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        ctx.lineTo(
          bounds.x + bounds.width / 2 + props.patchOffset.x,
          bounds.y + bounds.height / 2 + props.patchOffset.y,
        );
        ctx.strokeStyle = 'rgba(255,206,133,.6)';
        ctx.stroke();
      }
    }
    ctx.restore();
    if (tool === 'brush' && cursor && !space && !busy) {
      ctx.beginPath();
      ctx.arc(cursor.x, cursor.y, Math.max(2, (props.brushSize * view.zoom) / 2), 0, Math.PI * 2);
      ctx.strokeStyle = '#101917';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.strokeStyle = '#ddf5e9';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }, [
    size,
    view,
    overlay,
    bounds,
    checker,
    doc,
    props.composite,
    props.patchPreview,
    props.patchOffset,
    props.compare,
    props.showMask,
    tool,
    cursor,
    props.brushSize,
    space,
    busy,
  ]);

  const local = (event: React.PointerEvent) => {
    const rect = element.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const imagePoint = (p: Point) => ({
    x: (p.x - view.x) / view.zoom,
    y: (p.y - view.y) / view.zoom,
  });
  const down = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (busy || props.compare || ![0, 1].includes(event.button)) return;
    const point = local(event),
      image = imagePoint(point);
    const kind = space || event.button === 1 ? 'pan' : tool === 'hand' ? 'pan' : tool;
    if (
      kind !== 'pan' &&
      (image.x < 0 || image.y < 0 || image.x >= doc.width || image.y >= doc.height)
    )
      return;
    if (kind === 'patch' && !doc.selection[Math.floor(image.y) * doc.width + Math.floor(image.x)]) {
      props.onHint('Start dragging inside your selection to choose a sample.');
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const mode = event.altKey
      ? 'subtract'
      : event.shiftKey && tool === 'brush'
        ? 'add'
        : props.selectionMode;
    const stroke = new Uint8ClampedArray(doc.selection.length);
    drag.current = {
      kind,
      start: kind === 'pan' ? point : image,
      last: image,
      view,
      base: doc.selection,
      stroke,
      offset: props.patchOffset,
      mode,
    };
    if (kind === 'brush') {
      paintMask(stroke, doc.width, doc.height, image, image, props.brushSize / 2);
      draftRef.current = combineMasks(doc.selection, stroke, mode);
      setDraft(draftRef.current);
    }
  };
  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = local(event),
      image = imagePoint(point);
    setCursor(point);
    props.onPointer(
      image.x >= 0 && image.y >= 0 && image.x < doc.width && image.y < doc.height ? image : null,
    );
    const current = drag.current;
    if (!current || busy) return;
    if (current.kind === 'pan') {
      setView({
        ...current.view,
        x: current.view.x + point.x - current.start.x,
        y: current.view.y + point.y - current.start.y,
      });
      return;
    }
    if (current.kind === 'patch') {
      const b = selectionBounds(doc.selection, doc.width, doc.height)!;
      props.onPatchOffset({
        x: Math.max(
          -b.x,
          Math.min(
            doc.width - b.x - b.width,
            Math.round(current.offset.x + image.x - current.start.x),
          ),
        ),
        y: Math.max(
          -b.y,
          Math.min(
            doc.height - b.y - b.height,
            Math.round(current.offset.y + image.y - current.start.y),
          ),
        ),
      });
      return;
    }
    if (current.kind === 'marquee') {
      let end = image;
      if (event.shiftKey) {
        const side = Math.max(
          Math.abs(image.x - current.start.x),
          Math.abs(image.y - current.start.y),
        );
        end = {
          x: current.start.x + Math.sign(image.x - current.start.x) * side,
          y: current.start.y + Math.sign(image.y - current.start.y) * side,
        };
      }
      current.stroke = rectangleMask(doc.width, doc.height, current.start, end);
    } else {
      paintMask(current.stroke, doc.width, doc.height, current.last, image, props.brushSize / 2);
      current.last = image;
    }
    draftRef.current = combineMasks(current.base, current.stroke, current.mode);
    setDraft(draftRef.current);
  };
  const end = (event: React.PointerEvent<HTMLCanvasElement>, cancelled = false) => {
    const current = drag.current;
    drag.current = null;
    if (current && !cancelled && draftRef.current && ['brush', 'marquee'].includes(current.kind))
      props.onSelection(draftRef.current);
    draftRef.current = null;
    setDraft(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return (
    <div className="canvas-viewport" ref={viewport}>
      <canvas
        ref={element}
        aria-label="Image editing canvas"
        data-testid="editor-canvas"
        data-scale={view.zoom}
        data-image-left={view.x}
        data-image-top={view.y}
        data-document-width={doc.width}
        data-document-height={doc.height}
        style={{
          width: size.width,
          height: size.height,
          cursor: busy
            ? 'wait'
            : space || tool === 'hand'
              ? 'grab'
              : tool === 'patch'
                ? 'move'
                : tool === 'brush'
                  ? 'none'
                  : 'crosshair',
        }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={(e) => end(e)}
        onPointerCancel={(e) => end(e, true)}
        onPointerLeave={() => {
          setCursor(null);
          props.onPointer(null);
        }}
        onContextMenu={(e) => e.preventDefault()}
      />
      <div className="canvas-caption">
        <span>{props.compare ? 'ORIGINAL' : 'CANVAS'}</span>
        <span>
          {doc.width.toLocaleString()} × {doc.height.toLocaleString()}
        </span>
      </div>
    </div>
  );
});
