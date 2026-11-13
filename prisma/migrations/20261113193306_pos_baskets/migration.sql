-- CreateTable
CREATE TABLE "pos_box" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "pos_box_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_basket" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "box_id" UUID,
    "register_id" UUID,
    "status" VARCHAR(40) NOT NULL DEFAULT 'open',
    "receipt_id" UUID,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "pos_basket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_basket_line" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "basket_id" UUID NOT NULL,
    "line_num" INTEGER,
    "item_id" UUID NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "pos_basket_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pos_box_tenant_id_company_id_idx" ON "pos_box"("tenant_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "pos_box_tenant_id_company_id_code_key" ON "pos_box"("tenant_id", "company_id", "code");

-- CreateIndex
CREATE INDEX "pos_basket_tenant_id_company_id_idx" ON "pos_basket"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "pos_basket_box_id_idx" ON "pos_basket"("box_id");

-- CreateIndex
CREATE INDEX "pos_basket_register_id_idx" ON "pos_basket"("register_id");

-- CreateIndex
CREATE INDEX "pos_basket_receipt_id_idx" ON "pos_basket"("receipt_id");

-- CreateIndex
CREATE INDEX "pos_basket_line_tenant_id_company_id_idx" ON "pos_basket_line"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "pos_basket_line_basket_id_idx" ON "pos_basket_line"("basket_id");

-- CreateIndex
CREATE INDEX "pos_basket_line_item_id_idx" ON "pos_basket_line"("item_id");

-- AddForeignKey
ALTER TABLE "pos_box" ADD CONSTRAINT "pos_box_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_basket" ADD CONSTRAINT "pos_basket_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_basket" ADD CONSTRAINT "pos_basket_box_id_fkey" FOREIGN KEY ("box_id") REFERENCES "pos_box"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_basket" ADD CONSTRAINT "pos_basket_register_id_fkey" FOREIGN KEY ("register_id") REFERENCES "pos_register"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_basket" ADD CONSTRAINT "pos_basket_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "pos_receipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_basket_line" ADD CONSTRAINT "pos_basket_line_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_basket_line" ADD CONSTRAINT "pos_basket_line_basket_id_fkey" FOREIGN KEY ("basket_id") REFERENCES "pos_basket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_basket_line" ADD CONSTRAINT "pos_basket_line_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inv_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
