
import React from 'react';
import {
    makeStyles,
    tokens,
    Title3,
    Text,
    Card,
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbButton,
    BreadcrumbDivider
} from '@fluentui/react-components';
import {
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

const SectionLink = ({ text, onClick }: { text: string, onClick?: () => void }) => {
    const styles = useStyles();
    return (
        <div className={styles.actionLink} onClick={onClick}>
            <Text>{text}</Text>
        </div>
    )
}

export const DmsDashboard: React.FC = () => {
    const styles = useStyles();
    const navigate = useNavigate();

    return (
        <div className={styles.root}>
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
                {/* No buttons here anymore */}
            </ActionBar>

            <div className={styles.grid}>
                {/* 1. FORMULÁŘE */}
                <Card className={styles.sectionCard}>
                    <div className={styles.cardHeader}>
                        <FormNew24Regular />
                        <Title3>Formuláře</Title3>
                    </div>
                    <div className={styles.cardBody}>
                        <SectionLink text="Všechny dokumenty" onClick={() => navigate('/dms/list')} />
                        <SectionLink text="Ke schválení" />
                        <SectionLink text="Moje koncepty" />
                    </div>
                </Card>

                {/* 2. REPORTY */}
                <Card className={styles.sectionCard}>
                    <div className={styles.cardHeader}>
                        <DocumentPdf24Regular />
                        <Title3>Reporty</Title3>
                    </div>
                    <div className={styles.cardBody}>
                        <SectionLink text="Statistika nahrávání" />
                        <SectionLink text="Využití úložiště" />
                    </div>
                </Card>

                {/* 3. ÚLOHY */}
                <Card className={styles.sectionCard}>
                    <div className={styles.cardHeader}>
                        <TaskListSquareLtr24Regular />
                        <Title3>Úlohy</Title3>
                    </div>
                    <div className={styles.cardBody}>
                        <SectionLink text="Moje úkoly (0)" />
                        <SectionLink text="Delegované úkoly" />
                    </div>
                </Card>

                {/* 4. NASTAVENÍ */}
                <Card className={styles.sectionCard}>
                    <div className={styles.cardHeader}>
                        <Settings24Regular />
                        <Title3>Nastavení</Title3>
                    </div>
                    <div className={styles.cardBody}>
                        <SectionLink text="Typy dokumentů" />
                        <SectionLink text="Číselné řady" />
                        <SectionLink text="Přístupová práva" />
                    </div>
                </Card>
            </div>
        </div>
    );
};
