
import React, { useState } from 'react';
import {
    makeStyles,
    tokens,
    Button,
    Divider,
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbButton,
    BreadcrumbDivider,
    Text
} from '@fluentui/react-components';
import {
    Settings24Regular,
    TaskListSquareLtr24Regular,
    DocumentPdf24Regular,
    ChevronDown16Regular,
    ChevronUp16Regular,
    ArrowClockwise24Regular,
    Document24Regular
} from '@fluentui/react-icons';
import { ActionBar } from '../components/ActionBar';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '../context/TranslationContext';
import { MenuSection, MenuItem } from '../components/MenuSection';

const useStyles = makeStyles({
    root: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: tokens.colorNeutralBackground2
    },
    // Mobile Scroll Layout Styles (Shared Standard)
    scrollContainer: {
        display: 'flex',
        gap: '32px',
        flexWrap: 'wrap',
        alignItems: 'flex-start',
        padding: '24px',
        '@media (max-width: 800px)': {
            flexWrap: 'nowrap',
            overflowX: 'auto',
            paddingBottom: '20px', // Space for scrollbar
            scrollSnapType: 'x mandatory',
            gap: '16px',
            scrollPadding: '24px' // Padding for snap alignment
        }
    },
    scrollColumn: {
        flex: '1 1 300px',
        display: 'flex',
        flexDirection: 'column',
        gap: '0px',
        '@media (max-width: 800px)': {
            flex: '0 0 85vw', // Take most of width but show hint of next column
            scrollSnapAlign: 'start',
            minWidth: 'auto'
        }
    }
});

export const DmsDashboard: React.FC = () => {
    const styles = useStyles();
    const navigate = useNavigate();
    const { t } = useTranslation();

    // Sections for DMS
    const SECTION_IDS = ['documents', 'reports', 'tasks', 'settings'];
    const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(SECTION_IDS));

    const toggleSection = (id: string) => {
        const next = new Set(expandedSections);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setExpandedSections(next);
    };

    const expandAll = () => setExpandedSections(new Set(SECTION_IDS));
    const collapseAll = () => setExpandedSections(new Set());

    return (
        <div className={styles.root}>
            <ActionBar>
                <Breadcrumb>
                    <BreadcrumbItem>
                        <BreadcrumbButton onClick={() => navigate('/dashboard')}>{t('common.modules')}</BreadcrumbButton>
                    </BreadcrumbItem>
                    <BreadcrumbDivider />
                    <BreadcrumbItem>
                        <BreadcrumbButton current>{t('modules.dms')}</BreadcrumbButton>
                    </BreadcrumbItem>
                </Breadcrumb>

                <div style={{ flex: 1 }} />

                {/* Standard Toolbar Actions */}
                <div style={{ display: 'flex', gap: '8px', marginRight: '16px' }}>
                    <Button appearance="subtle" icon={<ChevronDown16Regular />} onClick={expandAll}>{t('system.expand_all')}</Button>
                    <Button appearance="subtle" icon={<ChevronUp16Regular />} onClick={collapseAll}>{t('system.collapse_all')}</Button>
                    <Divider vertical style={{ height: '20px', margin: 'auto 0' }} />
                </div>

                <Button icon={<ArrowClockwise24Regular />} onClick={() => {/* refresh logic if any */ }}>Obnovit</Button>
            </ActionBar>

            {/* 3-Column Layout */}
            <div className={styles.scrollContainer}>

                {/* Group: FORMULÁŘE */}
                <div className={styles.scrollColumn} style={{ breakInside: 'avoid', marginBottom: '32px' }}>
                    <Text weight="bold" style={{
                        color: tokens.colorNeutralForeground2,
                        textTransform: 'uppercase',
                        fontSize: '13px',
                        letterSpacing: '0.5px',
                        display: 'block',
                        marginBottom: '16px'
                    }}>
                        Formuláře
                    </Text>

                    <MenuSection id="documents" title="Dokumenty" icon={<Document24Regular />} isOpen={expandedSections.has('documents')} onToggle={toggleSection}>
                        <MenuItem label="Všechny dokumenty" onClick={() => navigate('/dms/list')} />
                        <MenuItem label="Ke schválení" onClick={() => { }} />
                        <MenuItem label="Moje koncepty" onClick={() => { }} />
                    </MenuSection>

                    <MenuSection id="reports" title={t('system.menu.reports')} icon={<DocumentPdf24Regular />} isOpen={expandedSections.has('reports')} onToggle={toggleSection}>
                        <MenuItem label="Statistika nahrávání" onClick={() => { }} />
                        <MenuItem label="Využití úložiště" onClick={() => { }} />
                    </MenuSection>
                </div>

                {/* Group: ÚLOHY */}
                <div className={styles.scrollColumn} style={{ breakInside: 'avoid', marginBottom: '32px' }}>
                    <Text weight="bold" style={{
                        color: tokens.colorNeutralForeground2,
                        textTransform: 'uppercase',
                        fontSize: '13px',
                        letterSpacing: '0.5px',
                        display: 'block',
                        marginBottom: '16px'
                    }}>
                        Úlohy
                    </Text>

                    <MenuSection id="tasks" title={t('system.menu.tasks')} icon={<TaskListSquareLtr24Regular />} isOpen={expandedSections.has('tasks')} onToggle={toggleSection}>
                        <MenuItem label="Moje úkoly (0)" onClick={() => { }} />
                        <MenuItem label="Delegované úkoly" onClick={() => { }} />
                    </MenuSection>
                </div>

                {/* Group: NASTAVENÍ */}
                <div className={styles.scrollColumn} style={{ breakInside: 'avoid', marginBottom: '32px' }}>
                    <Text weight="bold" style={{
                        color: tokens.colorNeutralForeground2,
                        textTransform: 'uppercase',
                        fontSize: '13px',
                        letterSpacing: '0.5px',
                        display: 'block',
                        marginBottom: '16px'
                    }}>
                        Nastavení
                    </Text>

                    <MenuSection id="settings" title={t('system.menu.settings')} icon={<Settings24Regular />} isOpen={expandedSections.has('settings')} onToggle={toggleSection}>
                        <MenuItem label="Typy dokumentů" onClick={() => navigate('/dms/settings')} />
                        <MenuItem label="Číselné řady" onClick={() => { }} />
                        <MenuItem label="Atributy" onClick={() => { }} />
                        <MenuItem label="Úložiště" onClick={() => { }} />
                    </MenuSection>
                </div>

            </div>
        </div>
    );
};
