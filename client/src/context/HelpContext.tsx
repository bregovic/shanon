import React, { createContext, useContext, useState } from 'react';

interface HelpContextType {
    isOpen: boolean;
    openHelp: (topicKey?: string) => void; // Optionally jump to a specific topic
    closeHelp: () => void;
    currentTopic: string | null;
}

const HelpContext = createContext<HelpContextType | null>(null);

export const HelpProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [currentTopic, setCurrentTopic] = useState<string | null>(null);

    const openHelp = (topicKey?: string) => {
        if (topicKey) setCurrentTopic(topicKey);
        else setCurrentTopic(null); // Default view
        setIsOpen(true);
    };

    const closeHelp = () => {
        setIsOpen(false);
        setCurrentTopic(null);
    };

    return (
        <HelpContext.Provider value={{ isOpen, openHelp, closeHelp, currentTopic }}>
            {children}
        </HelpContext.Provider>
    );
};

export const useHelp = () => {
    const ctx = useContext(HelpContext);
    if (!ctx) throw new Error("useHelp must be used within HelpProvider");
    return ctx;
};
