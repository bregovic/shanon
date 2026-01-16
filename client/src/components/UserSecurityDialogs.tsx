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

// --- User Access Drawer (Matrix) ---

interface OrgMatrixItem {
    org_id: string;
    display_name: string;
    roles: string[];
    is_assigned: boolean;
    is_active: boolean;
}

const AVAILABLE_ROLES = [
    { value: 'ADMIN', label: 'Administrátor' },
    { value: 'MANAGER', label: 'Manažer' },
    { value: 'USER', label: 'Uživatel' },
    { value: 'VIEWER', label: 'Čtenář' },
    { value: 'GUEST', label: 'Host' },
];

export const UserAccessDrawer: React.FC<{
    open: boolean;
    userId: number;
    userName: string;
    onClose: () => void;
}> = ({ open, userId, userName, onClose }) => {
    const { t } = useTranslation();
    const [loading, setLoading] = useState(false);
    const [matrix, setMatrix] = useState<OrgMatrixItem[]>([]);

    // UI State
    const [filterAssigned, setFilterAssigned] = useState(false);
    const [selectedOrgs, setSelectedOrgs] = useState<Set<string>>(new Set());

    // Bulk Role Edit State
    const [roleDialogOpen, setRoleDialogOpen] = useState(false);
    const [selectedRoles, setSelectedRoles] = useState<string[]>([]);

    useEffect(() => {
        if (open && userId) loadData();
    }, [open, userId]);

    const loadData = async () => {
        setLoading(true);
        try {
            const res = await fetch(`${API_BASE}/api-users.php?action=get_security_details&id=${userId}`, { credentials: 'include' });
            const json = await res.json();
            if (json.success) {
                setMatrix(json.matrix || []);
            }
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async (updatedMatrix: OrgMatrixItem[]) => {
        setLoading(true);
        // Transform matrix back to expected save format (only assigned items)
        const payload = updatedMatrix
            .filter(item => item.is_assigned)
            .map(item => ({
                org_id: item.org_id,
                roles: item.roles,
                is_active: true
            }));

        try {
            await fetch(`${API_BASE}/api-users.php?action=save_security_details`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: userId,
                    org_access: payload
                }),
                credentials: 'include'
            });
            // Reload to confirm state
            await loadData();
        } finally {
            setLoading(false);
        }
    };

    // --- Bulk Operations ---

    const handleBulkAssign = () => {
        // Open Role Picker
        setSelectedRoles([]); // Reset or prefill? Reset is safer for bulk.
        setRoleDialogOpen(true);
    };

    const applyBulkRoles = () => {
        const newMatrix = matrix.map(item => {
            if (selectedOrgs.has(item.org_id)) {
                return {
                    ...item,
                    is_assigned: true, // Auto-assign if we set roles
                    roles: selectedRoles
                };
            }
            return item;
        });
        setMatrix(newMatrix);
        setRoleDialogOpen(false);
        handleSave(newMatrix); // Auto-save on apply
    };

    const handleBulkRemove = () => {
        if (!confirm('Opravdu odebrat vybrané organizace?')) return;
        const newMatrix = matrix.map(item => {
            if (selectedOrgs.has(item.org_id)) {
                return { ...item, is_assigned: false, roles: [] };
            }
            return item;
        });
        setMatrix(newMatrix);
        handleSave(newMatrix);
    };

    // --- Columns ---
    // Note: We build a simple table or grid here. For "SmartDataGrid" inside a Drawer, 
    // we need to make sure it doesn't conflict with parent page logic. 
    // Since SmartDataGrid is robust, we can use it, but simple mapping is often faster for drawers.
    // However, user requested "Filtrovat", so let's stick to a clean UI list with ActionBar.

    const filteredItems = matrix.filter(item => {
        if (filterAssigned && !item.is_assigned) return false;
        return true;
    });

    return (
        <Drawer
            type="overlay"
            position="end"
            size="large" // Wider drawer for matrix
            open={open}
            onOpenChange={(_, data) => !data.open && onClose()}
        >
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 20 }}>
                {/* Header */}
                <div style={{ marginBottom: 20 }}>
                    <h2 style={{ margin: 0 }}>Oprávnění v organizacích</h2>
                    <div style={{ color: '#666' }}>Uživatel: <strong>{userName}</strong></div>
                </div>

                {/* Toolbar */}
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 10, borderBottom: '1px solid #ccc' }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        <Switch
                            label={filterAssigned ? "Jen přiřazené" : "Všechny organizace"}
                            checked={filterAssigned}
                            onChange={(_, d) => setFilterAssigned(d.checked)}
                        />
                    </div>
                    <div style={{ display: 'flex', gap: 5 }}>
                        <Button
                            icon={<Add24Regular />}
                            disabled={selectedOrgs.size === 0}
                            onClick={handleBulkAssign}
                        >
                            Nastavit role
                        </Button>
                        <Button
                            icon={<Delete24Regular />}
                            disabled={selectedOrgs.size === 0}
                            onClick={handleBulkRemove}
                        >
                            Odebrat
                        </Button>
                    </div>
                </div>

                {/* List / Grid */}
                <div style={{ flexGrow: 1, overflowY: 'auto', marginTop: 10 }}>
                    {loading && <Spinner />}
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHeaderCell style={{ width: 40 }}>
                                    <input
                                        type="checkbox"
                                        checked={selectedOrgs.size === filteredItems.length && filteredItems.length > 0}
                                        onChange={(e) => {
                                            if (e.target.checked) setSelectedOrgs(new Set(filteredItems.map(i => i.org_id)));
                                            else setSelectedOrgs(new Set());
                                        }}
                                    />
                                </TableHeaderCell>
                                <TableHeaderCell>Organizace</TableHeaderCell>
                                <TableHeaderCell>Stav</TableHeaderCell>
                                <TableHeaderCell>Role</TableHeaderCell>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filteredItems.map(item => (
                                <TableRow key={item.org_id} onClick={() => {
                                    // Toggle selection on row click
                                    const newSet = new Set(selectedOrgs);
                                    newSet.has(item.org_id) ? newSet.delete(item.org_id) : newSet.add(item.org_id);
                                    setSelectedOrgs(newSet);
                                }} style={{ cursor: 'pointer', background: selectedOrgs.has(item.org_id) ? '#f0f0f0' : 'transparent' }}>
                                    <TableCell>
                                        <input
                                            type="checkbox"
                                            checked={selectedOrgs.has(item.org_id)}
                                            readOnly
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <strong>{item.display_name}</strong>
                                        <div style={{ fontSize: '0.8em', color: '#888' }}>{item.org_id}</div>
                                    </TableCell>
                                    <TableCell>
                                        {item.is_assigned
                                            ? <Badge appearance="filled" color="success">Přiřazeno</Badge>
                                            : <Badge appearance="ghost">Nepřiřazeno</Badge>
                                        }
                                    </TableCell>
                                    <TableCell>
                                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                            {item.roles.map(r => (
                                                <Badge key={r} appearance="outline">{r}</Badge>
                                            ))}
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                            {filteredItems.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={4} style={{ textAlign: 'center', padding: 20 }}>Nic nenalezeno</TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </div>

                {/* Footer */}
                <div style={{ marginTop: 10, textAlign: 'right' }}>
                    <Button onClick={onClose}>Zavřít</Button>
                </div>
            </div>

            {/* Role Picker Dialog (Internal) */}
            <Dialog open={roleDialogOpen} onOpenChange={(_, d) => !d.open && setRoleDialogOpen(false)}>
                <DialogSurface>
                    <DialogBody>
                        <DialogTitle>Nastavit role pro {selectedOrgs.size} organizací</DialogTitle>
                        <DialogContent>
                            <p>Vyberte role, které budou hromadně nastaveny:</p>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                                {AVAILABLE_ROLES.map(role => (
                                    <div key={role.value} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                        <Switch
                                            checked={selectedRoles.includes(role.value)}
                                            onChange={(_, d) => {
                                                if (d.checked) setSelectedRoles([...selectedRoles, role.value]);
                                                else setSelectedRoles(selectedRoles.filter(r => r !== role.value));
                                            }}
                                        />
                                        <span>{role.label}</span>
                                    </div>
                                ))}
                            </div>
                        </DialogContent>
                        <DialogActions>
                            <Button appearance="primary" onClick={applyBulkRoles}>Použít</Button>
                            <Button appearance="secondary" onClick={() => setRoleDialogOpen(false)}>Zrušit</Button>
                        </DialogActions>
                    </DialogBody>
                </DialogSurface>
            </Dialog>

        </Drawer>
    );
};
