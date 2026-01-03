
import React from 'react';
import {
    makeStyles,
    tokens,
    Title3,
    Text,
    Card,
    Button
} from '@fluentui/react-components';
import {
    ClipboardTextEdit24Regular,
    Add24Regular
} from '@fluentui/react-icons';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const useStyles = makeStyles({
    root: {
        padding: '24px',
        display: 'flex',
        flexDirection: 'column',
        gap: '24px',
        height: '100%',
        boxSizing: 'border-box'
    },
    header: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
    },
    grid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
        gap: '16px'
    },
    card: {
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        cursor: 'pointer',
        ':hover': {
            boxShadow: tokens.shadow4
        }
    },
    cardHeader: {
        display: 'flex',
        alignItems: 'center',
        gap: '12px'
    }
});

export const DashboardPage: React.FC = () => {
    const styles = useStyles();
    const navigate = useNavigate();
    const { user } = useAuth();

    return (
        <div className={styles.root}>
            <div className={styles.header}>
                <Title3>Dashboard</Title3>

            </div>

            <div className={styles.grid}>
                {/* Requests Module Card */}
                <Card className={styles.card} onClick={() => navigate('/requests')}>
                    <div className={styles.cardHeader}>
                        <div style={{
                            backgroundColor: tokens.colorBrandBackground2,
                            padding: '8px',
                            borderRadius: '4px',
                            color: tokens.colorBrandForeground1
                        }}>
                            <ClipboardTextEdit24Regular />
                        </div>
                        <Text weight="semibold" size={400}>Change Requests</Text>
                    </div>
                    <Text size={300} style={{ color: tokens.colorNeutralForeground2 }}>
                        Manage system requirements, bugs, and feature requests.
                    </Text>
                    <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'flex-end' }}>
                        <Button icon={<Add24Regular />} appearance="subtle" onClick={(e) => { e.stopPropagation(); navigate('/requests?new=1'); }}>
                            New Request
                        </Button>
                    </div>
                </Card>

                {/* Placeholder for future modules */}
                {/* 
                <Card className={styles.card}>
                    <div className={styles.cardHeader}>
                       ...
                    </div>
                    <Text>Coming Soon...</Text>
                </Card> 
                */}
            </div>
        </div>
    );
};
