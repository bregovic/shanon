import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';

/**
 * Access Levels:
 * 0 = No access
 * 1 = View only
 * 2 = Edit
 * 3 = Full (including delete, admin actions)
 */
export type AccessLevel = 0 | 1 | 2 | 3;

interface PermissionData {
    [objectIdentifier: string]: AccessLevel;
}

interface PermissionState {
    permissions: PermissionData;
    isAdmin: boolean;
    loading: boolean;
    error: string | null;
}

let cachedPermissions: PermissionData | null = null;
let cachedIsAdmin: boolean = false;
let cacheTimestamp: number = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export function usePermission() {
    const { user } = useAuth();
    const [state, setState] = useState<PermissionState>({
        permissions: cachedPermissions || {},
        isAdmin: cachedIsAdmin,
        loading: !cachedPermissions,
        error: null
    });

    const fetchPermissions = useCallback(async () => {
        if (!user?.id) {
            setState({ permissions: {}, isAdmin: false, loading: false, error: null });
            return;
        }

        // Use cache if valid
        if (cachedPermissions && (Date.now() - cacheTimestamp) < CACHE_TTL) {
            setState({ permissions: cachedPermissions, isAdmin: cachedIsAdmin, loading: false, error: null });
            return;
        }

        setState(prev => ({ ...prev, loading: true }));

        try {
            const res = await fetch(`/api/api-security.php?action=check_user_permissions&user_id=${user.id}`);
            const json = await res.json();

            if (json.success) {
                cachedPermissions = json.data;
                cachedIsAdmin = json.is_admin;
                cacheTimestamp = Date.now();
                setState({ permissions: json.data, isAdmin: json.is_admin, loading: false, error: null });
            } else {
                setState(prev => ({ ...prev, loading: false, error: json.error }));
            }
        } catch (e) {
            setState(prev => ({ ...prev, loading: false, error: 'Failed to load permissions' }));
        }
    }, [user?.id]);

    useEffect(() => {
        fetchPermissions();
    }, [fetchPermissions]);

    /**
     * Check if user has at least the required access level for an object
     * @param objectIdentifier - e.g., 'mod_dms', 'form_security_roles'
     * @param requiredLevel - Minimum access level needed (default: 1 = view)
     */
    const hasPermission = useCallback((objectIdentifier: string, requiredLevel: AccessLevel = 1): boolean => {
        // Admin always has full access
        if (state.isAdmin) return true;

        const userLevel = state.permissions[objectIdentifier] ?? 0;
        return userLevel >= requiredLevel;
    }, [state.permissions, state.isAdmin]);

    /**
     * Get the access level for a specific object
     */
    const getAccessLevel = useCallback((objectIdentifier: string): AccessLevel => {
        if (state.isAdmin) return 3;
        return (state.permissions[objectIdentifier] ?? 0) as AccessLevel;
    }, [state.permissions, state.isAdmin]);

    /**
     * Check if user can view (level >= 1)
     */
    const canView = useCallback((objectIdentifier: string): boolean => {
        return hasPermission(objectIdentifier, 1);
    }, [hasPermission]);

    /**
     * Check if user can edit (level >= 2)
     */
    const canEdit = useCallback((objectIdentifier: string): boolean => {
        return hasPermission(objectIdentifier, 2);
    }, [hasPermission]);

    /**
     * Check if user has full access (level >= 3)
     */
    const canAdmin = useCallback((objectIdentifier: string): boolean => {
        return hasPermission(objectIdentifier, 3);
    }, [hasPermission]);

    /**
     * Invalidate cache and refetch
     */
    const refresh = useCallback(() => {
        cachedPermissions = null;
        cacheTimestamp = 0;
        fetchPermissions();
    }, [fetchPermissions]);

    return {
        ...state,
        hasPermission,
        getAccessLevel,
        canView,
        canEdit,
        canAdmin,
        refresh
    };
}

// Utility for checking admin status without hook
export function clearPermissionCache() {
    cachedPermissions = null;
    cachedIsAdmin = false;
    cacheTimestamp = 0;
}
