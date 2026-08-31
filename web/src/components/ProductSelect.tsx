import { useProducts, useSellableProducts } from "../api/queries";

export function ProductSelect({
  value,
  onChange,
  placeholder = "Select product…",
  className = "input",
  sellableOnly = false,
}: {
  value: string;
  onChange: (productId: string) => void;
  placeholder?: string;
  className?: string;
  /** When true, only priced (sellable) products are listed — for POS / OT orders. */
  sellableOnly?: boolean;
}) {
  const all = useProducts(true);
  const sellable = useSellableProducts();
  const { data: products, isLoading } = sellableOnly ? sellable : all;

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
