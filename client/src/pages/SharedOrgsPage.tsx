
import React, { useEffect, useState, useMemo } from 'react';
import {
    Button,
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbButton,
    BreadcrumbDivider,
    Spinner,
    Input,
    Title3,
    Label,
    Dialog,
    DialogSurface,
    DialogBody,
    DialogTitle,
    DialogContent,
    DialogActions,
    Text
} from '@fluentui/react-components';
import type { TableColumnDefinition, SelectionItemId } from '@fluentui/react-components';
import {
    Add24Regular,
    ArrowClockwise24Regular,
    Delete24Regular,
    Save24Regular,
    PeopleTeam24Regular,
    Database24Regular,
    ArrowLeft24Regular
} from '@fluentui/react-icons';
import { useNavigate } from 'react-router-dom';
import { PageLayout, PageHeader, PageContent } from '../components/PageLayout';
import { SmartDataGrid } from '../components/SmartDataGrid';
import { useTranslation } from '../context/TranslationContext';
import { ActionBar } from '../components/ActionBar';
import { useAuth } from '../context/AuthContext';
import { TransferList } from '../components/TransferList';

const API_BASE = import.meta.env.DEV ? 'http://localhost/Webhry/hollyhop/broker/shanon/backend' : '/api';

interface OrgGroup {
    org_id: string;
    display_name: string;
    is_active: boolean;
    is_virtual_group: boolean;
}

export const SharedOrgsPage: React.FC = () => {
    const navigate = useNavigate();
    const { t } = useTranslation();
    const { currentOrgId } = useAuth();
    const orgPrefix = `/${currentOrgId || 'VACKR'}`;

    // State
    const [viewMode, setViewMode] = useState<'list' | 'detail'>('list');
    const [items, setItems] = useState<OrgGroup[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedIds, setSelectedIds] = useState<Set<SelectionItemId>>(new Set());
    const [currentGroup, setCurrentGroup] = useState<OrgGroup>({ org_id: '', display_name: '', is_active: true, is_virtual_group: true });
    const [saving, setSaving] = useState(false);
    const [isCreate, setIsCreate] = useState(false);

    // Dialogs State
    const [membersDialogOpen, setMembersDialogOpen] = useState(false);
    const [tablesDialogOpen, setTablesDialogOpen] = useState(false);

    // Transfer List Data
    const [availableMembers, setAvailableMembers] = useState<any[]>([]); // All Orgs
    const [assignedMembers, setAssignedMembers] = useState<string[]>([]); // IDs

    const [availableTables, setAvailableTables] = useState<any[]>([]); // All Tables
    const [assignedTables, setAssignedTables] = useState<string[]>([]); // Names

    // --- FETCH LIST ---
    const fetchData = async () => {
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
    };

    useEffect(() => { fetchData(); }, []);

    // --- HANDLERS ---
    const handleCreate = () => {
        setCurrentGroup({ org_id: '', display_name: '', is_active: true, is_virtual_group: true });
        setIsCreate(true);
        setViewMode('detail');
    };

    const handleEdit = (item: OrgGroup) => {
        setCurrentGroup({ ...item });
        setIsCreate(false);
        setViewMode('detail');
    };

    const handleSave = async () => {
        if (!currentGroup.org_id || !currentGroup.display_name) return alert("Vyplňte ID a název.");
        setSaving(true);
        try {
            const action = isCreate ? 'create' : 'update';
            const res = await fetch(`${API_BASE}/api-orgs.php?action=${action}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(currentGroup)
            });
            const json = await res.json();

            if (json.success) {
                await fetchData();
                setViewMode('list');
            } else {
                alert(json.error || 'Uložení selhalo');
            }
        } catch (e) {
            alert('Chyba sítě');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!confirm('Opravdu smazat vybrané skupiny?')) return;
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

    // --- MEMBERS HANDLING ---
    const openMembersDialog = async () => {
        setLoading(true);
        try {
            const res = await fetch(`${API_BASE}/api-orgs.php?action=get_group_members&group_id=${currentGroup.org_id}`);
            const json = await res.json();
            if (json.success) {
                const available = json.available_orgs.map((o: any) => ({
                    key: o.org_id,
                    text: `${o.display_name} (${o.org_id})`
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
        const res = await fetch(`${API_BASE}/api-orgs.php?action=save_group_members`, {
            method: 'POST',
            body: JSON.stringify({ group_id: currentGroup.org_id, member_ids: assignedMembers })
        });
        if ((await res.json()).success) setMembersDialogOpen(false);
    };

    // --- TABLES HANDLING ---
    const openTablesDialog = async () => {
        setLoading(true);
        try {
            const res = await fetch(`${API_BASE}/api-orgs.php?action=get_shared_tables&group_id=${currentGroup.org_id}`);
            const json = await res.json();
            if (json.success) {
                const available = json.all_tables.map((t: any) => ({
                    key: t.id,
                    text: t.display_name
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
        const res = await fetch(`${API_BASE}/api-orgs.php?action=save_shared_tables`, {
            method: 'POST',
            body: JSON.stringify({ group_id: currentGroup.org_id, table_names: assignedTables })
        });
        if ((await res.json()).success) setTablesDialogOpen(false);
    };

    // --- COLUMNS ---
    const columns: TableColumnDefinition<OrgGroup>[] = useMemo(() => [
        {
            columnId: 'org_id',
            compare: (a, b) => a.org_id.localeCompare(b.org_id),
            renderHeaderCell: () => 'ID Skupiny',
            renderCell: (item) => <strong>{item.org_id}</strong>
        },
        {
            columnId: 'display_name',
            compare: (a, b) => a.display_name.localeCompare(b.display_name),
            renderHeaderCell: () => 'Název Skupiny',
            renderCell: (item) => item.display_name
        }
    ], []);

    return (
        <PageLayout>
            <PageHeader>
                <Breadcrumb>
                    <BreadcrumbItem><BreadcrumbButton onClick={() => navigate(`${orgPrefix}/system`)}>Systém</BreadcrumbButton></BreadcrumbItem>
                    <BreadcrumbDivider />
                    <BreadcrumbItem><BreadcrumbButton onClick={() => setViewMode('list')} current={viewMode === 'list'}>Sdílené společnosti</BreadcrumbButton></BreadcrumbItem>
                    {viewMode === 'detail' && (
                        <>
                            <BreadcrumbDivider />
                            <BreadcrumbItem><BreadcrumbButton current>{isCreate ? 'Nová skupina' : currentGroup.org_id}</BreadcrumbButton></BreadcrumbItem>
                        </>
                    )}
                </Breadcrumb>
            </PageHeader>

            {viewMode === 'list' && (
                <>
                    <ActionBar>
                        <Button appearance="primary" icon={<Add24Regular />} onClick={handleCreate}>Nová skupina</Button>
                        <Button appearance="subtle" icon={<ArrowClockwise24Regular />} onClick={fetchData}>Obnovit</Button>
                        <Button appearance="subtle" icon={<Delete24Regular />} disabled={selectedIds.size === 0} onClick={handleDelete}>Smazat</Button>
                    </ActionBar>
                    <PageContent>
                        {loading ? <Spinner /> : (
                            <SmartDataGrid
                                items={items}
                                columns={columns}
                                getRowId={i => i.org_id}
                                selectionMode="multiselect"
                                selectedItems={selectedIds}
                                onSelectionChange={(e, d) => setSelectedIds(d.selectedItems)}
                                onRowDoubleClick={handleEdit}
                            />
                        )}
                    </PageContent>
                </>
            )}

            {viewMode === 'detail' && (
                <PageContent>
                    <div style={{ maxWidth: 600, display: 'flex', flexDirection: 'column', gap: 20 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Button icon={<ArrowLeft24Regular />} onClick={() => setViewMode('list')}>Zpět</Button>
                            <Button appearance="primary" icon={<Save24Regular />} disabled={saving} onClick={handleSave}>Uložit</Button>
                        </div>

                        <div style={{ display: 'grid', gap: 15, padding: 20, background: '#fff', borderRadius: 8, border: '1px solid #eee' }}>
                            <Title3>Základní údaje</Title3>
                            <div>
                                <Label required>ID Skupiny (max 5 znaků)</Label>
                                <Input
                                    value={currentGroup.org_id}
                                    disabled={!isCreate}
                                    onChange={(e, d) => setCurrentGroup(p => ({ ...p, org_id: d.value.toUpperCase().substring(0, 5) }))}
                                    placeholder="ALL, GRP1"
                                />
                            </div>
                            <div>
                                <Label required>Název Skupiny</Label>
                                <Input
                                    value={currentGroup.display_name}
                                    onChange={(e, d) => setCurrentGroup(p => ({ ...p, display_name: d.value }))}
                                />
                            </div>
                        </div>

                        {!isCreate && (
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                                <div style={{ padding: 20, background: '#f0f8ff', borderRadius: 8, border: '1px solid #cce0ff' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                                        <PeopleTeam24Regular primaryFill="#0066cc" />
                                        <Title3>Členové skupiny</Title3>
                                    </div>
                                    <Text block style={{ marginBottom: 15 }}>Spravujte, které reálné společnosti patří do této skupiny.</Text>
                                    <Button onClick={openMembersDialog}>Spravovat členy</Button>
                                </div>

                                <div style={{ padding: 20, background: '#fff0f5', borderRadius: 8, border: '1px solid #ffccdd' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                                        <Database24Regular primaryFill="#cc0066" />
                                        <Title3>Sdílená data</Title3>
                                    </div>
                                    <Text block style={{ marginBottom: 15 }}>Vyberte tabulky, jejichž data budou sdílena se členy skupiny.</Text>
                                    <Button onClick={openTablesDialog}>Konfigurace tabulek</Button>
                                </div>
                            </div>
                        )}
                    </div>
                </PageContent>
            )}

            {/* MEMBERS DIALOG */}
            <Dialog open={membersDialogOpen} onOpenChange={(e, d) => setMembersDialogOpen(d.open)}>
                <DialogSurface>
                    <DialogBody>
                        <DialogTitle>Členové skupiny {currentGroup.display_name}</DialogTitle>
                        <DialogContent style={{ height: 400 }}>
                            <TransferList
                                leftTitle="Dostupné společnosti"
                                rightTitle="Přiřazení členové"
                                leftItems={availableMembers}
                                rightKeys={assignedMembers}
                                onChange={setAssignedMembers}
                            />
                        </DialogContent>
                        <DialogActions>
                            <Button appearance="secondary" onClick={() => setMembersDialogOpen(false)}>Zavřít</Button>
                            <Button appearance="primary" onClick={saveMembers}>Uložit změny</Button>
                        </DialogActions>
                    </DialogBody>
                </DialogSurface>
            </Dialog>

            {/* TABLES DIALOG */}
            <Dialog open={tablesDialogOpen} onOpenChange={(e, d) => setTablesDialogOpen(d.open)}>
                <DialogSurface>
                    <DialogBody>
                        <DialogTitle>Sdílené tabulky pro {currentGroup.display_name}</DialogTitle>
                        <DialogContent style={{ height: 400 }}>
                            <TransferList
                                leftTitle="Dostupné tabulky"
                                rightTitle="Sdílené tabulky"
                                leftItems={availableTables}
                                rightKeys={assignedTables}
                                onChange={setAssignedTables}
                            />
                        </DialogContent>
                        <DialogActions>
                            <Button appearance="secondary" onClick={() => setTablesDialogOpen(false)}>Zavřít</Button>
                            <Button appearance="primary" onClick={saveTables}>Uložit konfiguraci</Button>
                        </DialogActions>
                    </DialogBody>
                </DialogSurface>
            </Dialog>
        </PageLayout>
    );
};
