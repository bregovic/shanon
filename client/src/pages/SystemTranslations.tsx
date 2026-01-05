import { useState, useEffect, useMemo, useCallback } from 'react';
import {
    Table,
    TableHeader,
    TableRow,
    TableHeaderCell,
    TableBody,
    TableCell,
    Text,
    Button,
    Card,
    Badge,
    Spinner,
    makeStyles,
    Input,
    Label
} from '@fluentui/react-components';
import { Delete24Regular, Search24Regular } from '@fluentui/react-icons';
import axios from 'axios';
import { PageLayout, PageHeader, PageContent, PageFilterBar } from '../components/PageLayout';

const useStyles = makeStyles({
    tableContainer: {
        overflowX: 'auto',
    },
    filterGroup: {
        display: 'flex',
        flexDirection: 'column',
        gap: '4px'
    }
});

interface Translation {
    rec_id: number;
    table_name: string;
    record_id: number;
    language_code: string;
    translation: string;
    field_name: string;
    created_at: string;
}

export const SystemTranslations = () => {
    const styles = useStyles();
    const [translations, setTranslations] = useState<Translation[]>([]);
    const [loading, setLoading] = useState(true);

    // Filters
    const [filterTable, setFilterTable] = useState('');
    const [filterLang, setFilterLang] = useState('');
    const [filterText, setFilterText] = useState('');

    const isDev = import.meta.env.DEV;
    const getApiUrl = (endpoint: string) => isDev
        ? `http://localhost/Webhry/hollyhop/broker/broker 2.0/${endpoint}`
        : `/api/${endpoint}`;

    useEffect(() => {
        loadData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const res = await axios.get(getApiUrl('api-system.php?action=translations_list'));
            if (res.data.success) {
                setTranslations(res.data.data);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }, []);

    const handleDelete = async (id: number) => {
        if (!confirm('Opravdu smazat tento překlad?')) return;
        try {
            await axios.post(getApiUrl('api-system.php?action=translation_delete'), { id });
            loadData();
        } catch (e) {
            console.error(e);
            alert('Chyba při mazání');
        }
    };

    const filteredTranslations = useMemo(() => {
        return translations.filter(t => {
            const matchTable = t.table_name.toLowerCase().includes(filterTable.toLowerCase());
            const matchLang = t.language_code.toLowerCase().includes(filterLang.toLowerCase());
            const matchText = t.translation.toLowerCase().includes(filterText.toLowerCase()) ||
                t.field_name.toLowerCase().includes(filterText.toLowerCase());
            return matchTable && matchLang && matchText;
        });
    }, [translations, filterTable, filterLang, filterText]);

    return (
        <PageLayout>
            <PageHeader>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                    <Text size={500} weight="semibold">Systémové Překlady</Text>
                    <Badge appearance="tint" style={{ marginLeft: '10px' }}>{filteredTranslations.length}</Badge>
                </div>
            </PageHeader>
            <PageFilterBar>
                <div className={styles.filterGroup}>
                    <Label size="small">Tabulka</Label>
                    <Input
                        placeholder="Např. dms_attributes"
                        value={filterTable}
                        onChange={(_e, d) => setFilterTable(d.value)}
                        contentBefore={<Search24Regular />}
                    />
                </div>
                <div className={styles.filterGroup}>
                    <Label size="small">Jazyk</Label>
                    <Input
                        placeholder="en/de..."
                        value={filterLang}
                        onChange={(_e, d) => setFilterLang(d.value)}
                        style={{ width: '100px' }}
                    />
                </div>
                <div className={styles.filterGroup}>
                    <Label size="small">Hledat text</Label>
                    <Input
                        placeholder="Text překladu..."
                        value={filterText}
                        onChange={(_e, d) => setFilterText(d.value)}
                    />
                </div>
            </PageFilterBar>
            <PageContent>
                <Card>
                    {loading ? <Spinner label="Načítám překlady..." /> : (
                        <div className={styles.tableContainer}>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHeaderCell>Tabulka</TableHeaderCell>
                                        <TableHeaderCell>ID Záznamu</TableHeaderCell>
                                        <TableHeaderCell>Pole</TableHeaderCell>
                                        <TableHeaderCell>Jazyk</TableHeaderCell>
                                        <TableHeaderCell>Překlad</TableHeaderCell>
                                        <TableHeaderCell>Vytvořeno</TableHeaderCell>
                                        <TableHeaderCell>Akce</TableHeaderCell>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredTranslations.map((item) => (
                                        <TableRow key={item.rec_id}>
                                            <TableCell><Badge appearance="tint">{item.table_name}</Badge></TableCell>
                                            <TableCell>{item.record_id}</TableCell>
                                            <TableCell>{item.field_name}</TableCell>
                                            <TableCell><Text weight="bold">{item.language_code}</Text></TableCell>
                                            <TableCell>{item.translation}</TableCell>
                                            <TableCell>{item.created_at}</TableCell>
                                            <TableCell>
                                                <Button
                                                    icon={<Delete24Regular />}
                                                    appearance="subtle"
                                                    onClick={() => handleDelete(item.rec_id)}
                                                    aria-label="Smazat"
                                                />
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                    {filteredTranslations.length === 0 && (
                                        <TableRow>
                                            <TableCell colSpan={7} style={{ textAlign: 'center', padding: '20px' }}>
                                                {translations.length === 0 ? "Žádné data." : "Žádné výsledky odpovídající filtru."}
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </Card>
            </PageContent>
        </PageLayout>
    );
};
