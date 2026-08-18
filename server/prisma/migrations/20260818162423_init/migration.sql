-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'STORE', 'CANTEEN');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('CASH', 'UPI', 'CREDIT');

-- CreateEnum
CREATE TYPE "StoreLedgerTxnType" AS ENUM ('OPENING', 'INWARD', 'ISSUE', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "CanteenLedgerTxnType" AS ENUM ('RECEIVED', 'SALE', 'CONSUMPTION', 'WASTAGE', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "WastageReason" AS ENUM ('SPOILAGE', 'EXPIRED', 'PREPARATION_WASTE', 'DAMAGED', 'EXCESS_PREPARATION', 'OTHER');

-- CreateEnum
CREATE TYPE "StockArea" AS ENUM ('STORE', 'CANTEEN');

-- CreateEnum
CREATE TYPE "SaleStatus" AS ENUM ('COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "units" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact_person" TEXT,
    "mobile" TEXT,
    "address" TEXT,
    "gst_number" TEXT,
    "payment_terms" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "min_stock_level" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "reorder_level" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "track_canteen_stock" BOOLEAN NOT NULL DEFAULT true,
    "sell_price" DECIMAL(14,2),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_inwards" (
    "id" TEXT NOT NULL,
    "inward_no" TEXT NOT NULL,
    "inward_date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supplier_id" TEXT NOT NULL,
    "invoice_number" TEXT,
    "total_value" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_inwards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_inward_items" (
    "id" TEXT NOT NULL,
    "stock_inward_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "rate" DECIMAL(14,4) NOT NULL,
    "total_value" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_inward_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_issues" (
    "id" TEXT NOT NULL,
    "issue_no" TEXT NOT NULL,
    "issue_date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "total_value" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_issue_items" (
    "id" TEXT NOT NULL,
    "stock_issue_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "issue_rate" DECIMAL(14,4) NOT NULL,
    "issue_value" DECIMAL(14,2) NOT NULL,
    "previous_balance" DECIMAL(14,3) NOT NULL,
    "balance_after_issue" DECIMAL(14,3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_issue_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_stock_balances" (
    "product_id" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "avg_rate" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "stock_value" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_stock_balances_pkey" PRIMARY KEY ("product_id")
);

-- CreateTable
CREATE TABLE "store_stock_ledger" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "txn_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "txn_type" "StoreLedgerTxnType" NOT NULL,
    "ref_id" TEXT,
    "inward_qty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "issue_qty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "rate" DECIMAL(14,4) NOT NULL,
    "balance_qty" DECIMAL(14,3) NOT NULL,
    "balance_value" DECIMAL(14,2) NOT NULL,
    "remarks" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_stock_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canteen_stock_balances" (
    "product_id" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "avg_rate" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "stock_value" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "canteen_stock_balances_pkey" PRIMARY KEY ("product_id")
);

-- CreateTable
CREATE TABLE "canteen_stock_ledger" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "txn_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "txn_type" "CanteenLedgerTxnType" NOT NULL,
    "ref_id" TEXT,
    "in_qty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "out_qty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "rate" DECIMAL(14,4) NOT NULL,
    "balance_qty" DECIMAL(14,3) NOT NULL,
    "balance_value" DECIMAL(14,2) NOT NULL,
    "remarks" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "canteen_stock_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales" (
    "id" TEXT NOT NULL,
    "bill_no" TEXT NOT NULL,
    "bill_date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bill_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sub_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discount_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "grand_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "payment_mode" "PaymentMode" NOT NULL,
    "status" "SaleStatus" NOT NULL DEFAULT 'COMPLETED',
    "customer_ref" TEXT,
    "client_ref" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_items" (
    "id" TEXT NOT NULL,
    "sale_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "rate" DECIMAL(14,2) NOT NULL,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wastage" (
    "id" TEXT NOT NULL,
    "wastage_date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "product_id" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "rate" DECIMAL(14,4) NOT NULL,
    "wastage_value" DECIMAL(14,2) NOT NULL,
    "reason" "WastageReason" NOT NULL,
    "notes" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wastage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_adjustments" (
    "id" TEXT NOT NULL,
    "area" "StockArea" NOT NULL,
    "product_id" TEXT NOT NULL,
    "quantity_delta" DECIMAL(14,3) NOT NULL,
    "rate" DECIMAL(14,4) NOT NULL,
    "value_delta" DECIMAL(14,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_counters" (
    "bill_date" DATE NOT NULL,
    "last_seq" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "bill_counters_pkey" PRIMARY KEY ("bill_date")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "categories_name_key" ON "categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "units_name_key" ON "units"("name");

-- CreateIndex
CREATE UNIQUE INDEX "units_symbol_key" ON "units"("symbol");

-- CreateIndex
CREATE INDEX "suppliers_name_idx" ON "suppliers"("name");

-- CreateIndex
CREATE INDEX "products_category_id_idx" ON "products"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_name_unit_id_key" ON "products"("name", "unit_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_inwards_inward_no_key" ON "stock_inwards"("inward_no");

-- CreateIndex
CREATE INDEX "stock_inwards_supplier_id_idx" ON "stock_inwards"("supplier_id");

-- CreateIndex
CREATE INDEX "stock_inwards_inward_date_idx" ON "stock_inwards"("inward_date");

-- CreateIndex
CREATE INDEX "stock_inward_items_product_id_idx" ON "stock_inward_items"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_issues_issue_no_key" ON "stock_issues"("issue_no");

-- CreateIndex
CREATE INDEX "stock_issues_issue_date_idx" ON "stock_issues"("issue_date");

-- CreateIndex
CREATE INDEX "stock_issue_items_product_id_idx" ON "stock_issue_items"("product_id");

-- CreateIndex
CREATE INDEX "store_stock_ledger_product_id_txn_date_idx" ON "store_stock_ledger"("product_id", "txn_date");

-- CreateIndex
CREATE INDEX "canteen_stock_ledger_product_id_txn_date_idx" ON "canteen_stock_ledger"("product_id", "txn_date");

-- CreateIndex
CREATE UNIQUE INDEX "sales_bill_no_key" ON "sales"("bill_no");

-- CreateIndex
CREATE UNIQUE INDEX "sales_client_ref_key" ON "sales"("client_ref");

-- CreateIndex
CREATE INDEX "sales_bill_date_idx" ON "sales"("bill_date");

-- CreateIndex
CREATE INDEX "sales_payment_mode_idx" ON "sales"("payment_mode");

-- CreateIndex
CREATE INDEX "sale_items_product_id_idx" ON "sale_items"("product_id");

-- CreateIndex
CREATE INDEX "wastage_product_id_wastage_date_idx" ON "wastage"("product_id", "wastage_date");

-- CreateIndex
CREATE INDEX "stock_adjustments_product_id_idx" ON "stock_adjustments"("product_id");

-- CreateIndex
CREATE INDEX "audit_logs_entity_entity_id_idx" ON "audit_logs"("entity", "entity_id");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_inwards" ADD CONSTRAINT "stock_inwards_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_inwards" ADD CONSTRAINT "stock_inwards_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_inward_items" ADD CONSTRAINT "stock_inward_items_stock_inward_id_fkey" FOREIGN KEY ("stock_inward_id") REFERENCES "stock_inwards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_inward_items" ADD CONSTRAINT "stock_inward_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_issues" ADD CONSTRAINT "stock_issues_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_issue_items" ADD CONSTRAINT "stock_issue_items_stock_issue_id_fkey" FOREIGN KEY ("stock_issue_id") REFERENCES "stock_issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_issue_items" ADD CONSTRAINT "stock_issue_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_stock_balances" ADD CONSTRAINT "store_stock_balances_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_stock_ledger" ADD CONSTRAINT "store_stock_ledger_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canteen_stock_balances" ADD CONSTRAINT "canteen_stock_balances_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canteen_stock_ledger" ADD CONSTRAINT "canteen_stock_ledger_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wastage" ADD CONSTRAINT "wastage_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wastage" ADD CONSTRAINT "wastage_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
