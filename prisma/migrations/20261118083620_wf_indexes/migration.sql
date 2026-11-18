-- CreateIndex
CREATE INDEX "wf_work_item_tenant_id_company_id_assigned_to_status_idx" ON "wf_work_item"("tenant_id", "company_id", "assigned_to", "status");

-- CreateIndex
CREATE INDEX "wf_work_item_tenant_id_company_id_source_key_status_idx" ON "wf_work_item"("tenant_id", "company_id", "source_key", "status");

-- CreateIndex
CREATE INDEX "wf_work_item_tenant_id_company_id_ref_object_ref_id_idx" ON "wf_work_item"("tenant_id", "company_id", "ref_object", "ref_id");
