import React, { useEffect, useState } from 'react';
import {
    Title3,
    Card,
    CardHeader,
    Text,
    Badge,
    Spinner,
    Button,
    makeStyles
} from '@fluentui/react-components';
import {
    ArrowClockwise24Regular
} from '@fluentui/react-icons';
import { ActionBar } from '../components/ActionBar';

const useStyles = makeStyles({
    container: {
        padding: '24px',
        display: 'flex',
        flexDirection: 'column',
        gap: '24px'
    },
    grid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
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

    if (loading && !data) {
        return <div style={{ padding: '40px', textAlign: 'center' }}><Spinner label="Načítám konfiguraci..." /></div>;
    }

    if (error) {
        return (
            <div style={{ padding: '40px', textAlign: 'center' }}>
                <Title3>Chyba načítání</Title3>
                <Text>{error}</Text>
                <br /><br />
                <Button onClick={fetchData}>Zkusit znovu</Button>
            </div>
        );
    }

    return (
        <div style={{ height: '100%', overflow: 'auto' }}>
            <ActionBar>
                <Title3>Konfigurace systému</Title3>
                <div style={{ flex: 1 }} />
                <Button icon={<ArrowClockwise24Regular />} onClick={fetchData}>Obnovit</Button>
            </ActionBar>

            <div className={styles.container}>
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
                            <StatusRow label="Session ID" value={data?.session.id.substring(0, 10) + '...'} />
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
                                value={data?.overview.db_status}
                                status={data?.overview.db_status === 'Connected' ? 'success' : 'danger'}
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
            </div>
        </div>
    );
};
