import { useRef, useState } from "react";
import { Tooltip } from "@silo-code/sdk";
import { ArrowCounterClockwise, Eraser } from "@phosphor-icons/react";

interface Stroke {
  points: { x: number; y: number }[];
  color: string;
}

interface Props {
  dataUrl: string;
  close: () => void;
}

const PEN_COLORS = ["#f97316", "#ef4444", "#ffffff", "#000000"];

function replayStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  current: Stroke | null,
) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  for (const stroke of current ? [...strokes, current] : strokes) {
    if (stroke.points.length < 2) continue;
    ctx.beginPath();
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
    for (let i = 1; i < stroke.points.length; i++) {
      ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
    }
    ctx.stroke();
  }
}

export function AnnotationModal({ dataUrl, close }: Props) {
  // Active color is the only UI state that causes a re-render during drawing.
  const [activeColor, setActiveColor] = useState(PEN_COLORS[0]);
  // strokeCount drives Undo/Clear button disabled state without forcing redraws.
  const [strokeCount, setStrokeCount] = useState(0);
  const [copyError, setCopyError] = useState("");

  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const currentRef = useRef<Stroke | null>(null);
  const drawingRef = useRef(false);
  // Keep activeColor accessible in mouse handlers without stale closure.
  const colorRef = useRef(activeColor);
  colorRef.current = activeColor;

  function redraw() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;
    replayStrokes(ctx, strokesRef.current, currentRef.current);
  }

  function getPos(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onImgLoad() {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return;
    canvas.width = img.offsetWidth;
    canvas.height = img.offsetHeight;
    redraw();
  }

  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    e.preventDefault();
    drawingRef.current = true;
    currentRef.current = { points: [getPos(e)], color: colorRef.current };
  }

  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!drawingRef.current || !currentRef.current) return;
    const stroke = currentRef.current;
    const prevPoint = stroke.points[stroke.points.length - 1];
    const point = getPos(e);
    stroke.points.push(point);

    // Draw just the new segment instead of clearing and replaying every
    // prior stroke on every mousemove sample — that was O(total points
    // across all strokes) of work per pixel moved, causing visible lag once
    // a few strokes had accumulated.
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.beginPath();
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.moveTo(prevPoint.x, prevPoint.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
  }

  function onMouseUp() {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    if (currentRef.current && currentRef.current.points.length >= 2) {
      strokesRef.current = [...strokesRef.current, currentRef.current];
      setStrokeCount(strokesRef.current.length);
    }
    currentRef.current = null;
    redraw();
  }

  function undo() {
    strokesRef.current = strokesRef.current.slice(0, -1);
    setStrokeCount(strokesRef.current.length);
    redraw();
  }

  function clear() {
    strokesRef.current = [];
    setStrokeCount(0);
    redraw();
  }

  async function copyToClipboard() {
    const img = imgRef.current;
    if (!img) return;
    setCopyError("");

    const offscreen = document.createElement("canvas");
    offscreen.width = img.naturalWidth;
    offscreen.height = img.naturalHeight;
    const ctx = offscreen.getContext("2d");
    if (!ctx) return;

    // Composite the base screenshot + strokes synchronously — no awaits here.
    ctx.drawImage(img, 0, 0);

    const canvas = canvasRef.current;
    if (canvas && strokesRef.current.length > 0) {
      const scaleX = img.naturalWidth / canvas.width;
      const scaleY = img.naturalHeight / canvas.height;
      const scale = Math.max(scaleX, scaleY);
      for (const stroke of strokesRef.current) {
        if (stroke.points.length < 2) continue;
        ctx.beginPath();
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = 3 * scale;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.moveTo(stroke.points[0].x * scaleX, stroke.points[0].y * scaleY);
        for (let i = 1; i < stroke.points.length; i++) {
          ctx.lineTo(stroke.points[i].x * scaleX, stroke.points[i].y * scaleY);
        }
        ctx.stroke();
      }
    }

    const blobPromise = new Promise<Blob>((resolve, reject) => {
      offscreen.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("toBlob failed"));
      }, "image/png");
    });

    try {
      // WKWebView requires clipboard.write() to be called synchronously within
      // the click's user-activation window — awaiting the blob first and THEN
      // calling write() loses that activation and throws NotAllowedError.
      // Passing a pending Promise<Blob> as the ClipboardItem value instead lets
      // write() start immediately while the encode finishes in the background.
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blobPromise }),
      ]);
    } catch (err) {
      setCopyError(err instanceof Error ? err.message : String(err));
      return;
    }

    close();
  }

  return (
    <div className="lwv-ann">
      <p className="lwv-ann-subtitle">Draw on it, then copy it to clipboard.</p>
      <div className="lwv-ann-canvas-wrap">
        <div className="lwv-ann-canvas-stack">
          <img
            ref={imgRef}
            src={dataUrl}
            className="lwv-ann-img"
            alt="Screenshot"
            draggable={false}
            onLoad={onImgLoad}
          />
          <canvas
            ref={canvasRef}
            className="lwv-ann-canvas"
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
          />
        </div>
      </div>
      <div className="lwv-ann-footer">
        <div className="lwv-ann-footer-left">
          <span className="lwv-ann-pen-label">Draw</span>
          <div className="lwv-ann-swatches">
            {PEN_COLORS.map((c) => (
              <button
                key={c}
                className={`lwv-ann-swatch${activeColor === c ? " lwv-ann-swatch-active" : ""}`}
                style={{ background: c }}
                onClick={() => setActiveColor(c)}
                title={c}
              />
            ))}
          </div>
          <div className="lwv-ann-sep" />
          <Tooltip content="Undo">
            <button
              className="lwv-ann-action"
              onClick={undo}
              disabled={strokeCount === 0}
            >
              <ArrowCounterClockwise weight="bold" size={17} />
            </button>
          </Tooltip>
          <Tooltip content="Clear">
            <button
              className="lwv-ann-action"
              onClick={clear}
              disabled={strokeCount === 0}
            >
              <Eraser weight="bold" size={17} />
            </button>
          </Tooltip>
        </div>
        {copyError && <span className="lwv-ann-error">{copyError}</span>}
        <button className="lwv-ann-btn" onClick={close}>
          Cancel
        </button>
        <button
          className="lwv-ann-btn lwv-ann-btn-primary"
          onClick={() => void copyToClipboard()}
        >
          Copy to clipboard
        </button>
      </div>
    </div>
  );
}
