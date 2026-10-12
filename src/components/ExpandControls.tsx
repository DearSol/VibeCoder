import { expansionGeometry, type Margins } from '../model/expand';
export function ExpandControls({
  width,
  height,
  margins,
  onChange,
  disabled,
}: {
  width: number;
  height: number;
  margins: Margins;
  onChange: (margins: Margins) => void;
  disabled: boolean;
}) {
  let size = '',
    error = '';
  try {
    const next = expansionGeometry(width, height, margins);
    size = `${next.width.toLocaleString()} × ${next.height.toLocaleString()} px`;
  } catch (caught) {
    error = (caught as Error).message;
  }
  return (
    <section className="inspector-section expansion-section" aria-label="Expansion settings">
      <div className="section-heading">
        <span>Canvas expansion</span>
      </div>
      <p className="section-description">
        Drag any canvas edge or corner, or enter exact margins. The original keeps its scale.
      </p>
      <div className="margin-grid">
        {(['top', 'left', 'right', 'bottom'] as const).map((edge) => (
          <label key={edge}>
            {edge[0].toUpperCase() + edge.slice(1)}
            <input
              aria-label={`${edge[0].toUpperCase() + edge.slice(1)} expansion pixels`}
              type="number"
              min={0}
              max={8192}
              value={margins[edge]}
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  ...margins,
                  [edge]: Math.max(0, Math.min(8192, Math.round(Number(event.target.value) || 0))),
                })
              }
            />
            <span>px</span>
          </label>
        ))}
      </div>
      <p className="expansion-dimensions">{size}</p>
      {error && (
        <p className="setting-help" role="alert">
          {error}
        </p>
      )}
      <button
        className="button secondary full"
        disabled={disabled}
        onClick={() => onChange({ left: 0, right: 0, top: 0, bottom: 0 })}
      >
        Reset expansion
      </button>
      <p className="setting-help">
        Changing bounds is a preview. Generation starts only when you click Generate expansion.
        Existing pixels remain protected.
      </p>
    </section>
  );
}
