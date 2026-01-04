
import React from 'react';
import {
    makeStyles,
    tokens,
    Image,
    Avatar,
    Button,
    Tooltip
} from '@fluentui/react-components';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
    SignOut24Regular,
    Settings24Regular,
    Alert24Regular,
    Emoji24Regular,
    Home24Regular,

    DocumentData24Regular,
    ClipboardTextEdit24Regular,
    Briefcase24Regular,
    PeopleTeam24Regular
} from '@fluentui/react-icons';
import { SettingsDialog } from './SettingsDialog';
import { FeedbackModal } from './FeedbackModal';



const useStyles = makeStyles({
    root: {
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
    },
    header: {
        backgroundColor: tokens.colorNeutralBackground1,
        color: tokens.colorNeutralForeground1,
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        height: '56px',
        justifyContent: 'space-between',
        flexShrink: 0,
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`
    },
    logoSection: {
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        cursor: 'pointer',
        marginRight: '24px'
    },
    navLinks: {
        display: 'flex',
        gap: '8px',
        height: '100%'
    },
    link: {
        color: tokens.colorNeutralForeground2,
        textDecoration: 'none',
        fontSize: '14px',
        fontWeight: '600',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '0 12px',
        borderBottom: '3px solid transparent',
        transition: 'all 0.2s',
        ':hover': {
            backgroundColor: tokens.colorNeutralBackground2,
            color: tokens.colorBrandForeground1
        }
    },
    activeLink: {
        color: tokens.colorBrandForeground1,
        borderBottom: `3px solid ${tokens.colorBrandForeground1}`
    },
    content: {
        flex: 1,
        overflow: 'hidden',
        backgroundColor: tokens.colorNeutralBackground2,
        display: 'flex',
        flexDirection: 'column'
    }
});

const Layout: React.FC = () => {
    const styles = useStyles();
    const navigate = useNavigate();
    const location = useLocation();
    const { user, logout, hasPermission } = useAuth();
    const [settingsOpen, setSettingsOpen] = React.useState(false);
    const [feedbackOpen, setFeedbackOpen] = React.useState(false);

    const modules = [
        { label: 'Dashboard', path: '/dashboard', icon: <Home24Regular />, securityId: 'mod_dashboard' },
        { label: 'DMS', path: '/dms', icon: <DocumentData24Regular />, securityId: 'mod_dms' },
        { label: 'Projekty', path: '/projects', icon: <Briefcase24Regular />, securityId: 'mod_projects' },
        { label: 'CRM', path: '/crm', icon: <PeopleTeam24Regular />, securityId: 'mod_crm' },
        { label: 'Požadavky', path: '/requests', icon: <ClipboardTextEdit24Regular />, securityId: 'mod_requests' },
        { label: 'Systém', path: '/system', icon: <Settings24Regular />, securityId: 'mod_system' },
    ].sort((a, b) => {
        if (a.path === '/dashboard') return -1;
        if (b.path === '/dashboard') return 1;
        return a.label.localeCompare(b.label);
    });

    // Filter modules based on permissions
    // If securityId is present, check permission. If not, assume public.
    // Specially allow Dashboard if user has basic login, though strictly it is a module.
    // Fallback: If hasPermission returns false but user is admin (handled inside hasPermission), they see it.
    const visibleModules = modules.filter(m => {
        if (!m.securityId) return true;
        // Temporary: Force Dashboard visible for all logged users since we missed seeding GUEST permissions for it
        if (m.securityId === 'mod_dashboard') return true;
        return hasPermission(m.securityId, 1);
    });

    const isActive = (path: string) => location.pathname.startsWith(path);

    return (
        <div className={styles.root}>
            <header className={styles.header}>
                <div style={{ display: 'flex', height: '100%', alignItems: 'center' }}>
                    <div className={styles.logoSection} onClick={() => navigate('/dashboard')}>
                        <Image src="/logo.png" height={28} fit="contain" alt="Shanon" />
                    </div>

                    <nav className={styles.navLinks}>
                        {visibleModules.map(mod => (
                            <div
                                key={mod.path}
                                className={`${styles.link} ${isActive(mod.path) ? styles.activeLink : ''}`}
                                onClick={() => navigate(mod.path)}
                            >
                                <span style={{ fontSize: '20px' }}>{mod.icon}</span>
                                {mod.label}
                            </div>
                        ))}
                    </nav>

                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Tooltip content="Upozornění" relationship="label">
                        <Button icon={<Alert24Regular />} appearance="subtle" />
                    </Tooltip>

                    <Tooltip content="Rychlý požadavek" relationship="label">
                        <Button icon={<Emoji24Regular />} appearance="subtle" onClick={() => setFeedbackOpen(true)} />
                    </Tooltip>

                    <Tooltip content="Nastavení" relationship="label">

                        <Button icon={<Settings24Regular />} appearance="subtle" onClick={() => setSettingsOpen(true)} />
                    </Tooltip>

                    <div style={{ margin: '0 8px' }}>
                        <Avatar
                            color="brand"
                            initials={user?.initials || 'US'}
                            size={32}
                        />
                    </div>

                    <Tooltip content="Odhlásit" relationship="label">
                        <Button icon={<SignOut24Regular />} appearance="subtle" onClick={logout} />
                    </Tooltip>
                </div>
            </header>

            <main className={styles.content}>
                <Outlet />
            </main>

            <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
            <FeedbackModal open={feedbackOpen} onOpenChange={setFeedbackOpen} user={user} />
        </div>

    );
};

export default Layout;
