
import React, { useState, useMemo, useEffect, useRef, type SyntheticEvent } from 'react';
import type {
    TableColumnDefinition,
    TableColumnId,
    SelectionItemId,
    OnSelectionChangeData,
} from '@fluentui/react-components';
import {
    DataGrid,
    DataGridBody,
    DataGridRow,
    DataGridHeader,
    DataGridHeaderCell,
    DataGridCell,
    Input,
    Button,
    Menu,
    MenuTrigger,
    MenuList,
    MenuItem,
    MenuPopover,
    MenuDivider,
    Popover,
    PopoverSurface,
    PopoverTrigger,
    tokens,
    makeStyles,
} from '@fluentui/react-components';
import {
    ArrowSortUp24Regular,
    ArrowSortDown24Regular,
    Filter24Regular,
    QuestionCircle24Regular,
    ChevronDown24Regular
} from '@fluentui/react-icons';

const useStyles = makeStyles({
    headerCellContent: {
        display: 'flex',
        alignItems: 'stretch',
        width: '100%',
        height: '100%',
        justifyContent: 'space-between',
        ':hover': {
            backgroundColor: tokens.colorNeutralBackground1Hover
        }
    },
    headerLabelArea: {
        flexGrow: 1,
        display: 'flex',
        alignItems: 'center',
        padding: '0 8px',
        cursor: 'pointer',
        gap: '4px',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        textOverflow: 'ellipsis'
    },
    headerSortArea: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 8px',
        cursor: 'pointer',
        borderLeft: `1px solid ${tokens.colorNeutralStroke2}`,
        ':hover': {
            backgroundColor: tokens.colorNeutralBackground1Pressed
        }
    },
    filterActive: {
        color: tokens.colorBrandForeground1
    },
    cell: {
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        display: 'block', // Required for textOverflow to work in some flex contexts
        '@media (max-width: 768px)': {
            paddingLeft: '4px',
            paddingRight: '4px',
            fontSize: '12px'
        }
    },
    helpPopover: {
        padding: '12px',
        maxWidth: '300px'
    }
});

export type ExtendedTableColumnDefinition<T> = TableColumnDefinition<T> & {
    align?: 'left' | 'right' | 'center';
    minWidth?: number;
};

interface SmartDataGridProps<T> {
    items: T[];
    columns: ExtendedTableColumnDefinition<T>[];
    getRowId: (item: T) => string | number;
    withFilterRow?: boolean;
    onFilteredDataChange?: (filteredItems: T[]) => void;
    onRowClick?: (item: T) => void;
    selectionMode?: 'single' | 'multiselect' | 'none';
    selectedItems?: Set<SelectionItemId>;
    onSelectionChange?: (e: SyntheticEvent, data: OnSelectionChangeData) => void;
}

// ... inside component ...

export const SmartDataGrid = <T,>({ items, columns, getRowId,
    onFilteredDataChange,
    onRowClick,
    selectionMode,
    selectedItems,
    onSelectionChange
}: SmartDataGridProps<T>) => {
    // ...

    // Update renderHeader
    const renderHeader = () => (
        <DataGrid
            items={processedItems}
            columns={columns}
            sortable={false}
            selectionMode={selectionMode}
            getRowId={getRowId}
            selectedItems={selectedItems}
            onSelectionChange={onSelectionChange}
        >
            {/* ... */}
        </DataGrid>
    );

    // Update renderBody
    const renderBody = (itemsToRender: T[]) => (
        <DataGrid
            items={itemsToRender}
            columns={columns}
            sortable={false}
            selectionMode={selectionMode}
            getRowId={getRowId}
            selectedItems={selectedItems}
            onSelectionChange={onSelectionChange}
        >
            {/* ... */}
        </DataGrid>
    );

    // Update non-virtualized return
    if (!isVirtualized) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
                <div style={{ flex: 1, overflow: 'auto' }}>
                    <DataGrid
                        items={processedItems}
                        columns={columns}
                        sortable={false}
                        selectionMode={selectionMode}
                        getRowId={getRowId}
                        selectedItems={selectedItems}
                        onSelectionChange={onSelectionChange}
                    >
                        {/* ... */}
                    </DataGrid>
                </div>
            </div>
        );
    }

    // Virtualized Render
    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            {/* Fixed Header */}
            <div style={{ flexShrink: 0, borderBottom: `1px solid ${tokens.colorNeutralStroke1}` }}>
                {renderHeader()}
            </div>

            {/* Scrollable Body */}
            <div
                ref={scrollContainerRef}
                display-name="ScrollContainer"
                style={{ flex: 1, overflow: 'auto' }}
                onScroll={handleScroll}
            >
                <div style={{ height: `${totalHeight}px`, position: 'relative' }}>
                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${offsetY}px)` }}>
                        {renderBody(visibleItems)}
                    </div>
                </div>
            </div>
        </div>
    );
};
