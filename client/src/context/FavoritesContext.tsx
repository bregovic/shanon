import React, { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from './AuthContext';

export interface FavoriteItem {
    id: number;
    path: string;
    title: string;
    module?: string;
}

interface FavoritesContextType {
    favorites: FavoriteItem[];
    addFavorite: (path: string, title: string, module?: string) => Promise<void>;
    removeFavorite: (path: string) => Promise<void>;
    isFavorite: (path: string) => boolean;
    loading: boolean;
}

const FavoritesContext = createContext<FavoritesContextType | null>(null);

export const FavoritesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { user, getApiUrl } = useAuth();
    const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!user) {
            setFavorites([]);
            return;
        }

        const fetchFavorites = async () => {
            setLoading(true);
            try {
                const res = await axios.get(getApiUrl('api-favorites.php'));
                if (res.data.success) {
                    setFavorites(res.data.data);
                }
            } catch (e) {
                console.error("Failed to load favorites", e);
            } finally {
                setLoading(false);
            }
        };

        fetchFavorites();
    }, [user, getApiUrl]);

    const addFavorite = async (path: string, title: string, module?: string) => {
        try {
            await axios.post(getApiUrl('api-favorites.php'), { path, title, module });
            // Optimistic update or refetch
            setFavorites(prev => [...prev, { id: Date.now(), path, title, module }]); // Temp ID
            // Ideally refetch to get real ID, but not strictly needed for UI 
            // Better: await fetchFavorites();
            // Let's do simple optimistic for now, assuming success.
        } catch (e) {
            console.error("Failed to add favorite", e);
            throw e;
        }
    };

    const removeFavorite = async (path: string) => {
        try {
            await axios.delete(getApiUrl(`api-favorites.php?path=${encodeURIComponent(path)}`));
            setFavorites(prev => prev.filter(f => f.path !== path));
        } catch (e) {
            console.error("Failed to remove favorite", e);
            throw e;
        }
    };

    const isFavorite = (path: string) => {
        return favorites.some(f => f.path === path);
    };

    return (
        <FavoritesContext.Provider value={{ favorites, addFavorite, removeFavorite, isFavorite, loading }}>
            {children}
        </FavoritesContext.Provider>
    );
};

export const useFavorites = () => {
    const ctx = useContext(FavoritesContext);
    if (!ctx) throw new Error("useFavorites must be used within FavoritesProvider");
    return ctx;
};
