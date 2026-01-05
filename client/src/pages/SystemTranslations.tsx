import { useState, useEffect } from 'react';
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
    makeStyles
} from '@fluentui/react-components';
import { Delete24Regular } from '@fluentui/react-icons';
import axios from 'axios';
import PageLayout from '../components/PageLayout';
import { PageHeader } from '../components/PageLayout';
import { PageContent } from '../components/PageLayout';

const useStyles = makeStyles({
    tableContainer: {
        overflowX: 'auto',
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

    const isDev = import.meta.env.DEV;
    const getApiUrl = (endpoint: string) => isDev
        ? `http://localhost/Webhry/hollyhop/broker/broker 2.0/${endpoint}`
        : `/api/${endpoint}`;

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
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
    };

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

    return (
        <PageLayout>
            <PageHeader>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                    <Text size={500} weight="semibold">Systémové Překlady</Text>
                </div>
            </PageHeader>
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
                                    {translations.map((item) => (
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
                                    {translations.length === 0 && (
                                        <TableRow>
                                            <TableCell colSpan={7} style={{ textAlign: 'center', padding: '20px' }}>
                                                Žádné překlady nenalezeny.
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
