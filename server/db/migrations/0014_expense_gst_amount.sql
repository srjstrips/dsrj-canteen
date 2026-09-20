-- Allow storing GST as a flat amount instead of (or alongside) percentage
ALTER TABLE store_expense_items ADD COLUMN IF NOT EXISTS gst_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
