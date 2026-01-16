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
    Table,
    TableHeader,
    TableRow,
    TableHeaderCell,
    TableBody,
    TableCell,
    Badge,
    Select,
    Combobox,
    useId,
    Input
} from '@fluentui/react-components';
import { Delete24Regular, Add24Regular, Save24Regular } from '@fluentui/react-icons';
import { useTranslation } from '../context/TranslationContext';

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
                    <DialogTitle>Osobní nastavení uživatele</DialogTitle>
                    <DialogContent>
                        {loading && <Spinner />}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 15, marginTop: 10 }}>
                            <div>
                                <Label>Jazyk rozhraní</Label>
                                <Dropdown
                                    value={settings.language === 'en' ? 'English' : 'Čeština'}
                                    onOptionSelect={(_, d) => setSettings({ ...settings, language: d.optionValue || 'cs' })}
                                >
                                    <Option value="cs">Čeština</Option>
                                    <Option value="en">English</Option>
                                </Dropdown>
                            </div>
                            <div>
                                <Label>Výchozí společnost</Label>
                                <Dropdown
                                    placeholder="Vyberte organizaci..."
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
                        <Button appearance="primary" onClick={handleSave}>Uložit</Button>
                        <Button appearance="secondary" onClick={onClose}>Zavřít</Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};

// --- User Org Access Wizard ---

const AVAILABLE_ROLES = [
    { value: 'ADMIN', label: 'Administrátor' },
    { value: 'MANAGER', label: 'Manažer' },
    { value: 'USER', label: 'Uživatel' },
    { value: 'VIEWER', label: 'Čtenář' },
    { value: 'GUEST', label: 'Host' },
];

export const UserOrgWizard: React.FC<{
    open: boolean;
    userId: number;
    userName: string;
    onClose: () => void;
}> = ({ open, userId, userName, onClose }) => {
    const [loading, setLoading] = useState(false);
    const [accessList, setAccessList] = useState<OrgAccess[]>([]);
    const [availableOrgs, setAvailableOrgs] = useState<{ org_id: string, display_name: string }[]>([]);

    // Add New state
    const [newOrgId, setNewOrgId] = useState<string>('');
    const comboId = useId('combo-org');

    useEffect(() => {
        if (open && userId) loadData();
    }, [open, userId]);

    const loadData = async () => {
        setLoading(true);
        try {
            // Get User Data
            const resUser = await fetch(`${API_BASE}/api-users.php?action=get_security_details&id=${userId}`, { credentials: 'include' });
            const jsonUser = await resUser.json();
            if (jsonUser.success) {
                setAccessList(jsonUser.org_access || []);
            }

            // Get All Orgs (We need a way to list all system orgs)
            // Currently using a hack: getting logged user context usually returns available orgs, 
            // but we need ALL orgs to assign. Assuming admin can see all.
            // Let's reuse ajax-get-user logic or assume sys_organizations exists and we need an endpoint.
            // Fallback: Manually add org ID if list not available or implement 'list_organizations' in api-system.
            // Let's assumes api-system.php?action=list_organizations exists or we add it. 
            // For now, I'll Mock or fetch what I can.

            // Temporary: Fetch current user's orgs and hope Admin has all.
            const resMe = await fetch(`${API_BASE}/ajax-get-user.php`, { credentials: 'include' });
            const jsonMe = await resMe.json();
            if (jsonMe.success && jsonMe.organizations) {
                setAvailableOrgs(jsonMe.organizations);
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
                    org_access: accessList
                }),
                credentials: 'include'
            });
            onClose();
        } finally {
            setLoading(false);
        }
    };

    const addOrg = () => {
        if (!newOrgId) return;
        if (accessList.find(a => a.org_id === newOrgId)) return; // Already exists

        setAccessList([...accessList, {
            user_id: userId,
            org_id: newOrgId,
            roles: ['USER'], // Default
            is_active: true
        }]);
        setNewOrgId('');
    };

    const removeOrg = (orgId: string) => {
        setAccessList(accessList.filter(a => a.org_id !== orgId));
    };

    const toggleRole = (orgId: string, roleCode: string) => {
        setAccessList(accessList.map(a => {
            if (a.org_id !== orgId) return a;
            const hasRole = a.roles.includes(roleCode);
            const newRoles = hasRole
                ? a.roles.filter(r => r !== roleCode)
                : [...a.roles, roleCode];
            return { ...a, roles: newRoles };
        }));
    };

    return (
        <Dialog open={open} onOpenChange={(_, data) => !data.open && onClose()}>
            <DialogSurface aria-label="Editor oprávnění" style={{ minWidth: '600px' }}>
                <DialogBody>
                    <DialogTitle>Organizace a Role: {userName}</DialogTitle>
                    <DialogContent>
                        <p style={{ marginBottom: 10, color: '#666' }}>
                            Přiřaďte uživateli přístup do organizací a definujte jeho role v každé z nich.
                        </p>

                        {/* List */}
                        <div style={{ border: '1px solid #e0e0e0', borderRadius: 4, overflow: 'hidden' }}>
                            <Table size="small">
                                <TableHeader>
                                    <TableRow>
                                        <TableHeaderCell>Organizace</TableHeaderCell>
                                        <TableHeaderCell>Role</TableHeaderCell>
                                        <TableHeaderCell>Akce</TableHeaderCell>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {accessList.map(item => (
                                        <TableRow key={item.org_id}>
                                            <TableCell>
                                                <strong>{availableOrgs.find(o => o.org_id === item.org_id)?.display_name || item.org_id}</strong>
                                                <div style={{ fontSize: '0.8em', color: '#888' }}>{item.org_id}</div>
                                            </TableCell>
                                            <TableCell>
                                                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                                                    {AVAILABLE_ROLES.map(role => {
                                                        const active = item.roles.includes(role.value);
                                                        return (
                                                            <Badge
                                                                key={role.value}
                                                                appearance={active ? 'filled' : 'outline'}
                                                                color={active ? 'brand' : 'secondary'}
                                                                style={{ cursor: 'pointer' }}
                                                                onClick={() => toggleRole(item.org_id, role.value)}
                                                            >
                                                                {role.label}
                                                            </Badge>
                                                        );
                                                    })}
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <Button icon={<Delete24Regular />} appearance="subtle" onClick={() => removeOrg(item.org_id)} />
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                    {accessList.length === 0 && (
                                        <TableRow>
                                            <TableCell colSpan={3} style={{ textAlign: 'center', padding: 20 }}>
                                                Žádné přiřazené organizace. Uživatel nebude mít přístup nikam.
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </div>

                        {/* Add New */}
                        <div style={{ marginTop: 20, display: 'flex', gap: 10, alignItems: 'end' }}>
                            <div style={{ flexGrow: 1 }}>
                                <Label htmlFor={comboId}>Přidat přístup do organizace</Label>
                                <div style={{ display: 'flex', gap: 5 }}>
                                    <Dropdown
                                        aria-labelledby={comboId}
                                        placeholder="Vyberte organizaci"
                                        onOptionSelect={(_, d) => setNewOrgId(d.optionValue || '')}
                                        value={availableOrgs.find(o => o.org_id === newOrgId)?.display_name || newOrgId}
                                        style={{ flexGrow: 1 }}
                                    >
                                        {availableOrgs.filter(o => !accessList.find(a => a.org_id === o.org_id)).map(org => (
                                            <Option key={org.org_id} value={org.org_id} text={org.display_name}>
                                                {org.display_name} ({org.org_id})
                                            </Option>
                                        ))}
                                    </Dropdown>
                                    <Button icon={<Add24Regular />} onClick={addOrg} disabled={!newOrgId}>Přidat</Button>
                                </div>
                            </div>
                        </div>

                    </DialogContent>
                    <DialogActions>
                        <Button appearance="primary" icon={<Save24Regular />} onClick={handleSave} disabled={loading}>
                            {loading ? <Spinner size="tiny" /> : 'Uložit změny'}
                        </Button>
                        <Button appearance="secondary" onClick={onClose}>Zavřít</Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};
