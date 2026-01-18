
import React, { createContext, useContext, useState, useEffect } from 'react';

type User = {
    id: number;
    username: string;
    role: 'admin' | 'user' | 'superadmin' | 'developer';
    name: string;
    initials: string;
    assigned_tasks_count?: number;
};

export type Organization = {
    org_id: string;
    display_name: string;
    is_default: boolean;
};

type AuthContextType = {
    user: User | null;
    permissions: Record<string, number>;
    isLoading: boolean;
    login: (username: string, pass: string) => Promise<boolean>;
    logout: () => void;
    hasPermission: (objectId: string, minLevel?: number) => boolean;
    organizations: Organization[];
    currentOrgId: string | null;
    switchOrg: (orgId: string, preventReload?: boolean) => Promise<boolean>;
    orgPrefix: string;
    getApiUrl: (endpoint: string) => string;
};

const AuthContext = createContext<AuthContextType>({
    user: null,
    permissions: {},
    isLoading: true,
    login: async () => false,
    logout: () => { },
    hasPermission: () => false,
    organizations: [],
    currentOrgId: null,
    switchOrg: async () => false,
    orgPrefix: '',
    getApiUrl: (e) => e
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [permissions, setPermissions] = useState<Record<string, number>>({});
    const [organizations, setOrganizations] = useState<Organization[]>([]);
    const [currentOrgId, setCurrentOrgId] = useState<string | null>(null);

    // URL Prefix helper (e.g. /vackr) - Always lowercase for URLs
    const orgPrefix = currentOrgId ? `/${currentOrgId.toLowerCase()}` : '';

    const [isLoading, setIsLoading] = useState(true);

    // FIX: Set correct API path for Shanon (Nginx maps /api -> Backend)
    const API_BASE = import.meta.env.DEV
        ? 'http://localhost/Webhry/hollyhop/broker/shanon/backend'
        : '/api';

    const getApiUrl = React.useCallback((endpoint: string) => `${API_BASE}/${endpoint}`, [API_BASE]);

    useEffect(() => {
        checkAuth();

        const handleFocus = () => checkAuth();
        window.addEventListener('focus', handleFocus);

        // Poll every 60 seconds
        const interval = setInterval(checkAuth, 60000);

        return () => {
            window.removeEventListener('focus', handleFocus);
            clearInterval(interval);
        };
    }, []);

    const hasPermission = (objectId: string, minLevel: number = 1): boolean => {
        // Super Admin Bypass (optional, better to rely on DB mapping if possible, but safe here)
        if (user?.role === 'superadmin' || user?.role === 'admin') return true;

        const level = permissions[objectId] || 0;
        return level >= minLevel;
    };

    const checkAuth = async () => {
        try {
            const res = await fetch(`${API_BASE}/ajax-get-user.php`, {
                credentials: 'include'
            });
            const data = await res.json();
            if (data.success && data.user) {
                // Update user data (check all fields that might change, not just ID)
                const newUser = {
                    id: data.user.id,
                    username: data.user.name,
                    role: data.user.role || 'user',
                    name: data.user.name || '',
                    initials: data.user.initials || '?',
                    assigned_tasks_count: data.user.assigned_tasks_count || 0
                };
                setUser(prev => {
                    if (!prev) return newUser;
                    // Compare all relevant fields
                    if (prev.id !== newUser.id ||
                        prev.role !== newUser.role ||
                        prev.name !== newUser.name) {
                        return newUser;
                    }
                    return prev;
                });
                setPermissions(prev => (JSON.stringify(prev) === JSON.stringify(data.permissions) ? prev : data.permissions || {}));
                setOrganizations(prev => (JSON.stringify(prev) === JSON.stringify(data.organizations) ? prev : data.organizations || []));
                setCurrentOrgId(prev => (prev === data.current_org_id ? prev : data.current_org_id || null));
            } else {
                setUser(null);
                setPermissions({});
            }
        } catch (e) {
            console.error("Auth check failed", e);
            // Don't clear user immediately on network error to prevent flickering, potentially
            // but for safety usually we do. Let's keep existing behavior but just log.
            // setUser(null); 
        } finally {
            setIsLoading(false);
        }
    };

    // ... (keep login/logout/switchOrg as is, but memoize the context value)

    const login = async (username: string, pass: string) => {
        try {
            // FIX: Use correct endpoint name ajax-login.php
            const res = await fetch(`${API_BASE}/ajax-login.php`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password: pass }),
                credentials: 'include'
            });
            const data = await res.json();
            if (data.success && data.user) {
                setUser({
                    id: data.user.id,
                    username: data.user.name, // Use 'name' from response
                    role: data.user.role,
                    name: data.user.name,
                    initials: data.user.initials,
                    assigned_tasks_count: data.user.assigned_tasks_count || 0
                });
                setPermissions(data.permissions || {});
                if (!data.permissions) {
                    checkAuth();
                }
                return true;
            }
            return false;
        } catch (e) {
            console.error(e);
            return false;
        }
    };

    const logout = () => {
        fetch(`${API_BASE}/ajax-logout.php`);
        setUser(null);
        setPermissions({});
        setOrganizations([]);
        setCurrentOrgId(null);
    };

    const switchOrg = async (orgId: string, preventReload: boolean = false) => {
        try {
            const res = await fetch(`${API_BASE}/ajax-set-org.php`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ org_id: orgId })
            });
            const json = await res.json();
            if (json.success) {
                setCurrentOrgId(orgId);
                if (!preventReload) window.location.reload();
                return true;
            }
        } catch (e) { console.error(e); }
        return false;
    };

    const contextValue = React.useMemo(() => ({
        user, permissions, isLoading, login, logout, hasPermission, organizations, currentOrgId, switchOrg, orgPrefix, getApiUrl
    }), [user, permissions, isLoading, organizations, currentOrgId, orgPrefix, getApiUrl]);

    return (
        <AuthContext.Provider value={contextValue}>
            {children}
        </AuthContext.Provider>
    );
};
