import React, { useEffect, useState } from 'react';
import {
    makeStyles,
    tokens,
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
import { ActionBar } from '../components/ActionBar';
import { DataGrid } from '../components/DataGrid';
import type { DataGridColumn } from '../components/DataGrid';
import { useTranslation } from '../context/TranslationContext'; // Assuming context exists or use hardcoded for now if uncertain

const useStyles = makeStyles({
    root: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: tokens.colorNeutralBackground2
    },
    filterBar: {
        display: 'flex',
        gap: '16px',
        flexWrap: 'nowrap',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '8px 24px',
        backgroundColor: tokens.colorNeutralBackground2,
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        overflowX: 'auto',
        width: '100%',
        boxSizing: 'border-box',
        flexShrink: 0
    },
    content: {
        flex: 1,
        overflow: 'hidden', // DataGrid handles its own scroll usually, or we wrap it
        display: 'flex',
        flexDirection: 'column',
        padding: '24px'
    },
    searchContainer: {
        position: 'relative',
        display: 'flex',
        alignItems: 'center'
    }
});

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
    const styles = useStyles();
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
        <div className={styles.root}>
            <ActionBar>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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
                </div>
                <div style={{ flex: 1 }} />
                <Button appearance="subtle" icon={<ArrowClockwise24Regular />} onClick={fetchData}>
                    Obnovit
                </Button>
                <Button appearance="primary" icon={<Add24Regular />} onClick={() => navigate('/dms/import')}>
                    Nový dokument
                </Button>
            </ActionBar>

            {/* Filter Bar Standard */}
            <div className={styles.filterBar}>
                <Input
                    contentBefore={<Search24Regular />}
                    placeholder="Hledat dokumenty..."
                    value={searchText}
                    onChange={(_e, data) => setSearchText(data.value)}
                    style={{ minWidth: '300px' }}
                />
                <Button appearance="subtle" icon={<Filter24Regular />}>
                    Filtry
                </Button>
            </div>

            <div className={styles.content}>
                <DataGrid
                    data={filteredDocs}
                    columns={columns}
                    loading={loading}
                    pageSize={20}
                    emptyMessage="Žádné dokumenty"
                    onRowClick={(doc) => console.log('Open document:', doc.rec_id)}
                />
            </div>
        </div>
    );
};
