
import React, { useEffect, useState, useMemo, type SyntheticEvent } from 'react';
import {
    Button,
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbButton,
    BreadcrumbDivider,
    Spinner,
    Input,
    Label,
    TabList,
    Tab,
    SelectTabEvent,
    SelectTabData,
    Switch,
    Title3
} from '@fluentui/react-components';
import type { TableColumnDefinition, OnSelectionChangeData, SelectionItemId } from '@fluentui/react-components';
import {
    Add24Regular,
    ArrowClockwise24Regular,
    Delete24Regular,
    ArrowLeft24Regular,
    Save24Regular,
    Building24Regular
} from '@fluentui/react-icons';
import { useNavigate } from 'react-router-dom';
import { PageLayout, PageHeader, PageContent } from '../components/PageLayout';
import { SmartDataGrid } from '../components/SmartDataGrid';
import { useTranslation } from '../context/TranslationContext';
import { ActionBar } from '../components/ActionBar';
import { useAuth } from '../context/AuthContext';
import { usePermission } from '../hooks/usePermission';

const API_BASE = import.meta.env.DEV ? 'http://localhost/Webhry/hollyhop/broker/shanon/backend' : '/api';

interface Organization {
    org_id: string; // PK CHAR(5)
    display_name: string;
    reg_no: string;
    tax_no: string;
    street: string;
    city: string;
    zip: string;
    contact_email: string;
    contact_phone: string;
    bank_account: string;
    bank_code: string;
    data_box_id: string;
    is_active: boolean;
}

// Default empty state
const defaultOrg: Organization = {
    org_id: '',
    display_name: '',
    reg_no: '',
    tax_no: '',
    street: '',
    city: '',
    zip: '',
    contact_email: '',
    contact_phone: '',
    bank_account: '',
    bank_code: '',
    data_box_id: '',
    is_active: true
};

export const OrganizationsAdmin: React.FC = () => {
    const navigate = useNavigate();
    const { t } = useTranslation();
    const { currentOrgId } = useAuth();
    const { hasPermission } = usePermission();
    const orgPrefix = `/${currentOrgId || 'VACKR'}`;

    // View State: 'list' | 'detail' | 'create'
    const [viewMode, setViewMode] = useState<'list' | 'detail' | 'create'>('list');

    // Data State
    const [items, setItems] = useState<Organization[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedIds, setSelectedIds] = useState<Set<SelectionItemId>>(new Set());

    // Detail/Edit State
    const [currentCode, setCurrentCode] = useState<Organization>(defaultOrg);
    const [saving, setSaving] = useState(false);
    const [activeTab, setActiveTab] = useState<string>('general');

    // Security Check
    if (!hasPermission('mod_orgs', 'view') && !hasPermission('mod_system', 'view')) { // Fallback for transition
        return <div style={{ padding: 24 }}>Access Denied (mod_orgs)</div>;
    }

    // --- FETCHING ---
    const fetchData = async () => {
        setLoading(true);
        try {
            const res = await fetch(`${API_BASE}/api-orgs.php?action=list`);
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
        setCurrentCode({ ...defaultOrg });
        setViewMode('create');
        setActiveTab('general');
    };

    const handleEdit = (item: Organization) => {
        setCurrentCode({ ...item });
        setViewMode('detail');
        setActiveTab('general');
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const action = viewMode === 'create' ? 'create' : 'update';
            const res = await fetch(`${API_BASE}/api-orgs.php?action=${action}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(currentCode)
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
        if (!confirm('Opravdu smazat vybrané organizace?')) return;
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

    // --- COLUMNS ---
    const columns: TableColumnDefinition<Organization>[] = useMemo(() => [
        {
            columnId: 'org_id',
            compare: (a, b) => a.org_id.localeCompare(b.org_id),
            renderHeaderCell: () => 'Kód',
            renderCell: (item) => item.org_id
        },
        {
            columnId: 'display_name',
            compare: (a, b) => a.display_name.localeCompare(b.display_name),
            renderHeaderCell: () => 'Název společnosti',
            renderCell: (item) => <span style={{ fontWeight: 600 }}>{item.display_name}</span>
        },
        {
            columnId: 'reg_no',
            renderHeaderCell: () => 'IČO',
            renderCell: (item) => item.reg_no
        },
        {
            columnId: 'city',
            renderHeaderCell: () => 'Město',
            renderCell: (item) => item.city
        },
        {
            columnId: 'is_active',
            renderHeaderCell: () => 'Status',
            renderCell: (item) => (item.is_active ? 'Aktivní' : 'Neaktivní')
        }
    ], []);

    // --- RENDER DETAIL FORM ---
    const renderForm = () => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24, padding: '20px 0', maxWidth: '800px' }}>
            {/* Header / Actions for Form */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Title3>{viewMode === 'create' ? 'Nová organizace' : currentCode.display_name}</Title3>
                <div style={{ display: 'flex', gap: 10 }}>
                    <Button appearance="secondary" onClick={() => setViewMode('list')}>Zrušit</Button>
                    <Button appearance="primary" icon={<Save24Regular />} disabled={saving} onClick={handleSave}>
                        {saving ? 'Ukládání...' : 'Uložit změny'}
                    </Button>
                </div>
            </div>

            {/* Tabs */}
            <TabList selectedValue={activeTab} onTabSelect={(_, d) => setActiveTab(d.value as string)}>
                <Tab value="general">Základní údaje</Tab>
                <Tab value="address">Adresa & Sídlo</Tab>
                <Tab value="contact">Kontakt & Banka</Tab>
                <Tab value="settings">Nastavení</Tab>
            </TabList>

            {/* Tab: General */}
            {activeTab === 'general' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                    <div style={{ gridColumn: '1 / -1' }}>
                        <Label required>Název společnosti</Label>
                        <Input style={{ width: '100%' }} value={currentCode.display_name} onChange={(e, d) => setCurrentCode(p => ({ ...p, display_name: d.value }))} />
                    </div>
                    <div>
                        <Label required>Kód (ID) - max 5 znaků</Label>
                        <Input
                            style={{ width: '100%' }}
                            value={currentCode.org_id}
                            disabled={viewMode === 'detail'} // PK immutable
                            onChange={(e, d) => setCurrentCode(p => ({ ...p, org_id: d.value.toUpperCase().substring(0, 5) }))}
                            placeholder="NAPŘ: MOJE"
                        />
                    </div>
                    <div>
                        <Label>Status</Label>
                        <div style={{ marginTop: 5 }}>
                            <Switch checked={currentCode.is_active} onChange={(e, d) => setCurrentCode(p => ({ ...p, is_active: d.checked }))} label={currentCode.is_active ? 'Aktivní' : 'Neaktivní'} />
                        </div>
                    </div>
                    <div>
                        <Label>IČO (Reg. No)</Label>
                        <Input style={{ width: '100%' }} value={currentCode.reg_no} onChange={(e, d) => setCurrentCode(p => ({ ...p, reg_no: d.value }))} />
                    </div>
                    <div>
                        <Label>DIČ (Tax ID)</Label>
                        <Input style={{ width: '100%' }} value={currentCode.tax_no} onChange={(e, d) => setCurrentCode(p => ({ ...p, tax_no: d.value }))} />
                    </div>
                    <div>
                        <Label>ID Datové schránky</Label>
                        <Input style={{ width: '100%' }} value={currentCode.data_box_id} onChange={(e, d) => setCurrentCode(p => ({ ...p, data_box_id: d.value }))} />
                    </div>
                </div>
            )}

            {/* Tab: Address */}
            {activeTab === 'address' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                    <div style={{ gridColumn: '1 / -1' }}>
                        <Label>Ulice a číslo</Label>
                        <Input style={{ width: '100%' }} value={currentCode.street} onChange={(e, d) => setCurrentCode(p => ({ ...p, street: d.value }))} />
                    </div>
                    <div>
                        <Label>Město</Label>
                        <Input style={{ width: '100%' }} value={currentCode.city} onChange={(e, d) => setCurrentCode(p => ({ ...p, city: d.value }))} />
                    </div>
                    <div>
                        <Label>PSČ</Label>
                        <Input style={{ width: '100%' }} value={currentCode.zip} onChange={(e, d) => setCurrentCode(p => ({ ...p, zip: d.value }))} />
                    </div>
                </div>
            )}

            {/* Tab: Contact */}
            {activeTab === 'contact' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                    <div>
                        <Label>Kontaktní Email</Label>
                        <Input type="email" style={{ width: '100%' }} value={currentCode.contact_email} onChange={(e, d) => setCurrentCode(p => ({ ...p, contact_email: d.value }))} />
                    </div>
                    <div>
                        <Label>Telefon</Label>
                        <Input type="tel" style={{ width: '100%' }} value={currentCode.contact_phone} onChange={(e, d) => setCurrentCode(p => ({ ...p, contact_phone: d.value }))} />
                    </div>
                    <div style={{ gridColumn: '1 / -1', marginTop: 10 }}><Title3>Bankovní spojení</Title3></div>
                    <div>
                        <Label>Číslo účtu</Label>
                        <Input style={{ width: '100%' }} value={currentCode.bank_account} onChange={(e, d) => setCurrentCode(p => ({ ...p, bank_account: d.value }))} />
                    </div>
                    <div>
                        <Label>Kód banky</Label>
                        <Input style={{ width: '100%' }} value={currentCode.bank_code} onChange={(e, d) => setCurrentCode(p => ({ ...p, bank_code: d.value }))} />
                    </div>
                </div>
            )}

            {/* Tab: Settings */}
            {activeTab === 'settings' && (
                <div>
                    <p>Zde bude nastavení loga, barev a šablon (v příští verzi).</p>
                </div>
            )}
        </div>
    );

    // --- MAIN RENDER ---
    return (
        <PageLayout>
            <PageHeader>
                <Breadcrumb>
                    <BreadcrumbItem>
                        <BreadcrumbButton onClick={() => navigate(`${orgPrefix}/system`)}>Systém</BreadcrumbButton>
                    </BreadcrumbItem>
                    <BreadcrumbDivider />
                    <BreadcrumbItem>
                        <BreadcrumbButton onClick={() => setViewMode('list')} current={viewMode === 'list'}>Organizace</BreadcrumbButton>
                    </BreadcrumbItem>
                    {viewMode !== 'list' && (
                        <>
                            <BreadcrumbDivider />
                            <BreadcrumbItem><BreadcrumbButton current>{viewMode === 'create' ? 'Nová' : currentCode.org_id}</BreadcrumbButton></BreadcrumbItem>
                        </>
                    )}
                </Breadcrumb>
            </PageHeader>

            {/* List View ActionBar */}
            {viewMode === 'list' && (
                <ActionBar>
                    <Button appearance="primary" icon={<Add24Regular />} onClick={handleCreate}>Nová společnost</Button>
                    <Button appearance="subtle" icon={<ArrowClockwise24Regular />} onClick={fetchData}>Obnovit</Button>
                    <Button appearance="subtle" icon={<Delete24Regular />} disabled={selectedIds.size === 0} onClick={handleDelete}>Smazat</Button>
                </ActionBar>
            )}

            <PageContent>
                {viewMode === 'list' ? (
                    loading ? <div style={{ padding: 20 }}><Spinner /></div> :
                        <SmartDataGrid
                            items={items}
                            columns={columns}
                            getRowId={(i) => i.org_id}
                            selectionMode="multiselect"
                            selectedItems={selectedIds}
                            onSelectionChange={(e, d) => setSelectedIds(d.selectedItems)}
                            onRowClick={handleEdit}
                        />
                ) : (
                    renderForm()
                )}
            </PageContent>
        </PageLayout>
    );
};
