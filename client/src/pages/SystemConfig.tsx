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
    SelectTabData,
    TabValue
} from '@fluentui/react-components';
import {
    ArrowClockwise24Regular,
    Stethoscope24Regular,
    Settings24Regular,
    Notepad24Regular,
    Broom24Regular
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
    const [selectedTab, setSelectedTab] = useState<TabValue>('diagnostics');
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

    const onTabSelect = (_event: SelectTabData, data: SelectTabData) => {
        setSelectedTab(data.value);
    };

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

    // --- Content Renderers ---

    const renderDiagnostics = () => {
        if (loading && !data) return <div style={{ padding: '40px', textAlign: 'center' }}><Spinner label={t('common.loading')} /></div>;
        if (error) return <div style={{ padding: '24px' }}><Text style={{ color: 'red' }}>{error}</Text></div>;

        const isPersisted = data!.session.persisted_in_db;
        const isConnected = data!.overview.db_status.startsWith('Connected');

        return (
            <div className={styles.grid}>
                {/* Session Status */}
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
                        <StatusRow label="system.data_size" value={`${data?.session.data_length} bytes`} />
                        <StatusRow label="system.cookie_secure" value={data?.session.cookie_params.secure ? t('system.yes') : t('system.no')} />
                        <StatusRow label="system.cookie_samesite" value={data?.session.cookie_params.samesite} />
                    </div>
                </Card>

                {/* Database & Server */}
                <Card className={styles.card}>
                    <CardHeader header={<Text weight="semibold">{t('system.server_db')}</Text>} />
                    <div>
                        <StatusRow
                            label="system.database"
                            value={isConnected ? t('system.connected') : data?.overview.db_status}
                            status={isConnected ? 'success' : 'danger'}
                        />
                        <StatusRow label="system.php_version" value={data?.overview.php_version} />
                        <StatusRow label="system.https" value={data?.request.is_https ? t('system.active') : t('system.inactive')} />
                        <StatusRow label="system.server_time" value={data?.overview.server_time} />
                    </div>
                </Card>

                {/* Current User */}
                <Card className={styles.card}>
                    <CardHeader header={<Text weight="semibold">{t('system.current_user')}</Text>} />
                    <div>
                        <StatusRow label="system.user_name" value={data?.session.current_user?.full_name || '-'} />
                        <StatusRow label="system.user_email" value={data?.session.current_user?.email || '-'} />
                        <StatusRow label="system.user_role" value={data?.session.current_user?.role || '-'} />
                    </div>
                </Card>
            </div>
        );
    };

    const renderPlaceholder = (titleKey: string) => (
        <div style={{ textAlign: 'center', padding: '60px', color: '#888' }}>
            <Text size={500} block>{t(titleKey)}</Text>
            <Text>{t('system.section_preparing')}</Text>
        </div>
    );

    return (
        <div className={styles.root}>
            <ActionBar>
                <Title3>{t('system.title')}</Title3>
                <div style={{ flex: 1 }} />
                <Button icon={<ArrowClockwise24Regular />} onClick={fetchData}>{t('system.refresh')}</Button>
            </ActionBar>

            {/* Navigation Tabs */}
            <div className={styles.tabs}>
                <TabList selectedValue={selectedTab} onTabSelect={onTabSelect}>
                    <Tab id="diagnostics" icon={<Stethoscope24Regular />} value="diagnostics">{t('system.diagnostics')}</Tab>
                    <Tab id="settings" icon={<Settings24Regular />} value="settings">{t('system.settings')}</Tab>
                    <Tab id="logs" icon={<Notepad24Regular />} value="logs">{t('system.logs')}</Tab>
                    <Tab id="maintenance" icon={<Broom24Regular />} value="maintenance">{t('system.maintenance')}</Tab>
                </TabList>
            </div>

            {/* Content Area */}
            <div className={styles.container}>
                {selectedTab === 'diagnostics' && renderDiagnostics()}
                {selectedTab === 'settings' && renderPlaceholder('app.name')} {/* Placeholder */}
                {selectedTab === 'logs' && renderPlaceholder('system.logs')}
                {selectedTab === 'maintenance' && renderPlaceholder('system.maintenance')}
            </div>
        </div>
    );
};
