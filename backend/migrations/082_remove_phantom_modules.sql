-- Migration 082: Remove non-existent modules (CRM, Projects)
-- These modules were seeded but never implemented

DELETE FROM sys_security_permissions 
WHERE object_id IN (
    SELECT rec_id FROM sys_security_objects 
    WHERE identifier IN ('mod_crm', 'mod_projects')
);

DELETE FROM sys_security_objects 
WHERE identifier IN ('mod_crm', 'mod_projects');
