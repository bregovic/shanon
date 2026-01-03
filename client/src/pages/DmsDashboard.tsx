
import React from 'react';
import {
    makeStyles,
    tokens,
    Title3,
    Text,
    Card,
    Button,
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbButton,
    BreadcrumbDivider
} from '@fluentui/react-components';
import {
    DocumentAdd24Regular,
    ArrowUpload24Regular,
    Folder24Regular,
    Settings24Regular,
    TaskListSquareLtr24Regular,
    FormNew24Regular,
    DocumentPdf24Regular
} from '@fluentui/react-icons';
import { ActionBar } from '../components/ActionBar';
import { useNavigate } from 'react-router-dom';

const useStyles = makeStyles({
    root: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: tokens.colorNeutralBackground2
    },
    grid: {
        padding: '24px',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: '24px',
        maxWidth: '1200px'
    },
    sectionCard: {
        padding: '0',
        display: 'flex',
        flexDirection: 'column',
        height: '100%'
    },
    cardHeader: {
        padding: '16px',
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        backgroundColor: tokens.colorNeutralBackground1
    },
    cardBody: {
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        backgroundColor: tokens.colorNeutralBackground1,
        flex: 1
    },
    actionLink: {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '8px',
        cursor: 'pointer',
        borderRadius: '4px',
        ':hover': {
            backgroundColor: tokens.colorNeutralBackground2
        }
    }
});

const SectionLink = ({ icon, text, onClick }: { icon: any, text: string, onClick?: () => void }) => {
    const styles = useStyles();
    return (
        <div className={styles.actionLink} onClick={onClick}>
            <span style={{ color: tokens.colorBrandForeground1 }}>{icon}</span>
            <Text>{text}</Text>
        </div>
    )
}

export const DmsDashboard: React.FC = () => {
    const styles = useStyles();
    const navigate = useNavigate();

    return (
        <div className={styles.root}>
            {/* YELLOW ACTION BAR */}
            <ActionBar>
                <Breadcrumb>
                    <BreadcrumbItem>
                        <BreadcrumbButton>Moduly</BreadcrumbButton>
                    </BreadcrumbItem>
                    <BreadcrumbDivider />
                    <BreadcrumbItem>
                        <BreadcrumbButton current>DMS</BreadcrumbButton>
                    </BreadcrumbItem>
                </Breadcrumb>
                <div style={{ flex: 1 }} />
                {/* Module Level Actions */}
                <Button appearance="subtle" icon={<DocumentAdd24Regular />}>Nový dokument</Button>
                <Button appearance="subtle" icon={<ArrowUpload24Regular />}>Importovat</Button>
            </ActionBar>

            <div className={styles.grid}>
                {/* 1. FORMULÁŘE (Forms) */}
                <Card className={styles.sectionCard}>
                    <div className={styles.cardHeader}>
                        <FormNew24Regular />
                        <Title3>Formuláře</Title3>
                    </div>
                    <div className={styles.cardBody}>
                        <SectionLink icon={<Folder24Regular />} text="Všechny dokumenty" onClick={() => navigate('/dms/list')} />
                        <SectionLink icon={<DocumentAdd24Regular />} text="Ke schválení" />
                        <SectionLink icon={<DocumentAdd24Regular />} text="Moje koncepty" />
                    </div>
                </Card>

                {/* 2. REPORTY (Reports) */}
                <Card className={styles.sectionCard}>
                    <div className={styles.cardHeader}>
                        <DocumentPdf24Regular />
                        <Title3>Reporty</Title3>
                    </div>
                    <div className={styles.cardBody}>
                        <SectionLink icon={<DocumentPdf24Regular />} text="Statistika nahrávání" />
                        <SectionLink icon={<DocumentPdf24Regular />} text="Využití úložiště" />
                    </div>
                </Card>

                {/* 3. ÚLOHY (Tasks) */}
                <Card className={styles.sectionCard}>
                    <div className={styles.cardHeader}>
                        <TaskListSquareLtr24Regular />
                        <Title3>Úlohy</Title3>
                    </div>
                    <div className={styles.cardBody}>
                        <SectionLink icon={<TaskListSquareLtr24Regular />} text="Moje úkoly (0)" />
                        <SectionLink icon={<TaskListSquareLtr24Regular />} text="Delegované úkoly" />
                    </div>
                </Card>

                {/* 4. NASTAVENÍ (Settings) */}
                <Card className={styles.sectionCard}>
                    <div className={styles.cardHeader}>
                        <Settings24Regular />
                        <Title3>Nastavení</Title3>
                    </div>
                    <div className={styles.cardBody}>
                        <SectionLink icon={<Settings24Regular />} text="Typy dokumentů" />
                        <SectionLink icon={<Settings24Regular />} text="Číselné řady" />
                        <SectionLink icon={<Settings24Regular />} text="Přístupová práva" />
                    </div>
                </Card>
            </div>
        </div>
    );
};
