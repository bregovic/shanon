import React, { useState, useEffect } from 'react';
import {
    Drawer,
    DrawerHeader,
    DrawerHeaderTitle,
    DrawerBody,
    Button,
    makeStyles,
    tokens,
    Text,
    Badge,
    Tab,
    TabList,
    Field,
    Textarea,
    Spinner,
    Dialog,
    DialogSurface,
    DialogBody,
    DialogTitle,
    DialogContent,
    DialogActions
} from '@fluentui/react-components';
import {
    Attach24Regular,
    Document24Regular,
    Note24Regular,
    Delete24Regular,
    ArrowDownload24Regular,
    Add24Regular
} from '@fluentui/react-icons';
import { useAuth } from '../context/AuthContext';
import axios from 'axios';

// --- STYLES ---
const useStyles = makeStyles({
    root: {
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        height: '100%',
    },
    item: {
        display: 'flex',
        alignItems: 'center',
        padding: '8px',
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        ':hover': {
            backgroundColor: tokens.colorNeutralBackground1Hover
        }
    },
    itemIcon: {
        marginRight: '12px',
        color: tokens.colorBrandForeground1
    },
    itemContent: {
        flexGrow: 1,
        display: 'flex',
        flexDirection: 'column'
    },
    itemActions: {
        display: 'flex',
        gap: '4px'
    },
    meta: {
        fontSize: '11px',
        color: tokens.colorNeutralForeground3
    },
    badge: {
        position: 'absolute',
        top: '-4px', // Fixed: string
        right: '-4px', // Fixed: string
        transform: 'scale(0.8)'
    }
});

interface DocuRefProps {
    refTable: string;
    refId: number | null;
    disabled?: boolean;
}

interface DocuItem {
    id: number;
    type: 'File' | 'Note' | 'URL';
    name: string;
    notes?: string;
    file_mime?: string;
    file_size?: number;
    created_at: string;
    creator_name?: string;
}

export const DocuRefButton: React.FC<DocuRefProps> = ({ refTable, refId, disabled }) => {
    const styles = useStyles();
    const [isOpen, setIsOpen] = useState(false);
    const [items, setItems] = useState<DocuItem[]>([]);
    const { getApiUrl } = useAuth();

    // Fetch on mount or when ID changes
    useEffect(() => {
        if (!refId) {
            setItems([]);
            return;
        }
        loadItems();
    }, [refId, refTable]);

    const loadItems = async () => {
        if (!refId) return;
        try {
            const res = await axios.get(getApiUrl(`api-docuref.php?action=list&ref_table=${refTable}&ref_id=${refId}`));
            if (res.data.success) {
                setItems(res.data.data);
            }
        } catch (e) {
            console.error("Failed to load attachments", e);
        }
    };

    return (
        <>
            <div style={{ position: 'relative', display: 'inline-block' }}>
                <Button
                    appearance="subtle"
                    icon={<Attach24Regular />}
                    disabled={disabled || !refId}
                    onClick={() => setIsOpen(true)}
                    title="Přílohy (Attachments)"
                />
                {items.length > 0 && (
                    <Badge
                        color="danger"
                        shape="circular"
                        className={styles.badge}
                    >
                        {items.length}
                    </Badge>
                )}
            </div>

            <DocuRefDrawer
                open={isOpen}
                onOpenChange={(op) => setIsOpen(op)}
                refTable={refTable}
                refId={refId}
                items={items}
                onRefresh={loadItems}
            />
        </>
    );
};

// --- DRAWER ---
interface DrawerProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    refTable: string;
    refId: number | null;
    items: DocuItem[];
    onRefresh: () => void;
}

const DocuRefDrawer: React.FC<DrawerProps> = ({ open, onOpenChange, refTable, refId, items, onRefresh }) => {
    const styles = useStyles();
    const { getApiUrl } = useAuth();

    // Add Dialog
    const [isAddOpen, setIsAddOpen] = useState(false);

    const downloadFile = (id: number) => {
        const url = getApiUrl(`api-docuref.php?action=download&id=${id}`);
        window.open(url, '_blank');
    };

    const deleteItem = async (id: number) => {
        if (!confirm("Opravdu smazat?")) return;
        try {
            const formData = new FormData();
            formData.append('id', id.toString());
            await axios.post(getApiUrl('api-docuref.php?action=delete'), formData);
            onRefresh();
        } catch (e) { alert("Chyba při mazání"); }
    };

    return (
        <Drawer
            type="overlay"
            position="end"
            size="medium"
            open={open}
            onOpenChange={(_, { open }) => onOpenChange(open)}
        >
            <DrawerHeader>
                <DrawerHeaderTitle
                    action={
                        <Button appearance="primary" icon={<Add24Regular />} onClick={() => setIsAddOpen(true)}>
                            Přidat
                        </Button>
                    }
                >
                    Přílohy ({items.length})
                </DrawerHeaderTitle>
            </DrawerHeader>

            <DrawerBody>
                <div className={styles.root}>
                    {items.length === 0 && <Text style={{ padding: 20, textAlign: 'center', color: tokens.colorNeutralForeground3 }}>Žádné přílohy</Text>}

                    {items.map(item => (
                        <div key={item.id} className={styles.item}>
                            <div className={styles.itemIcon}>
                                {item.type === 'Note' ? <Note24Regular /> : <Document24Regular />}
                            </div>
                            <div className={styles.itemContent}>
                                <Text weight="semibold">{item.name}</Text>
                                {item.type === 'Note' && <Text size={200} style={{ whiteSpace: 'pre-wrap' }}>{item.notes}</Text>}
                                <span className={styles.meta}>
                                    {new Date(item.created_at).toLocaleString()} • {item.creator_name}
                                    {item.file_size ? ` • ${(item.file_size / 1024).toFixed(1)} KB` : ''}
                                </span>
                            </div>
                            <div className={styles.itemActions}>
                                {item.type === 'File' && (
                                    <Button icon={<ArrowDownload24Regular />} appearance="subtle" onClick={() => downloadFile(item.id)} />
                                )}
                                <Button icon={<Delete24Regular />} appearance="subtle" onClick={() => deleteItem(item.id)} />
                            </div>
                        </div>
                    ))}
                </div>
            </DrawerBody>

            <AddDocuDialog
                open={isAddOpen}
                onClose={() => setIsAddOpen(false)}
                refTable={refTable}
                refId={refId}
                onSuccess={() => { setIsAddOpen(false); onRefresh(); }}
            />
        </Drawer>
    );
};

// --- ADD DIALOG ---
const AddDocuDialog: React.FC<any> = ({ open, onClose, refTable, refId, onSuccess }) => {
    const [type, setType] = useState<'File' | 'Note'>('File');
    const [file, setFile] = useState<File | null>(null);
    const [note, setNote] = useState('');
    const [loading, setLoading] = useState(false);
    const { getApiUrl } = useAuth();

    // Reset on open
    useEffect(() => { setFile(null); setNote(''); setType('File'); }, [open]);

    const submit = async () => {
        setLoading(true);
        try {
            const fd = new FormData();
            fd.append('action', 'create');
            fd.append('ref_table', refTable);
            fd.append('ref_id', refId);
            fd.append('type', type);

            if (type === 'File') {
                if (!file) return;
                fd.append('file', file);
                fd.append('name', file.name);
            } else {
                fd.append('notes', note);
                fd.append('name', 'Poznámka');
            }

            await axios.post(getApiUrl('api-docuref.php?action=create'), fd);
            onSuccess();
        } catch (e) {
            console.error(e);
            alert("Chyba nahrávání");
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(_, { open }) => !open && onClose()}>
            <DialogSurface>
                <DialogBody>
                    <DialogTitle>Přidat přílohu</DialogTitle>
                    <DialogContent style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
                        <TabList selectedValue={type} onTabSelect={(_, d) => setType(d.value as any)}>
                            <Tab value="File">Soubor</Tab>
                            <Tab value="Note">Poznámka</Tab>
                        </TabList>

                        {type === 'File' ? (
                            <Field label="Vybrat soubor">
                                <input type="file" onChange={e => setFile(e.target.files?.[0] || null)} />
                            </Field>
                        ) : (
                            <Field label="Text poznámky">
                                <Textarea value={note} onChange={e => setNote(e.target.value)} rows={5} />
                            </Field>
                        )}
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={onClose}>Zrušit</Button>
                        <Button appearance="primary" onClick={submit} disabled={loading || (type === 'File' && !file)}>
                            {loading ? <Spinner size="tiny" /> : "Uložit"}
                        </Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};
