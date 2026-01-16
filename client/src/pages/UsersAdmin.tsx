import { UserSettingsDialog, UserOrgWizard } from '../components/UserSecurityDialogs';
import {
    Settings24Regular,
    BuildingBank24Regular
} from '@fluentui/react-icons';

// ... (existing imports)

export const UsersAdmin: React.FC = () => {
    // ... (existing hooks)

    // Security Dialogs State
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [securityOpen, setSecurityOpen] = useState(false);
    const [targetUser, setTargetUser] = useState<User | null>(null);

    // Helper to get selected user object
    const getSelectedUser = () => {
        if (selectedIds.size !== 1) return null;
        const id = Array.from(selectedIds)[0];
        return users.find(u => u.rec_id === id) || null;
    };

    const handleOpenSettings = () => {
        const u = getSelectedUser();
        if (u) {
            setTargetUser(u);
            setSettingsOpen(true);
        }
    };

    const handleOpenSecurity = () => {
        const u = getSelectedUser();
        if (u) {
            setTargetUser(u);
            setSecurityOpen(true);
        }
    };

    // ... (rest of component: fetchData, useEffect, CRUD handlers) ...

    return (
        <PageLayout>
            {/* ... Header ... */}

            <ActionBar>
                <Button appearance="primary" icon={<Add24Regular />} onClick={handleOpenCreate}>
                    {t('common.new') || 'Nový'}
                </Button>

                <Divider vertical style={{ height: 20, margin: '0 10px' }} />

                <Button
                    appearance="subtle"
                    icon={<Settings24Regular />}
                    disabled={selectedIds.size !== 1}
                    onClick={handleOpenSettings}
                >
                    Nastavení
                </Button>
                <Button
                    appearance="subtle"
                    icon={<BuildingBank24Regular />}
                    disabled={selectedIds.size !== 1}
                    onClick={handleOpenSecurity}
                >
                    Organizace
                </Button>

                <Divider vertical style={{ height: 20, margin: '0 10px' }} />

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

            {/* ... PageContent with Grid ... */}
            <PageContent>
                {/* ... Grid ... */}
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
                        onRowClick={(item) => {
                            // On row click, we select it exclusively if not holding ctrl/shift
                            // But usually SmartDataGrid handles selection.
                            // If we want double click to open edit, we can keep handleOpenEdit(item).
                            // Let's keep existing behavior:
                            handleOpenEdit(item);
                        }}
                    />
                )}
            </PageContent>

            {/* ... Existing Drawer ... */}
            <Drawer... />

            {/* New Dialogs */}
            {targetUser && (
                <>
                    <UserSettingsDialog
                        open={settingsOpen}
                        userId={targetUser.rec_id}
                        onClose={() => setSettingsOpen(false)}
                    />
                    <UserOrgWizard
                        open={securityOpen}
                        userId={targetUser.rec_id}
                        userName={targetUser.full_name || targetUser.email}
                        onClose={() => setSecurityOpen(false)}
                    />
                </>
            )}
        </PageLayout>
    );
};

export default UsersAdmin;
