import React, { createContext, useContext, useEffect, useCallback, useRef } from 'react';

/**
 * Keyboard Shortcuts System
 * 
 * Standard shortcuts:
 * - Esc: Go back / Close modal
 * - Enter: Confirm (context sensitive)
 * - Ctrl+S / Alt+S / Ctrl+Enter: Save
 * - Alt+N: New record
 * - Alt+D: Delete selected
 * - Alt+R: Refresh
 * - Alt+F: Toggle filters
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
            // Ignore if modifier keys are strictly Ctrl (excluding Enter/S) or Meta
            // We want to allow Alt

            const target = e.target as HTMLElement;
            const isInInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

            // 1. Escape - Global
            if (e.key === 'Escape') {
                const handler = handlersRef.current.get('escape');
                if (handler) { e.preventDefault(); handler(); return; }
            }

            // 2. Save (Ctrl+S or Alt+S) - Global
            if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') || (e.altKey && e.key.toLowerCase() === 's')) {
                const handler = handlersRef.current.get('save');
                if (handler) { e.preventDefault(); handler(); return; }
            }

            // 3. Confirm (Ctrl+Enter) - Global (e.g. submit form from textarea)
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                // Try 'save' first (often same action), then 'enter'
                const saveHandler = handlersRef.current.get('save');
                if (saveHandler) { e.preventDefault(); saveHandler(); return; }

                const enterHandler = handlersRef.current.get('enter');
                if (enterHandler) { e.preventDefault(); enterHandler(); return; }
            }

            // 4. Alt Shortcuts (Navigation/Actions)
            // ONLY when NOT in input mode (to avoid conflicts with typing)
            // Exclude Ctrl to avoid AltGr conflicts (AltGr = Ctrl+Alt)
            if (!isInInput && e.altKey && !e.ctrlKey) {
                let shortcutId: ShortcutId | null = null;
                switch (e.key.toLowerCase()) {
                    case 'n': shortcutId = 'new'; break;
                    case 'd': shortcutId = 'delete'; break;
                    case 'r': shortcutId = 'refresh'; break;
                    case 'f': shortcutId = 'toggleFilters'; break;
                }

                if (shortcutId) {
                    const handler = handlersRef.current.get(shortcutId);
                    if (handler) {
                        e.preventDefault();
                        handler();
                        return;
                    }
                }
            }

            // 5. Context-sensitive single keys (Only when NOT in input)
            if (!isInInput && !e.ctrlKey && !e.altKey && !e.metaKey) {
                // Enter
                if (e.key === 'Enter') {
                    const handler = handlersRef.current.get('enter');
                    if (handler) { e.preventDefault(); handler(); return; }
                }

                // F-Keys
                if (e.key === 'F2') {
                    // Rename/Edit logic could go here
                }
                if (e.key === 'F9') {
                    // Run logic could go here
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
