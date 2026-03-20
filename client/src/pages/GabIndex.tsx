import React, { useState, useEffect } from 'react';
import { PageContent } from '../components/PageLayout';
import { SmartDataGrid, type ExtendedTableColumnDefinition } from '../components/SmartDataGrid';
import { createTableColumn } from '@fluentui/react-components';
import { ActionBar } from '../components/ActionBar';
import { Button, Title1, MessageBar, MessageBarBody } from '@fluentui/react-components';
import { Add24Regular, Delete24Regular } from '@fluentui/react-icons';
import { useTranslation } from '../context/TranslationContext';
import { GabDetail } from './GabDetail';
import type { SelectionItemId } from '@fluentui/react-components';

export const GabIndex = () => {
    const { t } = useTranslation();
    const [data, setData] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    
    // Selection state
    const [selectedItems, setSelectedItems] = useState<Set<SelectionItemId>>(new Set());
    
    // Drawer state
    const [detailOpen, setDetailOpen] = useState(false);
    const [editId, setEditId] = useState<number | null>(null);

    const fetchData = async () => {
        setLoading(true);
        setError('');
        try {
            const res = await fetch('/api/api-gab.php?action=list');
            const json = await res.json();
            if (json.success) setData(json.data);
            else setError(json.error);
        } catch (e) { setError('Nelze načíst data adresáře'); }
        setLoading(false);
    };

    useEffect(() => {
        fetchData();
    }, []);

    const handleCreate = () => {
        setEditId(null);
        setDetailOpen(true);
    };

    const handleEdit = (id: number) => {
        setEditId(id);
        setDetailOpen(true);
    };

    const handleDeactivate = async () => {
        if (selectedItems.size === 0) return;
        if (!confirm('Opravdu chcete deaktivovat vybrané subjekty?')) return;
        
        try {
            const res = await fetch('/api/api-gab.php?action=deactivate', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ ids: Array.from(selectedItems) })
            });
            const json = await res.json();
            if (json.success) {
                setSelectedItems(new Set());
                fetchData();
            } else {
                alert(json.error);
            }
        } catch (e) { alert('Smazání se nezdařilo'); }
    }

    const columns: ExtendedTableColumnDefinition<any>[] = [
        createTableColumn({
            columnId: 'name',
            compare: (a: any, b: any) => a.name.localeCompare(b.name),
            renderHeaderCell: () => 'Název / Jméno',
            renderCell: (item: any) => <div style={{fontWeight: 'semibold'}}>{item.name}</div>,
        }),
        createTableColumn({
            columnId: 'reg_no',
            compare: (a: any, b: any) => (a.reg_no || '').localeCompare(b.reg_no || ''),
            renderHeaderCell: () => 'IČO',
            renderCell: (item: any) => <div style={{fontFamily: 'monospace'}}>{item.reg_no || '-'}</div>,
        }),
        createTableColumn({
            columnId: 'roles',
            compare: (a: any, b: any) => (a.roles || '').localeCompare(b.roles || ''),
            renderHeaderCell: () => 'Typy (Role)',
            renderCell: (item: any) => item.roles,
        }),
        createTableColumn({
            columnId: 'primary_contact',
            compare: (a: any, b: any) => (a.primary_contact || '').localeCompare(b.primary_contact || ''),
            renderHeaderCell: () => 'Primární Kontakt',
            renderCell: (item: any) => item.primary_contact,
        })
    ];

    return (
        <PageContent>
            <Title1 style={{ padding: '24px 24px 0 24px' }}>Globální adresář (GAB)</Title1>
            
            {error && (
                <MessageBar intent="error" style={{ margin: '0 24px' }}>
                    <MessageBarBody>{error}</MessageBarBody>
                </MessageBar>
            )}

            <ActionBar>
                <Button appearance="primary" icon={<Add24Regular />} onClick={handleCreate}>
                    Založit subjekt
                </Button>
                {selectedItems.size > 0 && (
                    <Button appearance="subtle" icon={<Delete24Regular color="red" />} onClick={handleDeactivate}>
                        Deaktivovat ({selectedItems.size})
                    </Button>
                )}
            </ActionBar>

            <div style={{ flex: 1, padding: '0 24px 24px 24px', overflow: 'hidden' }}>
                <SmartDataGrid 
                    items={data.filter(i => i.is_active)}
                    columns={columns}
                    getRowId={(i) => i.rec_id}
                    selectionMode="multiselect"
                    selectedItems={selectedItems}
                    onSelectionChange={(_, d) => setSelectedItems(d.selectedItems)}
                    onRowDoubleClick={(item) => handleEdit(item.rec_id)}
                />
            </div>

            <GabDetail 
                isOpen={detailOpen} 
                subjectId={editId} 
                onClose={() => setDetailOpen(false)} 
                onSaved={() => { setDetailOpen(false); fetchData(); }} 
            />
        </PageContent>
    );
};
