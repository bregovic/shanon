import React, { useState, useMemo } from 'react';
import {
    Button,
    Input,
    Text,
    Checkbox,
    makeStyles,
    tokens,
    Spinner
} from '@fluentui/react-components';
import {
    ChevronRight24Regular,
    ChevronLeft24Regular,
    ChevronDoubleRight24Regular,
    ChevronDoubleLeft24Regular,
    Search24Regular
} from '@fluentui/react-icons';
import { useTranslation } from '../context/TranslationContext';

const useStyles = makeStyles({
    container: {
        display: 'flex',
        gap: '16px',
        alignItems: 'stretch',
        minHeight: '300px'
    },
    panel: {
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        border: `1px solid ${tokens.colorNeutralStroke1}`,
        borderRadius: tokens.borderRadiusMedium,
        overflow: 'hidden',
        backgroundColor: tokens.colorNeutralBackground1
    },
    panelHeader: {
        padding: '12px',
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        backgroundColor: tokens.colorNeutralBackground2,
        display: 'flex',
        flexDirection: 'column',
        gap: '8px'
    },
    panelTitle: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
    },
    panelList: {
        flex: 1,
        overflow: 'auto',
        padding: '8px'
    },
    listItem: {
        display: 'flex',
        alignItems: 'center',
        padding: '8px 12px',
        borderRadius: tokens.borderRadiusSmall,
        cursor: 'pointer',
        '&:hover': {
            backgroundColor: tokens.colorNeutralBackground1Hover
        }
    },
    listItemSelected: {
        backgroundColor: tokens.colorBrandBackground2
    },
    controls: {
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: '8px',
        padding: '0 8px'
    },
    emptyMessage: {
        padding: '24px',
        textAlign: 'center',
        color: tokens.colorNeutralForeground3
    }
});

export interface TransferItem {
    id: string | number;
    label: string;
    description?: string;
    disabled?: boolean;
}

export interface TransferListProps {
    /** All available items */
    availableItems: TransferItem[];
    /** Currently selected item IDs */
    selectedIds: (string | number)[];
    /** Callback when selection changes */
    onSelectionChange: (selectedIds: (string | number)[]) => void;
    /** Title for left panel */
    availableTitle?: string;
    /** Title for right panel */
    selectedTitle?: string;
    /** Loading state */
    loading?: boolean;
    /** Height of the component */
    height?: string;
}

export const TransferList: React.FC<TransferListProps> = ({
    availableItems,
    selectedIds,
    onSelectionChange,
    availableTitle,
    selectedTitle,
    loading = false,
    height = '350px'
}) => {
    const styles = useStyles();
    const { t } = useTranslation();

    // Local selection state for highlighting (not the actual assignment)
    const [leftSelected, setLeftSelected] = useState<Set<string | number>>(new Set());
    const [rightSelected, setRightSelected] = useState<Set<string | number>>(new Set());

    // Filter state
    const [leftFilter, setLeftFilter] = useState('');
    const [rightFilter, setRightFilter] = useState('');

    // Computed lists
    const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

    const availableFiltered = useMemo(() => {
        const notSelected = availableItems.filter(item => !selectedSet.has(item.id));
        if (!leftFilter) return notSelected;
        const lowerFilter = leftFilter.toLowerCase();
        return notSelected.filter(item =>
            item.label.toLowerCase().includes(lowerFilter) ||
            item.description?.toLowerCase().includes(lowerFilter)
        );
    }, [availableItems, selectedSet, leftFilter]);

    const selectedFiltered = useMemo(() => {
        const selected = availableItems.filter(item => selectedSet.has(item.id));
        if (!rightFilter) return selected;
        const lowerFilter = rightFilter.toLowerCase();
        return selected.filter(item =>
            item.label.toLowerCase().includes(lowerFilter) ||
            item.description?.toLowerCase().includes(lowerFilter)
        );
    }, [availableItems, selectedSet, rightFilter]);

    // Handlers
    const toggleLeftItem = (id: string | number) => {
        const newSet = new Set(leftSelected);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setLeftSelected(newSet);
    };

    const toggleRightItem = (id: string | number) => {
        const newSet = new Set(rightSelected);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setRightSelected(newSet);
    };

    const selectAllLeft = () => {
        setLeftSelected(new Set(availableFiltered.map(i => i.id)));
    };

    const selectAllRight = () => {
        setRightSelected(new Set(selectedFiltered.map(i => i.id)));
    };

    // Transfer actions
    const moveRight = () => {
        if (leftSelected.size === 0) return;
        const newSelection = [...selectedIds, ...Array.from(leftSelected)];
        onSelectionChange(newSelection);
        setLeftSelected(new Set());
    };

    const moveAllRight = () => {
        const allAvailable = availableFiltered.map(i => i.id);
        const newSelection = [...selectedIds, ...allAvailable];
        onSelectionChange(newSelection);
        setLeftSelected(new Set());
    };

    const moveLeft = () => {
        if (rightSelected.size === 0) return;
        const newSelection = selectedIds.filter(id => !rightSelected.has(id));
        onSelectionChange(newSelection);
        setRightSelected(new Set());
    };

    const moveAllLeft = () => {
        const filteredIds = new Set(selectedFiltered.map(i => i.id));
        const newSelection = selectedIds.filter(id => !filteredIds.has(id));
        onSelectionChange(newSelection);
        setRightSelected(new Set());
    };

    if (loading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height }}>
                <Spinner label={t('common.loading') || 'Načítání...'} />
            </div>
        );
    }

    return (
        <div className={styles.container} style={{ height }}>
            {/* LEFT PANEL - Available */}
            <div className={styles.panel}>
                <div className={styles.panelHeader}>
                    <div className={styles.panelTitle}>
                        <Text weight="semibold">{availableTitle || t('transfer.available') || 'Dostupné'}</Text>
                        <Text size={200}>{availableFiltered.length} položek</Text>
                    </div>
                    <Input
                        size="small"
                        placeholder={t('common.search') || 'Hledat...'}
                        value={leftFilter}
                        onChange={(_, d) => setLeftFilter(d.value)}
                        contentBefore={<Search24Regular />}
                    />
                    <Checkbox
                        label={t('transfer.selectAll') || 'Vybrat vše'}
                        checked={leftSelected.size > 0 && leftSelected.size === availableFiltered.length}
                        onChange={() => {
                            if (leftSelected.size === availableFiltered.length) setLeftSelected(new Set());
                            else selectAllLeft();
                        }}
                    />
                </div>
                <div className={styles.panelList}>
                    {availableFiltered.length === 0 ? (
                        <div className={styles.emptyMessage}>
                            {leftFilter ? 'Žádné výsledky' : t('transfer.noAvailable') || 'Žádné dostupné položky'}
                        </div>
                    ) : (
                        availableFiltered.map(item => (
                            <div
                                key={item.id}
                                className={`${styles.listItem} ${leftSelected.has(item.id) ? styles.listItemSelected : ''}`}
                                onClick={() => toggleLeftItem(item.id)}
                            >
                                <Checkbox
                                    checked={leftSelected.has(item.id)}
                                    onChange={() => toggleLeftItem(item.id)}
                                />
                                <div style={{ marginLeft: 8 }}>
                                    <Text>{item.label}</Text>
                                    {item.description && (
                                        <Text size={200} style={{ display: 'block', color: tokens.colorNeutralForeground3 }}>
                                            {item.description}
                                        </Text>
                                    )}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* CONTROLS */}
            <div className={styles.controls}>
                <Button
                    icon={<ChevronRight24Regular />}
                    onClick={moveRight}
                    disabled={leftSelected.size === 0}
                    title={t('transfer.addSelected') || 'Přidat vybrané'}
                />
                <Button
                    icon={<ChevronDoubleRight24Regular />}
                    onClick={moveAllRight}
                    disabled={availableFiltered.length === 0}
                    title={t('transfer.addAll') || 'Přidat vše'}
                />
                <Button
                    icon={<ChevronLeft24Regular />}
                    onClick={moveLeft}
                    disabled={rightSelected.size === 0}
                    title={t('transfer.removeSelected') || 'Odebrat vybrané'}
                />
                <Button
                    icon={<ChevronDoubleLeft24Regular />}
                    onClick={moveAllLeft}
                    disabled={selectedFiltered.length === 0}
                    title={t('transfer.removeAll') || 'Odebrat vše'}
                />
            </div>

            {/* RIGHT PANEL - Selected */}
            <div className={styles.panel}>
                <div className={styles.panelHeader}>
                    <div className={styles.panelTitle}>
                        <Text weight="semibold">{selectedTitle || t('transfer.selected') || 'Vybrané'}</Text>
                        <Text size={200}>{selectedFiltered.length} položek</Text>
                    </div>
                    <Input
                        size="small"
                        placeholder={t('common.search') || 'Hledat...'}
                        value={rightFilter}
                        onChange={(_, d) => setRightFilter(d.value)}
                        contentBefore={<Search24Regular />}
                    />
                    <Checkbox
                        label={t('transfer.selectAll') || 'Vybrat vše'}
                        checked={rightSelected.size > 0 && rightSelected.size === selectedFiltered.length}
                        onChange={() => {
                            if (rightSelected.size === selectedFiltered.length) setRightSelected(new Set());
                            else selectAllRight();
                        }}
                    />
                </div>
                <div className={styles.panelList}>
                    {selectedFiltered.length === 0 ? (
                        <div className={styles.emptyMessage}>
                            {rightFilter ? 'Žádné výsledky' : t('transfer.noSelected') || 'Žádné vybrané položky'}
                        </div>
                    ) : (
                        selectedFiltered.map(item => (
                            <div
                                key={item.id}
                                className={`${styles.listItem} ${rightSelected.has(item.id) ? styles.listItemSelected : ''}`}
                                onClick={() => toggleRightItem(item.id)}
                            >
                                <Checkbox
                                    checked={rightSelected.has(item.id)}
                                    onChange={() => toggleRightItem(item.id)}
                                />
                                <div style={{ marginLeft: 8 }}>
                                    <Text>{item.label}</Text>
                                    {item.description && (
                                        <Text size={200} style={{ display: 'block', color: tokens.colorNeutralForeground3 }}>
                                            {item.description}
                                        </Text>
                                    )}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};

export default TransferList;
