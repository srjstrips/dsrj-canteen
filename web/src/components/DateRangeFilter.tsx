import { toDateInputValue } from "../lib/format";

export interface DateRange {
  from: string;
  to: string;
}

const presets: { label: string; get: () => DateRange }[] = [
  {
    label: "Today",
    get: () => {
      const d = toDateInputValue(new Date());
      return { from: d, to: d };
    },
  },
  {
    label: "Yesterday",
    get: () => {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      const v = toDateInputValue(d);
      return { from: v, to: v };
    },
  },
  {
    label: "This Week",
    get: () => {
      const now = new Date();
      const day = now.getDay();
      const monday = new Date(now);
      monday.setDate(now.getDate() - ((day + 6) % 7));
      return { from: toDateInputValue(monday), to: toDateInputValue(now) };
    },
  },
  {
    label: "This Month",
    get: () => {
      const now = new Date();
      return { from: toDateInputValue(new Date(now.getFullYear(), now.getMonth(), 1)), to: toDateInputValue(now) };
    },
  },
];

export function DateRangeFilter({ value, onChange }: { value: DateRange; onChange: (r: DateRange) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {presets.map((p) => (
        <button key={p.label} type="button" className="btn-secondary !px-3 !py-1.5 text-xs" onClick={() => onChange(p.get())}>
          {p.label}
        </button>
      ))}
      <div className="flex items-center gap-1.5">
        <input type="date" className="input !w-auto" value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value })} />
        <span className="text-xs text-muted">to</span>
        <input type="date" className="input !w-auto" value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value })} />
      </div>
    </div>
  );
}
