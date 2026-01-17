import React, { createContext, useContext, useEffect, useCallback, useRef } from 'react';

/**
 * Keyboard Shortcuts System
 * 
 * Standard shortcuts:
 * - Esc: Go back / Close modal
 * - Enter: Confirm / Submit (when focus is not in textarea)
 * - Shift+N: New record
 * - Shift+D: Delete selected
 * - Shift+R: Refresh
 * - Shift+S: Save
 * - Shift+F: Toggle filters (Funkce)
 */

export type ShortcutId =
    | 'escape'
    | 'enter'
    | 'new'
    | 'delete'
    | 'refresh'
    | 'save'
    | 'toggleFilters';

type ShortcutHandler = () => void;

interface KeyboardShortcutsContextType {
    registerHandler: (id: ShortcutId, handler: ShortcutHandler) => void;
    unregisterHandler: (id: ShortcutId) => void;
}

const KeyboardShortcutsContext = createContext<KeyboardShortcutsContextType | undefined>(undefined);

export const KeyboardShortcutsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const handlersRef = useRef<Map<ShortcutId, ShortcutHandler>>(new Map());

    const registerHandler = useCallback((id: ShortcutId, handler: ShortcutHandler) => {
        handlersRef.current.set(id, handler);
    }, []);

    const unregisterHandler = useCallback((id: ShortcutId) => {
        handlersRef.current.delete(id);
    }, []);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            const isInInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

            // Escape - always works (close modals, go back)
            if (e.key === 'Escape') {
                const handler = handlersRef.current.get('escape');
                if (handler) {
                    e.preventDefault();
                    handler();
                }
                return;
            }

            // Don't process other shortcuts when typing in inputs
            if (isInInput && !e.shiftKey) return;

            // Enter - confirm (only if not in textarea)
            if (e.key === 'Enter' && !e.shiftKey && target.tagName !== 'TEXTAREA') {
                const handler = handlersRef.current.get('enter');
                if (handler) {
                    e.preventDefault();
                    handler();
                }
                return;
            }

            // Shift + Key combinations
            if (e.shiftKey) {
                let shortcutId: ShortcutId | null = null;

                switch (e.key.toUpperCase()) {
                    case 'N': shortcutId = 'new'; break;
                    case 'D': shortcutId = 'delete'; break;
                    case 'R': shortcutId = 'refresh'; break;
                    case 'S': shortcutId = 'save'; break;
                    case 'F': shortcutId = 'toggleFilters'; break;
                }

                if (shortcutId) {
                    const handler = handlersRef.current.get(shortcutId);
                    if (handler) {
                        e.preventDefault();
                        handler();
                    }
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    return (
        <KeyboardShortcutsContext.Provider value={{ registerHandler, unregisterHandler }}>
            {children}
        </KeyboardShortcutsContext.Provider>
    );
};

/**
 * Hook to register keyboard shortcuts in components.
 * 
 * @example
 * ```tsx
 * useKeyboardShortcut('new', () => setIsAddDialogOpen(true));
 * useKeyboardShortcut('refresh', () => loadData());
 * useKeyboardShortcut('escape', () => navigate(-1));
 * ```
 */
export const useKeyboardShortcut = (id: ShortcutId, handler: ShortcutHandler, deps: React.DependencyList = []) => {
    const context = useContext(KeyboardShortcutsContext);

    useEffect(() => {
        if (!context) {
            console.warn('useKeyboardShortcut must be used within KeyboardShortcutsProvider');
            return;
        }

        context.registerHandler(id, handler);
        return () => context.unregisterHandler(id);
    }, [id, ...deps]);
};

export const useKeyboardShortcuts = () => {
    const context = useContext(KeyboardShortcutsContext);
    if (!context) {
        throw new Error('useKeyboardShortcuts must be used within KeyboardShortcutsProvider');
    }
    return context;
};
