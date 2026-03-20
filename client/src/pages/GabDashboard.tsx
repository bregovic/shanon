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
    ChevronDown16Regular,
    ChevronUp16Regular,
    ArrowClockwise24Regular,
    BuildingBank24Regular
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
    // Mobile Scroll Layout Styles
    scrollContainer: {
        display: 'flex',
        gap: '32px',
        flexWrap: 'wrap',
        alignItems: 'flex-start',
        padding: '24px',
        '@media (max-width: 800px)': {
            flexWrap: 'nowrap',
            overflowX: 'auto',
            paddingBottom: '20px',
            scrollSnapType: 'x mandatory',
            gap: '16px',
            scrollPadding: '24px'
        }
    },
    scrollColumn: {
        flex: '1 1 300px',
        display: 'flex',
        flexDirection: 'column',
        gap: '0px',
        '@media (max-width: 800px)': {
            flex: '0 0 85vw',
            scrollSnapAlign: 'start',
            minWidth: 'auto'
        }
    }
});

export const GabDashboard: React.FC = () => {
    const styles = useStyles();
    const navigate = useNavigate();
    const { t } = useTranslation();
    const { currentOrgId } = useAuth();
    const orgPrefix = `/${currentOrgId || 'VACKR'}`;

    // Sections for GAB
    const SECTION_IDS = ['subjects', 'org_mgmt', 'settings'];
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
                        <BreadcrumbButton current>Správa organizace (GAB)</BreadcrumbButton>
                    </BreadcrumbItem>
                </Breadcrumb>

                <div style={{ flex: 1 }} />

                <div style={{ display: 'flex', gap: '8px', marginRight: '16px' }}>
                    <Button appearance="subtle" icon={<ChevronDown16Regular />} onClick={expandAll}>{t('system.expand_all')}</Button>
                    <Button appearance="subtle" icon={<ChevronUp16Regular />} onClick={collapseAll}>{t('system.collapse_all')}</Button>
                    <Divider vertical style={{ height: '20px', margin: 'auto 0' }} />
                </div>

                <Button icon={<ArrowClockwise24Regular />} onClick={() => {/* refresh */}}>{t('common.refresh')}</Button>
            </ActionBar>

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

                    <MenuSection id="subjects" title="Adresář" icon={<BuildingBank24Regular />} isOpen={expandedSections.has('subjects')} onToggle={toggleSection}>
                        <MenuItem label="Všechny subjekty" onClick={() => navigate(orgPrefix + '/gab/list')} path={orgPrefix + '/gab/list'} />
                        <MenuItem label="Moji dodavatelé" onClick={() => {}} />
                        <MenuItem label="Moji zákazníci" onClick={() => {}} />
                    </MenuSection>

                    <MenuSection id="org_mgmt" title="Vazby a Týmy" icon={<TaskListSquareLtr24Regular />} isOpen={expandedSections.has('org_mgmt')} onToggle={toggleSection}>
                        <MenuItem label="Zaměstnanci" onClick={() => {}} />
                        <MenuItem label="Organizační struktura" onClick={() => {}} />
                    </MenuSection>
                </div>

                {/* Group: SYSTÉMOVÉ ORG */}
                <div className={styles.scrollColumn} style={{ breakInside: 'avoid', marginBottom: '32px' }}>
                    <Text weight="bold" style={{
                        color: tokens.colorNeutralForeground2,
                        textTransform: 'uppercase',
                        fontSize: '13px',
                        letterSpacing: '0.5px',
                        display: 'block',
                        marginBottom: '16px'
                    }}>
                        Interní Organizace
                    </Text>
                    <MenuSection id="internals" title="Účtované Společnosti" icon={<BuildingBank24Regular />} isOpen={expandedSections.has('internals')} onToggle={toggleSection}>
                        <MenuItem label={t('users.organizations') || 'Společnosti'} onClick={() => navigate(orgPrefix + '/system/organizations')} path={orgPrefix + '/system/organizations'} />
                        <MenuItem label={t('shared_orgs.title')} onClick={() => navigate(orgPrefix + '/system/shared-orgs')} path={orgPrefix + '/system/shared-orgs'} />
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
                        {t('common.settings')}
                    </Text>

                    <MenuSection id="settings" title={t('common.settings')} icon={<Settings24Regular />} isOpen={expandedSections.has('settings')} onToggle={toggleSection}>
                        <MenuItem label="Parametry GAB" onClick={() => {}} />
                        <MenuItem label="Duplikační pravidla" onClick={() => {}} />
                    </MenuSection>
                </div>

            </div>
        </div>
    );
};
