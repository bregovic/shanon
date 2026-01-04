
import React, { createContext, useContext, useState, useEffect } from 'react';

type User = {
    id: number;
    username: string;
    role: 'admin' | 'user' | 'superadmin' | 'developer';
    name: string;
    initials: string;
    assigned_tasks_count?: number;
};

type AuthContextType = {
    user: User | null;
    permissions: Record<string, number>;
    isLoading: boolean;
    login: (username: string, pass: string) => Promise<boolean>;
    logout: () => void;
    hasPermission: (objectId: string, minLevel?: number) => boolean;
};

const AuthContext = createContext<AuthContextType>({
    user: null,
    permissions: {},
    isLoading: true,
    login: async () => false,
    logout: () => { },
    hasPermission: () => false,
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [permissions, setPermissions] = useState<Record<string, number>>({});
    const [isLoading, setIsLoading] = useState(true);

    // FIX: Set correct API path for Shanon (Nginx maps /api -> Backend)
    const API_BASE = import.meta.env.DEV
        ? 'http://localhost/Webhry/hollyhop/broker/shanon/backend'
        : '/api';

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
                setUser({
                    id: data.user.id,
                    username: data.user.name,
                    role: data.user.role || 'user',
                    name: data.user.name || '',
                    initials: data.user.initials || '?',
                    assigned_tasks_count: data.user.assigned_tasks_count || 0
                });
                setPermissions(data.permissions || {});
            } else {
                setUser(null);
                setPermissions({});
            }
        } catch (e) {
            setUser(null);
            setPermissions({});
        } finally {
            setIsLoading(false);
        }
    };

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
                setPermissions(data.permissions || {}); // Assuming login might return permissions too, or we re-fetch
                // If login doesn't return permissions, call checkAuth immediately
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
        // Simple client logout. Server logout is usually stateless or handles own session destroy.
        fetch(`${API_BASE}/ajax-logout.php`);
        setUser(null);
        setPermissions({});
    };

    return (
        <AuthContext.Provider value={{ user, permissions, isLoading, login, logout, hasPermission }}>

            {children}
        </AuthContext.Provider>
    );
};
