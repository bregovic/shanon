import React, { useEffect, useState } from 'react';
import {
    Dialog,
    DialogSurface,
    DialogTitle,
    DialogBody,
    Button,
    Input,
    Spinner,
    Text,
    makeStyles,
    tokens
} from '@fluentui/react-components';
import { Search24Regular, Dismiss24Regular, QuestionCircle24Regular } from '@fluentui/react-icons';
import { useHelp } from '../context/HelpContext';
import { useAuth } from '../context/AuthContext';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';

const useStyles = makeStyles({
    dialogSurface: {
        maxWidth: '800px',
        width: '90%',
        height: '80vh',
        display: 'flex',
        flexDirection: 'column'
    },
    contentFunc: {
        display: 'flex',
        flex: 1,
        overflow: 'hidden',
        marginTop: '16px'
    },
    sidebar: {
        width: '250px',
        borderRight: `1px solid ${tokens.colorNeutralStroke2}`,
        paddingRight: '16px',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        '@media (max-width: 600px)': {
            display: 'none' // Hide sidebar on mobile if viewing content? or stack
        }
    },
    mainContent: {
        flex: 1,
        paddingLeft: '24px',
        overflowY: 'auto',
        lineHeight: 1.6
    },
    resultItem: {
        padding: '8px 12px',
        cursor: 'pointer',
        borderRadius: '4px',
        ':hover': {
            backgroundColor: tokens.colorNeutralBackground1Hover
        }
    },
    markdown: {
        fontFamily: tokens.fontFamilyBase,
        '& h1': { fontSize: '24px', marginBottom: '16px', color: tokens.colorBrandForeground1 },
        '& h2': { fontSize: '20px', marginTop: '24px', marginBottom: '12px', borderBottom: `1px solid ${tokens.colorNeutralStroke2}` },
        '& p': { marginBottom: '12px' },
        '& ul': { paddingLeft: '24px', marginBottom: '12px' },
        '& code': { backgroundColor: '#f0f0f0', padding: '2px 4px', borderRadius: '4px', fontFamily: 'monospace' }
    }
});

export const HelpModal: React.FC = () => {
    const styles = useStyles();
    const { isOpen, closeHelp, currentTopic } = useHelp();
    const { getApiUrl } = useAuth();

    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);

    // Loaded content
    const [pageContent, setPageContent] = useState<any>(null);
    const [pageLoading, setPageLoading] = useState(false);

    // Initial load handling
    useEffect(() => {
        if (isOpen) {
            // If opening with a specific topic, load it
            if (currentTopic) {
                loadPage(currentTopic);
            } else {
                // Otherwise perform default search (e.g. general help)
                performSearch('');
            }
        }
    }, [isOpen, currentTopic]);

    // Cleanup when closing
    useEffect(() => {
        if (!isOpen) {
            setSearchQuery('');
            setPageContent(null);
        }
    }, [isOpen]);

    const performSearch = async (query: string) => {
        setLoading(true);
        try {
            const res = await axios.get(getApiUrl(`api-help.php?action=search&q=${encodeURIComponent(query)}`));
            if (res.data.success) {
                setSearchResults(res.data.data);
            }
        } catch (e) {
            console.error("Search failed", e);
        } finally {
            setLoading(false);
        }
    };

    const loadPage = async (key: string) => {
        setPageLoading(true);
        try {
            const res = await axios.get(getApiUrl(`api-help.php?action=get&key=${key}`));
            if (res.data.success) {
                setPageContent(res.data.data);
            } else {
                setPageContent({ title: 'Nenalezeno', content: 'Téma nápovědy nebylo nalezeno.' });
            }
        } catch (e) {
            setPageContent({ title: 'Chyba', content: 'Nepodařilo se načíst obsah nápovědy.' });
        } finally {
            setPageLoading(false);
        }
    };

    const handleSearchChange = (_: any, data: any) => {
        setSearchQuery(data.value);
        // Debounce could be good here, but direct is fine for now
        performSearch(data.value);
    };

    return (
        <Dialog open={isOpen} onOpenChange={(_, data) => !data.open && closeHelp()}>
            <DialogSurface className={styles.dialogSurface}>
                <DialogBody style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                    <DialogTitle
                        action={<Button appearance="subtle" icon={<Dismiss24Regular />} onClick={closeHelp} aria-label="Close" />}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <QuestionCircle24Regular />
                            Centrum Nápovědy
                        </div>
                    </DialogTitle>

                    {/* Search Bar */}
                    <div style={{ marginTop: '16px' }}>
                        <Input
                            contentBefore={<Search24Regular />}
                            placeholder="Hledat v nápovědě..."
                            value={searchQuery}
                            onChange={handleSearchChange}
                            style={{ width: '100%' }}
                        />
                    </div>

                    <div className={styles.contentFunc}>
                        {/* Sidebar Results */}
                        <div className={styles.sidebar}>
                            <Text weight="semibold" style={{ marginBottom: '8px', color: tokens.colorNeutralForeground4 }}>Témata</Text>
                            {loading ? (
                                <Spinner size="small" />
                            ) : (
                                searchResults.length === 0 ? (
                                    <Text style={{ color: tokens.colorNeutralForeground3, fontStyle: 'italic' }}>Žádné výsledky</Text>
                                ) : (
                                    searchResults.map(res => (
                                        <div
                                            key={res.topic_key}
                                            className={styles.resultItem}
                                            onClick={() => loadPage(res.topic_key)}
                                            style={{ backgroundColor: pageContent?.topic_key === res.topic_key ? tokens.colorNeutralBackground2 : undefined }}
                                        >
                                            <Text weight="medium">{res.title}</Text>
                                            <div style={{ fontSize: '11px', color: tokens.colorNeutralForeground3 }}>{res.module}</div>
                                        </div>
                                    ))
                                )
                            )}
                        </div>

                        {/* Main Content Viewer */}
                        <div className={styles.mainContent}>
                            {pageLoading ? (
                                <div style={{ display: 'flex', justifyContent: 'center', marginTop: '40px' }}><Spinner label="Načítám článek..." /></div>
                            ) : (
                                pageContent ? (
                                    <div className={styles.markdown}>
                                        <ReactMarkdown>{pageContent.content}</ReactMarkdown>
                                    </div>
                                ) : (
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: tokens.colorNeutralForeground3, flexDirection: 'column', gap: '16px' }}>
                                        <Search24Regular style={{ fontSize: '48px', opacity: 0.5 }} />
                                        <Text>Vyberte téma ze seznamu nebo použijte vyhledávání.</Text>
                                    </div>
                                )
                            )}
                        </div>
                    </div>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};
