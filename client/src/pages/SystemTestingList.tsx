import React, { useState, useEffect } from "react";
import {
    Button,
    Badge,
    TabList,
    Tab,
    Text,
    createTableColumn
} from "@fluentui/react-components";
import type { SelectTabEventHandler, TableColumnDefinition } from "@fluentui/react-components";
import {
    Add24Regular,
    ClipboardTaskListLtr24Regular,
    Beaker24Regular,
    Warning24Regular,
    Delete24Regular,
    Play24Regular,
    Document24Regular
} from "@fluentui/react-icons";
import axios from "axios";
import { PageLayout, PageHeader, PageFilterBar, PageContent } from "../components/PageLayout";
import { SmartDataGrid } from "../components/SmartDataGrid";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

interface TestScenario {
    rec_id: number;
    title: string;
    description: string;
    category: string;
    step_count: number;
    last_status: string | null;
    last_run_date: string | null;
}

export const SystemTestingList: React.FC = () => {
    const navigate = useNavigate();
    const { t } = useTranslation();
    const [activeTab, setActiveTab] = useState('process');
    const [items, setItems] = useState<TestScenario[]>([]);
    const [loading, setLoading] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

    useEffect(() => {
        loadData();
    }, [activeTab]);

    const loadData = async () => {
        setLoading(true);
        setSelectedIds(new Set()); // Reset selection on tab change
        try {
            const res = await axios.get(`/api/api-system-testing.php?action=list_scenarios&category=${activeTab}`);
            if (res.data.success) {
                setItems(res.data.data);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleTabSelect: SelectTabEventHandler = (e, data) => {
        setActiveTab(data.value as string);
    };

    const columns: TableColumnDefinition<TestScenario>[] = [
        createTableColumn<TestScenario>({
            columnId: 'rec_id',
            compare: (a, b) => a.rec_id - b.rec_id,
            renderHeaderCell: () => 'ID',
            renderCell: (item) => <Text>{item.rec_id}</Text>
        }),
        createTableColumn<TestScenario>({
            columnId: 'title',
            compare: (a, b) => a.title.localeCompare(b.title),
            renderHeaderCell: () => 'Název scénáře',
            renderCell: (item) => (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <Text weight="semibold">{item.title}</Text>
                    <Text size={200} style={{ color: '#666' }}>{item.description}</Text>
                </div>
            )
        }),
        createTableColumn<TestScenario>({
            columnId: 'step_count',
            compare: (a, b) => a.step_count - b.step_count,
            renderHeaderCell: () => 'Kroky',
            renderCell: (item) => <Text>{item.step_count}</Text>
        }),
        createTableColumn<TestScenario>({
            columnId: 'last_status',
            compare: (a, b) => (a.last_status || '').localeCompare(b.last_status || ''),
            renderHeaderCell: () => 'Poslední stav',
            renderCell: (item) => {
                const map: Record<string, { label: string, color: 'success' | 'danger' | 'informative' }> = {
                    'passed': { label: 'OK', color: 'success' },
                    'failed': { label: 'Chyba', color: 'danger' },
                    'none': { label: 'Netestováno', color: 'informative' }
                };
                const st = map[item.last_status || 'none'] || { label: item.last_status || '-', color: 'informative' };
                return (
                    <Badge appearance="tint" color={st.color}>
                        {st.label}
                    </Badge>
                );
            }
        }),
        createTableColumn<TestScenario>({
            columnId: 'last_run_date',
            compare: (a, b) => (a.last_run_date || '').localeCompare(b.last_run_date || ''),
            renderHeaderCell: () => 'Naposledy spuštěno',
            renderCell: (item) => <Text>{item.last_run_date ? new Date(item.last_run_date).toLocaleString('cs-CZ') : '-'}</Text>
        })
    ];

    const handleDelete = async () => {
        if (!confirm(`Smazat ${selectedIds.size} scénářů?`)) return;
        // Todo: Implement Bulk Delete API
        alert("Delete not implemented in this demo.");
    };

    return (
        <PageLayout>
            <PageHeader>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                    <Text size={500} weight="bold">Testování (Test Management)</Text>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <Button
                            appearance="subtle"
                            icon={<Delete24Regular />}
                            disabled={selectedIds.size === 0}
                            onClick={handleDelete} // TODO
                        >
                            Smazat
                        </Button>
                        <Button icon={<Add24Regular />} appearance="primary" onClick={() => navigate('/system/testing/new')}>
                            Nový scénář
                        </Button>
                    </div>
                </div>
            </PageHeader>

            <PageFilterBar>
                <TabList selectedValue={activeTab} onTabSelect={handleTabSelect}>
                    <Tab value="process" icon={<ClipboardTaskListLtr24Regular />}>Procesy</Tab>
                    <Tab value="feature" icon={<Beaker24Regular />}>Programové úpravy</Tab>
                    <Tab value="critical_path" icon={<Warning24Regular />}>Kritická cesta</Tab>
                </TabList>
            </PageFilterBar>

            <PageContent>
                <div style={{ height: 'calc(100vh - 220px)', width: '100%' }}>
                    <SmartDataGrid
                        items={items}
                        columns={columns}
                        getRowId={(item) => item.rec_id}
                        selectionMode="multiselect"
                        selectedItems={selectedIds}
                        onSelectionChange={(_, data) => setSelectedIds(data.selectedItems as Set<number>)}
                        onRowClick={(item) => navigate(`/system/testing/${item.rec_id}`)}
                        withFilterRow={true}
                    />
                </div>
            </PageContent>
        </PageLayout>
    );
};
