
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageLayout, PageContent, PageHeader } from '../components/PageLayout';
import {
    Button,
    Title3,
    Text,
    Card,
    TabList,
    Tab,
    Spinner,
    Badge,
    Dialog,
    DialogSurface,
    DialogBody,
    DialogTitle,
    DialogContent,
    DialogActions,
    Label,
    Input,
    Checkbox,
    Dropdown,
    Option,
    createTableColumn
} from '@fluentui/react-components';
import type { TableColumnDefinition } from '@fluentui/react-components';
import {
    ArrowLeft24Regular,
    Add24Regular,
    Edit24Regular,
    Translate24Regular,
    Settings24Regular,
    PlugConnected24Regular,
    Delete24Regular
} from '@fluentui/react-icons';
import { TranslationDialog } from '../components/TranslationDialog';
import { useNavigate } from 'react-router-dom';
import { SmartDataGrid } from '../components/SmartDataGrid';

type TabValue = 'doc_types' | 'attributes' | 'storage';

interface DocType {
    rec_id: number;
    code: string;
    name: string;
    description?: string;
    number_series_id?: number;
    number_series_name?: string;
    is_active: boolean;
}



interface StorageProfile {
    rec_id: number;
    name: string;
    storage_type: string;
    connection_string?: string;
    base_path?: string;
    is_default: boolean;
    is_active: boolean;
}

interface Attribute {
    rec_id: number;
    name: string;
    data_type: string;
    is_required: boolean;
    is_searchable: boolean;
    default_value: string;
    help_text: string;
}

const STORAGE_TYPES = [
    { value: 'local', label: 'Lokální úložiště' },
    { value: 'ftp', label: 'FTP Server' },
    { value: 'sftp', label: 'SFTP Server' },
    { value: 'google_drive', label: 'Google Drive' },
    { value: 'sharepoint', label: 'SharePoint' },
    { value: 's3', label: 'Amazon S3' },
    { value: 'azure_blob', label: 'Azure Blob Storage' }
];

export const DmsSettings: React.FC = () => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState<TabValue>('doc_types');
    const [loading, setLoading] = useState(false);

    // Data
    const [docTypes, setDocTypes] = useState<DocType[]>([]);

    const [storageProfiles, setStorageProfiles] = useState<StorageProfile[]>([]);
    const [attributes, setAttributes] = useState<Attribute[]>([]);

    // Attribute Dialog State
    const [isAttrDialogOpen, setIsAttrDialogOpen] = useState(false);
    const [editingAttr, setEditingAttr] = useState<Attribute | null>(null);

    // DocType Dialog State
    const [isDocTypeDialogOpen, setIsDocTypeDialogOpen] = useState(false);
    const [editingDocType, setEditingDocType] = useState<DocType | null>(null);
    const [docTypeForm, setDocTypeForm] = useState({
        code: '',
        name: '',
        description: '',

    });

    // Storage Dialog State
    const [isStorageDialogOpen, setIsStorageDialogOpen] = useState(false);
    const [editingStorageProfile, setEditingStorageProfile] = useState<StorageProfile | null>(null);
    const [storageForm, setStorageForm] = useState({
        name: '',
        storage_type: 'local',
        base_path: '',
        connection_string: '',
        is_default: false,
        is_active: true
    });

    // Translation State
    const [transOpen, setTransOpen] = useState(false);
    const [transTarget, setTransTarget] = useState<{ id: number, name: string } | null>(null);

    const openTranslations = (attr: Attribute) => {
        setTransTarget({ id: attr.rec_id, name: attr.name });
        setTransOpen(true);
    };
    const [attrForm, setAttrForm] = useState({
        name: '',
        data_type: 'text',
        is_required: false,
        is_searchable: true,
        default_value: '',
        help_text: ''
    });

    const openAttrDialog = (attr?: Attribute) => {
        if (attr) {
            setEditingAttr(attr);
            setAttrForm({
                name: attr.name,
                data_type: attr.data_type,
                is_required: attr.is_required,
                is_searchable: attr.is_searchable,
                default_value: attr.default_value || '',
                help_text: attr.help_text || ''
            });
        } else {
            setEditingAttr(null);
            setAttrForm({
                name: '',
                data_type: 'text',
                is_required: false,
                is_searchable: true,
                default_value: '',
                help_text: ''
            });
        }
        setIsAttrDialogOpen(true);
    };

    const handleSaveAttribute = async () => {
        try {
            const action = editingAttr ? 'attribute_update' : 'attribute_create';
            const payload = {
                ...attrForm,
                id: editingAttr?.rec_id
            };

            await fetch(`/api/api-dms.php?action=${action}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            setIsAttrDialogOpen(false);
            // Reload data
            const res = await fetch('/api/api-dms.php?action=attributes');
            const json = await res.json();
            if (json.success) setAttributes(json.data);
        } catch (e) {
            console.error(e);
            alert('Chyba při ukládání atributu');
        }
    };

    const openDocTypeDialog = (dt?: DocType) => {
        if (dt) {
            setEditingDocType(dt);
            setDocTypeForm({
                code: dt.code,
                name: dt.name,
                description: dt.description || ''
            });
        } else {
            setEditingDocType(null);
            setDocTypeForm({
                code: '',
                name: '',
                description: ''
            });
        }
        setIsDocTypeDialogOpen(true);
    };

    const handleSaveDocType = async () => {
        try {
            const action = editingDocType ? 'doc_type_update' : 'doc_type_create';
            const payload = {
                ...docTypeForm,
                id: editingDocType?.rec_id
            };

            await fetch(`/api/api-dms.php?action=${action}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            setIsDocTypeDialogOpen(false);
            // Reload data
            const res = await fetch('/api/api-dms.php?action=doc_types');
            const json = await res.json();
            if (json.success) setDocTypes(json.data);
        } catch (e) {
            console.error(e);
            alert('Chyba při ukládání typu dokumentu');
        }
    };

    const openStorageDialog = (sp?: StorageProfile) => {
        if (sp) {
            setEditingStorageProfile(sp);
            setStorageForm({
                name: sp.name,
                storage_type: sp.storage_type,
                base_path: sp.base_path || '',
                connection_string: sp.connection_string || '',
                is_default: sp.is_default,
                is_active: sp.is_active
            });
        } else {
            setEditingStorageProfile(null);
            setStorageForm({
                name: '',
                storage_type: 'local',
                base_path: '',
                connection_string: '',
                is_default: false,
                is_active: true
            });
        }
        setIsStorageDialogOpen(true);
    };

    const handleSaveStorageProfile = async () => {
        try {
            const action = editingStorageProfile ? 'storage_profile_update' : 'storage_profile_create';
            const payload = {
                ...storageForm,
                id: editingStorageProfile?.rec_id
            };

            await fetch(`/api/api-dms.php?action=${action}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            setIsStorageDialogOpen(false);
            // Reload data
            const res = await fetch('/api/api-dms.php?action=storage_profiles');
            const json = await res.json();
            if (json.success) setStorageProfiles(json.data);
        } catch (e) {
            console.error(e);
            alert('Chyba při ukládání úložiště');
        }
    };

    const handleDeleteStorageProfile = async (sp: StorageProfile) => {
        if (!confirm(`Opravdu smazat úložiště "${sp.name}"?`)) return;
        try {
            const res = await fetch('/api/api-dms.php?action=storage_profile_delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: sp.rec_id })
            });
            const json = await res.json();
            if (json.success) {
                // Reload data
                const resList = await fetch('/api/api-dms.php?action=storage_profiles');
                const jsonList = await resList.json();
                if (jsonList.success) setStorageProfiles(jsonList.data);
            } else {
                alert('Chyba: ' + (json.error || json.message));
            }
        } catch (e) {
            console.error(e);
            alert('Chyba při mazání');
        }
    };

    const handleTestConnection = async () => {
        try {
            const payload = {
                ...storageForm,
                id: editingStorageProfile?.rec_id
            };

            const res = await fetch(`/api/api-dms.php?action=storage_profile_test`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const json = await res.json();

            if (json.success) {
                alert(json.message);
            } else {
                alert('Chyba: ' + json.error);
            }
        } catch (e) {
            console.error(e);
            alert('Chyba při testování připojení');
        }
    };

    // Fetch data based on active tab
    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            try {
                let endpoint = '';
                switch (activeTab) {
                    case 'doc_types': endpoint = 'doc_types'; break;
                    case 'storage': endpoint = 'storage_profiles'; break;
                    case 'attributes': endpoint = 'attributes'; break;
                }

                const res = await fetch(`/api/api-dms.php?action=${endpoint}`);
                const json = await res.json();

                if (json.success) {
                    switch (activeTab) {
                        case 'doc_types': setDocTypes(json.data || []); break;

                        case 'storage': setStorageProfiles(json.data || []); break;
                        case 'attributes': setAttributes(json.data || []); break;
                    }
                }
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [activeTab]);

    // Column Definitions using Fluent UI createTableColumn
    const docTypeColumns: TableColumnDefinition<DocType>[] = [
        createTableColumn<DocType>({
            columnId: 'code',
            compare: (a, b) => a.code.localeCompare(b.code),
            renderHeaderCell: () => 'Kód',
            renderCell: (item) => <Text weight="semibold">{item.code}</Text>
        }),
        createTableColumn<DocType>({
            columnId: 'name',
            compare: (a, b) => a.name.localeCompare(b.name),
            renderHeaderCell: () => 'Název',
            renderCell: (item) => <Text>{item.name}</Text>
        }),
        createTableColumn<DocType>({
            columnId: 'status',
            compare: (a, b) => (a.is_active ? 1 : 0) - (b.is_active ? 1 : 0),
            renderHeaderCell: () => 'Stav',
            renderCell: (item) => (
                <Badge appearance="tint" color={item.is_active ? 'success' : 'danger'}>
                    {item.is_active ? 'Aktivní' : 'Neaktivní'}
                </Badge>
            )
        }),
        createTableColumn<DocType>({
            columnId: 'actions',
            renderHeaderCell: () => 'Akce',
            renderCell: (item) => (
                <Button icon={<Edit24Regular />} appearance="subtle" size="small" onClick={() => openDocTypeDialog(item)} />
            )
        })
    ];

    const storageColumns: TableColumnDefinition<StorageProfile>[] = [
        createTableColumn<StorageProfile>({
            columnId: 'name',
            compare: (a, b) => a.name.localeCompare(b.name),
            renderHeaderCell: () => 'Název',
            renderCell: (item) => <Text weight="semibold">{item.name}</Text>
        }),
        createTableColumn<StorageProfile>({
            columnId: 'type',
            compare: (a, b) => a.storage_type.localeCompare(b.storage_type),
            renderHeaderCell: () => 'Typ',
            renderCell: (item) => (
                <Text>{STORAGE_TYPES.find(t => t.value === item.storage_type)?.label || item.storage_type}</Text>
            )
        }),
        createTableColumn<StorageProfile>({
            columnId: 'path',
            compare: (a, b) => (a.base_path || '').localeCompare(b.base_path || ''),
            renderHeaderCell: () => 'Cesta / IDFolder',
            renderCell: (item) => <Text>{item.base_path || '-'}</Text>
        }),
        createTableColumn<StorageProfile>({
            columnId: 'default',
            compare: (a, b) => (a.is_default ? 1 : 0) - (b.is_default ? 1 : 0),
            renderHeaderCell: () => 'Výchozí',
            renderCell: (item) => (
                item.is_default && <Badge appearance="tint" color="brand">Výchozí</Badge>
            )
        }),
        createTableColumn<StorageProfile>({
            columnId: 'status',
            compare: (a, b) => (a.is_active ? 1 : 0) - (b.is_active ? 1 : 0),
            renderHeaderCell: () => 'Stav',
            renderCell: (item) => (
                <Badge appearance="tint" color={item.is_active ? 'success' : 'danger'}>
                    {item.is_active ? 'Aktivní' : 'Neaktivní'}
                </Badge>
            )
        }),
        createTableColumn<StorageProfile>({
            columnId: 'actions',
            renderHeaderCell: () => 'Akce',
            renderCell: (item) => (
                <div style={{ display: 'flex', gap: '4px' }}>
                    <Button icon={<Edit24Regular />} appearance="subtle" size="small" onClick={() => openStorageDialog(item)} />
                    <Button
                        icon={<Delete24Regular />}
                        appearance="subtle"
                        size="small"
                        style={{ color: '#d13438' }}
                        onClick={() => handleDeleteStorageProfile(item)}
                    />
                </div>
            )
        })
    ];

    const attributeColumns: TableColumnDefinition<Attribute>[] = [
        createTableColumn<Attribute>({
            columnId: 'name',
            compare: (a, b) => a.name.localeCompare(b.name),
            renderHeaderCell: () => 'Název',
            renderCell: (item) => <Text weight="semibold">{item.name}</Text>
        }),
        createTableColumn<Attribute>({
            columnId: 'data_type',
            compare: (a, b) => a.data_type.localeCompare(b.data_type),
            renderHeaderCell: () => 'Typ dat',
            renderCell: (item) => <Badge appearance="tint">{item.data_type}</Badge>
        }),
        createTableColumn<Attribute>({
            columnId: 'required',
            compare: (a, b) => (a.is_required ? 1 : 0) - (b.is_required ? 1 : 0),
            renderHeaderCell: () => 'Povinný',
            renderCell: (item) => <Text>{item.is_required ? 'Ano' : 'Ne'}</Text>
        }),
        createTableColumn<Attribute>({
            columnId: 'searchable',
            compare: (a, b) => (a.is_searchable ? 1 : 0) - (b.is_searchable ? 1 : 0),
            renderHeaderCell: () => 'Vyhledávatelný',
            renderCell: (item) => <Text>{item.is_searchable ? 'Ano' : 'Ne'}</Text>
        }),
        createTableColumn<Attribute>({
            columnId: 'default',
            compare: (a, b) => (a.default_value || '').localeCompare(b.default_value || ''),
            renderHeaderCell: () => 'Výchozí hodnota',
            renderCell: (item) => <Text>{item.default_value || '-'}</Text>
        }),
        createTableColumn<Attribute>({
            columnId: 'actions',
            renderHeaderCell: () => 'Akce',
            renderCell: (item) => (
                <div style={{ display: 'flex', gap: '4px' }}>
                    <Button
                        icon={<Edit24Regular />}
                        appearance="subtle"
                        size="small"
                        onClick={() => openAttrDialog(item)}
                        title="Upravit"
                    />
                    <Button
                        icon={<Translate24Regular />}
                        appearance="subtle"
                        size="small"
                        onClick={() => openTranslations(item)}
                        title="Překlady"
                    />
                </div>
            )
        })
    ];

    return (
        <PageLayout>
            <PageHeader>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Button appearance="subtle" icon={<ArrowLeft24Regular />} onClick={() => navigate('/dms')}>
                        {t('common.back', 'Zpět')}
                    </Button>
                    <Settings24Regular />
                    <Title3>{t('dms.settings.title', 'Nastavení DMS')}</Title3>
                </div>
            </PageHeader>

            <PageContent>
                <TabList
                    selectedValue={activeTab}
                    onTabSelect={(_, data) => setActiveTab(data.value as TabValue)}
                    style={{ marginBottom: '24px' }}
                >
                    <Tab value="doc_types">{t('dms.settings.doc_types', 'Typy dokumentů')}</Tab>
                    <Tab value="attributes">{t('dms.settings.attributes', 'Atributy')}</Tab>
                    <Tab value="storage">{t('dms.settings.storage', 'Úložiště')}</Tab>
                </TabList>

                {loading ? (
                    <Spinner label="Načítám..." />
                ) : (
                    <>
                        {/* DOC TYPES TAB */}
                        {activeTab === 'doc_types' && (
                            <Card style={{ padding: '16px', height: '100%' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
                                    <Text weight="semibold" size={400}>Typy dokumentů</Text>
                                    <Button appearance="primary" icon={<Add24Regular />} size="small" onClick={() => openDocTypeDialog()}>
                                        Nový typ
                                    </Button>
                                </div>
                                <div style={{ height: 'calc(100vh - 280px)', overflow: 'hidden' }}>
                                    <SmartDataGrid
                                        items={docTypes}
                                        columns={docTypeColumns}
                                        getRowId={(item) => item.rec_id}
                                    />
                                </div>
                            </Card>
                        )}

                        {/* STORAGE PROFILES TAB */}
                        {activeTab === 'storage' && (
                            <Card style={{ padding: '16px', height: '100%' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
                                    <Text weight="semibold" size={400}>Úložiště</Text>
                                    <Button appearance="primary" icon={<Add24Regular />} size="small" onClick={() => openStorageDialog()}>
                                        Nové úložiště
                                    </Button>
                                </div>
                                <div style={{ height: 'calc(100vh - 280px)', overflow: 'hidden' }}>
                                    <SmartDataGrid
                                        items={storageProfiles}
                                        columns={storageColumns}
                                        getRowId={(item) => item.rec_id}
                                    />
                                </div>
                            </Card>
                        )}

                        {/* ATTRIBUTES TAB */}
                        {activeTab === 'attributes' && (
                            <Card style={{ padding: '16px', height: '100%' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
                                    <Text weight="semibold" size={400}>Sledované atributy</Text>
                                    <Button appearance="primary" icon={<Add24Regular />} size="small" onClick={() => openAttrDialog()}>
                                        Nový atribut
                                    </Button>
                                </div>
                                <div style={{ height: 'calc(100vh - 280px)', overflow: 'hidden' }}>
                                    <SmartDataGrid
                                        items={attributes}
                                        columns={attributeColumns}
                                        getRowId={(item) => item.rec_id}
                                    />
                                </div>
                            </Card>
                        )}
                    </>
                )}
            </PageContent>

            {/* ATTRIBUTE DIALOG */}
            <Dialog open={isAttrDialogOpen} onOpenChange={(_, data) => setIsAttrDialogOpen(data.open)}>
                <DialogSurface>
                    <DialogBody>
                        <DialogTitle>{editingAttr ? 'Upravit atribut' : 'Nový atribut'}</DialogTitle>
                        <DialogContent style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <div>
                                <Label required>Název atributu</Label>
                                <Input
                                    value={attrForm.name}
                                    onChange={(e) => setAttrForm({ ...attrForm, name: e.target.value })}
                                    style={{ width: '100%' }}
                                />
                            </div>
                            <div>
                                <Label>Typ dat</Label>
                                <Dropdown
                                    value={attrForm.data_type}
                                    onOptionSelect={(_, data) => setAttrForm({ ...attrForm, data_type: data.optionValue || 'text' })}
                                    style={{ width: '100%' }}
                                >
                                    <Option value="text">Text</Option>
                                    <Option value="number">Číslo</Option>
                                    <Option value="date">Datum</Option>
                                    <Option value="boolean">Ano/Ne</Option>
                                </Dropdown>
                            </div>
                            <div style={{ display: 'flex', gap: '16px' }}>
                                <Checkbox
                                    label="Povinný údaj"
                                    checked={attrForm.is_required}
                                    onChange={(_, data) => setAttrForm({ ...attrForm, is_required: data.checked === true })}
                                />
                                <Checkbox
                                    label="Vyhledávatelný"
                                    checked={attrForm.is_searchable}
                                    onChange={(_, data) => setAttrForm({ ...attrForm, is_searchable: data.checked === true })}
                                />
                            </div>
                            <div>
                                <Label>Výchozí hodnota</Label>
                                <Input
                                    value={attrForm.default_value}
                                    onChange={(e) => setAttrForm({ ...attrForm, default_value: e.target.value })}
                                    style={{ width: '100%' }}
                                />
                            </div>
                            <div>
                                <Label>Nápověda (tooltip)</Label>
                                <Input
                                    value={attrForm.help_text}
                                    onChange={(e) => setAttrForm({ ...attrForm, help_text: e.target.value })}
                                    style={{ width: '100%' }}
                                />
                            </div>
                        </DialogContent>
                        <DialogActions>
                            <Button appearance="primary" onClick={handleSaveAttribute}>{t('common.save', 'Uložit')}</Button>
                            <Button appearance="secondary" onClick={() => setIsAttrDialogOpen(false)}>{t('common.cancel', 'Zrušit')}</Button>
                        </DialogActions>
                    </DialogBody>
                </DialogSurface>
            </Dialog>

            {/* DOC TYPE DIALOG */}
            <Dialog open={isDocTypeDialogOpen} onOpenChange={(_, data) => setIsDocTypeDialogOpen(data.open)}>
                <DialogSurface>
                    <DialogBody>
                        <DialogTitle>{editingDocType ? 'Upravit typ dokumentu' : 'Nový typ dokumentu'}</DialogTitle>
                        <DialogContent style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <div>
                                <Label required>Kód</Label>
                                <Input
                                    value={docTypeForm.code}
                                    onChange={(_, data) => setDocTypeForm({ ...docTypeForm, code: data.value })}
                                    style={{ width: '100%' }}
                                    placeholder="NAPŘ. INV, CONTRACT..."
                                />
                            </div>
                            <div>
                                <Label required>Název</Label>
                                <Input
                                    value={docTypeForm.name}
                                    onChange={(_, data) => setDocTypeForm({ ...docTypeForm, name: data.value })}
                                    style={{ width: '100%' }}
                                />
                            </div>
                            <div>
                                <Label>Popis (volitelné)</Label>
                                <Input
                                    value={docTypeForm.description}
                                    onChange={(_, data) => setDocTypeForm({ ...docTypeForm, description: data.value })}
                                    style={{ width: '100%' }}
                                />
                            </div>

                        </DialogContent>
                        <DialogActions>
                            <Button appearance="primary" onClick={handleSaveDocType} disabled={!docTypeForm.code || !docTypeForm.name}>{t('common.save', 'Uložit')}</Button>
                            <Button appearance="secondary" onClick={() => setIsDocTypeDialogOpen(false)}>{t('common.cancel', 'Zrušit')}</Button>
                        </DialogActions>
                    </DialogBody>
                </DialogSurface>
            </Dialog>
            <TranslationDialog
                open={transOpen}
                onOpenChange={setTransOpen}
                tableName="dms_attributes"
                recordId={transTarget?.id || 0}
                title={transTarget?.name || ''}
            />

            {/* STORAGE PROFILE DIALOG */}
            <Dialog open={isStorageDialogOpen} onOpenChange={(_, data) => setIsStorageDialogOpen(data.open)}>
                <DialogSurface style={{ minWidth: '500px' }}>
                    <DialogBody>
                        <DialogTitle>{editingStorageProfile ? 'Upravit úložiště' : 'Nové úložiště'}</DialogTitle>
                        <DialogContent style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <div>
                                <Label required>Název</Label>
                                <Input
                                    value={storageForm.name}
                                    onChange={(_, data) => setStorageForm({ ...storageForm, name: data.value })}
                                    style={{ width: '100%' }}
                                />
                            </div>
                            <div>
                                <Label>Typ úložiště</Label>
                                <Dropdown
                                    value={STORAGE_TYPES.find(t => t.value === storageForm.storage_type)?.label || storageForm.storage_type}
                                    selectedOptions={[storageForm.storage_type]}
                                    onOptionSelect={(_, data) => setStorageForm({ ...storageForm, storage_type: data.optionValue || 'local' })}
                                    style={{ width: '100%' }}
                                >
                                    {STORAGE_TYPES.map(t => (
                                        <Option key={t.value} value={t.value} text={t.label}>
                                            {t.label}
                                        </Option>
                                    ))}
                                </Dropdown>
                            </div>

                            {storageForm.storage_type === 'local' && (
                                <div>
                                    <Label>Cesta k adresáři (na serveru)</Label>
                                    <Input
                                        value={storageForm.base_path}
                                        onChange={(_, data) => setStorageForm({ ...storageForm, base_path: data.value })}
                                        placeholder="např. /var/www/uploads nebo C:/uploads"
                                        style={{ width: '100%' }}
                                    />
                                </div>
                            )}

                            {storageForm.storage_type === 'google_drive' && (
                                <>
                                    <div style={{ padding: '8px', background: '#f0f0f0', borderRadius: '4px', fontSize: '12px' }}>
                                        Pro nastavení Google Drive je potřeba vytvořit <strong>Service Account</strong> v Google Cloud Console,
                                        stáhnout jeho JSON klíč a povolit mu přístup k cílovému adresáři.
                                    </div>
                                    <div>
                                        <Label required>ID Složky (Google Folder ID)</Label>
                                        <Input
                                            value={storageForm.base_path}
                                            onChange={(_, data) => setStorageForm({ ...storageForm, base_path: data.value })}
                                            placeholder="např. 19V3digDrRSIk2BhfbdytlXW0YgCoO1J8"
                                            style={{ width: '100%' }}
                                        />
                                    </div>
                                    <div>
                                        <Label required>Service Account JSON (Credentials)</Label>
                                        <textarea
                                            value={storageForm.connection_string}
                                            onChange={(e) => setStorageForm({ ...storageForm, connection_string: e.target.value })}
                                            placeholder={'{\n  "type": "service_account",\n  "project_id": "...",\n  "private_key_id": "...",\n  ... \n}'}
                                            style={{ width: '100%', minHeight: '150px', fontFamily: 'monospace', padding: '8px', border: '1px solid #d1d1d1', borderRadius: '4px' }}
                                        />
                                    </div>
                                </>
                            )}

                            <div style={{ display: 'flex', gap: '16px', marginTop: '8px' }}>
                                <Checkbox
                                    label="Aktivní"
                                    checked={storageForm.is_active}
                                    onChange={(_, data) => setStorageForm({ ...storageForm, is_active: data.checked === true })}
                                />
                                <Checkbox
                                    label="Výchozí úložiště"
                                    checked={storageForm.is_default}
                                    onChange={(_, data) => setStorageForm({ ...storageForm, is_default: data.checked === true })}
                                />
                            </div>

                        </DialogContent>
                        <DialogActions>
                            <Button
                                appearance="secondary"
                                icon={<PlugConnected24Regular />}
                                onClick={handleTestConnection}
                                disabled={!storageForm.base_path || (storageForm.storage_type === 'google_drive' && !storageForm.connection_string)}
                            >
                                Test
                            </Button>
                            <Button appearance="primary" onClick={handleSaveStorageProfile}>{t('common.save', 'Uložit')}</Button>
                            <Button appearance="secondary" onClick={() => setIsStorageDialogOpen(false)}>{t('common.cancel', 'Zrušit')}</Button>
                        </DialogActions>
                    </DialogBody>
                </DialogSurface>
            </Dialog>
        </PageLayout>
    );
};
