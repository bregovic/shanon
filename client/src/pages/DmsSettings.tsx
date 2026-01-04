
import React, { useEffect, useState } from 'react';
import { ActionBar } from '../components/ActionBar';
import {
    Button,
    Title3,
    Text,
    Card,
    TabList,
    Tab,
    Table,
    TableHeader,
    TableRow,
    TableHeaderCell,
    TableBody,
    TableCell,
    Spinner,
    tokens,
    Dialog,
    DialogTrigger,
    DialogSurface,
    DialogTitle,
    DialogBody,
    DialogActions,
    DialogContent,
    Input,
    Field,
    Checkbox,
    Dropdown,
    Option,
    Badge
} from '@fluentui/react-components';
import {
    ArrowLeft24Regular,
    Add24Regular,
    Edit24Regular,
    Settings24Regular
} from '@fluentui/react-icons';
import { useNavigate } from 'react-router-dom';

type TabValue = 'doc_types' | 'number_series' | 'attributes' | 'storage';

interface DocType {
    rec_id: number;
    code: string;
    name: string;
    description?: string;
    number_series_id?: number;
    number_series_name?: string;
    is_active: boolean;
}

interface NumberSeries {
    rec_id: number;
    code: string;
    name: string;
    prefix: string;
    suffix: string;
    current_number: number;
    number_length: number;
    is_default: boolean;
    is_active: boolean;
}

interface StorageProfile {
    rec_id: number;
    name: string;
    storage_type: string;
    connection_string?: string;
    base_path?: string;
    is_default: boolean;
    is_active: boolean;
}

const STORAGE_TYPES = [
    { value: 'local', label: 'Lokální úložiště' },
    { value: 'ftp', label: 'FTP Server' },
    { value: 'sftp', label: 'SFTP Server' },
    { value: 'google_drive', label: 'Google Drive' },
    { value: 'sharepoint', label: 'SharePoint' },
    { value: 's3', label: 'Amazon S3' },
    { value: 'azure_blob', label: 'Azure Blob Storage' }
];

export const DmsSettings: React.FC = () => {
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState<TabValue>('doc_types');
    const [loading, setLoading] = useState(false);

    // Data
    const [docTypes, setDocTypes] = useState<DocType[]>([]);
    const [numberSeries, setNumberSeries] = useState<NumberSeries[]>([]);
    const [storageProfiles, setStorageProfiles] = useState<StorageProfile[]>([]);

    // Fetch data based on active tab
    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            try {
                let endpoint = '';
                switch (activeTab) {
                    case 'doc_types': endpoint = 'doc_types'; break;
                    case 'number_series': endpoint = 'number_series'; break;
                    case 'storage': endpoint = 'storage_profiles'; break;
                    case 'attributes': endpoint = 'attributes'; break;
                }

                const res = await fetch(`/api/api-dms.php?action=${endpoint}`);
                const json = await res.json();

                if (json.success) {
                    switch (activeTab) {
                        case 'doc_types': setDocTypes(json.data || []); break;
                        case 'number_series': setNumberSeries(json.data || []); break;
                        case 'storage': setStorageProfiles(json.data || []); break;
                    }
                }
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [activeTab]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <ActionBar>
                <Button appearance="subtle" icon={<ArrowLeft24Regular />} onClick={() => navigate('/dms')}>
                    Zpět
                </Button>
                <div style={{ width: '24px' }} />
                <Settings24Regular />
                <Title3 style={{ marginLeft: '8px' }}>Nastavení DMS</Title3>
            </ActionBar>

            <div style={{ padding: '24px', flex: 1, overflow: 'auto' }}>
                <TabList
                    selectedValue={activeTab}
                    onTabSelect={(_, data) => setActiveTab(data.value as TabValue)}
                    style={{ marginBottom: '24px' }}
                >
                    <Tab value="doc_types">Typy dokumentů</Tab>
                    <Tab value="number_series">Číselné řady</Tab>
                    <Tab value="attributes">Atributy</Tab>
                    <Tab value="storage">Úložiště</Tab>
                </TabList>

                {loading ? (
                    <Spinner label="Načítám..." />
                ) : (
                    <>
                        {/* DOC TYPES TAB */}
                        {activeTab === 'doc_types' && (
                            <Card style={{ padding: '16px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
                                    <Text weight="semibold" size={400}>Typy dokumentů</Text>
                                    <Button appearance="primary" icon={<Add24Regular />} size="small">
                                        Nový typ
                                    </Button>
                                </div>
                                <Table aria-label="Doc Types">
                                    <TableHeader>
                                        <TableRow>
                                            <TableHeaderCell>Kód</TableHeaderCell>
                                            <TableHeaderCell>Název</TableHeaderCell>
                                            <TableHeaderCell>Číselná řada</TableHeaderCell>
                                            <TableHeaderCell>Stav</TableHeaderCell>
                                            <TableHeaderCell>Akce</TableHeaderCell>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {docTypes.map(dt => (
                                            <TableRow key={dt.rec_id}>
                                                <TableCell><Text weight="semibold">{dt.code}</Text></TableCell>
                                                <TableCell>{dt.name}</TableCell>
                                                <TableCell>{dt.number_series_name || '-'}</TableCell>
                                                <TableCell>
                                                    <Badge appearance="tint" color={dt.is_active ? 'success' : 'danger'}>
                                                        {dt.is_active ? 'Aktivní' : 'Neaktivní'}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell>
                                                    <Button icon={<Edit24Regular />} appearance="subtle" size="small" />
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </Card>
                        )}

                        {/* NUMBER SERIES TAB */}
                        {activeTab === 'number_series' && (
                            <Card style={{ padding: '16px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
                                    <Text weight="semibold" size={400}>Číselné řady</Text>
                                    <Button appearance="primary" icon={<Add24Regular />} size="small">
                                        Nová řada
                                    </Button>
                                </div>
                                <Table aria-label="Number Series">
                                    <TableHeader>
                                        <TableRow>
                                            <TableHeaderCell>Kód</TableHeaderCell>
                                            <TableHeaderCell>Název</TableHeaderCell>
                                            <TableHeaderCell>Formát</TableHeaderCell>
                                            <TableHeaderCell>Poslední číslo</TableHeaderCell>
                                            <TableHeaderCell>Výchozí</TableHeaderCell>
                                            <TableHeaderCell>Akce</TableHeaderCell>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {numberSeries.map(ns => (
                                            <TableRow key={ns.rec_id}>
                                                <TableCell><Text weight="semibold">{ns.code}</Text></TableCell>
                                                <TableCell>{ns.name}</TableCell>
                                                <TableCell>
                                                    <code>{ns.prefix}{'0'.repeat(ns.number_length)}{ns.suffix}</code>
                                                </TableCell>
                                                <TableCell>{ns.current_number}</TableCell>
                                                <TableCell>
                                                    {ns.is_default && <Badge appearance="tint" color="brand">Výchozí</Badge>}
                                                </TableCell>
                                                <TableCell>
                                                    <Button icon={<Edit24Regular />} appearance="subtle" size="small" />
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </Card>
                        )}

                        {/* STORAGE PROFILES TAB */}
                        {activeTab === 'storage' && (
                            <Card style={{ padding: '16px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
                                    <Text weight="semibold" size={400}>Úložiště</Text>
                                    <Button appearance="primary" icon={<Add24Regular />} size="small">
                                        Nové úložiště
                                    </Button>
                                </div>
                                <Table aria-label="Storage Profiles">
                                    <TableHeader>
                                        <TableRow>
                                            <TableHeaderCell>Název</TableHeaderCell>
                                            <TableHeaderCell>Typ</TableHeaderCell>
                                            <TableHeaderCell>Cesta</TableHeaderCell>
                                            <TableHeaderCell>Výchozí</TableHeaderCell>
                                            <TableHeaderCell>Stav</TableHeaderCell>
                                            <TableHeaderCell>Akce</TableHeaderCell>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {storageProfiles.map(sp => (
                                            <TableRow key={sp.rec_id}>
                                                <TableCell><Text weight="semibold">{sp.name}</Text></TableCell>
                                                <TableCell>
                                                    {STORAGE_TYPES.find(t => t.value === sp.storage_type)?.label || sp.storage_type}
                                                </TableCell>
                                                <TableCell>{sp.base_path || '-'}</TableCell>
                                                <TableCell>
                                                    {sp.is_default && <Badge appearance="tint" color="brand">Výchozí</Badge>}
                                                </TableCell>
                                                <TableCell>
                                                    <Badge appearance="tint" color={sp.is_active ? 'success' : 'danger'}>
                                                        {sp.is_active ? 'Aktivní' : 'Neaktivní'}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell>
                                                    <Button icon={<Edit24Regular />} appearance="subtle" size="small" />
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </Card>
                        )}

                        {/* ATTRIBUTES TAB */}
                        {activeTab === 'attributes' && (
                            <Card style={{ padding: '16px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
                                    <Text weight="semibold" size={400}>Sledované atributy</Text>
                                    <Button appearance="primary" icon={<Add24Regular />} size="small">
                                        Nový atribut
                                    </Button>
                                </div>
                                <Text style={{ color: tokens.colorNeutralForeground4 }}>
                                    Atributy umožňují přidávat vlastní metadata k dokumentům (např. číslo faktury, datum splatnosti, atd.)
                                </Text>
                            </Card>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};
