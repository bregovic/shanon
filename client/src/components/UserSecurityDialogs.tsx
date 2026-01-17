import React, { useEffect, useState } from 'react';
import {
    Dialog,
    DialogSurface,
    DialogBody,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Label,
    Dropdown,
    Option,
    Spinner,
    Drawer
} from '@fluentui/react-components';
import { useTranslation } from '../context/TranslationContext';
import { TransferList, type TransferItem } from './TransferList';

const API_BASE = import.meta.env.DEV
    ? 'http://localhost/Webhry/hollyhop/broker/shanon/backend'
    : '/api';

// --- Types ---
interface OrgAccess {
    rec_id?: number;
    user_id: number;
    org_id: string;
    roles: string[];
    is_active: boolean;
    is_default?: boolean;
}

interface UserSettings {
    language?: string;
    default_org_id?: string;
}

// --- User Settings Dialog ---

// ...
// ...
export const UserSettingsDialog: React.FC<{
    open: boolean;
    userId: number;
    onClose: () => void;
}> = ({ open, userId, onClose }) => {
    const { t } = useTranslation();
    const [loading, setLoading] = useState(false);
    const [settings, setSettings] = useState<UserSettings>({});
    const [orgOptions, setOrgOptions] = useState<string[]>([]);

    useEffect(() => {
        if (open && userId) {
            loadData();
        }
    }, [open, userId]);

    const loadData = async () => {
        setLoading(true);
        try {
            const res = await fetch(`${API_BASE}/api-users.php?action=get_security_details&id=${userId}`, { credentials: 'include' });
            const json = await res.json();
            if (json.success) {
                setSettings(json.settings || {});
                // Extract org IDs from access list for the default org dropdown
                const orgs = (json.org_access || []).map((oa: OrgAccess) => oa.org_id);
                setOrgOptions(orgs);
            }
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        setLoading(true);
        try {
            await fetch(`${API_BASE}/api-users.php?action=save_security_details`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: userId,
                    settings: settings
                }),
                credentials: 'include'
            });
            onClose();
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(_, data) => !data.open && onClose()}>
            <DialogSurface>
                <DialogBody>
                    <DialogTitle>{t('settings.user_title')}</DialogTitle>
                    <DialogContent>
                        {loading && <Spinner />}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 15, marginTop: 10 }}>
                            <div>
                                <Label>{t('settings.language_label')}</Label>
                                <Dropdown
                                    value={settings.language === 'en' ? t('settings.language_en') : t('settings.language_cs')}
                                    onOptionSelect={(_, d) => setSettings({ ...settings, language: d.optionValue || 'cs' })}
                                >
                                    <Option value="cs">{t('settings.language_cs')}</Option>
                                    <Option value="en">{t('settings.language_en')}</Option>
                                </Dropdown>
                            </div>
                            <div>
                                <Label>{t('settings.default_org_label')}</Label>
                                <Dropdown
                                    placeholder={t('settings.default_org_placeholder')}
                                    value={settings.default_org_id || ''}
                                    onOptionSelect={(_, d) => setSettings({ ...settings, default_org_id: d.optionValue || '' })}
                                >
                                    {orgOptions.map(o => (
                                        <Option key={o} value={o}>{o}</Option>
                                    ))}
                                </Dropdown>
                            </div>
                        </div>
                    </DialogContent>
                    <DialogActions>
                        <Button appearance="primary" onClick={handleSave}>{t('common.save')}</Button>
                        <Button appearance="secondary" onClick={onClose}>{t('common.close')}</Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};

// --- User Access Drawer (using TransferList) ---

interface OrgData {
    org_id: string;
    display_name: string;
}

export const UserAccessDrawer: React.FC<{
    open: boolean;
    userIds: number[];  // Support multiple users
    userNames: string[];
    onClose: () => void;
    onSaved?: () => void;
}> = ({ open, userIds, userNames, onClose, onSaved }) => {
    const { t } = useTranslation();
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    // All available organizations
    const [allOrgs, setAllOrgs] = useState<OrgData[]>([]);
    // Currently assigned org IDs (intersection for multiple users)
    const [assignedOrgIds, setAssignedOrgIds] = useState<string[]>([]);
    // Initial state for comparison
    const [initialAssignedIds, setInitialAssignedIds] = useState<string[]>([]);

    useEffect(() => {
        if (open && userIds.length > 0) {
            loadData();
        }
    }, [open, userIds]);

    const loadData = async () => {
        setLoading(true);
        try {
            // For single user, get their assignments
            // For multiple users, get intersection of assignments
            const res = await fetch(`${API_BASE}/api-users.php?action=get_org_assignments&ids=${userIds.join(',')}`, {
                credentials: 'include'
            });
            const json = await res.json();
            if (json.success) {
                setAllOrgs(json.all_orgs || []);
                setAssignedOrgIds(json.assigned_org_ids || []);
                setInitialAssignedIds(json.assigned_org_ids || []);
            }
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            // Determine what to add and remove
            const toAdd = assignedOrgIds.filter(id => !initialAssignedIds.includes(id));
            const toRemove = initialAssignedIds.filter(id => !assignedOrgIds.includes(id));

            await fetch(`${API_BASE}/api-users.php?action=save_org_assignments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_ids: userIds,
                    add_org_ids: toAdd,
                    remove_org_ids: toRemove
                }),
                credentials: 'include'
            });

            onSaved?.();
            onClose();
        } finally {
            setSaving(false);
        }
    };

    // Transform orgs to TransferItem format
    const availableItems: TransferItem[] = allOrgs.map(org => ({
        id: org.org_id,
        label: org.display_name,
        description: org.org_id
    }));

    const hasChanges = JSON.stringify(assignedOrgIds.sort()) !== JSON.stringify(initialAssignedIds.sort());

    return (
        <Drawer
            type="overlay"
            position="end"
            size="large"
            open={open}
            onOpenChange={(_, data) => !data.open && onClose()}
        >
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 20 }}>
                {/* Header */}
                <div style={{ marginBottom: 20 }}>
                    <h2 style={{ margin: 0 }}>{t('security.org_access') || 'Přiřazení organizací'}</h2>
                    <div style={{ color: '#666', marginTop: 4 }}>
                        {userIds.length === 1 ? (
                            <>{t('security.permissions_for') || 'Pro uživatele'}: <strong>{userNames[0]}</strong></>
                        ) : (
                            <>{t('security.permissions_for_multiple') || 'Pro uživatele'}: <strong>{userIds.length} uživatelů</strong> ({userNames.slice(0, 3).join(', ')}{userNames.length > 3 && '...'})</>
                        )}
                    </div>
                </div>

                {/* Transfer List */}
                <div style={{ flexGrow: 1, overflow: 'hidden' }}>
                    <TransferList
                        availableItems={availableItems}
                        selectedIds={assignedOrgIds}
                        onSelectionChange={(ids) => setAssignedOrgIds(ids.map(id => String(id)))}
                        availableTitle={t('security.available_orgs') || 'Dostupné organizace'}
                        selectedTitle={t('security.assigned_orgs') || 'Přiřazené organizace'}
                        loading={loading}
                        height="100%"
                    />
                </div>

                {/* Footer */}
                <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                    <Button appearance="secondary" onClick={onClose}>
                        {t('common.cancel') || 'Zrušit'}
                    </Button>
                    <Button
                        appearance="primary"
                        onClick={handleSave}
                        disabled={!hasChanges || saving}
                    >
                        {saving ? (t('common.saving') || 'Ukládám...') : (t('common.save') || 'Uložit')}
                    </Button>
                </div>
            </div>
        </Drawer>
    );
};

// Backward compatibility wrapper for single user
export const UserAccessDrawerSingle: React.FC<{
    open: boolean;
    userId: number;
    userName: string;
    onClose: () => void;
}> = ({ userId, userName, ...props }) => (
    <UserAccessDrawer
        {...props}
        userIds={[userId]}
        userNames={[userName]}
    />
);

