import React, { useEffect, useState } from 'react';
import {
    Button,
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbButton,
    BreadcrumbDivider,
    Input,
    Badge
} from '@fluentui/react-components';
import {
    Add24Regular,
    ArrowLeft24Regular,
    ArrowClockwise24Regular,
    Search24Regular,
    Filter24Regular
} from '@fluentui/react-icons';
import { useNavigate } from 'react-router-dom';
import { PageLayout, PageHeader, PageFilterBar, PageContent } from '../components/PageLayout';
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
    const [loading, setLoading] = useState(true);
    const [searchText, setSearchText] = useState('');

    const fetchData = async () => {
        setLoading(true);
        try {
            // Fetch documents
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

    // Filter logic
    const filteredDocs = documents.filter(doc => {
        if (!searchText) return true;
        const low = searchText.toLowerCase();
        return (
            doc.display_name?.toLowerCase().includes(low) ||
            doc.doc_type_name?.toLowerCase().includes(low) ||
            doc.uploaded_by_name?.toLowerCase().includes(low)
        );
    });

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
            filterable: true
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
        <PageLayout>
            <PageHeader>
                <Breadcrumb>
                    <BreadcrumbItem>
                        <BreadcrumbButton onClick={() => navigate('/dms')}>Moduly</BreadcrumbButton>
                    </BreadcrumbItem>
                    <BreadcrumbDivider />
                    <BreadcrumbItem>
                        <BreadcrumbButton onClick={() => navigate('/dms')}>DMS</BreadcrumbButton>
                    </BreadcrumbItem>
                    <BreadcrumbDivider />
                    <BreadcrumbItem>
                        <BreadcrumbButton current>Všechny dokumenty</BreadcrumbButton>
                    </BreadcrumbItem>
                </Breadcrumb>
                <div style={{ flex: 1 }} />
                <Button appearance="subtle" icon={<ArrowClockwise24Regular />} onClick={fetchData} aria-label="Obnovit" />
                <Button appearance="primary" icon={<Add24Regular />} onClick={() => navigate('/dms/import')}>
                    Nový dokument
                </Button>
            </PageHeader>

            {/* Filter Bar Standard */}
            <PageFilterBar>
                <Input
                    contentBefore={<Search24Regular />}
                    placeholder="Hledat dokumenty..."
                    value={searchText}
                    onChange={(_e, data) => setSearchText(data.value)}
                    style={{ minWidth: '300px' }}
                />
            </PageFilterBar>

            <PageContent>
                <DataGrid
                    data={filteredDocs}
                    columns={columns}
                    loading={loading}
                    pageSize={20}
                    emptyMessage="Žádné dokumenty"
                    onRowClick={(doc) => console.log('Open document:', doc.rec_id)}
                />
            </PageContent>
        </PageLayout>
    );
};
