
import React, { createContext, useContext, useState, useEffect } from 'react';

type User = {
    id: number;
    username: string;
    role: 'admin' | 'user';
    name: string;
    initials: string;
    assigned_tasks_count?: number;
};

type AuthContextType = {
    user: User | null;
    isLoading: boolean;
    login: (username: string, pass: string) => Promise<boolean>;
    logout: () => void;
};

const AuthContext = createContext<AuthContextType>({
    user: null,
    isLoading: true,
    login: async () => false,
    logout: () => { },
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    // FIX: Set correct API path for Shanon (Nginx maps /api -> Backend)
    const API_BASE = import.meta.env.DEV
        ? 'http://localhost:8000/api' // Assuming local dev proxy or backend port
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
            } else {
                setUser(null);
            }
        } catch (e) {
            setUser(null);
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
    };

    return (
        <AuthContext.Provider value={{ user, isLoading, login, logout }}>
            {children}
        </AuthContext.Provider>
    );
};
