
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useState } from 'react';
import {
    makeStyles,
    tokens,
    Text,
    Button,
    Badge,
    Image
} from '@fluentui/react-components';
import {
    Home24Regular,
    ClipboardTextEdit24Regular,
    Alert24Regular,
    Settings24Regular,
    Emoji24Regular,
    SignOut24Regular
} from '@fluentui/react-icons';
import { FeedbackModal } from './FeedbackModal';
import { SettingsDialog } from './SettingsDialog';
import { useAuth } from '../context/AuthContext';

const useStyles = makeStyles({
    root: { display: 'flex', flexDirection: 'column', height: '100vh', width: '100%', backgroundColor: tokens.colorNeutralBackground2 },
    header: {
        height: '60px', backgroundColor: '#ffffff', color: '#000000', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 24px', flexShrink: 0, zIndex: 100, borderBottom: `1px solid ${tokens.colorNeutralStroke1}`, boxShadow: tokens.shadow2
    },
    headerLeftGroup: { display: 'flex', alignItems: 'center', height: '100%', gap: '24px', flex: 1, overflowX: 'auto', scrollbarWidth: 'none' },
    logoImage: { height: '36px', objectFit: 'contain', marginRight: '12px' },
    navContainer: { display: 'flex', alignItems: 'center', height: '100%', gap: '4px' },
    navItem: {
        padding: '0 12px', height: '100%', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer',
        color: tokens.colorNeutralForeground1, borderBottom: '3px solid transparent', whiteSpace: 'nowrap',
        ':hover': { backgroundColor: tokens.colorNeutralBackground1Hover, color: tokens.colorBrandForeground1 }
    },
    navItemActive: { borderBottom: `3px solid ${tokens.colorBrandBackground}`, fontWeight: 600, color: tokens.colorBrandForeground1 },
    headerRight: { display: 'flex', alignItems: 'center', gap: '4px', marginLeft: 'auto' },
    userCircle: {
        width: '32px', height: '32px', borderRadius: '50%', backgroundColor: tokens.colorBrandBackground, color: '#ffffff',
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: 600, cursor: 'pointer', marginLeft: '4px'
    },
    body: { display: 'flex', flexDirection: 'column', flexGrow: 1, overflow: 'hidden' },
    content: { display: 'flex', flexDirection: 'column', flexGrow: 1, overflow: 'hidden', padding: '0', position: 'relative', width: '100%' },
    notificationWrapper: { position: 'relative', display: 'flex', alignItems: 'center' },
    badge: { position: 'absolute', top: '2px', right: '2px', zIndex: 1 }
});

const Layout = () => {
    const styles = useStyles();
    const navigate = useNavigate();
    const location = useLocation();
    const path = location.pathname;

    const selectedValue = path.includes('requests') ? 'requests' : 'dashboard';

    const { user, logout } = useAuth();
    const [feedbackOpen, setFeedbackOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);

    const NavItem = ({ value, icon, label }: { value: string, icon: any, label: string }) => {
        const isActive = selectedValue === value;
        return (
            <div
                className={isActive ? `${styles.navItem} ${styles.navItemActive}` : styles.navItem}
                onClick={() => {
                    if (value === 'requests') window.dispatchEvent(new CustomEvent('reset-requests-page'));
                    navigate(value === 'dashboard' ? '/' : value);
                }}
            >
                {icon}
                <Text>{label}</Text>
            </div>
        );
    };

    return (
        <div className={styles.root}>
            <header className={styles.header}>
                <div className={styles.headerLeftGroup}>
                    <div onClick={() => navigate('/')} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                        <Image src="/logo.png" className={styles.logoImage} alt="Logo" />
                        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                            <Text size={400} weight="bold" style={{ color: tokens.colorBrandBackground, lineHeight: '1' }}>SHANON</Text>
                            <Text size={100} style={{ color: tokens.colorNeutralForeground3, lineHeight: '1' }}>ENTERPRISE</Text>
                        </div>
                    </div>

                    <nav className={styles.navContainer} style={{ marginLeft: '40px' }}>
                        <NavItem value="dashboard" icon={<Home24Regular />} label="Dashboard" />

                        {(user?.role === 'admin' || (!!user?.assigned_tasks_count && user.assigned_tasks_count > 0)) && (
                            <NavItem value="requests" icon={<ClipboardTextEdit24Regular />} label="Správa požadavků" />
                        )}

                        <div className={styles.headerRight}>
                            <div className={styles.notificationWrapper}>
                                <Button appearance="transparent" icon={<Alert24Regular />} onClick={() => { window.dispatchEvent(new CustomEvent('reset-requests-page')); navigate('/requests?mine=1'); }} title="Moje požadavky" />
                                {user?.assigned_tasks_count && user.assigned_tasks_count > 0 ? (
                                    <Badge size="small" appearance="filled" color="danger" className={styles.badge}>{user.assigned_tasks_count}</Badge>
                                ) : null}
                            </div>
                            <Button appearance="transparent" icon={<Emoji24Regular />} onClick={() => setFeedbackOpen(true)} title="Nahlásit chybu / nápad" />
                            <Button appearance="transparent" icon={<Settings24Regular />} onClick={() => setSettingsOpen(true)} title="Nastavení" />

                            <div className={styles.userCircle} title={user?.name}>
                                {user ? user.initials : '...'}
                            </div>
                            <Button appearance="subtle" icon={<SignOut24Regular />} onClick={() => logout()} style={{ marginLeft: 8 }} title="Odhlásit" />
                        </div>
                    </nav>
                </div>
            </header>

            <FeedbackModal open={feedbackOpen} onOpenChange={setFeedbackOpen} user={user} />
            <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />

            <div className={styles.body}>
                <main className={styles.content}>
                    <Outlet />
                </main>
            </div>
        </div>
    );
};

export default Layout;
