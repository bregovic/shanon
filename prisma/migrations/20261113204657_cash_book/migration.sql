-- CreateTable
CREATE TABLE "cash_desk" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "account_id" UUID NOT NULL,
    "max_balance" DECIMAL(18,2),
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "cash_desk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_voucher" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "doc_num" VARCHAR(20),
    "desk_id" UUID NOT NULL,
    "direction" VARCHAR(40) NOT NULL DEFAULT 'out',
    "date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description" VARCHAR(255) NOT NULL,
    "partner_name" VARCHAR(120),
    "subject_id" UUID,
    "amount" DECIMAL(18,2) NOT NULL,
    "offset_account_id" UUID NOT NULL,
    "tax_code_id" UUID,
    "amount_net" DECIMAL(18,2),
    "tax_amount" DECIMAL(18,2),
    "dim1" VARCHAR(20),
    "dim2" VARCHAR(20),
    "dim3" VARCHAR(20),
    "dim4" VARCHAR(20),
    "dim5" VARCHAR(20),
    "dim6" VARCHAR(20),
    "status" VARCHAR(40) NOT NULL DEFAULT 'draft',
    "voucher_id" UUID,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "cash_voucher_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cash_desk_tenant_id_company_id_idx" ON "cash_desk"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "cash_desk_account_id_idx" ON "cash_desk"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "cash_desk_tenant_id_company_id_code_key" ON "cash_desk"("tenant_id", "company_id", "code");

-- CreateIndex
CREATE INDEX "cash_voucher_tenant_id_company_id_idx" ON "cash_voucher"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "cash_voucher_desk_id_idx" ON "cash_voucher"("desk_id");

-- CreateIndex
CREATE INDEX "cash_voucher_subject_id_idx" ON "cash_voucher"("subject_id");

-- CreateIndex
CREATE INDEX "cash_voucher_offset_account_id_idx" ON "cash_voucher"("offset_account_id");

-- CreateIndex
CREATE INDEX "cash_voucher_tax_code_id_idx" ON "cash_voucher"("tax_code_id");

-- CreateIndex
CREATE INDEX "cash_voucher_voucher_id_idx" ON "cash_voucher"("voucher_id");

-- CreateIndex
CREATE UNIQUE INDEX "cash_voucher_tenant_id_company_id_doc_num_key" ON "cash_voucher"("tenant_id", "company_id", "doc_num");

-- AddForeignKey
ALTER TABLE "cash_desk" ADD CONSTRAINT "cash_desk_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_desk" ADD CONSTRAINT "cash_desk_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "gl_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_voucher" ADD CONSTRAINT "cash_voucher_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_voucher" ADD CONSTRAINT "cash_voucher_desk_id_fkey" FOREIGN KEY ("desk_id") REFERENCES "cash_desk"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_voucher" ADD CONSTRAINT "cash_voucher_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "gab_subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_voucher" ADD CONSTRAINT "cash_voucher_offset_account_id_fkey" FOREIGN KEY ("offset_account_id") REFERENCES "gl_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_voucher" ADD CONSTRAINT "cash_voucher_tax_code_id_fkey" FOREIGN KEY ("tax_code_id") REFERENCES "tax_code"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_voucher" ADD CONSTRAINT "cash_voucher_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "gl_voucher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
