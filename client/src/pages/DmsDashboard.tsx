
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
import { useAuth } from '../context/AuthContext';
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
    const { currentOrgId } = useAuth();
    const orgPrefix = `/${currentOrgId || 'VACKR'}`;


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
                        <BreadcrumbButton onClick={() => navigate(orgPrefix + '/dashboard')}>{t('common.modules')}</BreadcrumbButton>
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

                <Button icon={<ArrowClockwise24Regular />} onClick={() => {/* refresh logic if any */ }}>{t('common.refresh')}</Button>
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
                        {t('system.menu.forms')}
                    </Text>

                    <MenuSection id="documents" title={t('dms.menu.documents')} icon={<Document24Regular />} isOpen={expandedSections.has('documents')} onToggle={toggleSection}>
                        <MenuItem label={t('dms.menu.all_documents')} onClick={() => navigate(orgPrefix + '/dms/list')} />
                        <MenuItem label={t('dms.menu.review')} onClick={() => navigate(orgPrefix + '/dms/review')} />
                        <MenuItem label={t('dms.menu.to_approve')} onClick={() => { }} />
                        <MenuItem label={t('dms.menu.my_drafts')} onClick={() => { }} />
                    </MenuSection>

                    <MenuSection id="reports" title={t('system.menu.reports')} icon={<DocumentPdf24Regular />} isOpen={expandedSections.has('reports')} onToggle={toggleSection}>
                        <MenuItem label={t('dms.reports.upload_stats')} onClick={() => { }} />
                        <MenuItem label={t('dms.reports.storage_usage')} onClick={() => { }} />
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
                        {t('dms.integrations')}
                    </Text>

                    <MenuSection id="tasks" title={t('dms.integrations')} icon={<TaskListSquareLtr24Regular />} isOpen={expandedSections.has('tasks')} onToggle={toggleSection}>
                        <MenuItem label={t('dms.import_documents')} onClick={() => navigate(orgPrefix + '/dms/import')} />
                        <MenuItem label={t('dms.google_setup')} onClick={() => navigate(orgPrefix + '/dms/google-setup')} />
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
                        {t('system.menu.settings')}
                    </Text>

                    <MenuSection id="settings" title={t('system.menu.settings')} icon={<Settings24Regular />} isOpen={expandedSections.has('settings')} onToggle={toggleSection}>
                        <MenuItem label={t('dms.settings.parameters')} onClick={() => navigate(orgPrefix + '/dms/settings')} />
                    </MenuSection>
                </div>

            </div>
        </div>
    );
};
