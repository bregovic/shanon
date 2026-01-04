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
    Title2,
    Divider,
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbButton,
    BreadcrumbDivider,
    shorthands,
    tokens
} from '@fluentui/react-components';
import {
    ArrowClockwise24Regular,
    Settings24Regular,
    Poll24Regular,
    Database24Regular,
    Table24Regular,
    TaskListSquareLtr24Regular,
    Wrench24Regular,
    ChevronRight16Regular,
    ArrowLeft24Regular
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
            borderColor: tokens.colorBrandStroke1,
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
    const { t } = useTranslation();

    // View State: null = Dashboard, string = specific detail view
    const [activeView, setActiveView] = useState<string | null>(null);
    const [viewTitle, setViewTitle] = useState<string>("");

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
        // Only fetch if needed (e.g. for dashboard widgets or first load)
        // But here we mainly use it for Diagnostics detail.
        // We can fetch it on mount anyway for potential dashboard widgets.
        fetchData();
    }, []);

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

    const MenuItem = ({ icon, label, onClick }: { icon: React.ReactNode, label: string, onClick?: () => void }) => (
        <div className={styles.menuItem} onClick={onClick}>
            <div className={styles.menuItemContent}>
                {icon}
                <Text weight="medium">{label}</Text>
            </div>
            <ChevronRight16Regular style={{ color: tokens.colorNeutralForeground3 }} />
        </div>
    );

    const renderDashboard = () => (
        <div className={styles.grid}>
            {/* 1. FORMULÁŘE */}
            <Card className={styles.card}>
                <CardHeader
                    header={<Title3>Formuláře</Title3>}
                    description={<Text>Správa sytémových dat a číselníků</Text>}
                />
                <div className={styles.menuGroup}>
                    <Text weight="semibold" style={{ color: tokens.colorNeutralForeground4, marginTop: '8px' }}>Nástroje administrátora</Text>

                    <MenuItem
                        icon={<Wrench24Regular />}
                        label="Diagnostika systému"
                        onClick={() => { setActiveView('diagnostics'); setViewTitle('Diagnostika systému'); }}
                    />

                    <MenuItem
                        icon={<Database24Regular />}
                        label="Server a databáze"
                        onClick={() => { setActiveView('schema'); setViewTitle('Server a databáze'); }}
                    />

                    <MenuItem
                        icon={<AppGeneric24Regular />}
                        label="Systémové relace"
                        onClick={() => { alert('Zde bude přehled aktivních relací'); }}
                    />

                    <MenuItem
                        icon={<Table24Regular />}
                        label="Číselné řady"
                        onClick={() => { alert('Správa číselných řad'); }}
                    />
                </div>
            </Card>

            {/* 2. REPORTY */}
            <Card className={styles.card}>
                <CardHeader
                    header={<Title3>Reporty</Title3>}
                    description={<Text>Logy a statistiky</Text>}
                />
                <div className={styles.menuGroup}>
                    <MenuItem
                        icon={<Poll24Regular />}
                        label="Audit log"
                        onClick={() => alert('Historie změn')}
                    />
                    <MenuItem
                        icon={<Poll24Regular />}
                        label="Statistiky výkonu"
                        onClick={() => alert('Grafy výkonu')}
                    />
                </div>
            </Card>

            {/* 3. ÚLOHY (CRON/JOB) */}
            <Card className={styles.card}>
                <CardHeader
                    header={<Title3>Systémové úlohy</Title3>}
                    description={<Text>Dávkové zpracování a periodické úlohy</Text>}
                />
                <div className={styles.menuGroup}>
                    <MenuItem
                        icon={<TaskListSquareLtr24Regular />}
                        label="Periodické úlohy (Cron)"
                        onClick={() => alert('Přehled cron jobů')}
                    />
                    <MenuItem
                        icon={<ArrowClockwise24Regular />}
                        label="Spustit indexaci"
                        onClick={() => alert('Manuální spuštění indexace')}
                    />
                </div>
            </Card>

            {/* 4. NASTAVENÍ */}
            <Card className={styles.card}>
                <CardHeader
                    header={<Title3>Nastavení</Title3>}
                    description={<Text>Konfigurace serveru</Text>}
                />
                <div className={styles.menuGroup}>
                    <MenuItem
                        icon={<Settings24Regular />}
                        label="Globální parametry"
                        onClick={() => alert('Settings')}
                    />
                </div>
            </Card>
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
            </div>
        </div>
    );
};
