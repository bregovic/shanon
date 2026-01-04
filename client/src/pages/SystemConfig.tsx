import React, { useEffect, useState } from 'react';
import {
    Title3,
    Card,
    CardHeader,
    Text,
    Badge,
    Spinner,
    Button,
    makeStyles,
    TabList,
    Tab,
    Title2,
    Divider
} from '@fluentui/react-components';
import type {
    SelectTabData,
    TabValue,
    SelectTabEvent
} from '@fluentui/react-components';
import {
    ArrowClockwise24Regular,
    AppGeneric24Regular,
    Settings24Regular,
    Poll24Regular,
    Database24Regular,
    Table24Regular,
    TaskListSquareLtr24Regular
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
        height: '100%'
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
    tabs: {
        padding: '0 16px',
        borderBottom: '1px solid #e0e0e0',
        backgroundColor: '#fff'
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
    const { t } = useTranslation();
    const [selectedTab, setSelectedTab] = useState<TabValue>('dashboard');
    const [data, setData] = useState<SystemData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

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
        fetchData();
    }, []);

    const onTabSelect = (_event: SelectTabEvent, data: SelectTabData) => {
        setSelectedTab(data.value);
    };

    // --- RENDERERS ---

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

    // --- SCHEMA RENDERER ---
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

    const renderPlaceholder = (title: string, desc: string) => (
        <div style={{ textAlign: 'center', padding: '80px', color: '#888' }}>
            <Title3 block>{title}</Title3>
            <Text>{desc}</Text>
        </div>
    );

    return (
        <div className={styles.root}>
            <ActionBar>
                <Title3>{t('system.title')}</Title3>
                <div style={{ flex: 1 }} />
                <Button icon={<ArrowClockwise24Regular />} onClick={fetchData}>{t('system.refresh')}</Button>
            </ActionBar>

            {/* NEW STANDARD DASHBOARD TABS */}
            <div className={styles.tabs}>
                <TabList selectedValue={selectedTab} onTabSelect={onTabSelect}>
                    <Tab id="dashboard" icon={<AppGeneric24Regular />} value="dashboard">{t('Dashboard')}</Tab>
                    <Tab id="forms" icon={<Table24Regular />} value="forms">{t('Forms & Data')}</Tab>
                    <Tab id="tasks" icon={<TaskListSquareLtr24Regular />} value="tasks">{t('Tasks')}</Tab>
                    <Tab id="reports" icon={<Poll24Regular />} value="reports">{t('Reports')}</Tab>
                    <Tab id="schema" icon={<Database24Regular />} value="schema">{t('Database')}</Tab>
                    <Tab id="settings" icon={<Settings24Regular />} value="settings">{t('Settings')}</Tab>
                </TabList>
            </div>

            <div className={styles.container}>
                {selectedTab === 'dashboard' && renderDiagnostics()}

                {selectedTab === 'forms' && renderPlaceholder(t('Forms & Data'), 'Manage Number Series, Dropdowns, and Global Enums.')}

                {selectedTab === 'tasks' && renderPlaceholder(t('Tasks'), 'Scheduled Cron Jobs and Batch Processes.')}

                {selectedTab === 'reports' && renderPlaceholder(t('Reports'), 'System Logs, Audit Trails, and Analytics.')}

                {selectedTab === 'schema' && renderSchema()}

                {selectedTab === 'settings' && renderPlaceholder(t('Settings'), 'Low-level PHP & Server Configuration.')}
            </div>
        </div>
    );
};
