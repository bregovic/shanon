import React, { useEffect, useState, useMemo } from 'react';
import {
    Button,
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbButton,
    BreadcrumbDivider,
    TabList,
    Tab,
    SelectTabData,
    Spinner,
    Badge,
    Title3
} from '@fluentui/react-components';
import {
    CheckmarkCircle24Regular,
    Warning24Regular,
    ErrorCircle24Regular,
    TextGrammarError24Regular
} from '@fluentui/react-icons';
import { useNavigate } from 'react-router-dom';
import { PageLayout, PageHeader, PageContent } from '../components/PageLayout';
import { SmartDataGrid } from '../components/SmartDataGrid';
import { useAuth } from '../context/AuthContext';

const API_BASE = import.meta.env.DEV
    ? 'http://localhost/Webhry/hollyhop/broker/shanon/backend'
    : '/api';

export const CodeAuditPage: React.FC = () => {
    const navigate = useNavigate();
    const { currentOrgId } = useAuth();
    const orgPrefix = `/${currentOrgId || 'VACKR'}`;

    const [loading, setLoading] = useState(false);
    const [selectedTab, setSelectedTab] = useState<string>('missing');

    const [data, setData] = useState<{
        missing_translations: any[];
        unused_translations: any[];
        hardcoded_candidates: any[];
    }>({
        missing_translations: [],
        unused_translations: [],
        hardcoded_candidates: []
    });

    useEffect(() => {
        const fetchAudit = async () => {
            setLoading(true);
            try {
                const res = await fetch(`${API_BASE}/api-audit.php?action=audit_translations`, { credentials: 'include' });
                const json = await res.json();
                if (json.success) {
                    setData({
                        missing_translations: json.missing_translations || [],
                        unused_translations: json.unused_translations || [],
                        hardcoded_candidates: json.hardcoded_candidates || []
                    });
                }
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        };

        fetchAudit();
    }, []);

    // --- Columns ---

    const missingColumns = useMemo(() => [
        { columnId: 'key', renderHeaderCell: () => 'Klíč', renderCell: (i: any) => <strong>{i.key}</strong> },
        { columnId: 'files', renderHeaderCell: () => 'Soubory', renderCell: (i: any) => i.files.join(', ') },
    ], []);

    const unusedColumns = useMemo(() => [
        { columnId: 'key', renderHeaderCell: () => 'Klíč', renderCell: (i: any) => i.key },
        { columnId: 'value', renderHeaderCell: () => 'Hodnota', renderCell: (i: any) => i.value },
    ], []);

    const hardcodedColumns = useMemo(() => [
        { columnId: 'text', renderHeaderCell: () => 'Text', renderCell: (i: any) => <strong>{i.text}</strong> },
        { columnId: 'file', renderHeaderCell: () => 'Soubor', renderCell: (i: any) => i.file },
    ], []);

    return (
        <PageLayout>
            <PageHeader>
                <Breadcrumb>
                    <BreadcrumbItem>
                        <BreadcrumbButton onClick={() => navigate(`${orgPrefix}/system`)}>Systém</BreadcrumbButton>
                    </BreadcrumbItem>
                    <BreadcrumbDivider />
                    <BreadcrumbItem>
                        <BreadcrumbButton current>Kvalita kódu & Audit</BreadcrumbButton>
                    </BreadcrumbItem>
                </Breadcrumb>
            </PageHeader>

            <div style={{ padding: '0 20px' }}>
                <Title3>Centrum kvality kódu</Title3>
                <p style={{ color: '#666', marginBottom: 20 }}>
                    Automatická analýza zdrojového kódu pro detekci technického dluhu.
                </p>

                <TabList
                    selectedValue={selectedTab}
                    onTabSelect={(_, d: SelectTabData) => setSelectedTab(d.value as string)}
                    style={{ marginBottom: 20 }}
                >
                    <Tab value="missing" icon={<ErrorCircle24Regular />}>
                        Chybějící překlady
                        <Badge appearance="filled" color="danger" style={{ marginLeft: 5 }}>{data.missing_translations.length}</Badge>
                    </Tab>
                    <Tab value="hardcoded" icon={<TextGrammarError24Regular />}>
                        Hardcoded Texty
                        <Badge appearance="filled" color="warning" style={{ marginLeft: 5 }}>{data.hardcoded_candidates.length}</Badge>
                    </Tab>
                    <Tab value="unused" icon={<Warning24Regular />}>
                        Nepoužité klíče
                        <Badge appearance="subtle" style={{ marginLeft: 5 }}>{data.unused_translations.length}</Badge>
                    </Tab>
                </TabList>
            </div>

            <PageContent>
                {loading ? (
                    <div style={{ padding: 20 }}><Spinner label="Provádím hloubkovou analýzu kódu..." /></div>
                ) : (
                    <>
                        {selectedTab === 'missing' && (
                            <SmartDataGrid
                                items={data.missing_translations}
                                columns={missingColumns}
                                getRowId={(i) => i.key}
                            />
                        )}
                        {selectedTab === 'hardcoded' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                <div style={{ background: '#fff3cd', padding: 10, borderRadius: 4 }}>
                                    ⚠️ Toto je heuristická analýza. Některé položky mohou být falešné poplachy (čísla, kódy).
                                </div>
                                <SmartDataGrid
                                    items={data.hardcoded_candidates}
                                    columns={hardcodedColumns}
                                    getRowId={(i) => i.text + i.file}
                                />
                            </div>
                        )}
                        {selectedTab === 'unused' && (
                            <SmartDataGrid
                                items={data.unused_translations}
                                columns={unusedColumns}
                                getRowId={(i) => i.key}
                            />
                        )}
                    </>
                )}
            </PageContent>
        </PageLayout>
    );
};
