import { useProducts, useSellableProducts, useStoreProducts } from "../api/queries";
import { Combobox } from "./Combobox";

export function ProductSelect({
  value,
  onChange,
  placeholder = "Type to search product…",
  className = "input",
  sellableOnly = false,
  storeOnly = false,
}: {
  value: string;
  onChange: (productId: string) => void;
  placeholder?: string;
  className?: string;
  /** When true, only priced (sellable) products are listed — for POS / OT orders. */
  sellableOnly?: boolean;
  /** When true, only store (non-food) products are listed, grouped by category. */
  storeOnly?: boolean;
}) {
  const all = useProducts(true);
  const sellable = useSellableProducts();
  const store = useStoreProducts(true);

  const source = storeOnly ? store : sellableOnly ? sellable : all;
  const { data: products, isLoading } = source;

  const options = (products ?? []).map((p) => ({
    value: p.id,
    label: `${p.name} (${p.unit.symbol})`,
    group: storeOnly ? p.category.name : undefined,
  }));

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
