-- CreateTable
CREATE TABLE "tax_trans" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "tax_date" DATE NOT NULL,
    "tax_code_id" UUID NOT NULL,
    "direction" VARCHAR(40) NOT NULL,
    "base" DECIMAL(18,2) NOT NULL,
    "tax" DECIMAL(18,2) NOT NULL,
    "currency_id" UUID,
    "base_cur" DECIMAL(18,2),
    "tax_cur" DECIMAL(18,2),
    "subject_id" UUID,
    "vat_id" VARCHAR(16),
    "document_num" VARCHAR(255),
    "voucher_id" UUID,
    "source_object" VARCHAR(255),
    "source_id" VARCHAR(255),
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "tax_trans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ar_group" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "receivable_account_id" UUID NOT NULL,
    "revenue_account_id" UUID,
    "tax_code_id" UUID,
    "payment_days" INTEGER DEFAULT 14,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "ar_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ar_customer" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "account_num" VARCHAR(20) NOT NULL,
    "subject_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "currency_id" UUID,
    "payment_days" INTEGER,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "ar_customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ar_invoice" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "invoice_num" VARCHAR(20) NOT NULL,
    "customer_id" UUID NOT NULL,
    "invoice_date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tax_date" DATE,
    "due_date" DATE,
    "currency_id" UUID,
    "description" VARCHAR(255),
    "amount_net" DECIMAL(18,2),
    "tax_amount" DECIMAL(18,2),
    "amount_gross" DECIMAL(18,2),
    "status" VARCHAR(40) NOT NULL DEFAULT 'draft',
    "voucher_id" UUID,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "ar_invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ar_invoice_line" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "description" VARCHAR(255) NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL DEFAULT 1,
    "unit_price" DECIMAL(18,2) NOT NULL,
    "revenue_account_id" UUID,
    "tax_code_id" UUID,
    "cost_center_id" UUID,
    "amount_net" DECIMAL(18,2),
    "tax_amount" DECIMAL(18,2),
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "ar_invoice_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ar_trans" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "invoice_id" UUID,
    "voucher_id" UUID,
    "document_num" VARCHAR(255),
    "date" DATE NOT NULL,
    "due_date" DATE,
    "currency_id" UUID,
    "amount" DECIMAL(18,2) NOT NULL,
    "amount_cur" DECIMAL(18,2),
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "ar_trans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ap_group" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "payable_account_id" UUID NOT NULL,
    "expense_account_id" UUID,
    "tax_code_id" UUID,
    "payment_days" INTEGER DEFAULT 14,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "ap_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ap_vendor" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "account_num" VARCHAR(20) NOT NULL,
    "subject_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "currency_id" UUID,
    "payment_days" INTEGER,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "ap_vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ap_invoice" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "invoice_num" VARCHAR(20) NOT NULL,
    "external_num" VARCHAR(20) NOT NULL,
    "vendor_id" UUID NOT NULL,
    "invoice_date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tax_date" DATE,
    "due_date" DATE,
    "currency_id" UUID,
    "description" VARCHAR(255),
    "amount_net" DECIMAL(18,2),
    "tax_amount" DECIMAL(18,2),
    "amount_gross" DECIMAL(18,2),
    "status" VARCHAR(40) NOT NULL DEFAULT 'draft',
    "voucher_id" UUID,
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "ap_invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ap_invoice_line" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "description" VARCHAR(255) NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL DEFAULT 1,
    "unit_price" DECIMAL(18,2) NOT NULL,
    "expense_account_id" UUID,
    "tax_code_id" UUID,
    "cost_center_id" UUID,
    "amount_net" DECIMAL(18,2),
    "tax_amount" DECIMAL(18,2),
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "ap_invoice_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ap_trans" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "invoice_id" UUID,
    "voucher_id" UUID,
    "document_num" VARCHAR(255),
    "date" DATE NOT NULL,
    "due_date" DATE,
    "currency_id" UUID,
    "amount" DECIMAL(18,2) NOT NULL,
    "amount_cur" DECIMAL(18,2),
    "ext" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "ap_trans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tax_trans_tenant_id_company_id_idx" ON "tax_trans"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "tax_trans_tax_code_id_idx" ON "tax_trans"("tax_code_id");

-- CreateIndex
CREATE INDEX "tax_trans_currency_id_idx" ON "tax_trans"("currency_id");

-- CreateIndex
CREATE INDEX "tax_trans_subject_id_idx" ON "tax_trans"("subject_id");

-- CreateIndex
CREATE INDEX "tax_trans_voucher_id_idx" ON "tax_trans"("voucher_id");

-- CreateIndex
CREATE INDEX "ar_group_tenant_id_company_id_idx" ON "ar_group"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "ar_group_receivable_account_id_idx" ON "ar_group"("receivable_account_id");

-- CreateIndex
CREATE INDEX "ar_group_revenue_account_id_idx" ON "ar_group"("revenue_account_id");

-- CreateIndex
CREATE INDEX "ar_group_tax_code_id_idx" ON "ar_group"("tax_code_id");

-- CreateIndex
CREATE UNIQUE INDEX "ar_group_tenant_id_company_id_code_key" ON "ar_group"("tenant_id", "company_id", "code");

-- CreateIndex
CREATE INDEX "ar_customer_tenant_id_company_id_idx" ON "ar_customer"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "ar_customer_subject_id_idx" ON "ar_customer"("subject_id");

-- CreateIndex
CREATE INDEX "ar_customer_group_id_idx" ON "ar_customer"("group_id");

-- CreateIndex
CREATE INDEX "ar_customer_currency_id_idx" ON "ar_customer"("currency_id");

-- CreateIndex
CREATE UNIQUE INDEX "ar_customer_tenant_id_company_id_account_num_key" ON "ar_customer"("tenant_id", "company_id", "account_num");

-- CreateIndex
CREATE UNIQUE INDEX "ar_customer_tenant_id_company_id_subject_id_key" ON "ar_customer"("tenant_id", "company_id", "subject_id");

-- CreateIndex
CREATE INDEX "ar_invoice_tenant_id_company_id_idx" ON "ar_invoice"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "ar_invoice_customer_id_idx" ON "ar_invoice"("customer_id");

-- CreateIndex
CREATE INDEX "ar_invoice_currency_id_idx" ON "ar_invoice"("currency_id");

-- CreateIndex
CREATE INDEX "ar_invoice_voucher_id_idx" ON "ar_invoice"("voucher_id");

-- CreateIndex
CREATE INDEX "ar_invoice_line_tenant_id_company_id_idx" ON "ar_invoice_line"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "ar_invoice_line_invoice_id_idx" ON "ar_invoice_line"("invoice_id");

-- CreateIndex
CREATE INDEX "ar_invoice_line_revenue_account_id_idx" ON "ar_invoice_line"("revenue_account_id");

-- CreateIndex
CREATE INDEX "ar_invoice_line_tax_code_id_idx" ON "ar_invoice_line"("tax_code_id");

-- CreateIndex
CREATE INDEX "ar_invoice_line_cost_center_id_idx" ON "ar_invoice_line"("cost_center_id");

-- CreateIndex
CREATE INDEX "ar_trans_tenant_id_company_id_idx" ON "ar_trans"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "ar_trans_customer_id_idx" ON "ar_trans"("customer_id");

-- CreateIndex
CREATE INDEX "ar_trans_invoice_id_idx" ON "ar_trans"("invoice_id");

-- CreateIndex
CREATE INDEX "ar_trans_voucher_id_idx" ON "ar_trans"("voucher_id");

-- CreateIndex
CREATE INDEX "ar_trans_currency_id_idx" ON "ar_trans"("currency_id");

-- CreateIndex
CREATE INDEX "ap_group_tenant_id_company_id_idx" ON "ap_group"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "ap_group_payable_account_id_idx" ON "ap_group"("payable_account_id");

-- CreateIndex
CREATE INDEX "ap_group_expense_account_id_idx" ON "ap_group"("expense_account_id");

-- CreateIndex
CREATE INDEX "ap_group_tax_code_id_idx" ON "ap_group"("tax_code_id");

-- CreateIndex
CREATE UNIQUE INDEX "ap_group_tenant_id_company_id_code_key" ON "ap_group"("tenant_id", "company_id", "code");

-- CreateIndex
CREATE INDEX "ap_vendor_tenant_id_company_id_idx" ON "ap_vendor"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "ap_vendor_subject_id_idx" ON "ap_vendor"("subject_id");

-- CreateIndex
CREATE INDEX "ap_vendor_group_id_idx" ON "ap_vendor"("group_id");

-- CreateIndex
CREATE INDEX "ap_vendor_currency_id_idx" ON "ap_vendor"("currency_id");

-- CreateIndex
CREATE UNIQUE INDEX "ap_vendor_tenant_id_company_id_account_num_key" ON "ap_vendor"("tenant_id", "company_id", "account_num");

-- CreateIndex
CREATE UNIQUE INDEX "ap_vendor_tenant_id_company_id_subject_id_key" ON "ap_vendor"("tenant_id", "company_id", "subject_id");

-- CreateIndex
CREATE INDEX "ap_invoice_tenant_id_company_id_idx" ON "ap_invoice"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "ap_invoice_vendor_id_idx" ON "ap_invoice"("vendor_id");

-- CreateIndex
CREATE INDEX "ap_invoice_currency_id_idx" ON "ap_invoice"("currency_id");

-- CreateIndex
CREATE INDEX "ap_invoice_voucher_id_idx" ON "ap_invoice"("voucher_id");

-- CreateIndex
CREATE INDEX "ap_invoice_line_tenant_id_company_id_idx" ON "ap_invoice_line"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "ap_invoice_line_invoice_id_idx" ON "ap_invoice_line"("invoice_id");

-- CreateIndex
CREATE INDEX "ap_invoice_line_expense_account_id_idx" ON "ap_invoice_line"("expense_account_id");

-- CreateIndex
CREATE INDEX "ap_invoice_line_tax_code_id_idx" ON "ap_invoice_line"("tax_code_id");

-- CreateIndex
CREATE INDEX "ap_invoice_line_cost_center_id_idx" ON "ap_invoice_line"("cost_center_id");

-- CreateIndex
CREATE INDEX "ap_trans_tenant_id_company_id_idx" ON "ap_trans"("tenant_id", "company_id");

-- CreateIndex
CREATE INDEX "ap_trans_vendor_id_idx" ON "ap_trans"("vendor_id");

-- CreateIndex
CREATE INDEX "ap_trans_invoice_id_idx" ON "ap_trans"("invoice_id");

-- CreateIndex
CREATE INDEX "ap_trans_voucher_id_idx" ON "ap_trans"("voucher_id");

-- CreateIndex
CREATE INDEX "ap_trans_currency_id_idx" ON "ap_trans"("currency_id");

-- AddForeignKey
ALTER TABLE "tax_trans" ADD CONSTRAINT "tax_trans_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_trans" ADD CONSTRAINT "tax_trans_tax_code_id_fkey" FOREIGN KEY ("tax_code_id") REFERENCES "tax_code"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_trans" ADD CONSTRAINT "tax_trans_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "sys_currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_trans" ADD CONSTRAINT "tax_trans_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "gab_subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_trans" ADD CONSTRAINT "tax_trans_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "gl_voucher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_group" ADD CONSTRAINT "ar_group_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_group" ADD CONSTRAINT "ar_group_receivable_account_id_fkey" FOREIGN KEY ("receivable_account_id") REFERENCES "gl_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_group" ADD CONSTRAINT "ar_group_revenue_account_id_fkey" FOREIGN KEY ("revenue_account_id") REFERENCES "gl_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_group" ADD CONSTRAINT "ar_group_tax_code_id_fkey" FOREIGN KEY ("tax_code_id") REFERENCES "tax_code"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_customer" ADD CONSTRAINT "ar_customer_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_customer" ADD CONSTRAINT "ar_customer_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "gab_subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_customer" ADD CONSTRAINT "ar_customer_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "ar_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_customer" ADD CONSTRAINT "ar_customer_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "sys_currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_invoice" ADD CONSTRAINT "ar_invoice_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_invoice" ADD CONSTRAINT "ar_invoice_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "ar_customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_invoice" ADD CONSTRAINT "ar_invoice_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "sys_currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_invoice" ADD CONSTRAINT "ar_invoice_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "gl_voucher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_invoice_line" ADD CONSTRAINT "ar_invoice_line_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_invoice_line" ADD CONSTRAINT "ar_invoice_line_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "ar_invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_invoice_line" ADD CONSTRAINT "ar_invoice_line_revenue_account_id_fkey" FOREIGN KEY ("revenue_account_id") REFERENCES "gl_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_invoice_line" ADD CONSTRAINT "ar_invoice_line_tax_code_id_fkey" FOREIGN KEY ("tax_code_id") REFERENCES "tax_code"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_invoice_line" ADD CONSTRAINT "ar_invoice_line_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "gl_cost_center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_trans" ADD CONSTRAINT "ar_trans_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_trans" ADD CONSTRAINT "ar_trans_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "ar_customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_trans" ADD CONSTRAINT "ar_trans_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "ar_invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_trans" ADD CONSTRAINT "ar_trans_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "gl_voucher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_trans" ADD CONSTRAINT "ar_trans_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "sys_currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_group" ADD CONSTRAINT "ap_group_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_group" ADD CONSTRAINT "ap_group_payable_account_id_fkey" FOREIGN KEY ("payable_account_id") REFERENCES "gl_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_group" ADD CONSTRAINT "ap_group_expense_account_id_fkey" FOREIGN KEY ("expense_account_id") REFERENCES "gl_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_group" ADD CONSTRAINT "ap_group_tax_code_id_fkey" FOREIGN KEY ("tax_code_id") REFERENCES "tax_code"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_vendor" ADD CONSTRAINT "ap_vendor_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_vendor" ADD CONSTRAINT "ap_vendor_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "gab_subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_vendor" ADD CONSTRAINT "ap_vendor_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "ap_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_vendor" ADD CONSTRAINT "ap_vendor_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "sys_currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_invoice" ADD CONSTRAINT "ap_invoice_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_invoice" ADD CONSTRAINT "ap_invoice_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "ap_vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_invoice" ADD CONSTRAINT "ap_invoice_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "sys_currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_invoice" ADD CONSTRAINT "ap_invoice_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "gl_voucher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_invoice_line" ADD CONSTRAINT "ap_invoice_line_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_invoice_line" ADD CONSTRAINT "ap_invoice_line_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "ap_invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_invoice_line" ADD CONSTRAINT "ap_invoice_line_expense_account_id_fkey" FOREIGN KEY ("expense_account_id") REFERENCES "gl_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_invoice_line" ADD CONSTRAINT "ap_invoice_line_tax_code_id_fkey" FOREIGN KEY ("tax_code_id") REFERENCES "tax_code"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_invoice_line" ADD CONSTRAINT "ap_invoice_line_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "gl_cost_center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_trans" ADD CONSTRAINT "ap_trans_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "sys_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_trans" ADD CONSTRAINT "ap_trans_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "ap_vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_trans" ADD CONSTRAINT "ap_trans_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "ap_invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_trans" ADD CONSTRAINT "ap_trans_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "gl_voucher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_trans" ADD CONSTRAINT "ap_trans_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "sys_currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
