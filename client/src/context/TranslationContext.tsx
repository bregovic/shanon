
import React, { createContext, useContext, useEffect, useState } from 'react';
import { useSettings } from './SettingsContext';

type TranslationContextType = {
    t: (key: string) => string;
    isLoading: boolean;
};

const TranslationContext = createContext<TranslationContextType>({
    t: (k) => k,
    isLoading: false,
});

export const useTranslation = () => useContext(TranslationContext);

export const TranslationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { language } = useSettings();
    const [translations, setTranslations] = useState<Record<string, string>>({});
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        const loadTranslations = async () => {
            setIsLoading(true);
            try {
                // FIX: Correct API Path
                const res = await fetch(`/api/api-translations.php?lang=${language}`);
                if (res.ok) {
                    const data = await res.json();
                    if (data.success && data.translations) {
                        setTranslations(data.translations);
                    }
                }
            } catch (e) {
                console.error("Failed to load translations", e);
            } finally {
                setIsLoading(false);
            }
        };

        loadTranslations();
    }, [language]);

    const t = (key: string) => {
        return translations[key] || key;
    };

    return (
        <TranslationContext.Provider value={{ t, isLoading }}>
            {children}
        </TranslationContext.Provider>
    );
};
