-- AlterTable
ALTER TABLE "ar_order" ADD COLUMN     "warehouse_id" UUID;

-- AlterTable
ALTER TABLE "ar_order_line" ADD COLUMN     "delivered_qty" DECIMAL(18,4);

-- AlterTable
ALTER TABLE "ap_order" ADD COLUMN     "warehouse_id" UUID;

-- AlterTable
ALTER TABLE "ap_order_line" ADD COLUMN     "delivered_qty" DECIMAL(18,4);

-- AlterTable
ALTER TABLE "pos_register" ADD COLUMN     "warehouse_id" UUID;

-- CreateTable
CREATE TABLE "whs_location_level" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "whs_location_level_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whs_warehouse" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "site_id" UUID,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "whs_warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whs_location" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "parent_id" UUID,
    "code" VARCHAR(20) NOT NULL,
    "path" VARCHAR(120),
    "name" VARCHAR(120),
    "level" INTEGER,
    "level_name" VARCHAR(120),
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "whs_location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whs_onhand" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "location_id" UUID,
    "qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "whs_onhand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whs_trans" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "item_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "location_id" UUID,
    "qty" DECIMAL(18,4) NOT NULL,
    "document_num" VARCHAR(255),
    "source_object" VARCHAR(40),
    "source_id" VARCHAR(36),
    "reason" VARCHAR(255),
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "whs_trans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whs_reservation" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "document_num" VARCHAR(255),
    "source_object" VARCHAR(40),
    "source_id" VARCHAR(36),
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "whs_reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whs_journal" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "journal_num" VARCHAR(20) NOT NULL,
    "kind" VARCHAR(40) NOT NULL DEFAULT 'receipt',
    "warehouse_id" UUID NOT NULL,
    "to_warehouse_id" UUID,
    "date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description" VARCHAR(255),
    "purchase_order_id" UUID,
    "status" VARCHAR(40) NOT NULL DEFAULT 'draft',
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "whs_journal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whs_journal_line" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "journal_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "location_id" UUID,
    "to_location_id" UUID,
    "qty" DECIMAL(18,4),
    "onhand_qty" DECIMAL(18,4),
    "counted_qty" DECIMAL(18,4),
    "reason" VARCHAR(255),
    "order_line_id" UUID,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "whs_journal_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whs_location_level_tenant_id_company_id_idx" ON "whs_location_level"("tenant_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "whs_location_level_tenant_id_company_id_position_key" ON "whs_location_level"("tenant_id", "company_id", "position");

-- CreateIndex
CREATE INDEX "whs_warehouse_tenant_id_company_id_idx" ON "whs_warehouse"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "whs_warehouse_site_id_idx" ON "whs_warehouse"("site_id");

-- CreateIndex
CREATE UNIQUE INDEX "whs_warehouse_tenant_id_company_id_code_key" ON "whs_warehouse"("tenant_id", "company_id", "code");

-- CreateIndex
CREATE INDEX "whs_location_tenant_id_company_id_idx" ON "whs_location"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "whs_location_warehouse_id_idx" ON "whs_location"("warehouse_id");

-- CreateIndex
CREATE INDEX "whs_location_parent_id_idx" ON "whs_location"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "whs_location_tenant_id_company_id_warehouse_id_path_key" ON "whs_location"("tenant_id", "company_id", "warehouse_id", "path");

-- CreateIndex
CREATE INDEX "whs_onhand_tenant_id_company_id_idx" ON "whs_onhand"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "whs_onhand_item_id_idx" ON "whs_onhand"("item_id");

-- CreateIndex
CREATE INDEX "whs_onhand_warehouse_id_idx" ON "whs_onhand"("warehouse_id");

-- CreateIndex
CREATE INDEX "whs_onhand_location_id_idx" ON "whs_onhand"("location_id");

-- CreateIndex
CREATE INDEX "whs_trans_tenant_id_company_id_idx" ON "whs_trans"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "whs_trans_item_id_idx" ON "whs_trans"("item_id");

-- CreateIndex
CREATE INDEX "whs_trans_warehouse_id_idx" ON "whs_trans"("warehouse_id");

-- CreateIndex
CREATE INDEX "whs_trans_location_id_idx" ON "whs_trans"("location_id");

-- CreateIndex
CREATE INDEX "whs_reservation_tenant_id_company_id_idx" ON "whs_reservation"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "whs_reservation_item_id_idx" ON "whs_reservation"("item_id");

-- CreateIndex
CREATE INDEX "whs_reservation_warehouse_id_idx" ON "whs_reservation"("warehouse_id");

-- CreateIndex
CREATE INDEX "whs_journal_tenant_id_company_id_idx" ON "whs_journal"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "whs_journal_warehouse_id_idx" ON "whs_journal"("warehouse_id");

-- CreateIndex
CREATE INDEX "whs_journal_to_warehouse_id_idx" ON "whs_journal"("to_warehouse_id");

-- CreateIndex
CREATE INDEX "whs_journal_purchase_order_id_idx" ON "whs_journal"("purchase_order_id");

-- CreateIndex
CREATE INDEX "whs_journal_line_tenant_id_company_id_idx" ON "whs_journal_line"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "whs_journal_line_journal_id_idx" ON "whs_journal_line"("journal_id");

-- CreateIndex
CREATE INDEX "whs_journal_line_item_id_idx" ON "whs_journal_line"("item_id");

-- CreateIndex
CREATE INDEX "whs_journal_line_location_id_idx" ON "whs_journal_line"("location_id");

-- CreateIndex
CREATE INDEX "whs_journal_line_to_location_id_idx" ON "whs_journal_line"("to_location_id");

-- CreateIndex
CREATE INDEX "whs_journal_line_order_line_id_idx" ON "whs_journal_line"("order_line_id");

-- CreateIndex
CREATE INDEX "ar_order_warehouse_id_idx" ON "ar_order"("warehouse_id");

-- CreateIndex
CREATE INDEX "ap_order_warehouse_id_idx" ON "ap_order"("warehouse_id");

-- CreateIndex
CREATE INDEX "pos_register_warehouse_id_idx" ON "pos_register"("warehouse_id");

-- AddForeignKey
ALTER TABLE "ar_order" ADD CONSTRAINT "ar_order_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "whs_warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_order" ADD CONSTRAINT "ap_order_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "whs_warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_register" ADD CONSTRAINT "pos_register_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "whs_warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whs_location_level" ADD CONSTRAINT "whs_location_level_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whs_warehouse" ADD CONSTRAINT "whs_warehouse_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whs_warehouse" ADD CONSTRAINT "whs_warehouse_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "org_site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whs_location" ADD CONSTRAINT "whs_location_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whs_location" ADD CONSTRAINT "whs_location_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "whs_warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whs_location" ADD CONSTRAINT "whs_location_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "whs_location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whs_onhand" ADD CONSTRAINT "whs_onhand_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whs_onhand" ADD CONSTRAINT "whs_onhand_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inv_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whs_onhand" ADD CONSTRAINT "whs_onhand_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "whs_warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whs_onhand" ADD CONSTRAINT "whs_onhand_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "whs_location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whs_trans" ADD CONSTRAINT "whs_trans_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whs_trans" ADD CONSTRAINT "whs_trans_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inv_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whs_trans" ADD CONSTRAINT "whs_trans_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "whs_warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whs_trans" ADD CONSTRAINT "whs_trans_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "whs_location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whs_reservation" ADD CONSTRAINT "whs_reservation_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whs_reservation" ADD CONSTRAINT "whs_reservation_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inv_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whs_reservation" ADD CONSTRAINT "whs_reservation_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "whs_warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whs_journal" ADD CONSTRAINT "whs_journal_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whs_journal" ADD CONSTRAINT "whs_journal_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "whs_warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whs_journal" ADD CONSTRAINT "whs_journal_to_warehouse_id_fkey" FOREIGN KEY ("to_warehouse_id") REFERENCES "whs_warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whs_journal" ADD CONSTRAINT "whs_journal_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "ap_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whs_journal_line" ADD CONSTRAINT "whs_journal_line_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whs_journal_line" ADD CONSTRAINT "whs_journal_line_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "whs_journal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whs_journal_line" ADD CONSTRAINT "whs_journal_line_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inv_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whs_journal_line" ADD CONSTRAINT "whs_journal_line_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "whs_location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whs_journal_line" ADD CONSTRAINT "whs_journal_line_to_location_id_fkey" FOREIGN KEY ("to_location_id") REFERENCES "whs_location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whs_journal_line" ADD CONSTRAINT "whs_journal_line_order_line_id_fkey" FOREIGN KEY ("order_line_id") REFERENCES "ap_order_line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
