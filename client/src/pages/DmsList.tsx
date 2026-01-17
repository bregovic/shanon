import React, { useEffect, useState } from 'react';
import {
    Button,
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbButton,
    BreadcrumbDivider,
    Badge,
    Drawer,
    DrawerHeader,
    DrawerHeaderTitle,
    DrawerBody,
    Title3,
    Text,
    Card,
    CardHeader,
    Divider,
    TableCellLayout,
    createTableColumn,
    Menu,
    MenuTrigger,
    MenuList,
    MenuItem,
    MenuPopover
} from '@fluentui/react-components';
import type { TableColumnDefinition } from '@fluentui/react-components';
import {
    Add24Regular,
    ArrowClockwise24Regular,
    Document24Regular,
    ScanText24Regular,
    Dismiss24Regular,
    Delete24Regular,
    Edit24Regular
} from '@fluentui/react-icons';
import { useNavigate } from 'react-router-dom';
import { PageLayout, PageHeader, PageFilterBar, PageContent } from '../components/PageLayout';
import { SmartDataGrid } from '../components/SmartDataGrid';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../context/TranslationContext';

interface DmsDocument {
    rec_id: number;
    display_name: string;
    doc_type_name: string;
    file_size_bytes: number;
    uploaded_by_name: string;
    ocr_status: string;
    status: string;
    created_at: string;
    metadata?: string; // JSON string from DB
}

export const DmsList: React.FC = () => {
    const { currentOrgId } = useAuth();
    const navigate = useNavigate();
    const { t } = useTranslation();
    const [documents, setDocuments] = useState<DmsDocument[]>([]);
    const [loading, setLoading] = useState(true);

    // Multi-selection
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

    // Detail Drawer (single view)
    const [drawerDoc, setDrawerDoc] = useState<DmsDocument | null>(null);
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);

    const fetchData = async () => {
        setLoading(true);
        try {
            const docsRes = await fetch('/api/api-dms.php?action=list');
            const docsJson = await docsRes.json();
            if (docsJson.success) {
                setDocuments(docsJson.data || []);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    // Format file size
    const formatSize = (bytes: number) => {
        if (!bytes) return '-';
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    };

    const handleBatchAnalyze = async () => {
        if (selectedIds.size === 0) return;
        if (!confirm(t('dms.list.confirm_batch_ocr', { count: selectedIds.size }))) return;

        try {
            const res = await fetch('/api/api-dms.php?action=analyze_doc', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: Array.from(selectedIds) })
            });
            const json = await res.json();
            if (json.success) {
                fetchData();
                alert(t('dms.list.batch_ocr_done'));
            } else {
                alert(t('common.error') + ': ' + (json.error || json.message || t('common.error')));
            }
        } catch (e) {
            console.error(e);
            alert('Chyba komunikace');
        }
    };

    const handleBatchDelete = async () => {
        if (selectedIds.size === 0) return;
        if (!confirm(t('dms.list.confirm_batch_delete', { count: selectedIds.size }))) return;

        try {
            const res = await fetch('/api/api-dms.php?action=delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: Array.from(selectedIds) })
            });
            const json = await res.json();
            if (json.success) {
                setIsDrawerOpen(false);
                setSelectedIds(new Set()); // clear selection
                fetchData();
            } else {
                alert(t('common.error') + ': ' + (json.error || 'Unknown error'));
            }
        } catch (e) {
            console.error(e);
            alert(t('common.network_error'));
        }
    };

    // Single doc handlers (forwarding to batch or specific logic)
    const handleAnalyzeSingle = (doc: DmsDocument) => {
        // Just select this one and call batch
        // Or call direct API if safer. Let's reuse batch logic logic for consistency but we need state.
        // Actually for Detail Drawer actions, we might just call the new API with single ID.
        fetch(`/api/api-dms.php?action=analyze_doc`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: [doc.rec_id] })
        }).then(res => res.json()).then(json => {
            if (json.success) {
                fetchData();
                alert(t('dms.list.ocr_done'));
            } else {
                alert(t('common.error') + ': ' + (json.error || t('common.error')));
            }
        });
    };

    const handleDeleteSingle = async (doc: DmsDocument) => {
        if (!confirm(t('dms.list.confirm_delete', { name: doc.display_name }))) return;
        const res = await fetch('/api/api-dms.php?action=delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: [doc.rec_id] })
        });
        if ((await res.json()).success) {
            setIsDrawerOpen(false);
            fetchData();
        }
    };


    const handleBatchStatusChange = async (status: string, ocrStatus?: string) => {
        if (selectedIds.size === 0) return;
        if (!confirm(t('dms.list.confirm_status_change'))) return;

        try {
            await fetch('/api/api-dms.php?action=update_status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ids: Array.from(selectedIds),
                    status: status,
                    ocr_status: ocrStatus
                })
            });
            fetchData();
        } catch (e) { console.error(e); }
    };

    // Column definitions
    const columns: TableColumnDefinition<DmsDocument>[] = [
        createTableColumn<DmsDocument>({
            columnId: 'rec_id',
            compare: (a, b) => a.rec_id - b.rec_id,
            renderHeaderCell: () => t('common.id'),
            renderCell: (item) => <Text>{item.rec_id}</Text>
        }),
        {
            ...createTableColumn<DmsDocument>({
                columnId: 'display_name',
                compare: (a, b) => a.display_name.localeCompare(b.display_name),
                renderHeaderCell: () => t('common.name'),
                renderCell: (item) => (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Document24Regular />
                        <Text weight="medium">{item.display_name}</Text>
                    </div>
                )
            }),
            minWidth: 400
        },
        createTableColumn<DmsDocument>({
            columnId: 'doc_type_name',
            compare: (a, b) => (a.doc_type_name || '').localeCompare(b.doc_type_name || ''),
            renderHeaderCell: () => t('common.type'),
            renderCell: (item) => <Text>{item.doc_type_name}</Text>
        }),
        createTableColumn<DmsDocument>({
            columnId: 'file_size_bytes',
            compare: (a, b) => a.file_size_bytes - b.file_size_bytes,
            renderHeaderCell: () => t('common.size'),
            renderCell: (item) => <Text>{formatSize(item.file_size_bytes)}</Text>
        }),
        createTableColumn<DmsDocument>({
            columnId: 'uploaded_by_name',
            compare: (a, b) => (a.uploaded_by_name || '').localeCompare(b.uploaded_by_name || ''),
            renderHeaderCell: () => t('common.author'),
            renderCell: (item) => <Text>{item.uploaded_by_name}</Text>
        }),
        createTableColumn<DmsDocument>({
            columnId: 'status',
            compare: (a, b) => (a.status || '').localeCompare(b.status || ''),
            renderHeaderCell: () => t('common.status'),
            renderCell: (item) => {
                const map: Record<string, string> = {
                    'new': t('dms.status.new'),
                    'processing': t('dms.status.processing'),
                    'review': t('dms.status.review'),
                    'verified': t('dms.status.verified'),
                    'approved': t('dms.status.approved'),
                    'rejected': t('dms.status.rejected')
                };
                const colors: Record<string, 'informative' | 'warning' | 'severe' | 'success' | 'danger'> = {
                    'new': 'informative',
                    'processing': 'warning',
                    'review': 'severe',
                    'verified': 'success',
                    'approved': 'success',
                    'rejected': 'danger'
                };
                const val = item.status || item.ocr_status || 'new';
                return (
                    <Badge appearance="tint" color={colors[val] || 'informative'}>
                        {map[val] || val}
                    </Badge>
                );
            }
        }),
        createTableColumn<DmsDocument>({
            columnId: 'created_at',
            compare: (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
            renderHeaderCell: () => t('common.created_at'),
            renderCell: (item) => <Text>{new Date(item.created_at).toLocaleString('cs-CZ')}</Text>
        })
    ];

    // Helper to parse metadata safely
    const getMetadataAttributes = (doc: DmsDocument) => {
        try {
            if (!doc.metadata) return null;
            const meta = typeof doc.metadata === 'string' ? JSON.parse(doc.metadata) : doc.metadata;
            return meta.attributes || null;
        } catch (e) {
            return null;
        }
    };

    return (
        <PageLayout>
            <PageHeader>
                <Breadcrumb>
                    <BreadcrumbItem>
                        <BreadcrumbButton onClick={() => navigate('/dms')}>{t('common.modules')}</BreadcrumbButton>
                    </BreadcrumbItem>
                    <BreadcrumbDivider />
                    <BreadcrumbItem>
                        <BreadcrumbButton onClick={() => navigate('/dms')}>{t('modules.dms')}</BreadcrumbButton>
                    </BreadcrumbItem>
                    <BreadcrumbDivider />
                    <BreadcrumbItem>
                        <BreadcrumbButton current>{t('dms.menu.all_documents')}</BreadcrumbButton>
                    </BreadcrumbItem>
                </Breadcrumb>
                <div style={{ flex: 1 }} />
                <Button appearance="subtle" icon={<ArrowClockwise24Regular />} onClick={fetchData} aria-label={t('common.refresh')} />
                <Button appearance="primary" icon={<Add24Regular />} onClick={() => navigate(`/${currentOrgId}/dms/import`)}>
                    {t('dms.import_documents')}
                </Button>
            </PageHeader>

            {/* Function Toolbar (replaces search) */}
            <PageFilterBar>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>


                    <Button
                        appearance="primary"
                        icon={<ScanText24Regular />}
                        disabled={selectedIds.size === 0}
                        onClick={handleBatchAnalyze}
                    >
                        {t('dms.list.btn_ocr')} {selectedIds.size > 1 ? `(${selectedIds.size})` : ''}
                    </Button>

                    <Button
                        appearance="secondary"
                        icon={<ArrowClockwise24Regular />} // Or specialized icon
                        onClick={() => navigate('/dms/review')}
                    >
                        {t('dms.list.btn_review')}
                    </Button>

                    <Button
                        appearance="secondary"
                        icon={<Document24Regular />}
                        disabled={selectedIds.size !== 1}
                        onClick={() => {
                            const id = Array.from(selectedIds)[0];
                            const doc = documents.find(d => d.rec_id === id);
                            if (doc) {
                                setDrawerDoc(doc);
                                setIsDrawerOpen(true);
                            }
                        }}
                    >
                        {t('dms.list.btn_detail')}
                    </Button>

                    <div style={{ width: '1px', backgroundColor: '#e0e0e0', margin: '0 8px', height: '20px' }} />


                    <Menu>
                        <MenuTrigger disableButtonEnhancement>
                            <Button icon={<Edit24Regular />} disabled={loading || selectedIds.size === 0}>
                                {t('dms.list.btn_change_status')}
                            </Button>
                        </MenuTrigger>
                        <MenuPopover>
                            <MenuList>
                                <MenuItem onClick={() => handleBatchStatusChange('review', 'mapping')}>{t('dms.status.set_mapping')}</MenuItem>
                                <MenuItem onClick={() => handleBatchStatusChange('verified')}>{t('dms.status.set_verified')}</MenuItem>
                                <MenuItem onClick={() => handleBatchStatusChange('rejected')}>{t('dms.status.rejected')}</MenuItem>
                                <Divider />
                                <MenuItem onClick={() => handleBatchStatusChange('new', 'pending')}>{t('dms.status.set_new')}</MenuItem>
                            </MenuList>
                        </MenuPopover>
                    </Menu>

                    <Button
                        appearance="secondary"
                        style={{ color: selectedIds.size === 0 ? 'inherit' : '#d13438', borderColor: selectedIds.size === 0 ? 'transparent' : '#d13438' }}
                        icon={<Delete24Regular />}
                        disabled={selectedIds.size === 0}
                        onClick={handleBatchDelete}
                    >
                        {t('common.delete')} {selectedIds.size > 1 ? `(${selectedIds.size})` : ''}
                    </Button>
                </div>
            </PageFilterBar>

            <PageContent>
                <div style={{ height: 'calc(100vh - 180px)', width: '100%', overflow: 'hidden' }}>
                    <SmartDataGrid
                        items={documents}
                        columns={columns}
                        getRowId={(item) => item.rec_id}
                        withFilterRow={true}
                        selectionMode="multiselect"
                        selectedItems={selectedIds}
                        onSelectionChange={(_, data) => setSelectedIds(data.selectedItems as Set<number>)}
                        onRowClick={(doc) => {
                            // If clicking valid row, open drawer? Or just toggle selection?
                            // Standard UX: Row click -> Selection (handled by DataGrid usually if checking checkbox).
                            // Let's assume SmartDataGrid handles checkbox selection separately from row click.
                            // If we want row click to open drawer:
                            setDrawerDoc(doc);
                            setIsDrawerOpen(true);
                        }}
                    />
                </div>
            </PageContent>

            <Drawer
                type="overlay"
                position="end"
                size="medium"
                open={isDrawerOpen}
                onOpenChange={(_, { open }) => setIsDrawerOpen(open)}
            >
                <DrawerHeader>
                    <DrawerHeaderTitle
                        action={
                            <Button
                                appearance="subtle"
                                aria-label={t('common.close')}
                                icon={<Dismiss24Regular />}
                                onClick={() => setIsDrawerOpen(false)}
                            />
                        }
                    >
                        {t('dms.detail.title')}
                    </DrawerHeaderTitle>
                </DrawerHeader>

                <DrawerBody>
                    {drawerDoc && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <Card>
                                <CardHeader header={<Text weight="semibold">{drawerDoc.display_name}</Text>} />
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '0 16px 16px' }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '8px', fontSize: '13px' }}>
                                        <Text weight="medium">{t('common.type')}:</Text> <Text>{drawerDoc.doc_type_name}</Text>
                                        <Text weight="medium">{t('common.size')}:</Text> <Text>{formatSize(drawerDoc.file_size_bytes)}</Text>
                                        <Text weight="medium">{t('common.created_at')}:</Text> <Text>{new Date(drawerDoc.created_at).toLocaleString('cs-CZ')}</Text>
                                        <Text weight="medium">{t('common.author')}:</Text> <Text>{drawerDoc.uploaded_by_name}</Text>
                                    </div>
                                    <Divider />
                                    <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
                                        <Button appearance="primary" icon={<Document24Regular />} onClick={() => window.open(`/api/api-dms.php?action=view&id=${drawerDoc.rec_id}`, '_blank')}>
                                            {t('common.open')}
                                        </Button>
                                        <Button icon={<ScanText24Regular />} onClick={() => handleAnalyzeSingle(drawerDoc)}>
                                            {t('dms.list.btn_ocr')}
                                        </Button>
                                        <Button
                                            appearance="secondary"
                                            style={{ color: '#d13438', borderColor: '#d13438' }}
                                            onClick={() => handleDeleteSingle(drawerDoc)}
                                        >
                                            {t('common.delete')}
                                        </Button>
                                    </div>
                                </div>
                            </Card>

                            <Title3>{t('dms.detail.ocr_data')}</Title3>
                            <Card>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '16px' }}>
                                    {getMetadataAttributes(drawerDoc) ? (
                                        Object.entries(getMetadataAttributes(drawerDoc)!).map(([key, val]) => (
                                            <div key={key} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f0f0f0', paddingBottom: '4px' }}>
                                                <Text weight="medium" style={{ color: '#666' }}>{t(`attribute.${key}`, key)}</Text>
                                                <Text>{String(val)}</Text>
                                            </div>
                                        ))
                                    ) : (
                                        <div style={{ textAlign: 'center', padding: '24px', color: '#888' }}>
                                            <ScanText24Regular style={{ fontSize: '32px', marginBottom: '8px' }} />
                                            <br />
                                            <Text>{t('dms.detail.no_data')}</Text>
                                            <div style={{ marginTop: '8px' }}>
                                                <Button size="small" onClick={() => handleAnalyzeSingle(drawerDoc)}>{t('dms.detail.run_ocr')}</Button>
                                                <Button size="small" appearance="subtle" onClick={() => navigate(`/dms/review?id=${drawerDoc.rec_id}`)}>{t('dms.detail.review')}</Button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </Card>
                        </div>
                    )}
                </DrawerBody>
            </Drawer>
        </PageLayout>
    );
};
