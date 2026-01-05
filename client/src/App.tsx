
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { RouterProvider, createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import Layout from './components/Layout';
import { DashboardPage } from './pages/DashboardPage';
import { DmsDashboard } from './pages/DmsDashboard';
import { DmsList } from './pages/DmsList';
import { DmsImport } from './pages/DmsImport';
import { DmsSettings } from './pages/DmsSettings';
import RequestsPage from './pages/RequestsPage';
import SecurityRoles from './pages/SecurityRoles';
import { SystemConfig } from './pages/SystemConfig';
import { SystemTranslations } from './pages/SystemTranslations';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { SettingsProvider } from './context/SettingsContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { TranslationProvider } from './context/TranslationContext';

const BASE_NAME = import.meta.env.BASE_URL || '/';

const RequireAuth = () => {
    const { user, isLoading } = useAuth();
    if (isLoading) return <div>Loading...</div>;
    if (!user) return <Navigate to="/login" replace />;
    return <Outlet />;
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
                path: "/",
                element: <Layout />,
                children: [
                    { index: true, element: <Navigate to="/dashboard" replace /> },
                    { path: "dashboard", element: <DashboardPage /> },
                    { path: "dms", element: <DmsDashboard /> },
                    { path: "dms/list", element: <DmsList /> },
                    { path: "dms/import", element: <DmsImport /> },
                    { path: "dms/settings", element: <DmsSettings /> },
                    { path: "requests", element: <RequestsPage /> },
                    { path: "system", element: <SystemConfig /> },
                    { path: "system/security-roles", element: <SecurityRoles /> },
                    { path: "system/translations", element: <SystemTranslations /> },
                ]
            }
        ]
    }
], { basename: BASE_NAME });

function App() {
    return (
        <FluentProvider theme={webLightTheme}>
            <AuthProvider>
                <SettingsProvider>
                    <TranslationProvider>
                        <RouterProvider router={router} />
                    </TranslationProvider>
                </SettingsProvider>
            </AuthProvider>
        </FluentProvider>
    );
}

export default App;
