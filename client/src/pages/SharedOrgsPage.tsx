
import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
    Button,
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbButton,
    BreadcrumbDivider,
    Spinner,
    Input,
    Label,
    Dialog,
    DialogSurface,
    DialogBody,
    DialogTitle,
    DialogContent,
    DialogActions,
    Text,
    Drawer,
    DrawerHeader,
    DrawerHeaderTitle,
    DrawerBody,
    Divider,
    MessageBar,
    MessageBarBody,
    Menu,
    MenuTrigger,
    MenuPopover,
    MenuList,
    MenuItem,
    tokens,
    Switch
} from '@fluentui/react-components';
import type { TableColumnDefinition, SelectionItemId } from '@fluentui/react-components';
import {
    Add24Regular,
    ArrowClockwise24Regular,
    Delete24Regular,
    Save24Regular,
    PeopleTeam24Regular,
    Database24Regular,
    Dismiss24Regular,
    ChevronDown24Regular,
    Edit24Regular,
    BuildingMultiple24Regular
} from '@fluentui/react-icons';
import { useNavigate } from 'react-router-dom';
import { PageLayout, PageHeader, PageContent } from '../components/PageLayout';
import { SmartDataGrid } from '../components/SmartDataGrid';
import { useTranslation } from '../context/TranslationContext';
import { ActionBar } from '../components/ActionBar';
import { useAuth } from '../context/AuthContext';
import { TransferList } from '../components/TransferList';
import { useKeyboardShortcut } from '../context/KeyboardShortcutsContext';

const API_BASE = import.meta.env.DEV ? 'http://localhost/Webhry/hollyhop/broker/shanon/backend' : '/api';

interface OrgGroup {
    org_id: string;
    display_name: string;
    is_active: boolean;
    is_virtual_group: boolean;
}

const defaultGroup: OrgGroup = {
    org_id: '',
    display_name: '',
    is_active: true,
    is_virtual_group: true
};

export const SharedOrgsPage: React.FC = () => {
    const navigate = useNavigate();
    const { t } = useTranslation();
    const { currentOrgId } = useAuth();
    const orgPrefix = `/${currentOrgId || 'VACKR'}`;

    // --- State ---
    const [items, setItems] = useState<OrgGroup[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedIds, setSelectedIds] = useState<Set<SelectionItemId>>(new Set());

    // Drawer & Form State
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);
    const [drawerMode, setDrawerMode] = useState<'create' | 'edit'>('create');
    const [formData, setFormData] = useState<OrgGroup>(defaultGroup);

    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Dialogs State (for Membership & Tables)
    const [membersDialogOpen, setMembersDialogOpen] = useState(false);
    const [tablesDialogOpen, setTablesDialogOpen] = useState(false);

    // Transfer List Data
    const [availableMembers, setAvailableMembers] = useState<any[]>([]); // All Orgs
    const [assignedMembers, setAssignedMembers] = useState<string[]>([]); // IDs

    const [availableTables, setAvailableTables] = useState<any[]>([]); // All Tables
    const [assignedTables, setAssignedTables] = useState<string[]>([]); // Names

    // --- Actions ---

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`${API_BASE}/api-orgs.php?action=list&type=virtual`);
            const json = await res.json();
            if (json.success) setItems(json.data || []);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);

    const handleOpenCreate = () => {
        setFormData({ ...defaultGroup });
        setDrawerMode('create');
        setError(null);
        setIsDrawerOpen(true);
    };

    const handleOpenEdit = (item: OrgGroup) => {
        setFormData({ ...item });
        setDrawerMode('edit');
        setError(null);
        setIsDrawerOpen(true);
    };

    const handleSave = async () => {
        if (!formData.org_id || !formData.display_name) {
            setError(t('common.required_fields') || 'Vyplňte povinná pole.');
            return;
        }

        setSaving(true);
        setError(null);
        try {
            const action = drawerMode === 'create' ? 'create' : 'update';
            const res = await fetch(`${API_BASE}/api-orgs.php?action=${action}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });
            const json = await res.json();

            if (json.success) {
                await fetchData();
                setIsDrawerOpen(false);
            } else {
                setError(json.error || 'Uložení selhalo');
            }
        } catch (e) {
            setError('Chyba sítě');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (selectedIds.size === 0) return;
        if (!confirm(t('common.confirm_delete') || 'Opravdu smazat vybrané záznamy?')) return;
        try {
            const res = await fetch(`${API_BASE}/api-orgs.php?action=delete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: Array.from(selectedIds) })
            });
            if ((await res.json()).success) {
                setSelectedIds(new Set());
                fetchData();
            }
        } catch (e) { console.error(e); }
    };

    // --- Shortcuts ---
    useKeyboardShortcut('new', handleOpenCreate, []);
    useKeyboardShortcut('refresh', fetchData, []);
    useKeyboardShortcut('save', () => { if (isDrawerOpen) handleSave(); }, [isDrawerOpen, formData]);
    useKeyboardShortcut('escape', () => {
        if (isDrawerOpen) setIsDrawerOpen(false);
        else navigate(`${orgPrefix}/system`);
    }, [isDrawerOpen, orgPrefix, navigate]);


    // --- Members Logic ---
    const openMembersDialog = async () => {
        if (selectedIds.size !== 1) return;
        const id = Array.from(selectedIds)[0] as string;
        const group = items.find(i => i.org_id === id);
        if (!group) return;

        setFormData(group); // Just for title context
        setLoading(true);
        try {
            const res = await fetch(`${API_BASE}/api-orgs.php?action=get_group_members&group_id=${id}`);
            const json = await res.json();
            if (json.success) {
                const available = json.available_orgs.map((o: any) => ({
                    id: o.org_id,
                    label: `${o.display_name} (${o.org_id})`
                }));
                setAvailableMembers(available);
                setAssignedMembers(json.assigned_ids);
                setMembersDialogOpen(true);
            }
        } finally {
            setLoading(false);
        }
    };

    const saveMembers = async () => {
        // We use formData.org_id here because we set it before opening dialog
        // Or better, track "activeDialogId"
        const groupId = Array.from(selectedIds)[0];

        const res = await fetch(`${API_BASE}/api-orgs.php?action=save_group_members`, {
            method: 'POST',
            body: JSON.stringify({ group_id: groupId, member_ids: assignedMembers })
        });
        if ((await res.json()).success) setMembersDialogOpen(false);
    };

    // --- Tables Logic ---
    const openTablesDialog = async () => {
        if (selectedIds.size !== 1) return;
        const id = Array.from(selectedIds)[0] as string;
        const group = items.find(i => i.org_id === id);
        if (!group) return;

        setFormData(group);
        setLoading(true);
        try {
            const res = await fetch(`${API_BASE}/api-orgs.php?action=get_shared_tables&group_id=${id}`);
            const json = await res.json();
            if (json.success) {
                const available = json.all_tables.map((t: any) => ({
                    id: t.id,
                    label: t.display_name
                }));
                setAvailableTables(available);
                setAssignedTables(json.assigned_tables);
                setTablesDialogOpen(true);
            }
        } finally {
            setLoading(false);
        }
    };

    const saveTables = async () => {
        const groupId = Array.from(selectedIds)[0];
        const res = await fetch(`${API_BASE}/api-orgs.php?action=save_shared_tables`, {
            method: 'POST',
            body: JSON.stringify({ group_id: groupId, table_names: assignedTables })
        });
        if ((await res.json()).success) setTablesDialogOpen(false);
    };

    // --- Columns ---
    const columns: TableColumnDefinition<OrgGroup>[] = useMemo(() => [
        {
            columnId: 'org_id',
            compare: (a, b) => a.org_id.localeCompare(b.org_id),
            renderHeaderCell: () => t('common.id') || 'ID',
            renderCell: (item) => <Text font="monospace">{item.org_id}</Text>
        },
        {
            columnId: 'display_name',
            compare: (a, b) => a.display_name.localeCompare(b.display_name),
            renderHeaderCell: () => t('common.name') || 'Název',
            renderCell: (item) => <strong>{item.display_name}</strong>
        },
        {
            columnId: 'is_active',
            compare: (a, b) => Number(b.is_active) - Number(a.is_active),
            renderHeaderCell: () => 'Status',
            renderCell: (item) => item.is_active ? 'Aktivní' : 'Neaktivní'
        }
    ], [t]);

    const getSelectedGroup = () => {
        if (selectedIds.size !== 1) return null;
        const id = Array.from(selectedIds)[0];
        return items.find(i => i.org_id === id);
    };

    return (
        <PageLayout>
            <PageHeader>
                <Breadcrumb>
                    <BreadcrumbItem><BreadcrumbButton onClick={() => navigate(`${orgPrefix}/system`)}>Systém</BreadcrumbButton></BreadcrumbItem>
                    <BreadcrumbDivider />
                    <BreadcrumbItem><BreadcrumbButton current>Sdílené společnosti</BreadcrumbButton></BreadcrumbItem>
                </Breadcrumb>
            </PageHeader>

            <ActionBar>
                {/* Primary Actions Menu */}
                <Menu>
                    <MenuTrigger>
                        <Button appearance="primary" icon={<ChevronDown24Regular />} iconPosition="after">
                            {t('common.actions') || 'Akce'}
                        </Button>
                    </MenuTrigger>
                    <MenuPopover>
                        <MenuList>
                            <MenuItem icon={<Add24Regular />} onClick={handleOpenCreate}>{t('common.new') || 'Nová skupina'}</MenuItem>
                            <MenuItem
                                icon={<Edit24Regular />}
                                disabled={selectedIds.size !== 1}
                                onClick={() => {
                                    const g = getSelectedGroup();
                                    if (g) handleOpenEdit(g);
                                }}
                            >
                                {t('common.edit') || 'Upravit'}
                            </MenuItem>
                            <MenuItem icon={<Delete24Regular />} disabled={selectedIds.size === 0} onClick={handleDelete}>{t('common.delete') || 'Smazat'}</MenuItem>
                        </MenuList>
                    </MenuPopover>
                </Menu>

                <div style={{ width: 1, height: 24, backgroundColor: tokens.colorNeutralStroke2, margin: '0 8px' }} />

                <Button appearance="subtle" icon={<ArrowClockwise24Regular />} onClick={fetchData} title={t('common.refresh')} />

                <div style={{ width: 1, height: 24, backgroundColor: tokens.colorNeutralStroke2, margin: '0 8px' }} />

                {/* Specific Tools */}
                <Button
                    appearance="subtle"
                    icon={<PeopleTeam24Regular />}
                    disabled={selectedIds.size !== 1}
                    onClick={openMembersDialog}
                >
                    Členové skupiny
                </Button>
                <Button
                    appearance="subtle"
                    icon={<Database24Regular />}
                    disabled={selectedIds.size !== 1}
                    onClick={openTablesDialog}
                >
                    Sdílené tabulky
                </Button>
            </ActionBar>

            <PageContent>
                {loading ? <Spinner /> : (
                    <SmartDataGrid
                        items={items}
                        columns={columns}
                        getRowId={i => i.org_id}
                        selectionMode="multiselect"
                        selectedItems={selectedIds}
                        onSelectionChange={(_, d) => setSelectedIds(d.selectedItems)}
                        onRowDoubleClick={handleOpenEdit}
                    />
                )}
            </PageContent>

            {/* DRAWER FOR EDIT/CREATE */}
            <Drawer
                type="overlay"
                position="end"
                open={isDrawerOpen}
                onOpenChange={(_, d) => setIsDrawerOpen(d.open)}
                size="medium"
            >
                <DrawerHeader>
                    <DrawerHeaderTitle
                        action={<Button appearance="subtle" icon={<Dismiss24Regular />} onClick={() => setIsDrawerOpen(false)} />}
                    >
                        <BuildingMultiple24Regular style={{ marginRight: 8 }} />
                        {drawerMode === 'create' ? 'Nová skupina' : 'Upravit skupinu'}
                    </DrawerHeaderTitle>
                </DrawerHeader>
                <DrawerBody>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '16px 0' }}>
                        {error && <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar>}

                        <div>
                            <Label required>ID Skupiny (max 5 znaků)</Label>
                            <Input
                                value={formData.org_id}
                                disabled={drawerMode === 'edit'}
                                onChange={(_, d) => setFormData(p => ({ ...p, org_id: d.value.toUpperCase().substring(0, 5) }))}
                                placeholder="např. ALL"
                                style={{ width: '100%' }}
                            />
                        </div>
                        <div>
                            <Label required>Název Skupiny</Label>
                            <Input
                                value={formData.display_name}
                                onChange={(_, d) => setFormData(p => ({ ...p, display_name: d.value }))}
                                style={{ width: '100%' }}
                            />
                        </div>
                        <div>
                            <Switch
                                checked={formData.is_active}
                                onChange={(_, d) => setFormData(p => ({ ...p, is_active: d.checked }))}
                                label="Aktivní"
                            />
                        </div>

                        <Divider />

                        <div style={{ display: 'flex', gap: 8 }}>
                            <Button appearance="primary" icon={<Save24Regular />} onClick={handleSave} disabled={saving}>
                                {saving ? t('common.saving') : t('common.save')}
                            </Button>
                            <Button appearance="secondary" onClick={() => setIsDrawerOpen(false)}>
                                {t('common.cancel')}
                            </Button>
                        </div>
                    </div>
                </DrawerBody>
            </Drawer>

            {/* MEMBERS DIALOG */}
            <Dialog open={membersDialogOpen} onOpenChange={(_, d) => setMembersDialogOpen(d.open)}>
                <DialogSurface>
                    <DialogBody>
                        <DialogTitle>Členové skupiny {formData.display_name}</DialogTitle>
                        <DialogContent style={{ height: 400 }}>
                            <TransferList
                                availableTitle="Dostupné společnosti"
                                selectedTitle="Přiřazení členové"
                                availableItems={availableMembers}
                                selectedIds={assignedMembers}
                                onSelectionChange={(ids) => setAssignedMembers(ids as string[])}
                            />
                        </DialogContent>
                        <DialogActions>
                            <Button appearance="secondary" onClick={() => setMembersDialogOpen(false)}>{t('common.close')}</Button>
                            <Button appearance="primary" onClick={saveMembers}>{t('common.save')}</Button>
                        </DialogActions>
                    </DialogBody>
                </DialogSurface>
            </Dialog>

            {/* TABLES DIALOG */}
            <Dialog open={tablesDialogOpen} onOpenChange={(_, d) => setTablesDialogOpen(d.open)}>
                <DialogSurface>
                    <DialogBody>
                        <DialogTitle>Sdílené tabulky pro {formData.display_name}</DialogTitle>
                        <DialogContent style={{ height: 400 }}>
                            <TransferList
                                availableTitle="Dostupné tabulky"
                                selectedTitle="Sdílené tabulky"
                                availableItems={availableTables}
                                selectedIds={assignedTables}
                                onSelectionChange={(ids) => setAssignedTables(ids as string[])}
                            />
                        </DialogContent>
                        <DialogActions>
                            <Button appearance="secondary" onClick={() => setTablesDialogOpen(false)}>{t('common.close')}</Button>
                            <Button appearance="primary" onClick={saveTables}>{t('common.save')}</Button>
                        </DialogActions>
                    </DialogBody>
                </DialogSurface>
            </Dialog>
        </PageLayout>
    );
};
