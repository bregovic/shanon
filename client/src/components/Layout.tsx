
import React from 'react';
import {
    makeStyles,
    tokens,
    Image,
    Avatar,
    Button,
    Tooltip,
    Menu,
    MenuTrigger,
    MenuList,
    MenuItem,
    MenuPopover
} from '@fluentui/react-components';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../context/TranslationContext';
import {
    SignOut24Regular,
    Settings24Regular,
    Alert24Regular,
    Emoji24Regular,
    Home24Regular,

    DocumentData24Regular,
    ClipboardTextEdit24Regular,
    BuildingBank24Regular,
    Checkmark24Regular,
    QuestionCircle24Regular
} from '@fluentui/react-icons';
import { SettingsDialog } from './SettingsDialog';
import { FeedbackModal } from './FeedbackModal';
import { FavoritesMenu } from './FavoritesMenu';
import { useHelp } from '../context/HelpContext';



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
        flexShrink: 0,
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        // Mobile Scroll Logic
        overflowX: 'auto',
        gap: '16px',
        '::-webkit-scrollbar': { display: 'none' },
        scrollbarWidth: 'none'
    },
    logoSection: {
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        cursor: 'pointer',
        flexShrink: 0 // Prevent logo shrinking
    },
    navLinks: {
        display: 'flex',
        gap: '8px',
        height: '100%',
        flexShrink: 0, // Prevent nav shrinking
        alignItems: 'center'
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
    const { openHelp } = useHelp();
    const { user, logout, hasPermission, organizations, currentOrgId } = useAuth();
    const { t } = useTranslation();
    const [settingsOpen, setSettingsOpen] = React.useState(false);
    const [feedbackOpen, setFeedbackOpen] = React.useState(false);

    const orgPrefix = `/${currentOrgId || 'VACKR'}`;

    const modules = [
        { label: t('modules.dashboard'), path: `${orgPrefix}/dashboard`, icon: <Home24Regular />, securityId: 'mod_dashboard' },
        { label: t('modules.dms'), path: `${orgPrefix}/dms`, icon: <DocumentData24Regular />, securityId: 'mod_dms' },
        { label: t('modules.requests'), path: `${orgPrefix}/requests`, icon: <ClipboardTextEdit24Regular />, securityId: 'mod_requests', resetEvent: 'reset-requests-page' },
        { label: t('modules.system'), path: `${orgPrefix}/system`, icon: <Settings24Regular />, securityId: 'mod_system' },
    ].sort((a, b) => {

        if (a.path.endsWith('/dashboard')) return -1;
        if (b.path.endsWith('/dashboard')) return 1;
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
                <div
                    className={styles.logoSection}
                    onClick={() => {
                        // Navigate to current module root (not always dashboard)
                        const currentModule = visibleModules.find(m => isActive(m.path));
                        const targetPath = currentModule?.path || `${orgPrefix}/dashboard`;
                        navigate(targetPath);
                    }}
                >
                    <Image src="/logo.png" height={28} fit="contain" alt="Shanon" />
                </div>

                {/* Module Picker Dropdown */}
                <Menu>
                    <MenuTrigger disableButtonEnhancement>
                        <Button
                            appearance="subtle"
                            style={{
                                fontWeight: '600',
                                minWidth: 'auto',
                                gap: '8px',
                                marginLeft: '16px'
                            }}
                        >
                            {(() => {
                                const current = visibleModules.find(m => isActive(m.path));
                                return current ? (
                                    <>
                                        <span style={{ display: 'flex', alignItems: 'center' }}>{current.icon}</span>
                                        {current.label}
                                    </>
                                ) : (
                                    <>
                                        <Home24Regular />
                                        {t('modules.dashboard')}
                                    </>
                                );
                            })()}
                        </Button>
                    </MenuTrigger>
                    <MenuPopover>
                        <MenuList>
                            {visibleModules.map(mod => (
                                <MenuItem
                                    key={mod.path}
                                    onClick={() => {
                                        if (isActive(mod.path) && (mod as any).resetEvent) {
                                            window.dispatchEvent(new Event((mod as any).resetEvent));
                                        }
                                        navigate(mod.path);
                                    }}
                                    icon={isActive(mod.path) ? <Checkmark24Regular /> : <div style={{ width: 24, height: 24 }} />}
                                >
                                    <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        {mod.icon}
                                        <span style={{ fontWeight: isActive(mod.path) ? 600 : 400 }}>
                                            {mod.label}
                                        </span>
                                    </span>
                                </MenuItem>
                            ))}
                        </MenuList>
                    </MenuPopover>
                </Menu>

                {/* Favorites Menu */}
                <FavoritesMenu />

                {/* Spacer to push actions to right, but allows shrinking/overflow */}
                <div style={{ flex: 1, minWidth: '16px' }} />

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>

                    {/* Multi-Org Switcher */}
                    <Menu>
                        <MenuTrigger disableButtonEnhancement>
                            <Button
                                appearance="subtle"
                                icon={<BuildingBank24Regular />}
                                style={{ fontWeight: '600', minWidth: 'auto' }}
                            >
                                {currentOrgId || '-'}
                            </Button>
                        </MenuTrigger>
                        <MenuPopover>
                            <MenuList>
                                {organizations.map(org => (
                                    <MenuItem
                                        key={org.org_id}
                                        onClick={() => navigate(`/${org.org_id}/dashboard`)}
                                        icon={currentOrgId === org.org_id ? <Checkmark24Regular /> : <div style={{ width: 24, height: 24 }} />}
                                    >
                                        <span style={{ fontWeight: currentOrgId === org.org_id ? 600 : 400 }}>
                                            {org.org_id}
                                        </span>
                                        <span style={{ color: tokens.colorNeutralForeground3, marginLeft: '8px' }}>
                                            {org.display_name}
                                        </span>
                                    </MenuItem>
                                ))}
                                {organizations.length === 0 && <MenuItem disabled>{t('layout.no_orgs')}</MenuItem>}
                            </MenuList>
                        </MenuPopover>
                    </Menu>

                    <div style={{ width: '1px', backgroundColor: '#e0e0e0', height: '20px', margin: '0 8px' }} />

                    <Tooltip content={t('common.warning')} relationship="label">
                        <Button icon={<Alert24Regular />} appearance="subtle" />
                    </Tooltip>

                    <Tooltip content={t('layout.fast_request')} relationship="label">
                        <Button icon={<Emoji24Regular />} appearance="subtle" onClick={() => setFeedbackOpen(true)} />
                    </Tooltip>

                    <Tooltip content={t('system.item.help')} relationship="label">
                        <Button icon={<QuestionCircle24Regular />} appearance="subtle" onClick={() => openHelp(undefined, location.pathname)} />
                    </Tooltip>

                    <Tooltip content={t('system.menu.settings')} relationship="label">

                        <Button icon={<Settings24Regular />} appearance="subtle" onClick={() => setSettingsOpen(true)} />
                    </Tooltip>

                    <div style={{ margin: '0 8px' }}>
                        <Avatar
                            color="brand"
                            initials={user?.initials || 'US'}
                            size={32}
                        />
                    </div>

                    <Tooltip content={t('auth.logout')} relationship="label">
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
