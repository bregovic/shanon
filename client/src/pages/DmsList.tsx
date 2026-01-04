import React, { useEffect, useState } from 'react';
import {
    Button,
    Title3,
    Badge,
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbButton,
    BreadcrumbDivider
} from '@fluentui/react-components';
import { Add24Regular, ArrowLeft24Regular } from '@fluentui/react-icons';
import { useNavigate } from 'react-router-dom';
import { ActionBar } from '../components/ActionBar';
import { DataGrid } from '../components/DataGrid';
import type { DataGridColumn } from '../components/DataGrid';

interface DmsDocument {
    rec_id: number;
    display_name: string;
    doc_type_name: string;
    file_size_bytes: number;
    uploaded_by_name: string;
    ocr_status: string;
    created_at: string;
}

export const DmsList: React.FC = () => {
    const navigate = useNavigate();
    const [documents, setDocuments] = useState<DmsDocument[]>([]);
    const [docTypes, setDocTypes] = useState<{ value: string; label: string }[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            try {
                // Fetch documents
                const docsRes = await fetch('/api/api-dms.php?action=list');
                const docsJson = await docsRes.json();
                if (docsJson.success) {
                    setDocuments(docsJson.data || []);

                    // Extract unique doc types for filter
                    const types = new Set<string>();
                    docsJson.data?.forEach((d: DmsDocument) => {
                        if (d.doc_type_name) types.add(d.doc_type_name);
                    });
                    setDocTypes(Array.from(types).map(t => ({ value: t, label: t })));
                }
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, []);

    // Format file size
    const formatSize = (bytes: number) => {
        if (!bytes) return '-';
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    };

    // Column definitions
    const columns: DataGridColumn<DmsDocument>[] = [
        {
            key: 'display_name',
            label: 'Název',
            sortable: true,
            width: '30%'
        },
        {
            key: 'doc_type_name',
            label: 'Typ',
            sortable: true,
            filterable: true,
            filterOptions: docTypes
        },
        {
            key: 'file_size_bytes',
            label: 'Velikost',
            sortable: true,
            render: (item) => formatSize(item.file_size_bytes)
        },
        {
            key: 'uploaded_by_name',
            label: 'Autor',
            sortable: true
        },
        {
            key: 'ocr_status',
            label: 'OCR Stav',
            sortable: true,
            filterable: true,
            filterOptions: [
                { value: 'pending', label: 'Čeká' },
                { value: 'completed', label: 'Dokončeno' },
                { value: 'skipped', label: 'Přeskočeno' },
                { value: 'failed', label: 'Chyba' }
            ],
            render: (item) => {
                const colors: Record<string, 'warning' | 'success' | 'informative' | 'danger'> = {
                    pending: 'warning',
                    completed: 'success',
                    skipped: 'informative',
                    failed: 'danger'
                };
                return (
                    <Badge appearance="tint" color={colors[item.ocr_status] || 'informative'}>
                        {item.ocr_status}
                    </Badge>
                );
            }
        },
        {
            key: 'created_at',
            label: 'Vytvořeno',
            sortable: true,
            render: (item) => new Date(item.created_at).toLocaleString('cs-CZ')
        }
    ];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <ActionBar>
                <Button appearance="subtle" icon={<ArrowLeft24Regular />} onClick={() => navigate('/dms')}>
                    Zpět
                </Button>
                <Breadcrumb>
                    <BreadcrumbItem>
                        <BreadcrumbButton onClick={() => navigate('/dms')}>DMS</BreadcrumbButton>
                    </BreadcrumbItem>
                    <BreadcrumbDivider />
                    <BreadcrumbItem>
                        <BreadcrumbButton current>Všechny dokumenty</BreadcrumbButton>
                    </BreadcrumbItem>
                </Breadcrumb>
                <div style={{ flex: 1 }} />
                <Button appearance="primary" icon={<Add24Regular />} onClick={() => navigate('/dms/import')}>
                    Nový dokument
                </Button>
            </ActionBar>

            <div style={{ padding: '24px', flex: 1, overflow: 'auto' }}>
                <Title3 style={{ marginBottom: '16px' }}>Všechny dokumenty</Title3>

                <DataGrid
                    data={documents}
                    columns={columns}
                    loading={loading}
                    pageSize={20}
                    searchPlaceholder="Hledat dokumenty..."
                    emptyMessage="Žádné dokumenty"
                    onRowClick={(doc) => console.log('Open document:', doc.rec_id)}
                />
            </div>
        </div>
    );
};
