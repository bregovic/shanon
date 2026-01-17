import React, { useEffect, useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    makeStyles,
    shorthands,
    Button,
    Title3,
    Text,
    Spinner,
    createTableColumn,
    Card,
    Badge
} from '@fluentui/react-components';
import type { TableColumnDefinition } from '@fluentui/react-components';
import {
    ArrowLeft24Regular,
    Database24Regular,
    Table24Regular,
    ArrowClockwise24Regular
} from '@fluentui/react-icons';

import { ActionBar } from '../components/ActionBar';
import { SmartDataGrid } from '../components/SmartDataGrid';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../context/TranslationContext';

const useStyles = makeStyles({
    root: {
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#f5f5f5' // Neutral background
    },
    container: {
        padding: '16px',
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
    },
    card: {
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        ...shorthands.padding('0') // We handle padding inside
    },
    gridContainer: {
        flex: 1,
        overflow: 'hidden',
        // Fix for FluentUI grid scrolling
        position: 'relative'
    }
});

interface TableInfo {
    id: string; // table_name
    table_name: string;
    size: string;
    estimated_rows: string | number;
}

export const TableBrowser: React.FC = () => {
    const styles = useStyles();
    const { getApiUrl } = useAuth();
    const { t } = useTranslation();
    const [searchParams, setSearchParams] = useSearchParams();

    // State
    const currentTable = searchParams.get('table');
    const [tables, setTables] = useState<TableInfo[]>([]);
    const [tableData, setTableData] = useState<any[]>([]);
    const [columns, setColumns] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // 1. Fetch Table List
    const fetchTables = async () => {
        setLoading(true);
        try {
            const res = await fetch(getApiUrl('api-table-browser.php?action=list_tables'));
            const json = await res.json();
            if (json.success) {
                setTables(json.data);
            } else {
                setError(json.error);
            }
        } catch (e) {
            setError("Network Error");
        } finally {
            setLoading(false);
        }
    };

    // 2. Fetch Table Data
    const fetchTableData = async (tableName: string) => {
        setLoading(true);
        setTableData([]);
        setColumns([]);
        try {
            const res = await fetch(getApiUrl(`api-table-browser.php?action=get_data&table=${tableName}`));
            const json = await res.json();
            if (json.success) {
                setColumns(json.columns);
                setTableData(json.data);
            } else {
                setError(json.error);
            }
        } catch (e) {
            setError("Network Error");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (currentTable) {
            fetchTableData(currentTable);
        } else {
            fetchTables();
        }
    }, [currentTable]);

    // --- COLUMNS DEFINITION ---

    const tableListColumns: TableColumnDefinition<TableInfo>[] = [
        createTableColumn({
            columnId: 'table_name',
            compare: (a, b) => a.table_name.localeCompare(b.table_name),
            renderHeaderCell: () => t('common.name'),
            renderCell: (item) => (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Table24Regular />
                    <Text weight="semibold">{item.table_name}</Text>
                </div>
            )
        }),
        createTableColumn({
            columnId: 'estimated_rows',
            compare: (a, b) => Number(a.estimated_rows) - Number(b.estimated_rows),
            renderHeaderCell: () => 'Řádky (odhad)',
            renderCell: (item) => <Text font="monospace">{item.estimated_rows}</Text>
        }),
        createTableColumn({
            columnId: 'size',
            compare: (a, b) => a.size.localeCompare(b.size), // String compare roughly ok for simple units
            renderHeaderCell: () => 'Velikost',
            renderCell: (item) => <Badge appearance="tint">{item.size}</Badge>
        })
    ];

    // Dynamic Columns for Data View
    const dynamicDataColumns = useMemo(() => {
        if (!columns || columns.length === 0) return [];
        return columns.map(col => createTableColumn<any>({
            columnId: col.column_name,
            compare: (a, b) => String(a[col.column_name] || '').localeCompare(String(b[col.column_name] || '')),
            renderHeaderCell: () => (
                <div style={{ display: 'flex', flexDirection: 'column', lineHeight: '1.1' }}>
                    <span>{col.column_name}</span>
                    <span style={{ fontSize: '10px', color: '#888', fontWeight: 'normal' }}>{col.data_type}</span>
                </div>
            ),
            renderCell: (item) => {
                const val = item[col.column_name];
                if (val === null) return <span style={{ color: '#ccc' }}>NULL</span>;
                if (typeof val === 'object') return <span style={{ fontFamily: 'monospace', fontSize: '11px' }}>{JSON.stringify(val).substring(0, 50)}</span>;
                // Boolean handling specific to Postgres (t/f or 1/0)
                if (val === true || val === 't') return <Badge appearance="tint" color="success">TRUE</Badge>;
                if (val === false || val === 'f') return <Badge appearance="tint" color="danger">FALSE</Badge>;
                return <span style={{ fontFamily: 'monospace' }}>{String(val)}</span>;
            }
        }));
    }, [columns]);

    // --- HANDLERS ---

    const handleTableSelect = (tableId: string) => {
        setSearchParams({ table: tableId });
    };

    const handleBack = () => {
        setSearchParams({});
    };

    // --- RENDER ---

    return (
        <div className={styles.root}>
            <ActionBar>
                {currentTable ? (
                    <>
                        <Button icon={<ArrowLeft24Regular />} onClick={handleBack}>Zpět na přehled</Button>
                        <div style={{ width: 1, height: 24, backgroundColor: '#ccc' }} />
                        <Title3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Database24Regular />
                            {currentTable}
                        </Title3>
                        <Badge appearance="outline">{tableData.length} rows (limit 500)</Badge>
                    </>
                ) : (
                    <Title3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Database24Regular />
                        Table Browser
                    </Title3>
                )}
                <div style={{ flex: 1 }} />
                <Button icon={<ArrowClockwise24Regular />} appearance="subtle" onClick={() => currentTable ? fetchTableData(currentTable) : fetchTables()}>
                    {t('common.refresh')}
                </Button>
            </ActionBar>

            <div className={styles.container}>
                {loading && <div style={{ padding: 20, textAlign: 'center' }}><Spinner label={t('common.loading')} /></div>}

                {error && <div style={{ padding: 20, color: 'red' }}>{error}</div>}

                {!loading && !error && (
                    <Card className={styles.card}>
                        <div className={styles.gridContainer}>
                            {currentTable ? (
                                <SmartDataGrid
                                    items={tableData}
                                    columns={dynamicDataColumns}
                                    getRowId={(item) => String(item.rec_id || item.id || Math.random())} // Try common PKs or random
                                    selectionMode="single"
                                />
                            ) : (
                                <SmartDataGrid
                                    items={tables}
                                    columns={tableListColumns}
                                    getRowId={(item) => item.id}
                                    onRowClick={(item) => handleTableSelect(item.id)}
                                />
                            )}
                        </div>
                    </Card>
                )}
            </div>
        </div>
    );
};
