
import { useEffect } from 'react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { RouterProvider, createBrowserRouter, Navigate, Outlet, useParams, useNavigate } from 'react-router-dom';
import Layout from './components/Layout';
import { DashboardPage } from './pages/DashboardPage';
import { DmsDashboard } from './pages/DmsDashboard';
import { DmsList } from './pages/DmsList';
import { DmsImport } from './pages/DmsImport';
import { DmsReview } from './pages/DmsReview';
import { DmsSettings } from './pages/DmsSettings';
import RequestsPage from './pages/RequestsPage';
import { SystemTestingList } from "./pages/SystemTestingList";
import { SystemTestingDetail } from "./pages/SystemTestingDetail";
import SecurityRoles from './pages/SecurityRoles';
import { UsersAdmin } from './pages/UsersAdmin';
import { CodeAuditPage } from './pages/CodeAuditPage';
import { OrganizationsAdmin } from './pages/OrganizationsAdmin';
import { SystemConfig } from './pages/SystemConfig';
import { SystemTranslations } from './pages/SystemTranslations';
import { TableBrowser } from './pages/TableBrowser';
import { OcrTemplateDesigner } from './pages/OcrTemplateDesigner';
import { DmsGoogleSetup } from './pages/DmsGoogleSetup';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { SettingsProvider } from './context/SettingsContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { TranslationProvider } from './context/TranslationContext';
import { KeyboardShortcutsProvider } from './context/KeyboardShortcutsContext';
import { FavoritesProvider } from './context/FavoritesContext';
import { HelpProvider } from './context/HelpContext';
import { HelpModal } from './components/HelpModal';

const BASE_NAME = import.meta.env.BASE_URL || '/';

const RequireAuth = () => {
    const { user, isLoading } = useAuth();
    if (isLoading) return <div>Loading...</div>;
    if (!user) return <Navigate to="/login" replace />;
    return <Outlet />;
};

const RootRedirect = () => {
    const { currentOrgId, isLoading } = useAuth();
    if (isLoading) return null;
    return <Navigate to={`/${currentOrgId || 'VACKR'}/dashboard`} replace />;
};

const OrgGuard = () => {
    const { orgId } = useParams();
    const { currentOrgId, switchOrg, isLoading, organizations } = useAuth();
    const navigate = useNavigate();

    useEffect(() => {
        if (!isLoading && orgId && orgId !== currentOrgId) {
            // Validate if user has access to this org
            // Case-insensitive check for URL friendliness
            const isValid = organizations.some(o => o.org_id.toUpperCase() === orgId.toUpperCase());
            if (isValid) {
                switchOrg(orgId, true); // true = prevent reload
            } else if (organizations.length > 0) {
                // Invalid org, redirect to first valid
                navigate(`/${organizations[0].org_id}/dashboard`);
            }
        }
    }, [orgId, currentOrgId, isLoading, organizations, switchOrg, navigate]);

    if (isLoading) return null;

    // No organizations available (DB migration not run or user has no access)
    if (organizations.length === 0) {
        return (
            <div style={{ padding: 40, textAlign: 'center' }}>
                <h2>⚠️ Žádné společnosti</h2>
                <p>Nemáte přiřazeny žádné organizace nebo databáze nebyla inicializována.</p>
                <p style={{ fontSize: 12, color: '#888' }}>
                    Administrátor: Spusťte migraci na <code>/api/install-db.php?token=...</code>
                </p>
            </div>
        );
    }

    // Waiting for context switch
    if (orgId && orgId !== currentOrgId) {
        return <div style={{ padding: 20 }}>Načítání společnosti...</div>;
    }

    return <Layout />;
};

// Redirect Helper for non-prefixed routes
const ContextRedirect = ({ prefix }: { prefix?: string }) => {
    const { currentOrgId, isLoading } = useAuth();
    const navigate = useNavigate();
    const { "*": splat } = useParams();

    useEffect(() => {
        if (!isLoading) {
            const targetPath = prefix ? `${prefix}/${splat}` : splat;
            navigate(`/${currentOrgId || 'VACKR'}/${targetPath}`, { replace: true });
        }
    }, [currentOrgId, isLoading, navigate, splat, prefix]);

    if (isLoading) return <div>Redirecting...</div>;
    return null;
};

const router = createBrowserRouter([
    {
        path: "/login",
        element: <LoginPage />
    },
    {
        path: "/register",
        element: <RegisterPage />
    },
    {
        path: "/",
        element: <RequireAuth />,
        children: [
            {
                index: true,
                element: <RootRedirect />
            },
            {
                path: ":orgId",
                element: <OrgGuard />,
                children: [
                    { index: true, element: <Navigate to="dashboard" replace /> },
                    { path: "dashboard", element: <DashboardPage /> },
                    { path: "dms", element: <DmsDashboard /> },
                    { path: "dms/list", element: <DmsList /> },
                    { path: "dms/import", element: <DmsImport /> },
                    { path: "dms/review", element: <DmsReview /> },
                    { path: "dms/settings", element: <DmsSettings /> },
                    { path: "requests", element: <RequestsPage /> },
                    { path: "system", element: <SystemConfig /> },
                    { path: "system/security-roles", element: <SecurityRoles /> },
                    { path: "system/users", element: <UsersAdmin /> },
                    { path: "system/organizations", element: <OrganizationsAdmin /> },
                    { path: "system/audit", element: <CodeAuditPage /> },
                    { path: "system/translations", element: <SystemTranslations /> },
                    { path: "system/table-browser", element: <TableBrowser /> },
                    { path: "system/testing", element: <SystemTestingList /> },
                    { path: "system/testing/:id", element: <SystemTestingDetail /> },
                    { path: "dms/ocr-designer/:id", element: <OcrTemplateDesigner /> },
                    { path: "dms/ocr-designer", element: <OcrTemplateDesigner /> },
                    { path: "dms/google-setup", element: <DmsGoogleSetup /> },
                    // Fix for user accessing /import directly
                    { path: "import", element: <Navigate to="dms/import" replace /> },
                ]
            }
        ]
    },
    // Fix: Catch-all for direct module access without Org Prefix (e.g. /dms/import -> /VACKR/dms/import)
    {
        path: "/dms/*",
        element: <RequireAuth />,
        children: [{ path: "*", element: <ContextRedirect prefix="dms" /> }]
    },
    {
        path: "/system/*",
        element: <RequireAuth />,
        children: [{ path: "*", element: <ContextRedirect prefix="system" /> }]
    },
    {
        path: "/requests/*",
        element: <RequireAuth />,
        children: [{ path: "*", element: <ContextRedirect prefix="requests" /> }]
    }
], { basename: BASE_NAME });

function App() {
    return (
        <FluentProvider theme={webLightTheme}>
            <AuthProvider>
                <SettingsProvider>
                    <TranslationProvider>
                        <KeyboardShortcutsProvider>
                            <FavoritesProvider>
                                <HelpProvider>
                                    <RouterProvider router={router} />
                                    <HelpModal />
                                </HelpProvider>
                            </FavoritesProvider>
                        </KeyboardShortcutsProvider>
                    </TranslationProvider>
                </SettingsProvider>
            </AuthProvider>
        </FluentProvider>
    );
}

export default App;
