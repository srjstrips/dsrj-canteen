import { useProducts, useSellableProducts } from "../api/queries";
import { Combobox } from "./Combobox";

export function ProductSelect({
  value,
  onChange,
  placeholder = "Type to search product…",
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

  const options = (products ?? []).map((p) => ({ value: p.id, label: `${p.name} (${p.unit.symbol})` }));

  return (
    <Combobox
      value={value}
      onChange={onChange}
      options={options}
      placeholder={isLoading ? "Loading…" : placeholder}
      disabled={isLoading}
      className={className}
    />
  );
}
