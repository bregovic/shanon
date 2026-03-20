import React, { useState, useEffect } from 'react';
import {
    Drawer, DrawerBody, DrawerHeader, DrawerHeaderTitle,
    Button, Field, Input, TabList, Tab, Select, Switch,
    makeStyles, tokens, MessageBar, MessageBarBody, MessageBarTitle,
    Table, TableHeader, TableRow, TableHeaderCell, TableBody, TableCell, Checkbox
} from '@fluentui/react-components';
import { Dismiss24Regular, Delete24Regular, Add24Regular } from '@fluentui/react-icons';

// Basic styles
const useStyles = makeStyles({
    root: { display: 'flex', flexDirection: 'column', height: '100%' },
    form: { display: 'flex', flexDirection: 'column', gap: '16px', padding: '16px 0', flex: 1, overflowY: 'auto' },
    footer: { display: 'flex', justifyContent: 'flex-end', gap: '8px', padding: '16px 0', borderTop: `1px solid ${tokens.colorNeutralStroke1}` },
    row: { display: 'flex', gap: '16px', flexWrap: 'wrap' },
    col: { flex: '1 1 200px' }
});

export const GabDetail = ({ subjectId, isOpen, onClose, onSaved }: { subjectId: number | null, isOpen: boolean, onClose: () => void, onSaved: () => void }) => {
    const styles = useStyles();
    const [activeTab, setActiveTab] = useState('general');
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    
    // Form State
    const [data, setData] = useState<any>({
        rec_id: 0, name: '', reg_no: '', tax_no: '', country_iso: 'CZ', roles: []
    });
    const [addresses, setAddresses] = useState<any[]>([]);
    const [contacts, setContacts] = useState<any[]>([]);

    useEffect(() => {
        if (isOpen) {
            setActiveTab('general');
            setError('');
            if (subjectId) fetchDetail(subjectId);
            else {
                setData({ rec_id: 0, name: '', reg_no: '', tax_no: '', country_iso: 'CZ', roles: ['CUSTOMER'] });
                setAddresses([]);
                setContacts([]);
                setLoading(false);
            }
        }
    }, [isOpen, subjectId]);

    const fetchDetail = async (id: number) => {
        setLoading(true);
        try {
            const res = await fetch(`/api/api-gab.php?action=get&id=${id}`);
            const json = await res.json();
            if (json.success) {
                setData(json.data);
                setAddresses(json.data.addresses || []);
                setContacts(json.data.contacts || []);
            } else setError(json.error);
        } catch (e) { setError('Network error'); }
        setLoading(false);
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setError('');
        try {
            const res = await fetch('/api/api-gab.php?action=save', {
                method: 'POST', body: JSON.stringify(data)
            });
            const json = await res.json();
            if (json.success) {
                onSaved();
            } else {
                setError(json.error);
            }
        } catch (e: any) { setError(e.message); }
        setSaving(false);
    };

    // Very basic Contacts/Address sub-saving logic omitted for brevity,
    // in real scenario we'd call api-gab.php?action=save_contact directly when user adds contact.

    if (!isOpen) return null;

    return (
        <Drawer
            type="overlay"
            position="end"
            size="large"
            open={isOpen}
            onOpenChange={(_, { open }) => !open && onClose()}
        >
            <DrawerHeader>
                <DrawerHeaderTitle
                    action={<Button appearance="subtle" icon={<Dismiss24Regular />} onClick={onClose} />}
                >
                    {data.rec_id ? `Detail: ${data.name}` : 'Nový subjekt (Zákazník, Partner)'}
                </DrawerHeaderTitle>
            </DrawerHeader>

            <DrawerBody className={styles.root}>
                {error && (
                    <MessageBar intent="error" style={{ marginBottom: 16 }}>
                        <MessageBarBody>{error}</MessageBarBody>
                    </MessageBar>
                )}

                <TabList selectedValue={activeTab} onTabSelect={(_, d) => setActiveTab(d.value as string)}>
                    <Tab value="general">Obecné údaje</Tab>
                    <Tab value="roles" disabled={!data.rec_id}>Role ({data?.roles?.length || 0})</Tab>
                    <Tab value="addresses" disabled={!data.rec_id}>Adresy ({addresses.length})</Tab>
                    <Tab value="contacts" disabled={!data.rec_id}>Kontakty ({contacts.length})</Tab>
                </TabList>

                {loading ? <div>Načítání...</div> : (
                    <form className={styles.form} onSubmit={handleSave}>
                        {activeTab === 'general' && (
                            <>
                                <Field label="Název subjektu / Jméno" required>
                                    <Input value={data.name || ''} onChange={e => setData({...data, name: e.target.value})} />
                                </Field>
                                <div className={styles.row}>
                                    <Field label="IČO" className={styles.col}>
                                        <Input value={data.reg_no || ''} onChange={e => setData({...data, reg_no: e.target.value})} />
                                    </Field>
                                    <Field label="DIČ" className={styles.col}>
                                        <Input value={data.tax_no || ''} onChange={e => setData({...data, tax_no: e.target.value})} />
                                    </Field>
                                </div>
                                <div className={styles.row}>
                                    <Field label="Země (ISO)" className={styles.col}>
                                        <Input value={data.country_iso || ''} onChange={e => setData({...data, country_iso: e.target.value})} />
                                    </Field>
                                </div>
                            </>
                        )}

                        {activeTab === 'roles' && (
                            <div>
                                <p>Role určují, jak aplikaci k tomuto subjektu přistupuje.</p>
                                <Field label="Zákazník / Odběratel">
                                    <Switch checked={data.roles.includes('CUSTOMER')} onChange={(e, d) => {
                                        const r = d.checked ? [...data.roles, 'CUSTOMER'] : data.roles.filter((x:any)=>x!=='CUSTOMER');
                                        setData({...data, roles: r});
                                        handleSave(e as any); // Auto-save mock
                                    }}/>
                                </Field>
                                <Field label="Dodavatel">
                                    <Switch checked={data.roles.includes('VENDOR')} onChange={(e, d) => {
                                        const r = d.checked ? [...data.roles, 'VENDOR'] : data.roles.filter((x:any)=>x!=='VENDOR');
                                        setData({...data, roles: r});
                                    }}/>
                                </Field>
                                <Field label="Zaměstnanec">
                                    <Switch checked={data.roles.includes('EMPLOYEE')} onChange={(e, d) => {
                                        const r = d.checked ? [...data.roles, 'EMPLOYEE'] : data.roles.filter((x:any)=>x!=='EMPLOYEE');
                                        setData({...data, roles: r});
                                    }}/>
                                </Field>
                            </div>
                        )}

                        {activeTab === 'addresses' && (
                            <div><Button appearance="outline" disabled>Přidat adresu (TODO)</Button></div>
                        )}
                        {activeTab === 'contacts' && (
                            <Table>
                                <TableHeader><TableRow><TableHeaderCell>Typ</TableHeaderCell><TableHeaderCell>Hodnota</TableHeaderCell><TableHeaderCell>Primární</TableHeaderCell></TableRow></TableHeader>
                                <TableBody>
                                    {contacts.map((c: any) => (
                                        <TableRow key={c.rec_id}>
                                            <TableCell>{c.contact_type}</TableCell>
                                            <TableCell>{c.contact_value}</TableCell>
                                            <TableCell>{c.is_primary ? 'Ano' : 'Ne'}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        )}
                    </form>
                )}

                <div className={styles.footer}>
                    <Button appearance="secondary" onClick={onClose}>Zrušit</Button>
                    <Button appearance="primary" onClick={handleSave} disabled={saving || loading}>
                        {saving ? 'Ukládání...' : 'Uložit (F2)'}
                    </Button>
                </div>
            </DrawerBody>
        </Drawer>
    );
};
