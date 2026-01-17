import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
    Title3,
    Card,
    CardHeader,
    Text,
    Badge,
    Spinner,
    Button,
    makeStyles,
    Title2,
    Divider,
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbButton,
    BreadcrumbDivider,
    shorthands,
    tokens,
    MessageBar,
    MessageBarTitle,
    MessageBarBody
} from '@fluentui/react-components';
import { MenuSection, MenuItem } from '../components/MenuSection';
import {
    Settings24Regular,
    ArrowLeft24Regular,
    ArrowClockwise24Regular,
    ChevronDown16Regular,
    ChevronUp16Regular,
    Shield24Regular,
    Document24Regular,
    DocumentPdf24Regular,
    TaskListSquareLtr24Regular,
    Desktop24Regular,
    Beaker24Regular
} from '@fluentui/react-icons';

import { ActionBar } from '../components/ActionBar';
import { useTranslation } from '../context/TranslationContext';
import { useAuth } from '../context/AuthContext';

const useStyles = makeStyles({
    root: {
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
    },
    container: {
        padding: '24px',
        display: 'flex',
        flexDirection: 'column',
        gap: '24px',
        flex: 1,
        overflow: 'auto'
    },
    grid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))',
        gap: '24px'
    },
    card: {
        height: '100%',
        ...shorthands.padding('20px')
    },
    row: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '8px 0',
        borderBottom: '1px solid #f0f0f0'
    },
    label: {
        color: '#605e5c',
        fontWeight: 600
    },
    value: {
        fontFamily: 'monospace'
    },
    schemaTable: {
        marginTop: '10px',
        marginBottom: '20px'
    },
    schemaCol: {
        display: 'grid',
        gridTemplateColumns: '150px 100px 1fr',
        gap: '10px',
        padding: '4px 0',
        borderBottom: '1px solid #eee',
        fontSize: '13px'
    },
    menuGroup: {
        display: 'flex',
        flexDirection: 'column',
        gap: '8px'
    },
    // New Mobile Scroll Layout Styles
    scrollContainer: {
        display: 'flex',
        gap: '32px',
        flexWrap: 'wrap',
        alignItems: 'flex-start',
        '@media (max-width: 800px)': {
            flexWrap: 'nowrap',
            overflowX: 'auto',
            paddingBottom: '20px', // Space for scrollbar
            scrollSnapType: 'x mandatory',
            gap: '16px',
            scrollPadding: '24px' // Padding for snap alignment
        }
    },
    scrollColumn: {
        flex: '1 1 300px',
        display: 'flex',
        flexDirection: 'column',
        gap: '0px',
        '@media (max-width: 800px)': {
            flex: '0 0 85vw', // Take most of width but show hint of next column
            scrollSnapAlign: 'start',
            minWidth: 'auto'
        }
    }
});

interface SystemData {
    overview: {
        php_version: string;
        server_software: string;
        db_status: string;
        server_time: string;
    };
    session: {
        id: string;
        handler: string;
        persisted_in_db: boolean;
        data_length: number;
        cookie_params: any;
        current_user: any;
    };
    request: {
        is_https: boolean;
        remote_addr: string;
    };
    dms_checks?: Record<string, { label: string, value: string, status?: 'success' | 'danger' | 'warning' }>;
}

export const SystemConfig: React.FC = () => {
    const styles = useStyles();
    const navigate = useNavigate();
    const { t } = useTranslation();
    const { currentOrgId } = useAuth();
    const orgPrefix = `/${currentOrgId || 'VACKR'}`;

    const [searchParams, setSearchParams] = useSearchParams();

    // Derived State from URL
    const activeView = searchParams.get('view');
    const docId = searchParams.get('doc');

    const [viewTitle, setViewTitle] = useState<string>("");

    // Helper to switch view updates URL
    const navigateToView = (view: string, title: string, extraParams: Record<string, string> = {}) => {
        setViewTitle(t(title));
        setSearchParams({ view, ...extraParams });
    };

    const [data, setData] = useState<SystemData | null>(null);
    const [loading, setLoading] = useState(false); // Default false, fetch on mount
    const [error, setError] = useState<string | null>(null);

    // DB Update State
    const [updatingDB, setUpdatingDB] = useState(false);
    const [migrationResult, setMigrationResult] = useState<any>(null);
    const [docContent, setDocContent] = useState<string>('');
    const [historyData, setHistoryData] = useState<any>(null);


    const handleUpdateDB = async () => {
        if (!confirm(t('system.update_db.confirm'))) return;
        setUpdatingDB(true);
        setMigrationResult(null);

        try {
            const res = await fetch('/api/install-db.php?token=shanon2026install');
            // Store text first to handle both success JSON and PHP error HTML
            const text = await res.text();

            try {
                const data = JSON.parse(text);
                setMigrationResult(data);
                if (data.success) {
                    fetchData(); // Refresh diagnostics if successful
                }
            } catch (jsonError) {
                console.error("Invalid JSON from install-db.php:", text);
                setMigrationResult({
                    success: false,
                    error: "Invalid Server Response (PHP Error?)",
                    details: [text.substring(0, 800)] // Show snippet of raw output
                });
            }
        } catch (networkError: any) {
            setMigrationResult({ success: false, error: networkError.message || 'Network error' });
        } finally {
            setUpdatingDB(false);
        }
    };


    const fetchData = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/api-system.php?action=diagnostics');
            const json = await res.json();
            if (json.success) {
                setData(json.data);
            } else {
                setError(json.error || 'Failed to load diagnostics');
            }
        } catch (e) {
            setError('Network error');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        // Initial Fetch for dashboard widgets
        if (!activeView) fetchData();

        // Load Specific Data based on URL View
        if (activeView === 'doc_viewer' && docId) {
            fetchDoc(docId);
        }
        if (activeView === 'history_viewer') {
            fetchHistory();
        }
        if (activeView === 'seeders') {
            fetchSeeders();
        }
    }, [activeView, docId]); // React to URL changes

    const fetchDoc = async (file: string) => {
        setLoading(true);
        // Title logic: Try to guess title or keep generic
        if (!viewTitle) setViewTitle(file);

        try {
            const res = await fetch(`/api/api-system.php?action=get_doc&file=${file}`);
            const json = await res.json();
            if (json.success) setDocContent(json.content);
            else setDocContent('Error loading document: ' + (json.error || 'Unknown'));
        } catch (e: any) { setDocContent('Network Error: ' + e.message); }
        setLoading(false);
    };

    const fetchHistory = async () => {
        setLoading(true);
        setViewTitle('Historie změn');
        try {
            const res = await fetch(`/api/api-system.php?action=history`);
            const json = await res.json();
            if (json.success) setHistoryData(json);
        } catch (e) { setError('Network Error'); }
        setLoading(false);
    };

    // --- RENDERERS ---

    const renderDocView = () => (
        <Card className={styles.card} style={{ height: 'calc(100vh - 200px)' }}>
            <CardHeader header={<Title3>{viewTitle}</Title3>} />
            <div style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', backgroundColor: '#f9f9f9', padding: '16px', borderRadius: '4px', overflow: 'auto', flex: 1 }}>
                {docContent}
            </div>
        </Card>
    );

    const renderHistoryView = () => (
        <div className={styles.grid}>
            <Card className={styles.card}>
                <CardHeader header={<Title3>Development History</Title3>} />
                <div style={{ maxHeight: '600px', overflow: 'auto' }}>
                    {historyData?.history?.map((h: any) => (
                        <div key={h.id} style={{ borderBottom: '1px solid #eee', padding: '12px 0' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <Text weight="bold">{h.date}</Text>
                                <Badge appearance="tint">{h.category}</Badge>
                            </div>
                            <Text weight="semibold" style={{ display: 'block', margin: '4px 0' }}>{h.title}</Text>
                            <Text style={{ color: tokens.colorNeutralForeground2 }}>{h.description}</Text>
                        </div>
                    ))}
                </div>
            </Card>
            <Card className={styles.card}>
                <CardHeader header={<Title3>Recent Requests</Title3>} />
                <div style={{ maxHeight: '600px', overflow: 'auto' }}>
                    {historyData?.requests?.map((r: any) => (
                        <div key={r.rec_id} style={{ borderBottom: '1px solid #eee', padding: '8px 0' }}>
                            <Text>#{r.rec_id} {r.subject}</Text>
                            <div style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>
                                <Badge size="extra-small" appearance="outline">{r.status}</Badge> priority: {r.priority}
                            </div>
                        </div>
                    ))}
                </div>
            </Card>
        </div>
    );


    const StatusRow = ({ label, value, status }: { label: string, value: any, status?: 'success' | 'danger' | 'warning' }) => (
        <div className={styles.row}>
            <Text className={styles.label}>{t(label) === label ? label : t(label)}</Text>
            {status ? (
                <Badge appearance="tint" color={status}>{String(value)}</Badge>
            ) : (
                <Text className={styles.value}>{String(value)}</Text>
            )}
        </div>
    );

    const renderDiagnostics = () => {
        if (loading && !data) return <div style={{ padding: '40px', textAlign: 'center' }}><Spinner label={t('common.loading')} /></div>;
        if (error) return <div style={{ padding: '24px' }}><Text style={{ color: 'red' }}>{error}</Text></div>;

        const isPersisted = data!.session.persisted_in_db;
        const isConnected = data!.overview.db_status.startsWith('Connected');

        return (
            <div className={styles.grid}>
                <Card className={styles.card}>
                    <CardHeader header={<Text weight="semibold">{t('system.session_diag')}</Text>} />
                    <div>
                        <StatusRow
                            label="system.db_persisted"
                            value={isPersisted ? t('system.yes') : t('system.no')}
                            status={isPersisted ? 'success' : 'danger'}
                        />
                        <StatusRow label="system.session_id" value={data?.session.id ? (data.session.id.substring(0, 10) + '...') : ''} />
                        <StatusRow label="system.db_handler" value={data?.session.handler} />
                    </div>
                </Card>

                <Card className={styles.card}>
                    <CardHeader header={<Text weight="semibold">{t('system.server_db')}</Text>} />
                    <div>
                        <StatusRow
                            label="system.database"
                            value={isConnected ? t('system.connected') : data?.overview.db_status}
                            status={isConnected ? 'success' : 'danger'}
                        />
                        <StatusRow label="system.php_version" value={data?.overview.php_version} />
                        <StatusRow label="system.server_time" value={data?.overview.server_time} />
                    </div>
                </Card>

                <Card className={styles.card}>
                    <CardHeader header={<Text weight="semibold">DMS & Modules Health</Text>} />
                    <div>
                        {data?.dms_checks && Object.values(data.dms_checks).map((check: any, i) => (
                            <StatusRow
                                key={i}
                                label={check.label}
                                value={check.value}
                                status={check.status}
                            />
                        ))}
                    </div>
                </Card>
            </div>
        );
    };

    const renderSchema = () => {
        const schema = [
            {
                category: "1. System Core",
                tables: [
                    { name: "sys_users", cols: [["rec_id", "PK"], ["tenant_id", "UUID"], ["username", "VARCHAR"], ["roles", "JSON"]] },
                    { name: "sys_sessions", cols: [["id", "PK"], ["data", "TEXT"], ["access", "INT"]] },
                    { name: "sys_number_series", cols: [["code", "VARCHAR (Unique)"], ["format", "VARCHAR"], ["last_n", "INT"]] },
                ]
            },
            {
                category: "2. Change Management",
                tables: [
                    { name: "sys_change_requests", cols: [["rec_id", "PK"], ["subject", "VARCHAR"], ["status", "ENUM"], ["priority", "ENUM"]] },
                    { name: "sys_change_requests_files", cols: [["rec_id", "PK"], ["cr_id", "FK"], ["file_data", "TEXT"]] },
                    { name: "development_history", cols: [["id", "PK"], ["date", "DATE"], ["category", "ENUM"], ["related_task", "FK"]] },
                ]
            },
            {
                category: "3. Document Management",
                tables: [
                    { name: "dms_documents", cols: [["rec_id", "PK"], ["display_name", "VARCHAR"], ["ocr_status", "ENUM"], ["metadata", "JSONB"]] },
                    { name: "dms_doc_types", cols: [["code", "PK/Unique"], ["icon", "VARCHAR"]] }
                ]
            }
        ];

        return (
            <div>
                <Title2 style={{ marginBottom: '20px' }}>Database Schema Documentation</Title2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
                    {schema.map(cat => (
                        <div key={cat.category}>
                            <Title3>{cat.category}</Title3>
                            <Divider style={{ margin: '10px 0' }} />
                            <div className={styles.grid}>
                                {cat.tables.map(t => (
                                    <Card key={t.name} className={styles.card}>
                                        <CardHeader header={<Text weight="bold" font="monospace">{t.name}</Text>} />
                                        <div className={styles.schemaTable}>
                                            {t.cols.map((col, i) => (
                                                <div key={i} className={styles.schemaCol}>
                                                    <Text weight="semibold">{col[0]}</Text>
                                                    <Text style={{ color: '#0078d4' }}>{col[1]}</Text>
                                                </div>
                                            ))}
                                        </div>
                                    </Card>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    // System Groups Definition
    const SECTION_IDS = ['admin', 'docs', 'testing', 'security', 'reports', 'tasks', 'settings'];
    // Default: All expanded (standard behavior)
    const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(SECTION_IDS));

    const toggleSection = (id: string) => {
        const next = new Set(expandedSections);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setExpandedSections(next);
    };

    const expandAll = () => setExpandedSections(new Set(SECTION_IDS));
    const collapseAll = () => setExpandedSections(new Set());

    // --- SEEDER LOGIC ---
    const [seeders, setSeeders] = useState<any[]>([]);
    const [selectedSeeders, setSelectedSeeders] = useState<Set<string>>(new Set());
    const [seeding, setSeeding] = useState(false);

    const fetchSeeders = async () => {
        try {
            const res = await fetch('/api/api-system.php?action=seeders_list');
            const json = await res.json();
            if (json.success) setSeeders(json.data);
        } catch (e) {
            console.error(e);
        }
    };

    const runSeeding = async () => {
        if (selectedSeeders.size === 0) return;
        setSeeding(true);
        setMigrationResult(null);
        try {
            const res = await fetch('/api/api-system.php?action=run_seeders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ids: Array.from(selectedSeeders),
                    org_id: currentOrgId
                })
            });
            const json = await res.json();
            if (json.success) {
                setMigrationResult({
                    success: true,
                    message: `Data úspěšně naplněna (${selectedSeeders.size} sad)`,
                    details: json.results || []
                });
            } else {
                setMigrationResult({
                    success: false,
                    error: json.error || 'Neznámá chyba'
                });
            }
        } catch (e) {
            setMigrationResult({
                success: false,
                error: 'Chyba sítě nebo serveru'
            });
        } finally {
            setSeeding(false);
        }
    };

    const renderSeeders = () => (
        <Card className={styles.card} style={{ maxWidth: 800 }}>
            <CardHeader header={<Title3>Inicializace standardních dat (Seeders)</Title3>} />
            <Text>Vyberte sady dat, které chcete nahrát do aktuální organizace. Existující klíče nebudou přepsány.</Text>
            <Divider style={{ margin: '12px 0' }} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {seeders.map(s => {
                    const isSelected = selectedSeeders.has(s.id);
                    return (
                        <Card key={s.id}
                            onClick={() => {
                                const next = new Set(selectedSeeders);
                                if (isSelected) next.delete(s.id); else next.add(s.id);
                                setSelectedSeeders(next);
                            }}
                            style={{
                                cursor: 'pointer',
                                border: isSelected ? `2px solid ${tokens.colorBrandBackground}` : '1px solid #eee',
                                padding: 12
                            }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div>
                                    <Text weight="semibold">{s.name}</Text>
                                    <div style={{ fontSize: '12px', color: '#666' }}>{s.description}</div>
                                </div>
                                {isSelected && <Badge appearance="filled" color="brand">Vybráno</Badge>}
                            </div>
                        </Card>
                    );
                })}
            </div>

            <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
                <Button appearance="primary" disabled={seeding || selectedSeeders.size === 0} onClick={runSeeding}>
                    {seeding ? 'Provádím...' : `Naplnit vybrané (${selectedSeeders.size})`}
                </Button>
            </div>
        </Card>
    );


    const renderDashboard = () => (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* 3-Column Layout (Responsive Flex with Mobile Scroll) */}
            <div className={styles.scrollContainer}>

                {/* Column 1 */}
                {/* Column 1 */}
                <div className={styles.scrollColumn}>
                    {/* 1. ADMIN TOOLS */}
                    <MenuSection id="admin" title={t('system.group.admin')} icon={<Desktop24Regular />} isOpen={expandedSections.has('admin')} onToggle={toggleSection}>
                        <MenuItem label={t('system.item.diagnostics')} onClick={() => navigateToView('diagnostics', 'system.item.diagnostics')} />
                        <MenuItem label={t('system.item.sessions')} onClick={() => alert(t('common.working'))} />
                        <MenuItem label={t('dms.settings.number_series')} onClick={() => alert(t('common.working'))} />
                        <MenuItem label="Správa uživatelů" onClick={() => navigate(orgPrefix + '/system/users')} />
                        <MenuItem label="Organizace a Subjekty" onClick={() => navigate(orgPrefix + '/system/organizations')} />
                    </MenuSection>

                    {/* 2. DOCS */}
                    <MenuSection id="docs" title={t('system.group.docs')} icon={<Document24Regular />} isOpen={expandedSections.has('docs')} onToggle={toggleSection}>
                        <MenuItem label={t('system.item.db_docs')} onClick={() => navigateToView('schema', 'system.item.db_docs')} />
                        <MenuItem label={t('system.item.manifest')} onClick={() => navigateToView('doc_viewer', 'system.item.manifest', { doc: 'manifest' })} />
                        <MenuItem label="UI/UX Standardy" onClick={() => navigateToView('doc_viewer', 'Standardy Formulářů', { doc: 'form_standard' })} />
                        <MenuItem label={t('system.item.security')} onClick={() => navigateToView('doc_viewer', 'system.item.security', { doc: 'security' })} />
                        <MenuItem label={t('system.item.history')} onClick={() => navigateToView('history_viewer', 'system.item.history')} />
                        <MenuItem label={t('system.item.help')} onClick={() => alert(t('common.working'))} />
                    </MenuSection>
                </div>

                {/* Column 2 */}
                <div className={styles.scrollColumn}>
                    {/* TEST MANAGEMENT */}
                    <MenuSection id="testing" title="Testování (QA)" icon={<Beaker24Regular />} isOpen={expandedSections.has('testing')} onToggle={toggleSection}>
                        <MenuItem label="Testovací scénáře" onClick={() => navigate(orgPrefix + '/system/testing')} />
                    </MenuSection>

                    {/* 4. REPORTS */}
                    <MenuSection id="reports" title={t('system.menu.reports')} icon={<DocumentPdf24Regular />} isOpen={expandedSections.has('reports')} onToggle={toggleSection}>
                        <MenuItem label={t('system.item.audit_log')} onClick={() => alert(t('common.working'))} />
                        <MenuItem label={t('system.item.performance_stats')} onClick={() => alert(t('common.working'))} />
                    </MenuSection>

                    {/* 5. TASKS */}
                    <MenuSection id="tasks" title={t('system.menu.tasks')} icon={<TaskListSquareLtr24Regular />} isOpen={expandedSections.has('tasks')} onToggle={toggleSection}>
                        <MenuItem label={t('system.item.cron_jobs')} onClick={() => alert(t('common.working'))} />
                        <MenuItem label={t('system.item.run_indexing')} onClick={() => alert(t('common.working'))} />
                        <MenuItem label="Kvalita kódu & Audit" onClick={() => navigate(orgPrefix + '/system/audit')} />
                        <MenuItem label={t('system.item.update_db')} onClick={() => handleUpdateDB()} disabled={updatingDB} />
                    </MenuSection>
                </div>

                {/* Column 3 */}
                <div className={styles.scrollColumn}>
                    {/* 3. SECURITY */}
                    {/* 3. SECURITY */}
                    <MenuSection id="security" title={t('system.group.security')} icon={<Shield24Regular />} isOpen={expandedSections.has('security')} onToggle={toggleSection}>
                        <MenuItem label="Správa rolí" onClick={() => navigate(orgPrefix + '/system/security-roles')} />
                    </MenuSection>

                    {/* 6. SETTINGS */}
                    {/* 6. SETTINGS */}
                    <MenuSection id="settings" title={t('system.menu.settings')} icon={<Settings24Regular />} isOpen={expandedSections.has('settings')} onToggle={toggleSection}>
                        <MenuItem label={t('system.item.global_params')} onClick={() => alert('Settings')} />
                        <MenuItem label="Překlady" onClick={() => navigate(orgPrefix + '/system/translations')} />
                        <MenuItem label="Inicializace dat (Seeders)" onClick={() => navigateToView('seeders', 'Inicializace dat')} />
                    </MenuSection>
                </div>

            </div>

            {/* MIGRATION RESULT MODAL (Keep generic) */}
            {migrationResult && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
                }}>
                    <Card style={{ maxWidth: '600px', width: '90%', maxHeight: '80vh', padding: '24px', display: 'flex', flexDirection: 'column' }}>
                        <Title3>Výsledek aktualizace</Title3>
                        <Divider style={{ margin: '12px 0' }} />

                        <div style={{ overflowY: 'auto', flex: 1, marginBottom: '16px' }}>
                            <MessageBar intent={migrationResult.success ? 'success' : 'error'}>
                                <MessageBarBody>
                                    <MessageBarTitle>{migrationResult.success ? 'Úspěch' : 'Chyba'}</MessageBarTitle>
                                    {migrationResult.message || migrationResult.error}
                                </MessageBarBody>
                            </MessageBar>
                            {migrationResult.details && (
                                <div style={{ marginTop: '16px', backgroundColor: '#f5f5f5', padding: '12px', borderRadius: '4px' }}>
                                    <Text weight="semibold">Detaily:</Text>
                                    <ul style={{ margin: '8px 0', paddingLeft: '20px', fontSize: '12px' }}>
                                        {Array.isArray(migrationResult.details)
                                            ? migrationResult.details.map((msg: string, i: number) => <li key={i}>{msg}</li>)
                                            : <li>{String(migrationResult.details)}</li>
                                        }
                                    </ul>
                                </div>
                            )}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <Button appearance="primary" onClick={() => setMigrationResult(null)}>Zavřít</Button>
                        </div>
                    </Card>
                </div>
            )}
        </div>
    );

    return (
        <div className={styles.root}>
            <ActionBar>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    {activeView && (
                        <Button icon={<ArrowLeft24Regular />} appearance="subtle" onClick={() => setSearchParams({})} />
                    )}
                    <Breadcrumb>
                        <BreadcrumbItem>
                            <BreadcrumbButton onClick={() => navigate(orgPrefix + '/dashboard')}>{t('common.modules')}</BreadcrumbButton>
                        </BreadcrumbItem>
                        <BreadcrumbDivider />
                        <BreadcrumbItem>
                            <BreadcrumbButton onClick={() => setSearchParams({})}>{t('modules.system')}</BreadcrumbButton>
                        </BreadcrumbItem>
                        {activeView && (
                            <>
                                <BreadcrumbDivider />
                                <BreadcrumbItem>
                                    <Text weight="semibold">{viewTitle || activeView}</Text>
                                </BreadcrumbItem>
                            </>
                        )}
                    </Breadcrumb>
                </div>
                <div style={{ flex: 1 }} />
                {!activeView && (
                    <div style={{ display: 'flex', gap: '8px', marginRight: '16px' }}>
                        <Button appearance="subtle" icon={<ChevronDown16Regular />} onClick={expandAll}>{t('system.expand_all')}</Button>
                        <Button appearance="subtle" icon={<ChevronUp16Regular />} onClick={collapseAll}>{t('system.collapse_all')}</Button>
                        <Divider vertical style={{ height: '20px', margin: 'auto 0' }} />
                    </div>
                )}
                <Button icon={<ArrowClockwise24Regular />} onClick={fetchData}>Obnovit</Button>
            </ActionBar>

            <div className={styles.container}>
                {!activeView && renderDashboard()}
                {activeView === 'diagnostics' && renderDiagnostics()}
                {activeView === 'schema' && renderSchema()}
                {activeView === 'doc_viewer' && renderDocView()}
                {activeView === 'history_viewer' && renderHistoryView()}
                {activeView === 'seeders' && renderSeeders()}
            </div>
        </div>
    );
};
