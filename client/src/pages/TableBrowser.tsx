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
    Badge,
    Textarea
} from '@fluentui/react-components';
import type { TableColumnDefinition } from '@fluentui/react-components';
import {
    ArrowLeft24Regular,
    Database24Regular,
    Table24Regular,
    ArrowClockwise24Regular,
    Code24Regular,
    Settings24Regular,
    Play24Regular
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
        backgroundColor: '#f5f5f5'
    },
    container: {
        padding: '16px',
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        gap: '16px'
    },
    card: {
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        ...shorthands.padding('0')
    },
    gridContainer: {
        flex: 1,
        overflow: 'hidden',
    },
    sqlEditor: {
        width: '100%',
        fontFamily: 'monospace',
        minHeight: '150px'
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

    // Navigation State
    const currentTable = searchParams.get('table');
    const [viewMode, setViewMode] = useState<'data' | 'sql' | 'settings'>('data');

    // Data State
    const [tables, setTables] = useState<TableInfo[]>([]);
    const [tableData, setTableData] = useState<any[]>([]);
    const [columns, setColumns] = useState<any[]>([]);
    const [filterInfo, setFilterInfo] = useState<string>('');
    const [features, setFeatures] = useState<any>({});

    // SQL State
    const [sqlQuery, setSqlQuery] = useState('');
    const [sqlResult, setSqlResult] = useState<any>(null);

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Initial Load & Effects
    useEffect(() => {
        if (currentTable) {
            setViewMode('data');
            fetchTableData(currentTable);
        } else {
            fetchTables();
            setSqlQuery('');
        }
    }, [currentTable]);

    const fetchTables = async () => {
        setLoading(true);
        try {
            const res = await fetch(getApiUrl('api-table-browser.php?action=list_tables'));
            const json = await res.json();
            if (json.success) setTables(json.data);
            else setError(json.error);
        } catch (e) { setError("Network Error"); }
        finally { setLoading(false); }
    };

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
                setFilterInfo(json.filter_active);
                setFeatures(json.features || {});
                if (!sqlQuery) setSqlQuery(`SELECT * FROM "${tableName}" LIMIT 50`);
            } else {
                setError(json.error);
            }
        } catch (e) { setError("Network Error"); }
        finally { setLoading(false); }
    };

    const executeSql = async () => {
        setLoading(true);
        setSqlResult(null);
        try {
            const res = await fetch(getApiUrl('api-table-browser.php?action=execute_sql'), {
                method: 'POST', body: JSON.stringify({ sql: sqlQuery })
            });
            const json = await res.json();
            setSqlResult(json);
        } catch (e) { setError("SQL Execution Failed"); }
        finally { setLoading(false); }
    };

    const applyFeature = async (feature: string) => {
        if (!currentTable || !confirm(`Opravdu aplikovat ${feature} na ${currentTable}?`)) return;
        setLoading(true);
        try {
            const res = await fetch(getApiUrl('api-table-browser.php?action=apply_feature'), {
                method: 'POST', body: JSON.stringify({ table: currentTable, feature })
            });
            const json = await res.json();
            if (json.success) {
                alert(json.message);
                fetchTableData(currentTable);
            } else alert(json.error);
        } catch (e) { alert("Error"); }
        finally { setLoading(false); }
    };

    // Columns Definition
    const dynamicDataColumns = useMemo(() => {
        const cols = viewMode === 'sql' && sqlResult?.columns ? sqlResult.columns : columns;
        if (!cols || cols.length === 0) return [];
        return cols.map((col: any) => createTableColumn<any>({
            columnId: col.column_name,
            compare: (a, b) => String(a[col.column_name] || '').localeCompare(String(b[col.column_name] || '')),
            renderHeaderCell: () => (
                <div style={{ lineHeight: '1.2' }}>
                    <div>{col.column_name}</div>
                    <div style={{ fontSize: '10px', color: '#888', fontWeight: 'normal' }}>{col.data_type}</div>
                </div>
            ),
            renderCell: (item) => {
                const val = item[col.column_name];
                if (val === null) return <span style={{ color: '#ccc' }}>NULL</span>;
                if (typeof val === 'object') return <span style={{ fontFamily: 'monospace', fontSize: '11px' }}>{JSON.stringify(val).substring(0, 40)}</span>;
                return <span style={{ fontFamily: 'monospace' }}>{String(val)}</span>;
            }
        }));
    }, [columns, sqlResult, viewMode]);

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
            renderHeaderCell: () => 'Rows',
            renderCell: (item) => <Text font="monospace">{item.estimated_rows}</Text>
        }),
        createTableColumn({
            columnId: 'size',
            compare: (a, b) => a.size.localeCompare(b.size),
            renderHeaderCell: () => 'Size',
            renderCell: (item) => <Badge appearance="tint">{item.size}</Badge>
        })
    ];

    return (
        <div className={styles.root}>
            <ActionBar>
                {currentTable ? (
                    <>
                        <Button icon={<ArrowLeft24Regular />} onClick={() => setSearchParams({})}>Zpět</Button>
                        <div style={{ width: 1, height: 24, backgroundColor: '#ccc', margin: '0 8px' }} />
                        <Title3 style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 16 }}>
                            <Database24Regular /> {currentTable}
                        </Title3>
                        <Button appearance={viewMode === 'data' ? 'primary' : 'subtle'} icon={<Table24Regular />} onClick={() => setViewMode('data')}>Data</Button>
                        <Button appearance={viewMode === 'settings' ? 'primary' : 'subtle'} icon={<Settings24Regular />} onClick={() => setViewMode('settings')}>Vlastnosti</Button>
                    </>
                ) : (
                    <Title3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Database24Regular /> Table Browser
                    </Title3>
                )}

                <div style={{ flex: 1 }} />
                <Button appearance={viewMode === 'sql' ? 'primary' : 'subtle'} icon={<Code24Regular />} onClick={() => setViewMode('sql')}>SQL Konzole</Button>
                <Button icon={<ArrowClockwise24Regular />} appearance="subtle" onClick={() => currentTable ? fetchTableData(currentTable) : fetchTables()}>Obnovit</Button>
            </ActionBar>

            <div className={styles.container}>
                {loading && <div style={{ textAlign: 'center' }}><Spinner label="Pracuji..." /></div>}
                {error && <div style={{ color: 'red', padding: 10 }}>{error}</div>}

                {/* --- TABLE LIST VIEW --- */}
                {!currentTable && viewMode !== 'sql' && !loading && (
                    <Card className={styles.card}>
                        <div className={styles.gridContainer}>
                            <SmartDataGrid
                                items={tables}
                                columns={tableListColumns}
                                getRowId={(item) => item.id}
                                onRowClick={(item) => setSearchParams({ table: item.id })}
                            />
                        </div>
                    </Card>
                )}

                {/* --- DATA VIEW --- */}
                {viewMode === 'data' && currentTable && !loading && (
                    <Card className={styles.card}>
                        <div style={{ padding: '8px 16px', backgroundColor: '#e1f0fa', fontSize: '12px', borderBottom: '1px solid #cce' }}>
                            {filterInfo}
                        </div>
                        <div className={styles.gridContainer}>
                            <SmartDataGrid
                                items={tableData}
                                columns={dynamicDataColumns}
                                getRowId={(item) => String(Math.random())}
                                selectionMode="single"
                            />
                        </div>
                    </Card>
                )}

                {/* --- SQL CONSOLE VIEW --- */}
                {viewMode === 'sql' && (
                    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 16 }}>
                        <Card>
                            <Text weight="semibold" style={{ marginBottom: 8 }}>SQL Query</Text>
                            <Textarea
                                value={sqlQuery}
                                onChange={e => setSqlQuery(e.target.value)}
                                className={styles.sqlEditor}
                                placeholder="SELECT * FROM sys_users..."
                            />
                            <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
                                <Button appearance="primary" icon={<Play24Regular />} onClick={executeSql} disabled={loading}>Spustit (F9)</Button>
                            </div>
                        </Card>

                        {sqlResult && (
                            <Card className={styles.card} style={{ flex: 1 }}>
                                {sqlResult.success ? (
                                    sqlResult.type === 'SELECT' ? (
                                        <div className={styles.gridContainer}>
                                            <SmartDataGrid
                                                items={sqlResult.data}
                                                columns={dynamicDataColumns}
                                                getRowId={() => String(Math.random())}
                                            />
                                        </div>
                                    ) : (
                                        <div style={{ padding: 20, color: 'green', fontWeight: 'bold' }}>
                                            ✓ {sqlResult.message}
                                        </div>
                                    )
                                ) : (
                                    <div style={{ padding: 20, color: 'red', fontWeight: 'bold', whiteSpace: 'pre-wrap' }}>
                                        ERROR: {sqlResult.error}
                                    </div>
                                )}
                            </Card>
                        )}
                    </div>
                )}

                {/* --- SETTINGS VIEW --- */}
                {viewMode === 'settings' && currentTable && !loading && (
                    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                        <Card style={{ width: '400px', padding: 20 }}>
                            <Title3>Standardy Tabulky</Title3>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 16 }}>
                                {/* Timestamps */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div>
                                        <Text weight="semibold">Časová razítka</Text>
                                        <div style={{ fontSize: '11px', color: '#666' }}>created_at, updated_at, created_by...</div>
                                    </div>
                                    {features.has_timestamps ? (
                                        <Badge color="success">Aktivní</Badge>
                                    ) : (
                                        <Button size="small" onClick={() => applyFeature('timestamps')}>Vytvořit</Button>
                                    )}
                                </div>
                                {/* Tenant */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div>
                                        <Text weight="semibold">Multitenancy</Text>
                                        <div style={{ fontSize: '11px', color: '#666' }}>sloupec tenant_id</div>
                                    </div>
                                    <Badge color={features.has_tenant ? 'success' : 'danger'}>
                                        {features.has_tenant ? 'Ano' : 'Ne'}
                                    </Badge>
                                </div>
                                {/* Soft Delete */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div>
                                        <Text weight="semibold">Soft Delete</Text>
                                        <div style={{ fontSize: '11px', color: '#666' }}>is_deleted = true</div>
                                    </div>
                                    <Button size="small" disabled>Nedostupné</Button>
                                </div>
                            </div>
                        </Card>
                    </div>
                )}
            </div>
        </div>
    );
};
