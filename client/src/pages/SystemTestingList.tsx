
import React, { useState, useEffect } from "react";
import {
    makeStyles,
    tokens,
    Button,
    Text,
    Spinner,
    TabList,
    Tab,
    SelectTabEvent,
    SelectTabEventHandler
} from "@fluentui/react-components";
import {
    Add24Regular,
    ClipboardTaskListLtr24Regular,
    Beaker24Regular,
    Warning24Regular
} from "@fluentui/react-icons";
import axios from "axios";
import { PageLayout, PageHeader, PageContent } from "../components/PageLayout";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next"; // Using i18next

// Define categories mapping for filter
const CATEGORIES: Record<string, string> = {
    'process': 'Procesy',
    'feature': 'Programové úpravy',
    'critical_path': 'Kritická cesta'
};

const useStyles = makeStyles({
    listContainer: {
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
    },
    itemRow: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "1rem",
        backgroundColor: tokens.colorNeutralBackground1,
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        borderRadius: tokens.borderRadiusMedium,
        cursor: "pointer",
        ":hover": {
            backgroundColor: tokens.colorNeutralBackground1Hover
        }
    },
    statusBadge: {
        fontSize: "12px",
        padding: "2px 8px",
        borderRadius: "12px",
        marginLeft: "8px"
    }
});

export const SystemTestingList: React.FC = () => {
    const navigate = useNavigate();
    const styles = useStyles();
    const { t } = useTranslation();

    // Valid categories: 'process', 'feature', 'critical_path'
    const [activeTab, setActiveTab] = useState('process');
    const [scenarios, setScenarios] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        loadData();
    }, [activeTab]);

    const loadData = async () => {
        setLoading(true);
        try {
            const res = await axios.get(`/api/api-system-testing.php?action=list_scenarios&category=${activeTab}`);
            setScenarios(res.data.data);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleTabSelect: SelectTabEventHandler = (e, data) => {
        setActiveTab(data.value as string);
    };

    const getStatusColor = (status: string) => {
        if (status === 'passed') return { bg: '#e6ffec', fg: 'green' };
        if (status === 'failed') return { bg: '#ffe6e6', fg: 'red' };
        return { bg: '#f3f2f1', fg: '#605e5c' };
    };

    return (
        <PageLayout>
            <PageHeader>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                    <Text size={500} weight="bold">Testování (Test Management)</Text>
                    <Button icon={<Add24Regular />} appearance="primary" onClick={() => navigate('/system/testing/new')}>
                        Nový scénář
                    </Button>
                </div>
            </PageHeader>
            <PageContent>
                <TabList selectedValue={activeTab} onTabSelect={handleTabSelect} style={{ marginBottom: '1rem' }}>
                    <Tab value="process" icon={<ClipboardTaskListLtr24Regular />}>Procesy</Tab>
                    <Tab value="feature" icon={<Beaker24Regular />}>Programové úpravy</Tab>
                    <Tab value="critical_path" icon={<Warning24Regular />}>Kritická cesta</Tab>
                </TabList>

                {loading ? <Spinner /> : (
                    <div className={styles.listContainer}>
                        {scenarios.length === 0 && (
                            <div style={{ textAlign: 'center', padding: '2rem', color: '#888' }}>
                                Žádné scénáře v této kategorii.
                            </div>
                        )}
                        {scenarios.map(item => {
                            const st = getStatusColor(item.last_status || 'none');
                            return (
                                <div key={item.rec_id} className={styles.itemRow} onClick={() => navigate(`/system/testing/${item.rec_id}`)}>
                                    <div>
                                        <Text weight="semibold" block>{item.title}</Text>
                                        <Text size={200} style={{ color: '#666' }}>{item.step_count} kroků | {item.description}</Text>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center' }}>
                                        {item.last_status && (
                                            <span style={{ backgroundColor: st.bg, color: st.fg, ...styles.statusBadge }}>
                                                {item.last_status} ({item.last_run_date?.substring(0, 10)})
                                            </span>
                                        )}
                                        {!item.last_status && <Text size={200} style={{ color: '#999' }}>Netestováno</Text>}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </PageContent>
        </PageLayout>
    );
};
