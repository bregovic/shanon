
import React, { useState, useEffect, useMemo } from 'react';
import {
    Dialog,
    DialogSurface,
    DialogBody,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Text,
    Spinner,
    createTableColumn
} from '@fluentui/react-components';
import { CheckmarkCircle24Regular, Dismiss24Regular } from '@fluentui/react-icons';
import { SmartDataGrid } from '../components/SmartDataGrid';
import type { TableColumnDefinition } from '@fluentui/react-components';

interface Attribute {
    rec_id: number;
    name: string;
    code?: string;
    data_type: string;
}

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    currentDocTypeId: number;
    onSave: () => void;
}

export const AttributeSelectorDialog: React.FC<Props> = ({ open, onOpenChange, currentDocTypeId, onSave }) => {
    const [allAttributes, setAllAttributes] = useState<Attribute[]>([]);
    const [linkedIds, setLinkedIds] = useState<Set<number>>(new Set());
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    // Initial Load
    useEffect(() => {
        if (open && currentDocTypeId) {
            loadData();
        }
    }, [open, currentDocTypeId]);

    const loadData = async () => {
        setLoading(true);
        try {
            // 1. Fetch ALL attributes
            const resAll = await fetch('/api/api-dms.php?action=attributes');
            const jsonAll = await resAll.json();
            const all: Attribute[] = jsonAll.data || [];

            // 2. Fetch LINKED attributes for this type
            const resLinked = await fetch(`/api/api-dms.php?action=doc_type_attributes&id=${currentDocTypeId}`);
            const jsonLinked = await resLinked.json();
            const linked: Attribute[] = jsonLinked.data || [];

            setAllAttributes(all);
            setLinkedIds(new Set(linked.map(a => a.rec_id)));

        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            // Bulk Sync Endpoint we just created
            const response = await fetch('/api/api-dms.php?action=doc_type_attributes_sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    doc_type_id: currentDocTypeId,
                    attribute_ids: Array.from(linkedIds)
                })
            });
            const json = await response.json();
            if (json.success) {
                onSave();
                onOpenChange(false);
            } else {
                alert('Chyba: ' + json.error);
            }
        } catch (e) {
            alert('Chyba ukládání');
            console.error(e);
        } finally {
            setSaving(false);
        }
    };

    const columns: TableColumnDefinition<Attribute>[] = useMemo(() => [
        createTableColumn<Attribute>({
            columnId: 'name',
            compare: (a, b) => a.name.localeCompare(b.name),
            renderHeaderCell: () => 'Název',
            renderCell: (item) => <Text weight="semibold">{item.name}</Text>
        }),
        createTableColumn<Attribute>({
            columnId: 'code',
            compare: (a, b) => (a.code || '').localeCompare(b.code || ''),
            renderHeaderCell: () => 'Kód',
            renderCell: (item) => <Text>{item.code}</Text>
        }),
        createTableColumn<Attribute>({
            columnId: 'type',
            compare: (a, b) => a.data_type.localeCompare(b.data_type),
            renderHeaderCell: () => 'Typ',
            renderCell: (item) => <Text>{item.data_type}</Text>
        })
    ], []);

    return (
        <Dialog open={open} onOpenChange={(_, data) => onOpenChange(data.open)}>
            <DialogSurface style={{ minWidth: '800px', height: '80vh' }}>
                <DialogBody style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                    <DialogTitle>
                        Správa atributů
                        <div style={{ fontSize: '12px', fontWeight: 'normal', marginTop: '4px' }}>
                            Vyberte atributy, které se mají vytěžovat pro tento typ dokumentu.
                        </div>
                    </DialogTitle>

                    <DialogContent style={{ flexGrow: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        {loading ? (
                            <Spinner label="Načítám konfiguraci..." />
                        ) : (
                            <div style={{ flexGrow: 1, overflow: 'hidden' }}>
                                <SmartDataGrid
                                    items={allAttributes}
                                    columns={columns}
                                    getRowId={(item) => item.rec_id}
                                    selectionMode="multiselect"
                                    selectedItems={linkedIds}
                                    onSelectionChange={(_, data) => setLinkedIds(data.selectedItems as Set<number>)}
                                    withFilterRow={true}
                                />
                            </div>
                        )}
                        <div style={{ padding: '8px', background: '#f0f0f0', borderRadius: '4px' }}>
                            <Text>Vybráno: {linkedIds.size} atributů</Text>
                        </div>
                    </DialogContent>

                    <DialogActions>
                        <Button
                            appearance="primary"
                            icon={<CheckmarkCircle24Regular />}
                            onClick={handleSave}
                            disabled={loading || saving}
                        >
                            {saving ? 'Ukládám...' : 'Uložit změny'}
                        </Button>
                        <Button
                            appearance="secondary"
                            onClick={() => onOpenChange(false)}
                            disabled={saving}
                        >
                            Zrušit
                        </Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};
