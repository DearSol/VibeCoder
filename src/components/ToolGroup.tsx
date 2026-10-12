import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import type { Tool } from './EditorCanvas';

export type ToolOption = { id: Tool; label: string; key: string; icon: ReactNode };
export function ToolGroup({
  label,
  options,
  tool,
  disabled,
  onChoose,
}: {
  label: string;
  options: ToolOption[];
  tool: Tool;
  disabled: boolean;
  onChoose: (tool: Tool) => void;
}) {
  const [open, setOpen] = useState(false),
    [last, setLast] = useState(options[0].id);
  const group = useRef<HTMLDivElement>(null);
  const selected =
    options.find((option) => option.id === tool) || options.find((option) => option.id === last)!;
  useEffect(() => {
    if (options.some((option) => option.id === tool)) setLast(tool);
  }, [tool]);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!group.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        event.preventDefault();
      }
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', escape);
    };
  }, [open]);
  return (
    <div className="tool-group" ref={group}>
      <button
        className={`tool-button ${options.some((option) => option.id === tool) ? 'active' : ''}`}
        title={`${selected.label} (${selected.key})`}
        aria-label={selected.label}
        aria-pressed={selected.id === tool}
        disabled={disabled}
        onClick={() => onChoose(selected.id)}
      >
        {selected.icon}
        <span className="tool-key">{selected.key}</span>
      </button>
      <button
        className="tool-group-arrow"
        aria-label={label}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        <ChevronRight size={12} />
      </button>
      {open && !disabled && (
        <div className="tool-flyout" role="group" aria-label={`${label} choices`}>
          {options.map((option) => (
            <button
              key={option.id}
              aria-pressed={tool === option.id}
              onClick={() => {
                onChoose(option.id);
                setLast(option.id);
                setOpen(false);
              }}
            >
              {option.icon}
              <span>{option.label}</span>
              <kbd>{option.key}</kbd>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
