import { useProducts } from "../api/queries";

export function ProductSelect({
  value,
  onChange,
  placeholder = "Select product…",
  className = "input",
}: {
  value: string;
  onChange: (productId: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const { data: products, isLoading } = useProducts(true);

  return (
    <select className={className} value={value} onChange={(e) => onChange(e.target.value)} disabled={isLoading}>
      <option value="">{isLoading ? "Loading…" : placeholder}</option>
      {products?.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name} ({p.unit.symbol})
        </option>
      ))}
    </select>
  );
}
