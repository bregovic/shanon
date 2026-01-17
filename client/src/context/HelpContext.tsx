import React, { createContext, useContext, useState } from 'react';

interface HelpContextType {
    isOpen: boolean;
    openHelp: (topicKey?: string, contextPath?: string) => void;
    closeHelp: () => void;
    currentTopic: string | null;
    currentPath: string | null;
}

const HelpContext = createContext<HelpContextType | null>(null);

export const HelpProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [currentTopic, setCurrentTopic] = useState<string | null>(null);
    const [currentPath, setCurrentPath] = useState<string | null>(null);

    const openHelp = (topicKey?: string, path?: string) => {
        setCurrentTopic(topicKey || null);
        setCurrentPath(path || null);
        setIsOpen(true);
    };

    const closeHelp = () => {
        setIsOpen(false);
        setCurrentTopic(null);
        setCurrentPath(null);
    };

    return (
        <HelpContext.Provider value={{ isOpen, openHelp, closeHelp, currentTopic, currentPath }}>
            {children}
        </HelpContext.Provider>
    );
};

export const useHelp = () => {
    const ctx = useContext(HelpContext);
    if (!ctx) throw new Error("useHelp must be used within HelpProvider");
    return ctx;
};
