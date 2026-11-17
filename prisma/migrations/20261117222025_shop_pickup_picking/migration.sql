-- AlterTable
ALTER TABLE "inv_item" ADD COLUMN     "weigh_buffer_pct" DECIMAL(7,4);

-- AlterTable
ALTER TABLE "shop_shop" ADD COLUMN     "pickup_from" INTEGER DEFAULT 8,
ADD COLUMN     "pickup_lead_days" INTEGER DEFAULT 1,
ADD COLUMN     "pickup_max_days" INTEGER DEFAULT 14,
ADD COLUMN     "pickup_to" INTEGER DEFAULT 17,
ADD COLUMN     "weigh_buffer_pct" DECIMAL(7,4) DEFAULT 10;

-- AlterTable
ALTER TABLE "shop_order" ADD COLUMN     "amount_max" DECIMAL(18,2),
ADD COLUMN     "estimated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pickup_date" DATE,
ADD COLUMN     "pickup_hour" INTEGER;

-- CreateTable
CREATE TABLE "shop_pick" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "shop_order_id" UUID NOT NULL,
    "order_line_id" UUID NOT NULL,
    "item_id" UUID,
    "name" VARCHAR(255),
    "unit" VARCHAR(20),
    "weighed" BOOLEAN NOT NULL DEFAULT false,
    "ordered_qty" DECIMAL(18,4),
    "max_qty" DECIMAL(18,4),
    "picked_qty" DECIMAL(18,4),
    "status" VARCHAR(40) NOT NULL DEFAULT 'pending',
    "picked_at" TIMESTAMP(3),
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "shop_pick_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shop_pick_tenant_id_company_id_idx" ON "shop_pick"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "shop_pick_shop_order_id_idx" ON "shop_pick"("shop_order_id");

-- CreateIndex
CREATE INDEX "shop_pick_order_line_id_idx" ON "shop_pick"("order_line_id");

-- CreateIndex
CREATE INDEX "shop_pick_item_id_idx" ON "shop_pick"("item_id");

-- AddForeignKey
ALTER TABLE "shop_pick" ADD CONSTRAINT "shop_pick_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_pick" ADD CONSTRAINT "shop_pick_shop_order_id_fkey" FOREIGN KEY ("shop_order_id") REFERENCES "shop_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_pick" ADD CONSTRAINT "shop_pick_order_line_id_fkey" FOREIGN KEY ("order_line_id") REFERENCES "ar_order_line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_pick" ADD CONSTRAINT "shop_pick_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inv_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
