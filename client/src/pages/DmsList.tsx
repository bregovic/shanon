
import React, { useEffect, useState } from 'react';
import { ActionBar } from '../components/ActionBar';
import {
    Button,
    Title3,
    Table,
    TableHeader,
    TableRow,
    TableHeaderCell,
    TableBody,
    TableCell,
    Badge,
    Spinner,
    Text,
    tokens
} from '@fluentui/react-components';
import {
    ArrowLeft24Regular,
    DocumentAdd24Regular,
    ArrowSync24Regular
} from '@fluentui/react-icons';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

interface DmsDocument {
    rec_id: number;
    display_name: string;
    doc_type_name: string;
    file_extension: string;
    file_size_bytes: number;
    ocr_status: 'pending' | 'processing' | 'done' | 'failed';
    created_at: string;
    uploaded_by_name: string;
}

const getStatusColor = (status: string) => {
    switch (status) {
        case 'done': return 'success';
        case 'processing': return 'warning';
        case 'failed': return 'danger';
        default: return 'secondary';
    }
}

const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export const DmsList: React.FC = () => {
    const navigate = useNavigate();

    const [docs, setDocs] = useState<DmsDocument[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchDocs = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/api-dms.php?action=list');
            const json = await res.json();
            if (json.success) {
                setDocs(json.data);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchDocs();
    }, []);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <ActionBar>
                <Button appearance="subtle" icon={<ArrowLeft24Regular />} onClick={() => navigate('/dms')}>Zpět</Button>
                <div style={{ width: '24px' }} />
                <Title3>Všechny dokumenty</Title3>
                <div style={{ flex: 1 }} />
                <Button icon={<ArrowSync24Regular />} appearance="subtle" onClick={fetchDocs} disabled={loading} />
                <Button appearance="primary" icon={<DocumentAdd24Regular />} onClick={() => navigate('/dms/import')}>
                    Nový dokument
                </Button>
            </ActionBar>

            <div style={{ padding: '24px', flex: 1, overflow: 'auto' }}>
                {loading ? (
                    <Spinner label="Načítám dokumenty..." />
                ) : (
                    docs.length === 0 ? (
                        <div style={{ textAlign: 'center', marginTop: '40px', color: tokens.colorNeutralForeground4 }}>
                            <Text size={400}>Žádné dokumenty k zobrazení.</Text>
                            <br />
                            <Button style={{ marginTop: '10px' }} onClick={() => navigate('/dms/import')}>Nahrát první dokument</Button>
                        </div>
                    ) : (
                        <Table aria-label="DMS List">
                            <TableHeader>
                                <TableRow>
                                    <TableHeaderCell>Název</TableHeaderCell>
                                    <TableHeaderCell>Typ</TableHeaderCell>
                                    <TableHeaderCell>Velikost</TableHeaderCell>
                                    <TableHeaderCell>Autor</TableHeaderCell>
                                    <TableHeaderCell>OCR Stav</TableHeaderCell>
                                    <TableHeaderCell>Vytvořeno</TableHeaderCell>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {docs.map(doc => (
                                    <TableRow key={doc.rec_id}>
                                        <TableCell>
                                            <Text weight="semibold">{doc.display_name}</Text>
                                            <Text size={200} style={{ color: tokens.colorNeutralForeground4, marginLeft: '8px' }}>
                                                .{doc.file_extension}
                                            </Text>
                                        </TableCell>
                                        <TableCell>{doc.doc_type_name || '-'}</TableCell>
                                        <TableCell>{formatBytes(doc.file_size_bytes || 0)}</TableCell>
                                        <TableCell>{doc.uploaded_by_name}</TableCell>
                                        <TableCell>
                                            <Badge appearance="tint" color={getStatusColor(doc.ocr_status) as any}>
                                                {doc.ocr_status}
                                            </Badge>
                                        </TableCell>
                                        <TableCell>{new Date(doc.created_at).toLocaleString()}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )
                )}
            </div>
        </div>
    );
};
