import React, { useEffect, useState, useMemo, useCallback } from 'react';
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
    BreadcrumbDivider,
    Menu,
    MenuTrigger,
    MenuList,
    MenuItem,
    MenuPopover
} from '@fluentui/react-components';
import type { TableColumnDefinition } from '@fluentui/react-components';
import {
    ArrowLeft24Regular,
    Table24Regular,
    ArrowClockwise24Regular,
    Code24Regular,
    Settings24Regular,
    Play24Regular,
    Filter24Regular,
    ChevronDown24Regular
} from '@fluentui/react-icons';

import { ActionBar } from '../components/ActionBar';
import { SmartDataGrid } from '../components/SmartDataGrid';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../context/TranslationContext';
import { PageLayout, PageHeader, PageContent } from '../components/PageLayout';
import { useKeyboardShortcut } from '../context/KeyboardShortcutsContext';
import { useHelp } from '../context/HelpContext';

const useStyles = makeStyles({
    gridContainer: {
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
    },
    filterBar: {
        padding: '8px 12px',
        color: tokens.colorNeutralForeground2,
        fontSize: '12px',
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        backgroundColor: tokens.colorNeutralBackground2,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
    },
    funkcePanel: {
        padding: '16px',
        backgroundColor: tokens.colorNeutralBackground2,
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        display: 'flex',
        flexDirection: 'column',
        gap: '12px'
    },
    sqlEditor: {
        width: '100%',
        fontFamily: 'Consolas, monospace',
        minHeight: '150px',
        border: `1px solid ${tokens.colorNeutralStroke1}`,
        borderRadius: tokens.borderRadiusMedium,
        padding: '12px',
        fontSize: '13px',
        resize: 'vertical'
    },
    sqlTemplates: {
        display: 'flex',
        gap: '8px',
        marginBottom: '12px',
        flexWrap: 'wrap'
    }
});

interface TableInfo {
    id: string;
    table_name: string;
    size: string;
    estimated_rows: string | number;
    description?: string;
}

// SQL Template Generator
const generateSqlTemplates = (tableName: string, columns: any[]) => {
    const pkCol = columns.find(c => c.column_name === 'id' || c.column_name === 'rec_id')?.column_name || 'id';
    const colNames = columns.map(c => c.column_name).slice(0, 5).join(', ');

    return {
        select: `SELECT ${colNames}\nFROM "${tableName}"\nWHERE 1=1\nLIMIT 50`,
        update: `UPDATE "${tableName}"\nSET column_name = 'new_value'\nWHERE ${pkCol} = ?`,
        insert: `INSERT INTO "${tableName}" (${colNames})\nVALUES (?, ?, ?, ?, ?)`,
        delete: `DELETE FROM "${tableName}"\nWHERE ${pkCol} = ?`
    };
};

export const TableBrowser: React.FC = () => {
    const styles = useStyles();
    const { getApiUrl, currentOrgId } = useAuth();
    const { t } = useTranslation();
    const { openHelp } = useHelp();
    const [searchParams, setSearchParams] = useSearchParams();
    const navigate = useNavigate();
    const orgPrefix = `/${currentOrgId || 'VACKR'}`;

    // Navigation State
    const currentTable = searchParams.get('table');
    const [viewMode, setViewMode] = useState<'data' | 'settings'>('data');
    const [showFunkce, setShowFunkce] = useState(false);

    // Data State
    const [tables, setTables] = useState<TableInfo[]>([]);
    const [tableData, setTableData] = useState<any[]>([]);
    const [columns, setColumns] = useState<any[]>([]);
    const [filterInfo, setFilterInfo] = useState<string>('');
    const [features, setFeatures] = useState<any>({});
    const [tableDescription, setTableDescription] = useState<string>('');

    // SQL State
    const [sqlQuery, setSqlQuery] = useState('');
    const [sqlResult, setSqlResult] = useState<any>(null);
    const [sqlTemplates, setSqlTemplates] = useState<any>({});

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // --- Keyboard Shortcuts ---
    const handleRefresh = useCallback(() => {
        if (currentTable) fetchTableData(currentTable);
        else fetchTables();
    }, [currentTable]);

    useKeyboardShortcut('refresh', handleRefresh, [currentTable]);
    useKeyboardShortcut('escape', () => {
        if (currentTable) setSearchParams({});
        else navigate(`${orgPrefix}/system`);
    }, [currentTable, orgPrefix]);
    useKeyboardShortcut('toggleFilters', () => setShowFunkce(prev => !prev), []);

    // --- Data Fetching ---
    useEffect(() => {
        if (currentTable) {
            if (viewMode !== 'settings') setViewMode('data');
            fetchTableData(currentTable);
        } else {
            fetchTables();
            setSqlQuery('');
            setSqlTemplates({});
        }
    }, [currentTable]);

    const fetchTables = async () => {
        setLoading(true);
        setError(null);
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
        setError(null);
        try {
            const res = await fetch(getApiUrl(`api-table-browser.php?action=get_data&table=${tableName}`));
            const json = await res.json();
            if (json.success) {
                setColumns(json.columns);
                setTableData(json.data);
                setFilterInfo(json.filter_active);
                setFeatures(json.features || {});
                setTableDescription(json.description || '');

                // Generate SQL templates
                const templates = generateSqlTemplates(tableName, json.columns);
                setSqlTemplates(templates);
                setSqlQuery(templates.select);
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

    // --- Column Definitions ---
    const dynamicDataColumns = useMemo(() => {
        const cols = sqlResult?.columns || columns;
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
                if (val === null) return <span style={{ color: '#ccc', fontStyle: 'italic' }}>NULL</span>;
                if (typeof val === 'object') return <span style={{ fontFamily: 'monospace', fontSize: '11px' }}>{JSON.stringify(val).substring(0, 40)}...</span>;
                return <span style={{ fontFamily: 'monospace' }}>{String(val)}</span>;
            }
        }));
    }, [columns, sqlResult]);

    const tableListColumns: TableColumnDefinition<TableInfo>[] = [
        createTableColumn({
            columnId: 'table_name',
            compare: (a, b) => a.table_name.localeCompare(b.table_name),
            renderHeaderCell: () => t('common.name'),
            renderCell: (item) => (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Table24Regular />
                    <div>
                        <Text weight="semibold">{item.table_name}</Text>
                        {item.description && (
                            <div style={{ fontSize: '11px', color: tokens.colorNeutralForeground3 }}>{item.description}</div>
                        )}
                    </div>
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

    // --- Render ---
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
                {/* LEFT: Actions Menu (when table selected) */}
                {currentTable && (
                    <>
                        <Menu>
                            <MenuTrigger>
                                <Button appearance="primary" icon={<ChevronDown24Regular />} iconPosition="after">Akce</Button>
                            </MenuTrigger>
                            <MenuPopover>
                                <MenuList>
                                    <MenuItem onClick={() => setViewMode('data')}>Zobrazit data</MenuItem>
                                    <MenuItem onClick={() => setViewMode('settings')}>Vlastnosti tabulky</MenuItem>
                                </MenuList>
                            </MenuPopover>
                        </Menu>
                        <div style={{ width: 1, height: 24, backgroundColor: tokens.colorNeutralStroke2, margin: '0 8px' }} />
                    </>
                )}

                {/* Refresh (icon-only, with title) */}
                <Button
                    icon={<ArrowClockwise24Regular />}
                    appearance="subtle"
                    onClick={handleRefresh}
                    title={t('common.refresh')}
                />

                <div style={{ flex: 1 }} />

                {/* RIGHT: Funkce Toggle */}
                <div style={{ width: 1, height: 24, backgroundColor: tokens.colorNeutralStroke2, margin: '0 8px' }} />
                <Button
                    appearance={showFunkce ? 'primary' : 'subtle'}
                    icon={<Filter24Regular />}
                    onClick={() => setShowFunkce(prev => !prev)}
                >
                    Funkce
                </Button>
            </ActionBar>

            {/* FUNKCE Panel (SQL Console + Tools) */}
            {showFunkce && (
                <div className={styles.funkcePanel}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                        <Code24Regular />
                        <Text weight="semibold">SQL Konzole</Text>
                        {currentTable && (
                            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                                Tabulka: {currentTable}
                            </Text>
                        )}
                    </div>

                    {/* SQL Templates */}
                    {currentTable && Object.keys(sqlTemplates).length > 0 && (
                        <div className={styles.sqlTemplates}>
                            <Text size={200}>Šablony:</Text>
                            <Button size="small" appearance="subtle" onClick={() => setSqlQuery(sqlTemplates.select)}>SELECT</Button>
                            <Button size="small" appearance="subtle" onClick={() => setSqlQuery(sqlTemplates.insert)}>INSERT</Button>
                            <Button size="small" appearance="subtle" onClick={() => setSqlQuery(sqlTemplates.update)}>UPDATE</Button>
                            <Button size="small" appearance="subtle" onClick={() => setSqlQuery(sqlTemplates.delete)}>DELETE</Button>
                        </div>
                    )}

                    <Textarea
                        value={sqlQuery}
                        onChange={e => setSqlQuery(e.target.value)}
                        className={styles.sqlEditor}
                        placeholder="SELECT * FROM sys_users LIMIT 10..."
                    />
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                        <Button appearance="primary" icon={<Play24Regular />} onClick={executeSql} disabled={loading}>
                            Spustit SQL (F9)
                        </Button>
                    </div>

                    {sqlResult && (
                        <div style={{ marginTop: 12 }}>
                            {sqlResult.success ? (
                                sqlResult.type === 'SELECT' ? (
                                    <div style={{ maxHeight: 300, overflow: 'auto', border: `1px solid ${tokens.colorNeutralStroke1}`, borderRadius: 4 }}>
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

            <PageContent>
                {loading && <div style={{ textAlign: 'center', padding: 20 }}><Spinner label="Pracuji..." /></div>}
                {error && <MessageBar intent="error" style={{ marginBottom: 16 }}>{error}</MessageBar>}

                {!loading && !error && (
                    <>
                        {/* 1. TABLE LIST */}
                        {!currentTable && (
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
                                    <div>
                                        {filterInfo} • {tableData.length} zobrazeno (limit 500)
                                    </div>
                                    {tableDescription && (
                                        <div style={{ fontStyle: 'italic', color: tokens.colorNeutralForeground3 }}>
                                            {tableDescription}
                                        </div>
                                    )}
                                </div>
                                <SmartDataGrid
                                    items={tableData}
                                    columns={dynamicDataColumns}
                                    getRowId={() => String(Math.random())}
                                    selectionMode="single"
                                />
                            </div>
                        )}

                        {/* 3. SETTINGS VIEW */}
                        {currentTable && viewMode === 'settings' && (
                            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', padding: '16px 0' }}>
                                <div style={{ width: '400px', border: `1px solid ${tokens.colorNeutralStroke1}`, padding: 20, borderRadius: tokens.borderRadiusMedium }}>
                                    <Title3>Standardy Tabulky: {currentTable}</Title3>
                                    {tableDescription && (
                                        <Text size={200} style={{ display: 'block', marginTop: 8, color: tokens.colorNeutralForeground3, fontStyle: 'italic' }}>
                                            {tableDescription}
                                        </Text>
                                    )}
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
