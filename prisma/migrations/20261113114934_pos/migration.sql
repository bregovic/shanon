-- AlterTable
ALTER TABLE "tax_trans" ADD COLUMN     "simplified" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "pos_register" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "template" VARCHAR(40) NOT NULL DEFAULT 'counter',
    "cash_account_id" UUID NOT NULL,
    "card_account_id" UUID NOT NULL,
    "rounding_gain_account_id" UUID NOT NULL,
    "rounding_loss_account_id" UUID NOT NULL,
    "round_cash" BOOLEAN NOT NULL DEFAULT true,
    "receipt_footer" VARCHAR(255),
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "pos_register_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_shift" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "shift_num" VARCHAR(20) NOT NULL,
    "register_id" UUID NOT NULL,
    "open_date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" VARCHAR(40) NOT NULL DEFAULT 'open',
    "opening_cash" DECIMAL(18,2),
    "receipt_count" INTEGER,
    "sales_gross" DECIMAL(18,2),
    "tax_amount" DECIMAL(18,2),
    "cash_total" DECIMAL(18,2),
    "card_total" DECIMAL(18,2),
    "rounding_total" DECIMAL(18,2),
    "expected_cash" DECIMAL(18,2),
    "voucher_id" UUID,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "pos_shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_receipt" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "receipt_num" VARCHAR(20) NOT NULL,
    "register_id" UUID NOT NULL,
    "shift_id" UUID NOT NULL,
    "date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payment_method" VARCHAR(40) NOT NULL,
    "amount_net" DECIMAL(18,2),
    "tax_amount" DECIMAL(18,2),
    "amount_gross" DECIMAL(18,2),
    "rounding" DECIMAL(18,2),
    "amount_paid" DECIMAL(18,2),
    "cash_given" DECIMAL(18,2),
    "change" DECIMAL(18,2),
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "pos_receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_receipt_line" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "receipt_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "description" VARCHAR(255) NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "unit_id" UUID,
    "unit_price" DECIMAL(18,2) NOT NULL,
    "tax_code_id" UUID,
    "revenue_account_id" UUID,
    "amount_gross" DECIMAL(18,2),
    "amount_net" DECIMAL(18,2),
    "tax_amount" DECIMAL(18,2),
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "pos_receipt_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pos_register_tenant_id_company_id_idx" ON "pos_register"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "pos_register_cash_account_id_idx" ON "pos_register"("cash_account_id");

-- CreateIndex
CREATE INDEX "pos_register_card_account_id_idx" ON "pos_register"("card_account_id");

-- CreateIndex
CREATE INDEX "pos_register_rounding_gain_account_id_idx" ON "pos_register"("rounding_gain_account_id");

-- CreateIndex
CREATE INDEX "pos_register_rounding_loss_account_id_idx" ON "pos_register"("rounding_loss_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "pos_register_tenant_id_company_id_code_key" ON "pos_register"("tenant_id", "company_id", "code");

-- CreateIndex
CREATE INDEX "pos_shift_tenant_id_company_id_idx" ON "pos_shift"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "pos_shift_register_id_idx" ON "pos_shift"("register_id");

-- CreateIndex
CREATE INDEX "pos_shift_voucher_id_idx" ON "pos_shift"("voucher_id");

-- CreateIndex
CREATE INDEX "pos_receipt_tenant_id_company_id_idx" ON "pos_receipt"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "pos_receipt_register_id_idx" ON "pos_receipt"("register_id");

-- CreateIndex
CREATE INDEX "pos_receipt_shift_id_idx" ON "pos_receipt"("shift_id");

-- CreateIndex
CREATE INDEX "pos_receipt_line_tenant_id_company_id_idx" ON "pos_receipt_line"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "pos_receipt_line_receipt_id_idx" ON "pos_receipt_line"("receipt_id");

-- CreateIndex
CREATE INDEX "pos_receipt_line_item_id_idx" ON "pos_receipt_line"("item_id");

-- CreateIndex
CREATE INDEX "pos_receipt_line_unit_id_idx" ON "pos_receipt_line"("unit_id");

-- CreateIndex
CREATE INDEX "pos_receipt_line_tax_code_id_idx" ON "pos_receipt_line"("tax_code_id");

-- CreateIndex
CREATE INDEX "pos_receipt_line_revenue_account_id_idx" ON "pos_receipt_line"("revenue_account_id");

-- AddForeignKey
ALTER TABLE "pos_register" ADD CONSTRAINT "pos_register_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_register" ADD CONSTRAINT "pos_register_cash_account_id_fkey" FOREIGN KEY ("cash_account_id") REFERENCES "gl_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_register" ADD CONSTRAINT "pos_register_card_account_id_fkey" FOREIGN KEY ("card_account_id") REFERENCES "gl_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_register" ADD CONSTRAINT "pos_register_rounding_gain_account_id_fkey" FOREIGN KEY ("rounding_gain_account_id") REFERENCES "gl_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_register" ADD CONSTRAINT "pos_register_rounding_loss_account_id_fkey" FOREIGN KEY ("rounding_loss_account_id") REFERENCES "gl_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_shift" ADD CONSTRAINT "pos_shift_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_shift" ADD CONSTRAINT "pos_shift_register_id_fkey" FOREIGN KEY ("register_id") REFERENCES "pos_register"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_shift" ADD CONSTRAINT "pos_shift_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "gl_voucher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_receipt" ADD CONSTRAINT "pos_receipt_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_receipt" ADD CONSTRAINT "pos_receipt_register_id_fkey" FOREIGN KEY ("register_id") REFERENCES "pos_register"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_receipt" ADD CONSTRAINT "pos_receipt_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "pos_shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_receipt_line" ADD CONSTRAINT "pos_receipt_line_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_receipt_line" ADD CONSTRAINT "pos_receipt_line_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "pos_receipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_receipt_line" ADD CONSTRAINT "pos_receipt_line_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inv_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_receipt_line" ADD CONSTRAINT "pos_receipt_line_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "inv_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_receipt_line" ADD CONSTRAINT "pos_receipt_line_tax_code_id_fkey" FOREIGN KEY ("tax_code_id") REFERENCES "tax_code"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_receipt_line" ADD CONSTRAINT "pos_receipt_line_revenue_account_id_fkey" FOREIGN KEY ("revenue_account_id") REFERENCES "gl_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
