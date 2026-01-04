import React, { useEffect, useState, useMemo } from 'react';
import {
    Title2,
    Title3,
    Card,
    CardHeader,
    Text,
    Button,
    Spinner,
    Divider,
    makeStyles,
    tokens,
    shorthands,
    Input,
    MessageBar,
    MessageBarBody,
    MessageBarTitle
} from '@fluentui/react-components';
import {
    Shield24Regular,
    Add24Regular,
    Save24Regular,
    Search24Regular
} from '@fluentui/react-icons';
import { useTranslation } from '../context/TranslationContext';

const useStyles = makeStyles({
    container: {
        display: 'flex',
        flexDirection: 'column',
        ...shorthands.gap('24px'),
        ...shorthands.padding('24px'),
        maxWidth: '1400px',
    },
    header: {
        display: 'flex',
        alignItems: 'center',
        ...shorthands.gap('12px'),
    },
    grid: {
        display: 'grid',
        gridTemplateColumns: '300px 1fr',
        ...shorthands.gap('24px'),
    },
    rolesList: {
        display: 'flex',
        flexDirection: 'column',
        ...shorthands.gap('8px'),
    },
    roleItem: {
        ...shorthands.padding('12px'),
        ...shorthands.borderRadius('8px'),
        cursor: 'pointer',
        backgroundColor: tokens.colorNeutralBackground2,
        ':hover': {
            backgroundColor: tokens.colorNeutralBackground2Hover,
        },
    },
    roleItemActive: {
        backgroundColor: tokens.colorBrandBackground2,
        ...shorthands.borderColor(tokens.colorBrandStroke1),
        ...shorthands.borderWidth('2px'),
        ...shorthands.borderStyle('solid'),
    },
    permissionsPanel: {
        display: 'flex',
        flexDirection: 'column',
        ...shorthands.gap('16px'),
    },
    searchBox: {
        maxWidth: '300px',
    },
    objectsGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        ...shorthands.gap('12px'),
    },
    objectCard: {
        ...shorthands.padding('16px'),
        ...shorthands.borderRadius('8px'),
        backgroundColor: tokens.colorNeutralBackground3,
        display: 'flex',
        flexDirection: 'column',
        ...shorthands.gap('8px'),
    },
    accessLevelRow: {
        display: 'flex',
        ...shorthands.gap('8px'),
        alignItems: 'center',
        flexWrap: 'wrap',
    },
    accessButton: {
        minWidth: '70px',
    },
    typeLabel: {
        fontSize: '11px',
        textTransform: 'uppercase',
        color: tokens.colorNeutralForeground3,
    },
});

interface Role {
    rec_id: number;
    code: string;
    description: string;
}

interface SecurityObject {
    rec_id: number;
    identifier: string;
    type: string;
    display_name: string;
    description: string;
}

// Permission interface moved to hook if needed

// These will be translated in the component
const ACCESS_LEVEL_KEYS = [
    { value: 0, key: 'security.access.none', color: 'subtle' as const },
    { value: 1, key: 'security.access.view', color: 'informative' as const },
    { value: 2, key: 'security.access.edit', color: 'warning' as const },
    { value: 3, key: 'security.access.full', color: 'success' as const },
];

export default function SecurityRoles() {
    const styles = useStyles();
    const { t } = useTranslation();

    const [roles, setRoles] = useState<Role[]>([]);
    const [objects, setObjects] = useState<SecurityObject[]>([]);
    const [selectedRole, setSelectedRole] = useState<Role | null>(null);
    const [permissions, setPermissions] = useState<Record<number, number>>({}); // objectId -> accessLevel
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [newRoleCode, setNewRoleCode] = useState('');

    // Fetch roles and objects
    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            try {
                const [rolesRes, objectsRes] = await Promise.all([
                    fetch('/api/api-security.php?action=get_roles'),
                    fetch('/api/api-security.php?action=get_objects')
                ]);
                const rolesData = await rolesRes.json();
                const objectsData = await objectsRes.json();

                if (rolesData.success) setRoles(rolesData.data);
                if (objectsData.success) setObjects(objectsData.data);
            } catch (e) {
                setMessage({ type: 'error', text: 'Nepodařilo se načíst data' });
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, []);

    // Fetch permissions when role selected
    useEffect(() => {
        if (!selectedRole) {
            setPermissions({});
            return;
        }

        const fetchPermissions = async () => {
            try {
                const res = await fetch(`/api/api-security.php?action=get_permissions&role_id=${selectedRole.rec_id}`);
                const data = await res.json();
                if (data.success) {
                    const permMap: Record<number, number> = {};
                    data.data.forEach((p: any) => {
                        permMap[p.object_id] = p.access_level;
                    });
                    setPermissions(permMap);
                }
            } catch (e) {
                console.error('Failed to fetch permissions', e);
            }
        };
        fetchPermissions();
    }, [selectedRole]);

    // Filter objects by search
    const filteredObjects = useMemo(() => {
        if (!searchQuery) return objects;
        const q = searchQuery.toLowerCase();
        return objects.filter(o =>
            o.display_name.toLowerCase().includes(q) ||
            o.identifier.toLowerCase().includes(q) ||
            o.type.toLowerCase().includes(q)
        );
    }, [objects, searchQuery]);

    // Group objects by type
    const groupedObjects = useMemo(() => {
        const groups: Record<string, SecurityObject[]> = {};
        filteredObjects.forEach(obj => {
            if (!groups[obj.type]) groups[obj.type] = [];
            groups[obj.type].push(obj);
        });
        return groups;
    }, [filteredObjects]);

    const handleSetAccessLevel = (objectId: number, level: number) => {
        setPermissions(prev => ({ ...prev, [objectId]: level }));
    };

    const handleSavePermissions = async () => {
        if (!selectedRole) return;

        setSaving(true);
        try {
            const permissionsArray = Object.entries(permissions).map(([objectId, accessLevel]) => ({
                object_id: parseInt(objectId),
                access_level: accessLevel
            }));

            const res = await fetch('/api/api-security.php?action=set_permissions_bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    role_id: selectedRole.rec_id,
                    permissions: permissionsArray
                })
            });
            const data = await res.json();

            if (data.success) {
                setMessage({ type: 'success', text: 'Oprávnění byla uložena' });
            } else {
                setMessage({ type: 'error', text: data.error || 'Chyba při ukládání' });
            }
        } catch (e) {
            setMessage({ type: 'error', text: 'Síťová chyba' });
        } finally {
            setSaving(false);
        }
    };

    const handleCreateRole = async () => {
        if (!newRoleCode.trim()) return;

        try {
            const res = await fetch('/api/api-security.php?action=create_role', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: newRoleCode.toUpperCase(), description: '' })
            });
            const data = await res.json();

            if (data.success) {
                setRoles(prev => [...prev, { rec_id: data.id, code: newRoleCode.toUpperCase(), description: '' }]);
                setNewRoleCode('');
                setMessage({ type: 'success', text: 'Role vytvořena' });
            }
        } catch (e) {
            setMessage({ type: 'error', text: 'Nepodařilo se vytvořit roli' });
        }
    };

    if (loading) {
        return (
            <div className={styles.container}>
                <Spinner label="Načítám..." />
            </div>
        );
    }

    return (
        <div className={styles.container}>
            {/* Header */}
            <div className={styles.header}>
                <Shield24Regular />
                <Title2>Správa rolí zabezpečení</Title2>
            </div>

            {message && (
                <MessageBar intent={message.type === 'success' ? 'success' : 'error'}>
                    <MessageBarBody>
                        <MessageBarTitle>{message.type === 'success' ? 'Úspěch' : 'Chyba'}</MessageBarTitle>
                        {message.text}
                    </MessageBarBody>
                </MessageBar>
            )}

            <div className={styles.grid}>
                {/* Left: Roles List */}
                <Card>
                    <CardHeader header={<Title3>Role</Title3>} />
                    <div className={styles.rolesList}>
                        {roles.map(role => (
                            <div
                                key={role.rec_id}
                                className={`${styles.roleItem} ${selectedRole?.rec_id === role.rec_id ? styles.roleItemActive : ''}`}
                                onClick={() => setSelectedRole(role)}
                            >
                                <Text weight="semibold">{role.code}</Text>
                                {role.description && (
                                    <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                                        {role.description}
                                    </Text>
                                )}
                            </div>
                        ))}

                        <Divider style={{ margin: '12px 0' }} />

                        {/* New Role */}
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <Input
                                placeholder="Kód nové role"
                                value={newRoleCode}
                                onChange={(e, d) => setNewRoleCode(d.value)}
                                style={{ flex: 1 }}
                            />
                            <Button icon={<Add24Regular />} onClick={handleCreateRole} />
                        </div>
                    </div>
                </Card>

                {/* Right: Permissions */}
                <Card>
                    <CardHeader
                        header={
                            <Title3>
                                {selectedRole
                                    ? `Oprávnění pro roli: ${selectedRole.code}`
                                    : 'Vyberte roli'}
                            </Title3>
                        }
                        action={
                            selectedRole && (
                                <Button
                                    appearance="primary"
                                    icon={<Save24Regular />}
                                    onClick={handleSavePermissions}
                                    disabled={saving}
                                >
                                    {saving ? 'Ukládám...' : 'Uložit'}
                                </Button>
                            )
                        }
                    />

                    {selectedRole ? (
                        <div className={styles.permissionsPanel}>
                            <Input
                                className={styles.searchBox}
                                placeholder="Hledat objekty..."
                                contentBefore={<Search24Regular />}
                                value={searchQuery}
                                onChange={(e, d) => setSearchQuery(d.value)}
                            />

                            {Object.entries(groupedObjects).map(([type, objs]) => (
                                <div key={type}>
                                    <Text className={styles.typeLabel}>{type}</Text>
                                    <div className={styles.objectsGrid}>
                                        {objs.map(obj => (
                                            <div key={obj.rec_id} className={styles.objectCard}>
                                                <Text weight="semibold">{obj.display_name}</Text>
                                                <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                                                    {obj.identifier}
                                                </Text>
                                                <div className={styles.accessLevelRow}>
                                                    {ACCESS_LEVEL_KEYS.map(level => (
                                                        <Button
                                                            key={level.value}
                                                            className={styles.accessButton}
                                                            size="small"
                                                            appearance={permissions[obj.rec_id] === level.value ? 'primary' : 'subtle'}
                                                            onClick={() => handleSetAccessLevel(obj.rec_id, level.value)}
                                                        >
                                                            {t(level.key)}
                                                        </Button>
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <Text style={{ padding: '24px', color: tokens.colorNeutralForeground3 }}>
                            Vyberte roli ze seznamu vlevo pro zobrazení a úpravu oprávnění.
                        </Text>
                    )}
                </Card>
            </div>
        </div>
    );
}
