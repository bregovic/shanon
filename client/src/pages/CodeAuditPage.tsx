
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
    DocumentSearch24Regular,
    Copy24Regular,
    ClipboardCode24Regular,
    ArrowDownload24Regular
} from '@fluentui/react-icons';
import { useNavigate } from 'react-router-dom';
import { PageLayout, PageHeader, PageContent } from '../components/PageLayout';
import { SmartDataGrid } from '../components/SmartDataGrid';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../context/TranslationContext';
import { setLocalLastValue, useLocalLastValue } from '../utils/indexedDB';

const API_BASE = import.meta.env.DEV
    ? 'http://localhost/Webhry/hollyhop/broker/shanon/backend'
    : '/api';

// ...
const LastFolderButton: React.FC<{ onLoad: (handle: any) => void }> = ({ onLoad }) => {
    const { value: lastHandle, loading } = useLocalLastValue<any>('audit_folder_handle');

    if (loading || !lastHandle) return null;

    return (
        <Button
            size="small"
            appearance="subtle"
            onClick={async () => {
                // Verify permission
                if ((await lastHandle.queryPermission({ mode: 'read' })) === 'granted') {
                    onLoad(lastHandle);
                } else {
                    // Request permission
                    if ((await lastHandle.requestPermission({ mode: 'read' })) === 'granted') {
                        onLoad(lastHandle);
                    }
                }
            }}
        >
            Použít naposledy vybranou složku ({lastHandle.name})
        </Button>
    );
};

interface AuditData {
    scanned_count?: number;
    missing_translations: { key: string; files: string[] }[];
    unused_translations: { key: string; files: string[] }[];
    hardcoded_candidates: { file: string; text: string }[];
    duplicate_values: { value: string; keys: string[] }[];
    code_smells: { type: 'console' | 'todo' | 'fixme'; file: string; line: number; content: string }[];
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
        hardcoded_candidates: [],
        duplicate_values: [],
        code_smells: []
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
                        hardcoded_candidates: json.hardcoded_candidates || [],
                        duplicate_values: [],
                        code_smells: []
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
            columnId: 'status',
            compare: (a, b) => 0,
            renderHeaderCell: () => 'Status',
            renderCell: (i) => <Badge appearance="ghost">Nepoužito</Badge>
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

    const duplicateColumns: TableColumnDefinition<AuditData['duplicate_values'][0]>[] = useMemo(() => [
        {
            columnId: 'value',
            compare: (a, b) => a.value.localeCompare(b.value),
            renderHeaderCell: () => 'Hodnota Duplicity',
            renderCell: (i) => <strong>{i.value}</strong>
        },
        {
            columnId: 'keys',
            compare: (a, b) => a.keys.length - b.keys.length,
            renderHeaderCell: () => 'Klíče',
            renderCell: (i) => <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{i.keys.map(k => <Badge key={k} size="small">{k}</Badge>)}</div>
        },
    ], []);

    const smellColumns: TableColumnDefinition<AuditData['code_smells'][0]>[] = useMemo(() => [
        {
            columnId: 'type',
            compare: (a, b) => a.type.localeCompare(b.type),
            renderHeaderCell: () => 'Typ',
            renderCell: (i) => <Badge color={i.type === 'console' ? 'warning' : 'danger'}>{i.type.toUpperCase()}</Badge>
        },
        {
            columnId: 'file',
            compare: (a, b) => a.file.localeCompare(b.file),
            renderHeaderCell: () => 'Soubor : Řádek',
            renderCell: (i) => <span>{i.file}:{i.line}</span>
        },
        {
            columnId: 'content',
            compare: (a, b) => a.content.localeCompare(b.content),
            renderHeaderCell: () => 'Obsah',
            renderCell: (i) => <code>{i.content}</code>
        },
    ], []);

    const handleExport = () => {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(data, null, 2));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataStr);
        downloadAnchorNode.setAttribute("download", "audit_report.json");
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
    };

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
                <div style={{ display: 'flex', gap: 10 }}>
                    {(data as any).scanned_count > 0 && (
                        <Button icon={<ArrowDownload24Regular />} onClick={handleExport}>
                            Export Report
                        </Button>
                    )}
                    <Badge appearance="outline" color={(data as any).scanned_count > 0 ? 'success' : 'warning'}>
                        Files Scanned: {(data as any).scanned_count ?? 'N/A'}
                    </Badge>
                </div>
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

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <Button
                                appearance="primary"
                                size="large"
                                onClick={async () => {
                                    try {
                                        // @ts-ignore - File System Access API
                                        const dirHandle = await window.showDirectoryPicker();

                                        // Save handle to IDB (SysLastValue Pattern)
                                        await setLocalLastValue('audit_folder_handle', dirHandle);

                                        setLoading(true);
                                        const { runLocalAudit } = await import('../utils/localAuditScanner');
                                        const result = await runLocalAudit(dirHandle);
                                        // @ts-ignore
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
                                Vybrat novou složku
                            </Button>

                            {/* Reuse Last Handle Button */}
                            <LastFolderButton onLoad={async (handle: any) => {
                                setLoading(true);
                                try {
                                    const { runLocalAudit } = await import('../utils/localAuditScanner');
                                    const result = await runLocalAudit(handle);
                                    // @ts-ignore
                                    setData(result);
                                } finally {
                                    setLoading(false);
                                }
                            }} />
                        </div>
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
                <Tab value="duplicates" icon={<Copy24Regular />}>
                    Duplicity
                    <Badge appearance="ghost" style={{ marginLeft: 5 }}>{data.duplicate_values?.length || 0}</Badge>
                </Tab>
                <Tab value="smells" icon={<ClipboardCode24Regular />}>
                    Best Practices
                    <Badge appearance="ghost" style={{ marginLeft: 5 }}>{data.code_smells?.length || 0}</Badge>
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
                                columns={unusedColumns as any}
                                getRowId={(i) => i.key}
                            />
                        )}
                        {selectedTab === 'duplicates' && (
                            <SmartDataGrid
                                items={data.duplicate_values || []}
                                columns={duplicateColumns as any}
                                getRowId={(i) => i.value}
                            />
                        )}
                        {selectedTab === 'smells' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                <div style={{ background: '#e0f7ff', padding: 10, borderRadius: 4 }}>
                                    💡 Zde najdete zapomenuté <code>console.log</code> a <code>TODO/FIXME</code> komentáře.
                                </div>
                                <SmartDataGrid
                                    items={data.code_smells || []}
                                    columns={smellColumns}
                                    getRowId={(i) => i.file + i.line}
                                />
                            </div>
                        )}
                    </>
                )}
            </PageContent>
        </PageLayout >
    );
};
