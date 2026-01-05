import React, { createContext, useContext, useState, useEffect } from 'react';
import { makeStyles, tokens, Button, Tooltip } from '@fluentui/react-components';
import { Filter24Regular, ChevronDown24Regular, ChevronUp24Regular } from '@fluentui/react-icons';

// --- Context ---
interface PageLayoutContextValue {
    hasFilters: boolean;
    setHasFilters: (has: boolean) => void;
    isFiltersOpen: boolean;
    toggleFilters: () => void;
}

const PageLayoutContext = createContext<PageLayoutContextValue>({
    hasFilters: false,
    setHasFilters: () => { },
    isFiltersOpen: false,
    toggleFilters: () => { }
});

const useStyles = makeStyles({
    root: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        boxSizing: 'border-box'
    }
});

export const PageLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const styles = useStyles();
    const [hasFilters, setHasFilters] = useState(false);
    const [isFiltersOpen, setIsFiltersOpen] = useState(false); // Default: Collapsed

    const toggleFilters = () => setIsFiltersOpen(prev => !prev);

    return (
        <PageLayoutContext.Provider value={{ hasFilters, setHasFilters, isFiltersOpen, toggleFilters }}>
            <div className={styles.root}>{children}</div>
        </PageLayoutContext.Provider>
    );
};

const useHeaderStyles = makeStyles({
    root: {
        width: '100%',
        padding: '10px 24px',
        paddingRight: '24px', // Reduced slightly to account for extra button if clear
        backgroundColor: tokens.colorNeutralBackground1,
        borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
        display: 'flex',
        alignItems: 'center',
        // We use an inner container for the user content to maintain space-between
        justifyContent: 'flex-start',
        gap: '12px',
        flexShrink: 0,
        boxSizing: 'border-box',
        overflowX: 'visible', // Changed to allow tooltip/menu overflow if needed
        zIndex: 10,
        '@media (max-width: 768px)': {
            padding: '10px 12px'
        }
    },
    userContent: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexGrow: 1,
        gap: '12px',
        overflowX: 'auto',
        scrollbarWidth: 'none',
        '::-webkit-scrollbar': { display: 'none' }
    }
});

export const PageHeader: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const styles = useHeaderStyles();
    const { hasFilters, isFiltersOpen, toggleFilters } = useContext(PageLayoutContext);

    return (
        <div className={styles.root}>
            <div className={styles.userContent}>
                {children}
            </div>
            {hasFilters && (
                <Tooltip content={isFiltersOpen ? "Skrýt filtry" : "Zobrazit filtry"} relationship="label">
                    <Button
                        appearance="subtle"
                        icon={<Filter24Regular />}
                        iconPosition="before"
                        onClick={toggleFilters}
                        aria-label="Toggle Filters"
                    >
                        Filtry
                        {isFiltersOpen ? <ChevronUp24Regular style={{ marginLeft: 6 }} /> : <ChevronDown24Regular style={{ marginLeft: 6 }} />}
                    </Button>
                </Tooltip>
            )}
        </div>
    );
};

// --- Standardized Filter Bar ---
const useFilterBarStyles = makeStyles({
    root: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-start', // Standard: Left aligned
        gap: '16px',
        flexWrap: 'nowrap',
        padding: '8px 24px',
        backgroundColor: tokens.colorNeutralBackground2, // Standard: Gray
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        flexShrink: 0,
        overflowX: 'auto',
        animationDuration: '0.2s',
        animationName: {
            from: { opacity: 0, transform: 'translateY(-10px)' },
            to: { opacity: 1, transform: 'translateY(0)' }
        },
        '@media (max-width: 768px)': {
            padding: '8px 12px'
        }
    }
});

export const PageFilterBar: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const styles = useFilterBarStyles();
    const { setHasFilters, isFiltersOpen } = useContext(PageLayoutContext);

    useEffect(() => {
        setHasFilters(true);
        return () => setHasFilters(false);
    }, [setHasFilters]);

    if (!isFiltersOpen) return null;

    return <div className={styles.root}>{children}</div>;
};

const useContentStyles = makeStyles({
    root: {
        flexGrow: 1,
        overflow: 'auto',
        padding: '24px',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: '24px',
        touchAction: 'pan-y',
        '-webkit-overflow-scrolling': 'touch',
        '@media (max-width: 768px)': {
            padding: '12px',
            gap: '12px'
        }
    }
});

export const PageContent: React.FC<{ children: React.ReactNode; noScroll?: boolean }> = ({ children, noScroll }) => {
    const styles = useContentStyles();
    return <div className={styles.root} style={noScroll ? { overflow: 'hidden' } : undefined}>{children}</div>;
};
