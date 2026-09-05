import { useEffect, useMemo, useRef, useState } from "react";

export interface ComboOption {
  value: string;
  label: string;
  /** Optional group header — items with the same group string are visually grouped. */
  group?: string;
}

interface ComboboxProps {
  value: string;
  onChange: (value: string) => void;
  options: ComboOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

/** Type-to-search dropdown: shows filtered suggestions as you type, click (or
 * Enter) to select. Replaces plain <select> for long lists like products and
 * suppliers. */
export function Combobox({ value, onChange, options, placeholder = "Type to search…", disabled, className = "input" }: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, 50);
    return options.filter((o) => o.label.toLowerCase().includes(q)).slice(0, 50);
  }, [options, query]);

  // Close when clicking outside.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function choose(opt: ComboOption) {
    onChange(opt.value);
    setQuery("");
    setOpen(false);
  }

  return (
    <div className="relative" ref={ref}>
      <input
        className={className}
        disabled={disabled}
        value={open ? query : selected?.label ?? ""}
        placeholder={placeholder}
        onFocus={() => {
          setOpen(true);
          setQuery("");
          setHighlight(0);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setHighlight(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setHighlight((h) => Math.min(h + 1, filtered.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter" && open && filtered[highlight]) {
            e.preventDefault();
            choose(filtered[highlight]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && (
        <div className="absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-border bg-card shadow-lg">
          {filtered.length === 0 && <p className="px-3 py-2 text-sm text-muted">No matches</p>}
          {filtered.map((opt, i) => {
            const showGroupHeader = opt.group && (i === 0 || filtered[i - 1].group !== opt.group);
            return (
              <div key={opt.value}>
                {showGroupHeader && (
                  <p className="px-3 pb-0.5 pt-2 text-xs font-semibold uppercase tracking-wide text-muted">{opt.group}</p>
                )}
                <button
                  type="button"
                  className={`block w-full px-3 py-2 text-left text-sm ${i === highlight ? "bg-primary-light text-primary" : "hover:bg-background"} ${opt.value === value ? "font-semibold" : ""}`}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => choose(opt)}
                >
                  {opt.label}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
