
import { useState, useEffect, useCallback } from 'react';

// Use idb-keyval lightweight wrapper pattern if not available, 
// but since we are in raw TS/React without extra deps, we implement a tiny wrapper.
// This requires no external npm packages.

const DB_NAME = 'ShanonLocalStore';
const STORE_NAME = 'sys_last_values';
const VERSION = 1;

const initDB = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, VERSION);
        req.onupgradeneeded = (e) => {
            const db = (e.target as any).result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
};

export const getLocalLastValue = async (key: string): Promise<any> => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
};

export const setLocalLastValue = async (key: string, value: any): Promise<void> => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.put(value, key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
};

/**
 * Hook to manage persistent state (Local IndexedDB for complex objects like FileHandles, 
 * Server for simple prefs - though server sync is implemented in separate context).
 * For now, this is purely for the FileHandle use-case requested.
 */
export function useLocalLastValue<T>(key: string, initialValue: T | null = null) {
    const [value, setVal] = useState<T | null>(initialValue);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        getLocalLastValue(key).then((val) => {
            if (val !== undefined) setVal(val);
            setLoading(false);
        }).catch(err => {
            console.error("IDB Error", err);
            setLoading(false);
        });
    }, [key]);

    const setValue = useCallback((newVal: T) => {
        setVal(newVal);
        setLocalLastValue(key, newVal).catch(console.error);
    }, [key]);

    return { value, setValue, loading };
}
