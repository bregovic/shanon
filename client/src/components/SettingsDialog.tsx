
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
    tokens
} from '@fluentui/react-components';
import { useTranslation } from '../context/TranslationContext';
import { useSettings } from '../context/SettingsContext';
import { useAuth } from '../context/AuthContext';
import { useState } from 'react';

const useStyles = makeStyles({
    content: {
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        paddingTop: '10px',
        minHeight: '150px'
    }
});

const API_BASE = import.meta.env.DEV
    ? 'http://localhost/Webhry/hollyhop/broker/shanon/backend'
    : '/api';

export const SettingsDialog = ({ open, onOpenChange }: { open: boolean, onOpenChange: (open: boolean) => void }) => {
    const styles = useStyles();
    const { t } = useTranslation();
    const { language, setLanguage, saveSettings } = useSettings();
    const { organizations, currentOrgId } = useAuth();
    const [saving, setSaving] = useState(false);
    const [selectedDefaultOrg, setSelectedDefaultOrg] = useState<string | null>(null);

    // Find initial default
    const initialDefault = organizations.find(o => o.is_default)?.org_id || organizations[0]?.org_id || '';
    const effectiveDefault = selectedDefaultOrg ?? initialDefault;

    const handleSave = async () => {
        setSaving(true);
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

    return (
        <Dialog open={open} onOpenChange={(_, data) => onOpenChange(data.open)}>
            <DialogSurface>
                <DialogBody>
                    <DialogTitle>{t('settings.title')}</DialogTitle>
                    <DialogContent className={styles.content}>
                        <div style={{ marginBottom: '16px', padding: '8px', backgroundColor: tokens.colorNeutralBackground2, borderRadius: '4px' }}>
                            <Text size={200} block style={{ color: tokens.colorNeutralForeground4 }}>
                                Version: <span style={{ fontFamily: 'monospace' }}>{__APP_VERSION__}</span>
                            </Text>
                            <Text size={200} block style={{ color: tokens.colorNeutralForeground4 }}>
                                Built: {__APP_BUILD_DATE__}
                            </Text>
                        </div>

                        {/* Language Setting */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                            <Label>{t('settings.language')}</Label>
                            <Dropdown
                                value={language === 'cs' ? 'Čeština' : 'English'}
                                onOptionSelect={(_, data) => setLanguage(data.optionValue as any)}
                            >
                                <Option value="cs" text="Čeština">Čeština</Option>
                                <Option value="en" text="English">English</Option>
                            </Dropdown>
                        </div>

                        {/* Default Organization Setting */}
                        {organizations.length > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                <Label>{t('settings.defaultOrganization') || 'Výchozí společnost'}</Label>
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
                                    {t('settings.defaultOrgHint') || 'Tato společnost bude automaticky vybrána po přihlášení.'}
                                </Text>
                            </div>
                        )}
                    </DialogContent>
                    <DialogActions>
                        <Button appearance="primary" onClick={handleSave} disabled={saving}>
                            {saving ? t('common.loading') : t('common.save')}
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
