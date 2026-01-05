import { useState, useEffect } from 'react';
import {
    Dialog,
    DialogSurface,
    DialogTitle,
    DialogBody,
    DialogActions,
    DialogContent,
    Button,
    Input,
    Label,
    Dropdown,
    Option,
    makeStyles,
    tokens,
    Spinner,
    Text
} from '@fluentui/react-components';
import { Add24Regular, Delete24Regular } from '@fluentui/react-icons';
import axios from 'axios';

const useStyles = makeStyles({
    content: {
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        paddingTop: '12px'
    },
    row: {
        display: 'grid',
        gridTemplateColumns: '120px 1fr auto',
        gap: '8px',
        alignItems: 'end'
    },
    header: {
        marginBottom: '10px'
    }
});

interface TranslationItem {
    rec_id: number;
    language_code: string;
    translation: string;
    field_name: string;
}

interface TranslationDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    tableName: string;
    recordId: number;
    title: string; // The base value being translated (e.g. "Faktura")
    fieldName?: string; // Default 'name'
}

const LANGUAGES = [
    { code: 'en', name: 'English' },
    { code: 'de', name: 'Deutsch' },
    { code: 'cs', name: 'Čeština' }, // Rare but possible
    { code: 'sk', name: 'Slovenčina' },
    { code: 'pl', name: 'Polski' },
    { code: 'fr', name: 'Français' },
    { code: 'es', name: 'Español' }
];

export const TranslationDialog = ({ open, onOpenChange, tableName, recordId, title, fieldName = 'name' }: TranslationDialogProps) => {
    const styles = useStyles();
    const [translations, setTranslations] = useState<TranslationItem[]>([]);
    const [loading, setLoading] = useState(false);

    // New Entry State
    const [newLang, setNewLang] = useState('en');
    const [newValue, setNewValue] = useState('');
    const [saving, setSaving] = useState(false);

    // API URL Helper
    const isDev = import.meta.env.DEV;
    const getApiUrl = (endpoint: string) => isDev
        ? `http://localhost/Webhry/hollyhop/broker/broker 2.0/${endpoint}`
        : `/api/${endpoint}`;

    const loadTranslations = async () => {
        setLoading(true);
        try {
            const res = await axios.get(getApiUrl(`api-system.php?action=translations_list&table_name=${tableName}&record_id=${recordId}`));
            if (res.data.success) {
                // Filter by field name manually if backend returns all fields for record
                const filtered = res.data.data.filter((i: TranslationItem) => i.field_name === fieldName);
                setTranslations(filtered);
            }
        } catch (e) {
            console.error("Failed to load translations", e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (open && recordId) {
            loadTranslations();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, recordId]);

    const handleSave = async (lang: string, val: string) => {
        if (!val.trim()) return;
        setSaving(true);
        try {
            await axios.post(getApiUrl('api-system.php?action=translation_save'), {
                table_name: tableName,
                record_id: recordId,
                field_name: fieldName,
                language_code: lang,
                translation: val
            });
            await loadTranslations();
            setNewValue('');
        } catch (e) {
            console.error(e);
            alert('Failed to save translation');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: number) => {
        if (!confirm('Odstranit překlad?')) return;
        try {
            await axios.post(getApiUrl('api-system.php?action=translation_delete'), { id });
            loadTranslations();
        } catch (e) {
            console.error(e);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(_e, data) => onOpenChange(data.open)}>
            <DialogSurface>
                <DialogBody>
                    <DialogTitle>Překlady: {title}</DialogTitle>
                    <DialogContent className={styles.content}>
                        <Text>Zde můžete definovat alternativní názvy pro různé jazyky (např. pro OCR).</Text>

                        {loading ? <Spinner /> : (
                            <>
                                {translations.map(tr => (
                                    <div key={tr.rec_id} className={styles.row}>
                                        <Text weight="semibold">{LANGUAGES.find(l => l.code === tr.language_code)?.name || tr.language_code}</Text>
                                        <Text>{tr.translation}</Text>
                                        <Button
                                            icon={<Delete24Regular />}
                                            appearance="subtle"
                                            onClick={() => handleDelete(tr.rec_id)}
                                        />
                                    </div>
                                ))}

                                <div style={{ borderTop: `1px solid ${tokens.colorNeutralStroke1}`, margin: '8px 0' }} />

                                <div className={styles.row}>
                                    <div>
                                        <Label>Jazyk</Label>
                                        <Dropdown
                                            value={LANGUAGES.find(l => l.code === newLang)?.name}
                                            selectedOptions={[newLang]}
                                            onOptionSelect={(_e, data) => setNewLang(data.optionValue as string)}
                                        >
                                            {LANGUAGES.map(l => (
                                                <Option key={l.code} value={l.code} text={l.name}>{l.name}</Option>
                                            ))}
                                        </Dropdown>
                                    </div>
                                    <div>
                                        <Label>Překlad</Label>
                                        <Input
                                            value={newValue}
                                            onChange={(_e, d) => setNewValue(d.value)}
                                            style={{ width: '100%' }}
                                        />
                                    </div>
                                    <Button
                                        icon={<Add24Regular />}
                                        appearance="primary"
                                        disabled={saving || !newValue}
                                        onClick={() => handleSave(newLang, newValue)}
                                    >
                                        Přidat
                                    </Button>
                                </div>
                            </>
                        )}
                    </DialogContent>
                    <DialogActions>
                        <Button appearance="secondary" onClick={() => onOpenChange(false)}>Zavřít</Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};
