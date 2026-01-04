
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

import { translations as localTranslations } from '../locales/translations';
import type { Language } from '../locales/translations';

export const useTranslation = () => useContext(TranslationContext);

export const TranslationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { language } = useSettings();
    const [translations, setTranslations] = useState<Record<string, string>>({});
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        const loadTranslations = async () => {
            setIsLoading(true);

            // 1. Load Local Translations FIRST
            const currentLang = (language as Language) || 'cs';
            const local = localTranslations[currentLang] || localTranslations['cs'];

            // Set local immediately so UI doesn't flicker or show keys
            setTranslations(local);

            try {
                // 2. Fetch Server Translations (Optional Override)
                const res = await fetch(`/api/api-translations.php?lang=${language}`);
                if (res.ok) {
                    const data = await res.json();
                    if (data.success && data.translations) {
                        // Merge server translations over local
                        setTranslations(prev => ({ ...prev, ...data.translations }));
                    }
                }
            } catch (e) {
                console.error("Failed to load server translations, using local only", e);
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
