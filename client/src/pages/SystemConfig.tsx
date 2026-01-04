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
            <Text className={styles.label}>{label}</Text>
            {status ? (
                <Badge appearance="tint" color={status}>{String(value)}</Badge>
            ) : (
                <Text className={styles.value}>{String(value)}</Text>
            )}
        </div>
    );

    // --- Content Renderers ---

    const renderDiagnostics = () => {
        if (loading && !data) return <div style={{ padding: '40px', textAlign: 'center' }}><Spinner label="Načítám..." /></div>;
        if (error) return <div style={{ padding: '24px' }}><Text style={{ color: 'red' }}>{error}</Text></div>;

        return (
            <div className={styles.grid}>
                {/* Session Status */}
                <Card className={styles.card}>
                    <CardHeader header={<Text weight="semibold">Diagnostika Session</Text>} />
                    <div>
                        <StatusRow
                            label="Uloženo v DB"
                            value={data?.session.persisted_in_db ? 'ANO' : 'NE'}
                            status={data?.session.persisted_in_db ? 'success' : 'danger'}
                        />
                        <StatusRow label="Session ID" value={data?.session.id ? (data.session.id.substring(0, 10) + '...') : ''} />
                        <StatusRow label="DB Handler" value={data?.session.handler} />
                        <StatusRow label="Velikost dat" value={`${data?.session.data_length} bytes`} />
                        <StatusRow label="Cookie Secure" value={data?.session.cookie_params.secure ? 'Yes' : 'No'} />
                        <StatusRow label="Cookie SameSite" value={data?.session.cookie_params.samesite} />
                    </div>
                </Card>

                {/* Database & Server */}
                <Card className={styles.card}>
                    <CardHeader header={<Text weight="semibold">Server & Databáze</Text>} />
                    <div>
                        <StatusRow
                            label="Databáze"
                            value={data?.overview.db_status.replace('Connected to', '')}
                            status={data?.overview.db_status.startsWith('Connected') ? 'success' : 'danger'}
                        />
                        <StatusRow label="PHP Verze" value={data?.overview.php_version} />
                        <StatusRow label="HTTPS" value={data?.request.is_https ? 'Aktivní' : 'Neaktivní'} />
                        <StatusRow label="Server Čas" value={data?.overview.server_time} />
                    </div>
                </Card>

                {/* Current User */}
                <Card className={styles.card}>
                    <CardHeader header={<Text weight="semibold">Přihlášený Uživatel</Text>} />
                    <div>
                        <StatusRow label="Jméno" value={data?.session.current_user?.full_name || '-'} />
                        <StatusRow label="Email" value={data?.session.current_user?.email || '-'} />
                        <StatusRow label="Role" value={data?.session.current_user?.role || '-'} />
                    </div>
                </Card>
            </div>
        );
    };

    const renderPlaceholder = (title: string) => (
        <div style={{ textAlign: 'center', padding: '60px', color: '#888' }}>
            <Text size={500} block>{title}</Text>
            <Text>Tato sekce se připravuje.</Text>
        </div>
    );

    return (
        <div className={styles.root}>
            <ActionBar>
                <Title3>Konfigurace systému</Title3>
                <div style={{ flex: 1 }} />
                <Button icon={<ArrowClockwise24Regular />} onClick={fetchData}>Obnovit</Button>
            </ActionBar>

            {/* Navigation Tabs */}
            <div className={styles.tabs}>
                <TabList selectedValue={selectedTab} onTabSelect={onTabSelect}>
                    <Tab id="diagnostics" icon={<Stethoscope24Regular />} value="diagnostics">Diagnostika</Tab>
                    <Tab id="settings" icon={<Settings24Regular />} value="settings">Nastavení</Tab>
                    <Tab id="logs" icon={<Notepad24Regular />} value="logs">Logy</Tab>
                    <Tab id="maintenance" icon={<Broom24Regular />} value="maintenance">Údržba</Tab>
                </TabList>
            </div>

            {/* Content Area */}
            <div className={styles.container}>
                {selectedTab === 'diagnostics' && renderDiagnostics()}
                {selectedTab === 'settings' && renderPlaceholder('Globální nastavení aplikace')}
                {selectedTab === 'logs' && renderPlaceholder('Systémové logy a chyby')}
                {selectedTab === 'maintenance' && renderPlaceholder('Údržba a čištění cache')}
            </div>
        </div>
    );
};
