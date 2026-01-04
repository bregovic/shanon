import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
import {
    Settings24Regular,
    Poll24Regular,
    TaskListSquareLtr24Regular,
    ChevronRight16Regular,
    ArrowLeft24Regular,
    ArrowClockwise24Regular,
    Document24Regular,
    ChevronDown16Regular,
    ChevronUp16Regular,
    Shield24Regular
} from '@fluentui/react-icons';

import { ActionBar } from '../components/ActionBar';
import { useTranslation } from '../context/TranslationContext';

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
    menuItem: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        borderRadius: tokens.borderRadiusMedium,
        cursor: 'pointer',
        backgroundColor: tokens.colorNeutralBackground1,
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        transition: 'all 0.2s',
        ':hover': {
            backgroundColor: tokens.colorNeutralBackground1Hover,
            ...shorthands.borderColor(tokens.colorBrandStroke1),

            color: tokens.colorBrandForeground1
        }
    },
    menuItemContent: {
        display: 'flex',
        alignItems: 'center',
        gap: '12px'
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
}

export const SystemConfig: React.FC = () => {
    const styles = useStyles();
    const navigate = useNavigate();
    const { t } = useTranslation();

    // View State: null = Dashboard, string = specific detail view
    const [activeView, setActiveView] = useState<string | null>(null);
    const [viewTitle, setViewTitle] = useState<string>("");

    const [data, setData] = useState<SystemData | null>(null);
    const [loading, setLoading] = useState(true);
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
        // Only fetch if needed (e.g. for dashboard widgets or first load)
        // But here we mainly use it for Diagnostics detail.
        // We can fetch it on mount anyway for potential dashboard widgets.
        fetchData();
    }, []);
    const fetchDoc = async (file: string, title: string) => {
        setLoading(true);
        setActiveView('doc_viewer');
        setViewTitle(t(title)); // Assuming title passed is translation key, or we translate here? Let's pass key.

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
        setActiveView('history_viewer');
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

    const MenuItem = ({ icon, label, onClick, disabled }: { icon: React.ReactNode, label: string, onClick?: () => void, disabled?: boolean }) => (
        <div
            className={styles.menuItem}
            onClick={disabled ? undefined : onClick}
            style={disabled ? { opacity: 0.6, cursor: 'default', pointerEvents: 'none' } : {}}
        >
            <div className={styles.menuItemContent}>
                {icon}
                <Text weight="medium">{label}</Text>
            </div>
            {disabled ? <Spinner size="extra-small" /> : <ChevronRight16Regular style={{ color: tokens.colorNeutralForeground3 }} />}
        </div>
    );


    // === D365 DASHBOARD REDESIGN ===

    // Controlled MenuSection for Expand/Collapse All
    const MenuSection = ({ id, title, children, isOpen, onToggle }: { id: string, title: string, children: React.ReactNode, isOpen: boolean, onToggle: (id: string) => void }) => {
        return (
            <div style={{ marginBottom: '16px', breakInside: 'avoid' }}>
                <div
                    onClick={() => onToggle(id)}
                    style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '8px 0', cursor: 'pointer',
                        borderBottom: `2px solid ${tokens.colorNeutralStroke2}`,
                        marginBottom: '8px',
                        userSelect: 'none'
                    }}
                >
                    <Text weight="semibold" style={{ fontSize: '15px', color: tokens.colorNeutralForeground1 }}>{title}</Text>
                    {isOpen ? <ChevronUp16Regular style={{ color: tokens.colorNeutralForeground3 }} /> : <ChevronDown16Regular style={{ color: tokens.colorNeutralForeground3 }} />}
                </div>
                {isOpen && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        {children}
                    </div>
                )}
            </div>
        );
    };

    // System Groups Definition
    const SECTION_IDS = ['admin', 'docs', 'security', 'reports', 'tasks', 'settings'];
    const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(SECTION_IDS));

    const toggleSection = (id: string) => {
        const next = new Set(expandedSections);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setExpandedSections(next);
    };

    const expandAll = () => setExpandedSections(new Set(SECTION_IDS));
    const collapseAll = () => setExpandedSections(new Set());

    const renderDashboard = () => (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* Toolbar */}
            <div style={{
                display: 'flex', gap: '16px', marginBottom: '24px',
                paddingBottom: '12px', borderBottom: `1px solid ${tokens.colorNeutralStrokeDivider}`
            }}>
                <Button appearance="subtle" icon={<ChevronDown16Regular />} onClick={expandAll}>Expand all</Button>
                <Button appearance="subtle" icon={<ChevronUp16Regular />} onClick={collapseAll}>Collapse all</Button>
            </div>

            {/* 3-Column Layout (Responsive Flex) */}
            <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: '32px', alignItems: 'flex-start' }}>

                {/* Column 1 */}
                <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: '0px' }}>
                    {/* 1. ADMIN TOOLS */}
                    <MenuSection id="admin" title={t('system.group.admin')} isOpen={expandedSections.has('admin')} onToggle={toggleSection}>
                        <MenuItem icon={null} label={t('system.item.diagnostics')} onClick={() => { setActiveView('diagnostics'); setViewTitle(t('system.item.diagnostics')); }} />
                        <MenuItem icon={null} label={t('system.item.sessions')} onClick={() => alert(t('common.working'))} />
                        <MenuItem icon={null} label={t('system.item.sequences')} onClick={() => alert(t('common.working'))} />
                    </MenuSection>

                    {/* 2. DOCS */}
                    <MenuSection id="docs" title={t('system.group.docs')} isOpen={expandedSections.has('docs')} onToggle={toggleSection}>
                        <MenuItem icon={null} label={t('system.item.db_docs')} onClick={() => { setActiveView('schema'); setViewTitle(t('system.item.db_docs')); }} />
                        <MenuItem icon={null} label={t('system.item.manifest')} onClick={() => fetchDoc('manifest', 'system.item.manifest')} />
                        <MenuItem icon={null} label={t('system.item.security')} onClick={() => fetchDoc('security', 'system.item.security')} />
                        <MenuItem icon={null} label={t('system.item.history')} onClick={() => fetchHistory()} />
                        <MenuItem icon={null} label={t('system.item.help')} onClick={() => alert(t('common.working'))} />
                    </MenuSection>
                </div>

                {/* Column 2 */}
                <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: '0px' }}>
                    {/* 4. REPORTS */}
                    <MenuSection id="reports" title={t('system.menu.reports')} isOpen={expandedSections.has('reports')} onToggle={toggleSection}>
                        <MenuItem icon={null} label={t('system.item.audit_log')} onClick={() => alert(t('common.working'))} />
                        <MenuItem icon={null} label={t('system.item.performance_stats')} onClick={() => alert(t('common.working'))} />
                    </MenuSection>

                    {/* 5. TASKS */}
                    <MenuSection id="tasks" title={t('system.menu.tasks')} isOpen={expandedSections.has('tasks')} onToggle={toggleSection}>
                        <MenuItem icon={null} label={t('system.item.cron_jobs')} onClick={() => alert(t('common.working'))} />
                        <MenuItem icon={null} label={t('system.item.run_indexing')} onClick={() => alert(t('common.working'))} />
                        <MenuItem icon={null} label={t('system.item.update_db')} onClick={() => handleUpdateDB()} disabled={updatingDB} />
                    </MenuSection>
                </div>

                {/* Column 3 */}
                <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: '0px' }}>
                    {/* 3. SECURITY */}
                    <MenuSection id="security" title="Zabezpečení" isOpen={expandedSections.has('security')} onToggle={toggleSection}>
                        <MenuItem icon={<Shield24Regular />} label="Správa rolí" onClick={() => navigate('/system/security-roles')} />
                    </MenuSection>

                    {/* 6. SETTINGS */}
                    <MenuSection id="settings" title={t('system.menu.settings')} isOpen={expandedSections.has('settings')} onToggle={toggleSection}>
                        <MenuItem icon={null} label={t('system.item.global_params')} onClick={() => alert('Settings')} />
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
                        <Button icon={<ArrowLeft24Regular />} appearance="subtle" onClick={() => { setActiveView(null); setViewTitle(""); }} />
                    )}
                    <Breadcrumb>
                        <BreadcrumbItem>
                            <BreadcrumbButton onClick={() => { setActiveView(null); setViewTitle(""); }}>Moduly</BreadcrumbButton>
                        </BreadcrumbItem>
                        <BreadcrumbDivider />
                        <BreadcrumbItem>
                            <BreadcrumbButton onClick={() => { setActiveView(null); setViewTitle(""); }}>Systém</BreadcrumbButton>
                        </BreadcrumbItem>
                        {activeView && (
                            <>
                                <BreadcrumbDivider />
                                <BreadcrumbItem>
                                    <Text weight="semibold">{viewTitle}</Text>
                                </BreadcrumbItem>
                            </>
                        )}
                    </Breadcrumb>
                </div>
                <div style={{ flex: 1 }} />
                <Button icon={<ArrowClockwise24Regular />} onClick={fetchData}>Obnovit</Button>
            </ActionBar>

            <div className={styles.container}>
                {!activeView && renderDashboard()}
                {activeView === 'diagnostics' && renderDiagnostics()}
                {activeView === 'schema' && renderSchema()}
                {activeView === 'doc_viewer' && renderDocView()}
                {activeView === 'history_viewer' && renderHistoryView()}
            </div>
        </div>
    );
};

