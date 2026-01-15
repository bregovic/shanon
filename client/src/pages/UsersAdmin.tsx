import React, { useEffect, useState, useMemo, type SyntheticEvent } from 'react';
import {
    Button,
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbButton,
    BreadcrumbDivider,
    Badge,
    Drawer,
    DrawerHeader,
    DrawerHeaderTitle,
    DrawerBody,
    Divider,
    TableCellLayout,
    createTableColumn,
    Input,
    Label,
    Dropdown,
    Option,
    Switch,
    Spinner,
    MessageBar,
    MessageBarBody
} from '@fluentui/react-components';
import type { TableColumnDefinition, OnSelectionChangeData, SelectionItemId } from '@fluentui/react-components';
import {
    Add24Regular,
    ArrowClockwise24Regular,
    Delete24Regular,
    Person24Regular,
    Dismiss24Regular,
    Save24Regular
} from '@fluentui/react-icons';
import { useNavigate } from 'react-router-dom';
import { PageLayout, PageHeader, PageContent } from '../components/PageLayout';
import { SmartDataGrid } from '../components/SmartDataGrid';
import { useTranslation } from '../context/TranslationContext';
import { ActionBar } from '../components/ActionBar';
import { useAuth } from '../context/AuthContext';

const API_BASE = import.meta.env.DEV
    ? 'http://localhost/Webhry/hollyhop/broker/shanon/backend'
    : '/api';

interface User {
    rec_id: number;
    email: string;
    full_name: string;
    role: string;
    is_active: boolean;
    created_at: string;
    updated_at: string;
}

interface UserFormData {
    rec_id?: number;
    email: string;
    full_name: string;
    role: string;
    password: string;
    is_active: boolean;
}

const ROLES = [
    { value: 'user', label: 'Uživatel' },
    { value: 'manager', label: 'Manažer' },
    { value: 'admin', label: 'Administrátor' },
    { value: 'superadmin', label: 'Super Admin' },
];

export const UsersAdmin: React.FC = () => {
    const navigate = useNavigate();
    const { t } = useTranslation();
    const { currentOrgId } = useAuth();
    const orgPrefix = `/${currentOrgId || 'VACKR'}`;

    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedIds, setSelectedIds] = useState<Set<SelectionItemId>>(new Set());

    // Drawer state
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);
    const [drawerMode, setDrawerMode] = useState<'create' | 'edit'>('create');
    const [formData, setFormData] = useState<UserFormData>({
        email: '',
        full_name: '',
        role: 'user',
        password: '',
        is_active: true
    });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchData = async () => {
        setLoading(true);
        try {
            const res = await fetch(`${API_BASE}/api-users.php?action=list`, { credentials: 'include' });
            const json = await res.json();
            if (json.success) {
                setUsers(json.data || []);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    const handleOpenCreate = () => {
        setFormData({ email: '', full_name: '', role: 'user', password: '', is_active: true });
        setDrawerMode('create');
        setError(null);
        setIsDrawerOpen(true);
    };

    const handleOpenEdit = (user: User) => {
        setFormData({
            rec_id: user.rec_id,
            email: user.email,
            full_name: user.full_name,
            role: user.role,
            password: '',
            is_active: user.is_active
        });
        setDrawerMode('edit');
        setError(null);
        setIsDrawerOpen(true);
    };

    const handleSave = async () => {
        setSaving(true);
        setError(null);

        try {
            const action = drawerMode === 'create' ? 'create' : 'update';
            const res = await fetch(`${API_BASE}/api-users.php?action=${action}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData),
                credentials: 'include'
            });
            const json = await res.json();

            if (json.success) {
                setIsDrawerOpen(false);
                fetchData();
            } else {
                setError(json.error || 'Unknown error');
            }
        } catch (e) {
            setError('Network error');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (selectedIds.size === 0) return;
        if (!confirm(`Opravdu smazat ${selectedIds.size} uživatel(e)?`)) return;

        try {
            const res = await fetch(`${API_BASE}/api-users.php?action=delete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: Array.from(selectedIds) }),
                credentials: 'include'
            });
            const json = await res.json();

            if (json.success) {
                setSelectedIds(new Set());
                fetchData();
            } else {
                alert(json.error);
            }
        } catch (e) {
            console.error(e);
        }
    };

    const handleSelectionChange = (_e: SyntheticEvent, data: OnSelectionChangeData) => {
        setSelectedIds(data.selectedItems);
    };

    const handleRowClick = (item: User) => {
        handleOpenEdit(item);
    };

    // Column definitions
    const columns: TableColumnDefinition<User>[] = useMemo(() => [
        createTableColumn<User>({
            columnId: 'rec_id',
            compare: (a, b) => a.rec_id - b.rec_id,
            renderHeaderCell: () => 'ID',
            renderCell: (item) => <TableCellLayout>{item.rec_id}</TableCellLayout>
        }),
        createTableColumn<User>({
            columnId: 'email',
            compare: (a, b) => (a.email || '').localeCompare(b.email || ''),
            renderHeaderCell: () => 'Email',
            renderCell: (item) => <TableCellLayout>{item.email}</TableCellLayout>
        }),
        createTableColumn<User>({
            columnId: 'first_name',
            compare: (a, b) => {
                const nameA = a.full_name.split(' ').slice(0, -1).join(' ');
                const nameB = b.full_name.split(' ').slice(0, -1).join(' ');
                return nameA.localeCompare(nameB);
            },
            renderHeaderCell: () => 'Jméno',
            renderCell: (item) => (
                <TableCellLayout>
                    {item.full_name.split(' ').slice(0, -1).join(' ') || item.full_name}
                </TableCellLayout>
            )
        }),
        createTableColumn<User>({
            columnId: 'last_name',
            compare: (a, b) => {
                const partsA = a.full_name.trim().split(' ');
                const partsB = b.full_name.trim().split(' ');
                const lastA = partsA[partsA.length - 1] || '';
                const lastB = partsB[partsB.length - 1] || '';
                return lastA.localeCompare(lastB);
            },
            renderHeaderCell: () => 'Příjmení',
            renderCell: (item) => {
                const parts = item.full_name.trim().split(' ');
                // If only one name, it's usually treated as Last Name or First Name depending on context. 
                // Let's assume if only one word, it's in the First Name column (above) and this is empty, 
                // OR we put strictly the last token here.
                return (
                    <TableCellLayout>
                        {parts.length > 1 ? parts[parts.length - 1] : ''}
                    </TableCellLayout>
                );
            }
        }),
        createTableColumn<User>({
            columnId: 'role',
            compare: (a, b) => (a.role || '').localeCompare(b.role || ''),
            renderHeaderCell: () => 'Role',
            renderCell: (item) => (
                <TableCellLayout>
                    <Badge appearance="filled" color={item.role === 'superadmin' ? 'danger' : item.role === 'admin' ? 'warning' : 'informative'}>
                        {ROLES.find(r => r.value === item.role)?.label || item.role}
                    </Badge>
                </TableCellLayout>
            )
        }),
        createTableColumn<User>({
            columnId: 'is_active',
            compare: (a, b) => Number(b.is_active) - Number(a.is_active),
            renderHeaderCell: () => 'Status',
            renderCell: (item) => (
                <TableCellLayout>
                    <Badge appearance="filled" color={item.is_active ? 'success' : 'subtle'}>
                        {item.is_active ? 'Aktivní' : 'Neaktivní'}
                    </Badge>
                </TableCellLayout>
            )
        }),
        createTableColumn<User>({
            columnId: 'created_at',
            compare: (a, b) => (a.created_at || '').localeCompare(b.created_at || ''),
            renderHeaderCell: () => 'Vytvořeno',
            renderCell: (item) => (
                <TableCellLayout>
                    {item.created_at ? new Date(item.created_at).toLocaleDateString('cs-CZ') : '-'}
                </TableCellLayout>
            )
        }),
    ], []);

    return (
        <PageLayout>
            <PageHeader>
                <Breadcrumb>
                    <BreadcrumbItem>
                        <BreadcrumbButton onClick={() => navigate(`${orgPrefix}/system`)}>Systém</BreadcrumbButton>
                    </BreadcrumbItem>
                    <BreadcrumbDivider />
                    <BreadcrumbItem>
                        <BreadcrumbButton current>Správa uživatelů</BreadcrumbButton>
                    </BreadcrumbItem>
                </Breadcrumb>
            </PageHeader>

            <ActionBar>
                <Button appearance="primary" icon={<Add24Regular />} onClick={handleOpenCreate}>
                    {t('common.new') || 'Nový'}
                </Button>
                <Button appearance="subtle" icon={<ArrowClockwise24Regular />} onClick={fetchData}>
                    {t('common.refresh') || 'Obnovit'}
                </Button>
                <Button
                    appearance="subtle"
                    icon={<Delete24Regular />}
                    disabled={selectedIds.size === 0}
                    onClick={handleDelete}
                >
                    {t('common.delete') || 'Smazat'} {selectedIds.size > 0 && `(${selectedIds.size})`}
                </Button>
            </ActionBar>

            <PageContent>
                {loading ? (
                    <Spinner label="Načítání..." />
                ) : (
                    <SmartDataGrid
                        items={users}
                        columns={columns}
                        getRowId={(item: User) => item.rec_id}
                        selectionMode="multiselect"
                        selectedItems={selectedIds}
                        onSelectionChange={handleSelectionChange}
                        onRowClick={handleRowClick}
                    />
                )}
            </PageContent>

            {/* Edit/Create Drawer */}
            <Drawer
                type="overlay"
                position="end"
                open={isDrawerOpen}
                onOpenChange={(_, data) => setIsDrawerOpen(data.open)}
                size="medium"
            >
                <DrawerHeader>
                    <DrawerHeaderTitle
                        action={
                            <Button
                                appearance="subtle"
                                icon={<Dismiss24Regular />}
                                onClick={() => setIsDrawerOpen(false)}
                            />
                        }
                    >
                        <Person24Regular style={{ marginRight: 8 }} />
                        {drawerMode === 'create' ? 'Nový uživatel' : 'Upravit uživatele'}
                    </DrawerHeaderTitle>
                </DrawerHeader>
                <DrawerBody>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '16px 0' }}>
                        {error && (
                            <MessageBar intent="error">
                                <MessageBarBody>{error}</MessageBarBody>
                            </MessageBar>
                        )}

                        <div>
                            <Label required>Email</Label>
                            <Input
                                type="email"
                                value={formData.email}
                                onChange={(_, d) => setFormData({ ...formData, email: d.value })}
                                style={{ width: '100%' }}
                            />
                        </div>

                        <div>
                            <Label required>Jméno a příjmení</Label>
                            <Input
                                value={formData.full_name}
                                onChange={(_, d) => setFormData({ ...formData, full_name: d.value })}
                                style={{ width: '100%' }}
                            />
                        </div>

                        <div>
                            <Label>Role</Label>
                            <Dropdown
                                value={ROLES.find(r => r.value === formData.role)?.label || formData.role}
                                onOptionSelect={(_, d) => setFormData({ ...formData, role: d.optionValue as string })}
                                style={{ width: '100%' }}
                            >
                                {ROLES.map(role => (
                                    <Option key={role.value} value={role.value}>{role.label}</Option>
                                ))}
                            </Dropdown>
                        </div>

                        <div>
                            <Label required={drawerMode === 'create'}>
                                {drawerMode === 'create' ? 'Heslo' : 'Nové heslo (ponechte prázdné pro zachování)'}
                            </Label>
                            <Input
                                type="password"
                                value={formData.password}
                                onChange={(_, d) => setFormData({ ...formData, password: d.value })}
                                style={{ width: '100%' }}
                            />
                        </div>

                        <div>
                            <Switch
                                checked={formData.is_active}
                                onChange={(_, d) => setFormData({ ...formData, is_active: d.checked })}
                                label="Aktivní účet"
                            />
                        </div>

                        <Divider />

                        <div style={{ display: 'flex', gap: 8 }}>
                            <Button
                                appearance="primary"
                                icon={<Save24Regular />}
                                onClick={handleSave}
                                disabled={saving}
                            >
                                {saving ? 'Ukládání...' : 'Uložit'}
                            </Button>
                            <Button
                                appearance="secondary"
                                onClick={() => setIsDrawerOpen(false)}
                            >
                                Zrušit
                            </Button>
                        </div>
                    </div>
                </DrawerBody>
            </Drawer>
        </PageLayout>
    );
};

export default UsersAdmin;
