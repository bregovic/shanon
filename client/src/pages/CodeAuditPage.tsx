import React, { useEffect, useState, useMemo } from 'react';
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbButton,
    BreadcrumbDivider,
    TabList,
    Tab,
    Spinner,
    Badge,
    Title3,
    Button
} from '@fluentui/react-components';
import type { SelectTabData, TableColumnDefinition } from '@fluentui/react-components';
import {
    Warning24Regular,
    ErrorCircle24Regular,
    DocumentSearch24Regular
} from '@fluentui/react-icons';
import { useNavigate } from 'react-router-dom';
import { PageLayout, PageHeader, PageContent } from '../components/PageLayout';
import { SmartDataGrid } from '../components/SmartDataGrid';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../context/TranslationContext';

const API_BASE = import.meta.env.DEV
    ? 'http://localhost/Webhry/hollyhop/broker/shanon/backend'
    : '/api';

interface AuditData {
    missing_translations: { key: string; files: string[] }[];
    unused_translations: { key: string; value: string }[];
    hardcoded_candidates: { file: string; text: string }[];
}

export const CodeAuditPage: React.FC = () => {
    const navigate = useNavigate();
    const { t } = useTranslation();
    const { currentOrgId } = useAuth();
    const orgPrefix = `/${currentOrgId || 'VACKR'}`;

    const [loading, setLoading] = useState(false);
    const [selectedTab, setSelectedTab] = useState<string>('missing');

    const [data, setData] = useState<AuditData>({
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

    const missingColumns: TableColumnDefinition<AuditData['missing_translations'][0]>[] = useMemo(() => [
        {
            columnId: 'key',
            compare: (a, b) => a.key.localeCompare(b.key),
            renderHeaderCell: () => 'Klíč',
            renderCell: (i) => <strong>{i.key}</strong>
        },
        {
            columnId: 'files',
            compare: (a, b) => a.files.length - b.files.length,
            renderHeaderCell: () => 'Soubory',
            renderCell: (i) => i.files.join(', ')
        },
    ], []);

    const unusedColumns: TableColumnDefinition<AuditData['unused_translations'][0]>[] = useMemo(() => [
        {
            columnId: 'key',
            compare: (a, b) => a.key.localeCompare(b.key),
            renderHeaderCell: () => 'Klíč',
            renderCell: (i) => i.key
        },
        {
            columnId: 'value',
            compare: (a, b) => a.value.localeCompare(b.value),
            renderHeaderCell: () => 'Hodnota',
            renderCell: (i) => i.value
        },
    ], []);

    const hardcodedColumns: TableColumnDefinition<AuditData['hardcoded_candidates'][0]>[] = useMemo(() => [
        {
            columnId: 'text',
            compare: (a, b) => a.text.localeCompare(b.text),
            renderHeaderCell: () => 'Text',
            renderCell: (i) => <strong>{i.text}</strong>
        },
        {
            columnId: 'file',
            compare: (a, b) => a.file.localeCompare(b.file),
            renderHeaderCell: () => 'Soubor',
            renderCell: (i) => i.file
        },
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

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <div>
                    <Title3>{t('system.audit.title') || 'Centrum kvality kódu'}</Title3>
                    <p style={{ color: '#666', margin: 0 }}>
                        {t('system.audit.desc') || 'Automatická analýza zdrojového kódu pro detekci technického dluhu.'}
                    </p>
                </div>
                <Badge appearance="outline" color={(data as any).scanned_count > 0 ? 'success' : 'warning'}>
                    Files Scanned: {(data as any).scanned_count ?? 'N/A'}
                </Badge>
            </div>

            {/* SOURCE SELECTION */}
            <div style={{ marginBottom: 20 }}>
                {/* PROD WARNING / INFO */}
                {(!import.meta.env.DEV) && (
                    <div style={{ background: '#f0f6ff', padding: 16, borderRadius: 8, marginBottom: 24, border: '1px solid #cce0ff', display: 'flex', gap: 12, alignItems: 'center' }}>
                        <div style={{ fontSize: 24 }}>📂</div>
                        <div style={{ flexGrow: 1 }}>
                            <div style={{ fontWeight: 'bold', marginBottom: 4 }}>Lokální Audit (Browser Mode)</div>
                            <div>
                                Aplikace běží na serveru, kde nejsou dostupné zdrojové kódy.
                                Pro spuštění auditu vyberte složku <code>client/src</code> na vašem počítači.
                            </div>
                        </div>
                        <Button
                            appearance="primary"
                            size="large"
                            onClick={async () => {
                                try {
                                    // @ts-ignore - File System Access API
                                    const dirHandle = await window.showDirectoryPicker();
                                    setLoading(true);

                                    // Dynamic import to avoid Top-Level await issues if bundler is old, though direct import is fine usually.
                                    const { runLocalAudit } = await import('../utils/localAuditScanner');
                                    const result = await runLocalAudit(dirHandle);

                                    setData(result);
                                } catch (e: any) {
                                    if (e.name !== 'AbortError') {
                                        alert('Nepodařilo se načíst složku: ' + e.message);
                                    }
                                } finally {
                                    setLoading(false);
                                }
                            }}
                        >
                            Vybrat složku src
                        </Button>
                    </div>
                )}
            </div>

            <TabList
                selectedValue={selectedTab}
                onTabSelect={(_, d: SelectTabData) => setSelectedTab(d.value as string)}
                style={{ marginBottom: 20 }}
            >
                <Tab value="missing" icon={<ErrorCircle24Regular />}>
                    Chybějící překlady
                    <Badge appearance="filled" color="danger" style={{ marginLeft: 5 }}>{data.missing_translations.length}</Badge>
                </Tab>
                <Tab value="hardcoded" icon={<DocumentSearch24Regular />}>
                    Hardcoded Texty
                    <Badge appearance="filled" color="warning" style={{ marginLeft: 5 }}>{data.hardcoded_candidates.length}</Badge>
                </Tab>
                <Tab value="unused" icon={<Warning24Regular />}>
                    Nepoužité klíče
                    <Badge appearance="ghost" style={{ marginLeft: 5 }}>{data.unused_translations.length}</Badge>
                </Tab>
            </TabList>


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
        </PageLayout >
    );
};
