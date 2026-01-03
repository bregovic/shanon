
import React from 'react';
import {
    makeStyles,
    tokens,
    Image,
    Text,
    Avatar,
    Menu,
    MenuTrigger,
    MenuList,
    MenuItem,
    MenuPopover
} from '@fluentui/react-components';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { SignOutRegular, SettingsRegular } from '@fluentui/react-icons';
import { SettingsDialog } from './SettingsDialog';

const useStyles = makeStyles({
    root: {
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
    },
    header: {
        backgroundColor: tokens.colorBrandBackground, // BLUE BAR
        color: tokens.colorNeutralForegroundOnBrand,
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        height: '48px',
        justifyContent: 'space-between',
        flexShrink: 0,
        boxShadow: tokens.shadow4
    },
    logoSection: {
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        cursor: 'pointer'
    },
    navLinks: {
        display: 'flex',
        gap: '24px',
        marginLeft: '40px',
        height: '100%'
    },
    link: {
        color: 'inherit',
        textDecoration: 'none',
        fontSize: '14px',
        fontWeight: '600',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        borderBottom: '3px solid transparent',
        opacity: 0.9,
        transition: 'all 0.2s',
        ':hover': {
            opacity: 1,
            borderBottom: '3px solid white'
        }
    },
    activeLink: {
        opacity: 1,
        borderBottom: '3px solid white'
    },
    content: {
        flex: 1,
        overflow: 'hidden', // Prepare for internal scrolling
        backgroundColor: tokens.colorNeutralBackground2,
        display: 'flex',
        flexDirection: 'column'
    }
});

const Layout: React.FC = () => {
    const styles = useStyles();
    const navigate = useNavigate();
    const location = useLocation();
    const { user, logout } = useAuth();
    const [settingsOpen, setSettingsOpen] = React.useState(false);

    // Module Definition
    const modules = [
        { label: 'Dashboard', path: '/dashboard' },
        { label: 'DMS', path: '/dms' },
        { label: 'Projekty', path: '/projects' }, // Placeholder
        { label: 'CRM', path: '/crm' }, // Placeholder
        { label: 'Požadavky', path: '/requests' },
    ].sort((a, b) => {
        // Dashboard always first, others alphabetical
        if (a.path === '/dashboard') return -1;
        if (b.path === '/dashboard') return 1;
        return a.label.localeCompare(b.label);
    });

    const isActive = (path: string) => location.pathname.startsWith(path);

    return (
        <div className={styles.root}>
            {/* BLUE TOP BAR */}
            <header className={styles.header}>
                <div style={{ display: 'flex', height: '100%', alignItems: 'center' }}>
                    <div className={styles.logoSection} onClick={() => navigate('/dashboard')}>
                        <Image src="/logo.png" height={24} fit="contain" style={{ filter: 'brightness(0) invert(1)' }} />
                        <Text weight="semibold" size={400}>Shanon</Text>
                    </div>

                    <nav className={styles.navLinks}>
                        {modules.map(mod => (
                            <div
                                key={mod.path}
                                className={`${styles.link} ${isActive(mod.path) ? styles.activeLink : ''}`}
                                onClick={() => navigate(mod.path)}
                            >
                                {mod.label}
                            </div>
                        ))}
                    </nav>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <Text size={200} style={{ opacity: 0.8 }}>{user?.name}</Text>
                    <Menu>
                        <MenuTrigger disableButtonEnhancement>
                            <Avatar
                                color="brand"
                                initials={user?.initials}
                                size={28}
                                style={{ cursor: 'pointer', border: '2px solid rgba(255,255,255,0.2)' }}
                            />
                        </MenuTrigger>
                        <MenuPopover>
                            <MenuList>
                                <MenuItem icon={<SettingsRegular />} onClick={() => setSettingsOpen(true)}>
                                    Nastavení
                                </MenuItem>
                                <MenuItem icon={<SignOutRegular />} onClick={logout}>
                                    Odhlásit se
                                </MenuItem>
                            </MenuList>
                        </MenuPopover>
                    </Menu>
                </div>
            </header>

            {/* CONTENT AREA (Includes Yellow Bar if page provides it) */}
            <main className={styles.content}>
                <Outlet />
            </main>

            <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
        </div>
    );
};

export default Layout;
