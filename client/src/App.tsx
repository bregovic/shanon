
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { RouterProvider, createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
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
import { SystemConfig } from './pages/SystemConfig';
import { SystemTranslations } from './pages/SystemTranslations';
import { OcrTemplateDesigner } from './pages/OcrTemplateDesigner';
import { DmsGoogleSetup } from './pages/DmsGoogleSetup';
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
                    { path: "dms/review", element: <DmsReview /> },
                    { path: "dms/settings", element: <DmsSettings /> },
                    { path: "requests", element: <RequestsPage /> },
                    { path: "system", element: <SystemConfig /> },
                    { path: "system/security-roles", element: <SecurityRoles /> },
                    { path: "system/translations", element: <SystemTranslations /> },
                    { path: "system/testing", element: <SystemTestingList /> },
                    { path: "system/testing/:id", element: <SystemTestingDetail /> },
                    { path: "dms/ocr-designer/:id", element: <OcrTemplateDesigner /> },
                    { path: "dms/ocr-designer", element: <OcrTemplateDesigner /> }, // For new templates
                    { path: "dms/google-setup", element: <DmsGoogleSetup /> },
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
