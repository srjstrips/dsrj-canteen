-- Product image (used by the POS food cards). Stores a served path such as
-- /uploads/products/<file>.jpg written by the image upload endpoint.
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT;
