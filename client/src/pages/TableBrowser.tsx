import React, { useEffect, useState, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
    makeStyles,
    Button,
    Title3,
    Text,
    Spinner,
    createTableColumn,
    Badge,
    Textarea,
    tokens,
    MessageBar,
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbButton,
    BreadcrumbDivider
} from '@fluentui/react-components';
import type { TableColumnDefinition } from '@fluentui/react-components';
import {
    ArrowLeft24Regular,
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
import { PageLayout, PageHeader, PageContent } from '../components/PageLayout';

const useStyles = makeStyles({
    gridContainer: {
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
    },
    filterBar: {
        padding: '8px 4px',
        color: tokens.colorNeutralForeground2,
        fontSize: '12px',
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        backgroundColor: tokens.colorNeutralBackground2
    },
    sqlEditor: {
        width: '100%',
        fontFamily: 'monospace',
        minHeight: '120px',
        marginBottom: '16px',
        border: `1px solid ${tokens.colorNeutralStroke1}`,
        borderRadius: tokens.borderRadiusMedium,
        padding: '8px'
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
    const { getApiUrl, currentOrgId } = useAuth();
    const { t } = useTranslation();
    const [searchParams, setSearchParams] = useSearchParams();
    const navigate = useNavigate();
    const orgPrefix = `/${currentOrgId || 'VACKR'}`;

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
            // Only force data view if not already in SQL/Settings or just navigating
            if (viewMode !== 'sql' && viewMode !== 'settings') setViewMode('data');

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
        <PageLayout>
            <PageHeader>
                <Breadcrumb>
                    <BreadcrumbItem>
                        <BreadcrumbButton onClick={() => navigate(`${orgPrefix}/system`)}>Systém</BreadcrumbButton>
                    </BreadcrumbItem>
                    <BreadcrumbDivider />
                    <BreadcrumbItem>
                        <BreadcrumbButton onClick={() => setSearchParams({})}>Prohlížeč tabulek</BreadcrumbButton>
                    </BreadcrumbItem>
                    {currentTable && (
                        <>
                            <BreadcrumbDivider />
                            <BreadcrumbItem>
                                <BreadcrumbButton current>{currentTable}</BreadcrumbButton>
                            </BreadcrumbItem>
                        </>
                    )}
                </Breadcrumb>
            </PageHeader>

            <ActionBar>
                {currentTable && (
                    <>
                        <Button appearance="subtle" icon={<ArrowLeft24Regular />} onClick={() => setSearchParams({})}>Zpět</Button>
                        <div style={{ width: 1, height: 24, backgroundColor: tokens.colorNeutralStroke2, margin: '0 8px' }} />

                        <Button appearance={viewMode === 'data' ? 'primary' : 'subtle'} icon={<Table24Regular />} onClick={() => setViewMode('data')}>Data</Button>
                        <Button appearance={viewMode === 'settings' ? 'primary' : 'subtle'} icon={<Settings24Regular />} onClick={() => setViewMode('settings')}>Vlastnosti</Button>
                    </>
                )}

                <div style={{ flex: 1 }} />

                <Button appearance={viewMode === 'sql' ? 'primary' : 'subtle'} icon={<Code24Regular />} onClick={() => setViewMode('sql')}>SQL Konzole</Button>
                <div style={{ width: 1, height: 24, backgroundColor: tokens.colorNeutralStroke2, margin: '0 8px' }} />
                <Button icon={<ArrowClockwise24Regular />} appearance="subtle" onClick={() => currentTable ? fetchTableData(currentTable) : fetchTables()}>Obnovit</Button>
            </ActionBar>

            <PageContent>
                {loading && <div style={{ textAlign: 'center', padding: 20 }}><Spinner label="Pracuji..." /></div>}
                {error && <MessageBar intent="error" style={{ marginBottom: 16 }}>{error}</MessageBar>}

                {!loading && !error && (
                    <>
                        {/* 1. TABLE LIST */}
                        {!currentTable && viewMode !== 'sql' && (
                            <SmartDataGrid
                                items={tables}
                                columns={tableListColumns}
                                getRowId={(item: any) => item.id}
                                onRowClick={(item) => setSearchParams({ table: item.id })}
                            />
                        )}

                        {/* 2. DATA VIEW */}
                        {currentTable && viewMode === 'data' && (
                            <div className={styles.gridContainer}>
                                <div className={styles.filterBar}>
                                    {filterInfo} &bull; {tableData.length} zobrazeno (limit 500)
                                </div>
                                <SmartDataGrid
                                    items={tableData}
                                    columns={dynamicDataColumns}
                                    getRowId={() => String(Math.random())}
                                    selectionMode="single"
                                />
                            </div>
                        )}

                        {/* 3. SQL VIEW */}
                        {viewMode === 'sql' && (
                            <div className={styles.gridContainer}>
                                <Textarea
                                    value={sqlQuery}
                                    onChange={e => setSqlQuery(e.target.value)}
                                    className={styles.sqlEditor}
                                    placeholder="SELECT * FROM sys_users LIMIT 10..."
                                />
                                <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-end' }}>
                                    <Button appearance="primary" icon={<Play24Regular />} onClick={executeSql} disabled={loading}>Spustit SQL (F9)</Button>
                                </div>

                                {sqlResult && (
                                    <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                                        {sqlResult.success ? (
                                            sqlResult.type === 'SELECT' ? (
                                                <div style={{ flex: 1, overflow: 'hidden' }}>
                                                    <SmartDataGrid items={sqlResult.data} columns={dynamicDataColumns} getRowId={() => String(Math.random())} />
                                                </div>
                                            ) : (
                                                <MessageBar intent="success">✓ {sqlResult.message}</MessageBar>
                                            )
                                        ) : (
                                            <MessageBar intent="error">
                                                <Text style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>ERROR: {sqlResult.error}</Text>
                                            </MessageBar>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* 4. SETTINGS VIEW */}
                        {currentTable && viewMode === 'settings' && (
                            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', padding: '16px 0' }}>
                                <div style={{ width: '400px', border: `1px solid ${tokens.colorNeutralStroke1}`, padding: 20, borderRadius: tokens.borderRadiusMedium }}>
                                    <Title3>Standardy Tabulky</Title3>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 16 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <div>
                                                <Text weight="semibold">Časová razítka</Text>
                                                <div style={{ fontSize: '11px', color: '#666' }}>created_at, updated_at...</div>
                                            </div>
                                            {features.has_timestamps ? (
                                                <Badge color="success">Aktivní</Badge>
                                            ) : (
                                                <Button size="small" onClick={() => applyFeature('timestamps')}>Vytvořit</Button>
                                            )}
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <div>
                                                <Text weight="semibold">Multitenancy</Text>
                                                <div style={{ fontSize: '11px', color: '#666' }}>tenant_id</div>
                                            </div>
                                            <Badge color={features.has_tenant ? 'success' : 'danger'}>
                                                {features.has_tenant ? 'Ano' : 'Ne'}
                                            </Badge>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </PageContent>
        </PageLayout>
    );
};
