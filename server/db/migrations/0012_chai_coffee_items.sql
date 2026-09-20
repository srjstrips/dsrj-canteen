-- Add "Chai / Coffee" food category and its 5 prepared beverages.
-- These are prepared items (track_canteen_stock = FALSE) with a fixed sell price.
-- Prices can be updated later via the Admin UI.

DO $$
DECLARE
  v_category_id UUID;
  v_unit_id     UUID;
BEGIN
  -- Upsert the "Chai / Coffee" food category
  INSERT INTO categories (name, is_food)
  VALUES ('Chai / Coffee', TRUE)
  ON CONFLICT (name) DO UPDATE SET is_food = TRUE
  RETURNING id INTO v_category_id;

  -- If it already existed and ON CONFLICT updated it, re-fetch the id
  IF v_category_id IS NULL THEN
    SELECT id INTO v_category_id FROM categories WHERE name = 'Chai / Coffee';
  END IF;

  -- Reuse the "Pieces" unit (PCS) for cups/servings
  SELECT id INTO v_unit_id FROM units WHERE symbol = 'PCS';

  -- Insert the 5 beverages (idempotent — skip if already present)
  INSERT INTO products (name, category_id, unit_id, sell_price, track_canteen_stock, min_stock_level, reorder_level)
  VALUES
    ('Chai',        v_category_id, v_unit_id, 5,  FALSE, 0, 0),
    ('Coffee',      v_category_id, v_unit_id, 10, FALSE, 0, 0),
    ('Milk',        v_category_id, v_unit_id, 10, FALSE, 0, 0),
    ('Tea Powder',  v_category_id, v_unit_id, 5,  FALSE, 0, 0),
    ('Limbu',       v_category_id, v_unit_id, 10, FALSE, 0, 0)
  ON CONFLICT (name, unit_id) DO NOTHING;
END;
$$;
