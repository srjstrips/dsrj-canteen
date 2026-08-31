-- Separate canteen food-item categories (Breakfast, Lunch, Snacks…) from
-- store/raw-material categories (Grocery, Oil…). Food categories are only used
-- by non-stock priced products (prepared food).

ALTER TABLE categories ADD COLUMN IF NOT EXISTS is_food BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill: any category already used by a food item (non-stock + priced) is food.
UPDATE categories SET is_food = TRUE
WHERE id IN (
  SELECT DISTINCT category_id FROM products
  WHERE track_canteen_stock = FALSE AND sell_price IS NOT NULL
);
