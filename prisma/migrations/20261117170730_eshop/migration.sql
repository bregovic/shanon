-- AlterTable
ALTER TABLE "inv_item" ADD COLUMN     "eshop" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "shop_category_id" UUID;

-- AlterTable
ALTER TABLE "ar_order" ADD COLUMN     "prices_incl_tax" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ar_invoice" ADD COLUMN     "prices_incl_tax" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "bank_payment_method" ADD COLUMN     "eshop" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "shop_shop" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "public_url" VARCHAR(120),
    "layout" VARCHAR(40) NOT NULL DEFAULT 'classic',
    "accent_color" VARCHAR(7) DEFAULT '#1f6f5c',
    "logo" VARCHAR(36),
    "headline" VARCHAR(255),
    "intro" TEXT,
    "hero_image" VARCHAR(36),
    "customer_id" UUID NOT NULL,
    "warehouse_id" UUID,
    "sell_out_of_stock" BOOLEAN NOT NULL DEFAULT true,
    "min_order" DECIMAL(18,2),
    "free_shipping_from" DECIMAL(18,2),
    "contact_email" VARCHAR(254),
    "contact_phone" VARCHAR(30),
    "order_hour_limit" INTEGER DEFAULT 5,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "shop_shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_category" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(60) NOT NULL,
    "parent_id" UUID,
    "position" INTEGER DEFAULT 10,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "image" VARCHAR(36),
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "shop_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_delivery" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "kind" VARCHAR(40) NOT NULL DEFAULT 'address',
    "price" DECIMAL(18,2) DEFAULT 0,
    "tax_code_id" UUID,
    "allow_cod" BOOLEAN NOT NULL DEFAULT false,
    "description" VARCHAR(255),
    "position" INTEGER DEFAULT 10,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "shop_delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_page" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(60) NOT NULL,
    "body" TEXT,
    "position" INTEGER DEFAULT 10,
    "in_footer" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "shop_page_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_order" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "order_num" VARCHAR(20) NOT NULL,
    "status" VARCHAR(40) NOT NULL DEFAULT 'new',
    "ordered_at" TIMESTAMP(3),
    "buyer_name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "phone" VARCHAR(30),
    "company_name" VARCHAR(120),
    "reg_no" VARCHAR(12),
    "vat_id" VARCHAR(255),
    "street" VARCHAR(255),
    "city" VARCHAR(255),
    "zip" VARCHAR(10),
    "country" VARCHAR(2) DEFAULT 'CZ',
    "note" TEXT,
    "delivery_id" UUID,
    "payment_method_id" UUID,
    "amount_gross" DECIMAL(18,2),
    "currency_id" UUID,
    "ar_order_id" UUID,
    "advance_id" UUID,
    "token" VARCHAR(64),
    "ip_hash" VARCHAR(64),
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "shop_order_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shop_shop_tenant_id_company_id_idx" ON "shop_shop"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "shop_shop_customer_id_idx" ON "shop_shop"("customer_id");

-- CreateIndex
CREATE INDEX "shop_shop_warehouse_id_idx" ON "shop_shop"("warehouse_id");

-- CreateIndex
CREATE INDEX "shop_category_tenant_id_company_id_idx" ON "shop_category"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "shop_category_parent_id_idx" ON "shop_category"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "shop_category_tenant_id_company_id_slug_key" ON "shop_category"("tenant_id", "company_id", "slug");

-- CreateIndex
CREATE INDEX "shop_delivery_tenant_id_company_id_idx" ON "shop_delivery"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "shop_delivery_tax_code_id_idx" ON "shop_delivery"("tax_code_id");

-- CreateIndex
CREATE UNIQUE INDEX "shop_delivery_tenant_id_company_id_code_key" ON "shop_delivery"("tenant_id", "company_id", "code");

-- CreateIndex
CREATE INDEX "shop_page_tenant_id_company_id_idx" ON "shop_page"("tenant_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "shop_page_tenant_id_company_id_slug_key" ON "shop_page"("tenant_id", "company_id", "slug");

-- CreateIndex
CREATE INDEX "shop_order_tenant_id_company_id_idx" ON "shop_order"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "shop_order_delivery_id_idx" ON "shop_order"("delivery_id");

-- CreateIndex
CREATE INDEX "shop_order_payment_method_id_idx" ON "shop_order"("payment_method_id");

-- CreateIndex
CREATE INDEX "shop_order_currency_id_idx" ON "shop_order"("currency_id");

-- CreateIndex
CREATE INDEX "shop_order_ar_order_id_idx" ON "shop_order"("ar_order_id");

-- CreateIndex
CREATE INDEX "shop_order_advance_id_idx" ON "shop_order"("advance_id");

-- CreateIndex
CREATE INDEX "inv_item_shop_category_id_idx" ON "inv_item"("shop_category_id");

-- AddForeignKey
ALTER TABLE "inv_item" ADD CONSTRAINT "inv_item_shop_category_id_fkey" FOREIGN KEY ("shop_category_id") REFERENCES "shop_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_shop" ADD CONSTRAINT "shop_shop_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_shop" ADD CONSTRAINT "shop_shop_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "ar_customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_shop" ADD CONSTRAINT "shop_shop_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "whs_warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_category" ADD CONSTRAINT "shop_category_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_category" ADD CONSTRAINT "shop_category_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "shop_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_delivery" ADD CONSTRAINT "shop_delivery_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_delivery" ADD CONSTRAINT "shop_delivery_tax_code_id_fkey" FOREIGN KEY ("tax_code_id") REFERENCES "tax_code"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_page" ADD CONSTRAINT "shop_page_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_order" ADD CONSTRAINT "shop_order_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_order" ADD CONSTRAINT "shop_order_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "shop_delivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_order" ADD CONSTRAINT "shop_order_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "bank_payment_method"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_order" ADD CONSTRAINT "shop_order_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "sys_currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_order" ADD CONSTRAINT "shop_order_ar_order_id_fkey" FOREIGN KEY ("ar_order_id") REFERENCES "ar_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_order" ADD CONSTRAINT "shop_order_advance_id_fkey" FOREIGN KEY ("advance_id") REFERENCES "ar_advance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
