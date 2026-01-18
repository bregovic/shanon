
import {
    Dialog,
    DialogSurface,
    DialogTitle,
    DialogBody,
    DialogContent,
    DialogActions,
    Button,
    Dropdown,
    Option,
    Label,
    makeStyles,
    Text,
    tokens,
    TabList,
    Tab,
    Table,
    TableHeader,
    TableRow,
    TableHeaderCell,
    TableBody,
    TableCell
} from '@fluentui/react-components';
import { Delete24Regular } from '@fluentui/react-icons';
import { useTranslation } from '../context/TranslationContext';
import { useSettings } from '../context/SettingsContext';
import { useAuth } from '../context/AuthContext';
import { useState, useEffect } from 'react';
import { Input } from '@fluentui/react-components';
import { deleteLocalLastValue, clearAllLocalValues } from '../utils/indexedDB';

const useStyles = makeStyles({
    content: {
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        paddingTop: '10px',
        minHeight: '400px',
        minWidth: '550px'
    }
});

const API_BASE = import.meta.env.DEV
    ? 'http://localhost/Webhry/hollyhop/broker/shanon/backend'
    : '/api';

export const SettingsDialog = ({ open, onOpenChange }: { open: boolean, onOpenChange: (open: boolean) => void }) => {
    const styles = useStyles();
    const { t } = useTranslation();
    const { language, setLanguage, saveSettings } = useSettings();
    const { organizations } = useAuth();
    const [saving, setSaving] = useState(false);
    const [selectedDefaultOrg, setSelectedDefaultOrg] = useState<string | null>(null);

    // Password Change State
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [passwordError, setPasswordError] = useState('');

    // Find initial default
    const initialDefault = organizations.find(o => o.is_default)?.org_id || organizations[0]?.org_id || '';
    const effectiveDefault = selectedDefaultOrg ?? initialDefault;

    const handleSave = async () => {
        setSaving(true);
        setPasswordError('');

        // Password Change Logic
        if (newPassword || confirmPassword) {
            if (newPassword !== confirmPassword) {
                setPasswordError('user.passwordsDoNotMatch');
                setSaving(false);
                return;
            }
            if (newPassword.length < 5) {
                setPasswordError('user.passwordTooShort');
                setSaving(false);
                return;
            }

            try {
                const res = await fetch(`${API_BASE}/api-users.php?action=update_profile`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password: newPassword }),
                    credentials: 'include'
                });
                const json = await res.json();
                if (!json.success) {
                    setPasswordError(json.error || 'Failed to change password');
                    setSaving(false);
                    return;
                }
            } catch (e) {
                console.error(e);
                setPasswordError('Network error during password change');
                setSaving(false);
                return;
            }
        }

        await saveSettings();

        // Save default org if changed
        if (selectedDefaultOrg && selectedDefaultOrg !== initialDefault) {
            try {
                await fetch(`${API_BASE}/ajax-set-org.php`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ org_id: selectedDefaultOrg, set_default: true }),
                    credentials: 'include'
                });
            } catch (e) { console.error('Failed to save default org', e); }
        }

        setSaving(false);
        onOpenChange(false);
    };

    // Personalization Logic (Server + IndexedDB cache)
    const [tab, setTab] = useState<string>('general');
    const [serverParams, setServerParams] = useState<any[]>([]);

    const fetchServerParams = async () => {
        try {
            const r = await fetch(`${API_BASE}/api-user.php?action=list_params`);
            const j = await r.json();
            if (j.success) setServerParams(j.data || []);
        } catch (e) { console.error(e); }
    };

    useEffect(() => {
        if (tab === 'personalization' && open) fetchServerParams();
    }, [tab, open]);

    const deleteServerParam = async (id: number, key: string) => {
        if (!confirm(t('common.confirm_delete'))) return;
        await fetch(`${API_BASE}/api-user.php?action=delete_param`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
        });
        // Also clear from IndexedDB cache
        await deleteLocalLastValue(key).catch(() => { });
        fetchServerParams();
    };

    const clearAllPrefs = async () => {
        if (!confirm(t('settings.confirm_clear_all'))) return;
        // Delete all from server
        for (const p of serverParams) {
            await fetch(`${API_BASE}/api-user.php?action=delete_param`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: p.rec_id })
            });
        }
        // Clear IndexedDB cache
        await clearAllLocalValues();
        fetchServerParams();
    };


    // ...
    return (
        <Dialog open={open} onOpenChange={(_, data) => onOpenChange(data.open)}>
            <DialogSurface>
                <DialogBody>
                    <DialogTitle>{t('settings.title')}</DialogTitle>
                    <DialogContent className={styles.content}>
                        <TabList selectedValue={tab} onTabSelect={(_, d) => setTab(d.value as string)}>
                            <Tab value="general">{t('settings.tab_general')}</Tab>
                            <Tab value="security">{t('settings.tab_security')}</Tab>
                            <Tab value="personalization">{t('settings.tab_personalization')}</Tab>
                        </TabList>

                        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 0' }}>
                            {/* GENERAL TAB */}
                            {tab === 'general' && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

                                    <div style={{ padding: '8px', backgroundColor: tokens.colorNeutralBackground2, borderRadius: '4px' }}>
                                        <Text size={200} block style={{ color: tokens.colorNeutralForeground4 }}>
                                            Version: <span style={{ fontFamily: 'monospace' }}>{__APP_VERSION__}</span>
                                        </Text>
                                        <Text size={200} block style={{ color: tokens.colorNeutralForeground4 }}>
                                            Built: {__APP_BUILD_DATE__}
                                        </Text>
                                    </div>

                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                        <Label>{t('settings.language_label')}</Label>
                                        <Dropdown
                                            value={language === 'cs' ? t('settings.language_cs') : t('settings.language_en')}
                                            onOptionSelect={(_, data) => setLanguage(data.optionValue as any)}
                                        >
                                            <Option value="cs" text={t('settings.language_cs')}>{t('settings.language_cs')}</Option>
                                            <Option value="en" text={t('settings.language_en')}>{t('settings.language_en')}</Option>
                                        </Dropdown>
                                    </div>

                                    {organizations.length > 0 && (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                            <Label>{t('settings.default_org_label')}</Label>
                                            <Dropdown
                                                value={organizations.find(o => o.org_id === effectiveDefault)?.display_name || effectiveDefault}
                                                onOptionSelect={(_, data) => setSelectedDefaultOrg(data.optionValue as string)}
                                            >
                                                {organizations.map(org => (
                                                    <Option key={org.org_id} value={org.org_id} text={`${org.display_name} (${org.org_id})`}>
                                                        {org.display_name} ({org.org_id})
                                                    </Option>
                                                ))}
                                            </Dropdown>
                                            <Text size={100} style={{ color: tokens.colorNeutralForeground4 }}>
                                                {t('settings.defaultOrgHint')}
                                            </Text>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* SECURITY TAB */}
                            {tab === 'security' && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    <Text weight="semibold" style={{ marginBottom: '8px', display: 'block' }}>{t('settings.password_change')}</Text>
                                    <div>
                                        <Label>{t('settings.new_password')}</Label>
                                        <Input
                                            type="password"
                                            value={newPassword}
                                            onChange={(_, d) => setNewPassword(d.value)}
                                            style={{ width: '100%' }}
                                        />
                                    </div>
                                    <div>
                                        <Label>{t('settings.confirm_password')}</Label>
                                        <Input
                                            type="password"
                                            value={confirmPassword}
                                            onChange={(_, d) => setConfirmPassword(d.value)}
                                            style={{ width: '100%' }}
                                        />
                                    </div>
                                    {passwordError && (
                                        <Text style={{ color: tokens.colorPaletteRedForeground1 }}>
                                            {t(passwordError) || passwordError}
                                        </Text>
                                    )}
                                </div>
                            )}

                            {/* PERSONALIZATION TAB */}
                            {tab === 'personalization' && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <Text weight="semibold">{t('settings.grid_preferences')}</Text>
                                        <Button appearance="secondary" onClick={clearAllPrefs} disabled={serverParams.length === 0}>
                                            {t('settings.clear_all')}
                                        </Button>
                                    </div>
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHeaderCell>{t('common.name')}</TableHeaderCell>
                                                <TableHeaderCell>{t('common.updated_at')}</TableHeaderCell>
                                                <TableHeaderCell />
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {serverParams.length === 0 && <TableRow><TableCell colSpan={3}>{t('common.no_data')}</TableCell></TableRow>}
                                            {serverParams.map((p: any) => (
                                                <TableRow key={p.rec_id}>
                                                    <TableCell>{p.param_key.replace('grid_', (t('common.grid') || 'Grid') + ': ')}</TableCell>
                                                    <TableCell>{p.updated_at ? new Date(p.updated_at).toLocaleString() : '-'}</TableCell>
                                                    <TableCell>
                                                        <Button icon={<Delete24Regular />} appearance="subtle" onClick={() => deleteServerParam(p.rec_id, p.param_key)} title={t('common.delete')} />
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                    <Text size={200} style={{ color: tokens.colorNeutralForeground4 }}>
                                        {t('settings.personalization_hint')}
                                    </Text>
                                </div>
                            )}
                        </div>
                    </DialogContent>
                    <DialogActions>
                        <Button appearance="primary" onClick={handleSave} disabled={saving}>
                            {saving ? t('common.working') : t('common.save')}
                        </Button>
                        <Button appearance="secondary" onClick={() => onOpenChange(false)}>
                            {t('common.cancel')}
                        </Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};

