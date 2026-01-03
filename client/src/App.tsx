import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { RouterProvider, createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import Layout from './components/Layout';
import { BalancePage } from './pages/BalancePage';
import RequestsPage from './pages/RequestsPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { SettingsProvider } from './context/SettingsContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { TranslationProvider } from './context/TranslationContext'; // Přidávám Translation, bude se hodit

// Pro Docker / Railway nasazení obvykle běžíme na rootu nebo specifickém base
const BASE_NAME = import.meta.env.BASE_URL || '/';

const RequireAuth = () => {
  const { user, isLoading } = useAuth();
  if (isLoading) return <div>Načítám...</div>;
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
          { path: "/", element: <Navigate to="/dashboard" replace /> },
          { path: "dashboard", element: <BalancePage /> }, // Rename logically in UI later
          { path: "requests", element: <RequestsPage /> },
          // Zde budeme přidávat generické ERP moduly
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
