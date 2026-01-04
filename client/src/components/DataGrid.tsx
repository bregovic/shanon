import React, { useState, useMemo } from 'react';
import {
    Table,
    TableHeader,
    TableBody,
    TableRow,
    TableHeaderCell,
    TableCell,
    Button,
    Input,
    Dropdown,
    Option,
    Text,
    Spinner,
    Popover,
    PopoverSurface,
    PopoverTrigger,
    Divider,
    makeStyles
} from '@fluentui/react-components';
import {
    Filter24Regular,
    Filter24Filled,
    ArrowSortUp24Regular,
    ArrowSortDown24Regular,
    ChevronLeft24Regular,
    ChevronRight24Regular,
    Delete24Regular,
    Checkmark24Regular,
    bundleIcon
} from '@fluentui/react-icons';

const FilterIcon = bundleIcon(Filter24Filled, Filter24Regular);

const useStyles = makeStyles({
    tableContainer: {
        overflowX: 'auto',
    },
    headerCellContent: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        cursor: 'pointer',
        padding: '4px 8px',
        ':hover': {
            backgroundColor: 'rgba(0,0,0,0.05)'
        }
    },
    filterTrigger: {
        marginLeft: '8px',
        opacity: 0.5,
        ':hover': { opacity: 1 },
        '&.active': { opacity: 1, color: '#0078d4' }
    },
    popoverContent: {
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        minWidth: '250px',
        padding: '12px'
    },
    filterSection: {
        display: 'flex',
        flexDirection: 'column',
        gap: '8px'
    },
    footerLayout: {
        display: 'flex',
        justifyContent: 'flex-end',
        gap: '8px',
        marginTop: '8px'
    },
    pagination: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: '16px',
        padding: '12px 0',
        borderTop: '1px solid #e0e0e0'
    },
    paginationInfo: {
        display: 'flex',
        alignItems: 'center',
        gap: '16px'
    },
    paginationButtons: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px'
    },
    menuItem: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px',
        cursor: 'pointer',
        borderRadius: '4px',
        ':hover': { backgroundColor: 'rgba(0,0,0,0.05)' }
    }
});

// Column definition
export interface DataGridColumn<T> {
    key: keyof T | string;
    label: string;
    width?: string;
    sortable?: boolean;
    filterable?: boolean;
    dataType?: 'text' | 'number' | 'date' | 'boolean';
    render?: (item: T) => React.ReactNode;
}

// Filter State Model
interface ColumnFilter {
    operator: string;
    value: string;
}

interface DataGridProps<T> {
    data: T[];
    columns: DataGridColumn<T>[];
    loading?: boolean;
    pageSize?: number;
    emptyMessage?: string;
    onRowClick?: (item: T) => void;
    showPagination?: boolean;
}

export function DataGrid<T extends { [key: string]: any }>({
    data,
    columns,
    loading = false,
    pageSize = 20,
    emptyMessage = 'Žádné záznamy',
    onRowClick,
    showPagination = true
}: DataGridProps<T>) {
    const styles = useStyles();

    // State
    const [page, setPage] = useState(1);
    const [sort, setSort] = useState<{ key: string, dir: 'asc' | 'desc' } | null>(null);
    const [filters, setFilters] = useState<Record<string, ColumnFilter>>({});

    // Popover State (controlled to allow closing on apply)
    const [openPopover, setOpenPopover] = useState<string | null>(null);

    // Apply Logic
    const filteredData = useMemo(() => {
        let result = [...data];

        // 1. Filter
        Object.entries(filters).forEach(([key, filter]) => {
            if (!filter.value && filter.operator !== 'is_empty' && filter.operator !== 'is_not_empty') return;

            result = result.filter(item => {
                const val = item[key];
                const strVal = String(val ?? '').toLowerCase();
                const filterVal = filter.value.toLowerCase();

                switch (filter.operator) {
                    case 'contains': return strVal.includes(filterVal);
                    case 'not_contains': return !strVal.includes(filterVal);
                    case 'starts_with': return strVal.startsWith(filterVal);
                    case 'is_exactly': return strVal === filterVal;
                    case 'is_empty': return !val || val === '';
                    case 'is_not_empty': return val && val !== '';
                    default: return true;
                }
            });
        });

        // 2. Sort
        if (sort) {
            result.sort((a, b) => {
                const valA = a[sort.key];
                const valB = b[sort.key];

                if (valA == null) return 1;
                if (valB == null) return -1;

                const cmp = String(valA).localeCompare(String(valB), undefined, { numeric: true });
                return sort.dir === 'asc' ? cmp : -cmp;
            });
        }

        return result;
    }, [data, filters, sort]);

    // Pagination Logic
    const totalPages = Math.ceil(filteredData.length / pageSize);
    const paginatedData = useMemo(() => {
        const start = (page - 1) * pageSize;
        return filteredData.slice(start, start + pageSize);
    }, [filteredData, page, pageSize]);

    // Handlers
    const handleSort = (key: string, dir: 'asc' | 'desc') => {
        setSort({ key, dir });
        setOpenPopover(null);
    };

    const handleApplyFilter = (key: string, operator: string, value: string) => {
        setFilters(prev => ({
            ...prev,
            [key]: { operator, value }
        }));
        setPage(1); // Reset page
        setOpenPopover(null);
    };

    const handleClearFilter = (key: string) => {
        const newFilters = { ...filters };
        delete newFilters[key];
        setFilters(newFilters);
        setPage(1);
        setOpenPopover(null);
    };

    if (loading) {
        return (
            <div style={{ padding: '40px', textAlign: 'center' }}>
                <Spinner label="Načítám data..." />
            </div>
        );
    }

    // --- Header Filter Component (Internal) ---
    const HeaderFilter = ({ column }: { column: DataGridColumn<T> }) => {
        const colKey = String(column.key);
        const isActive = !!filters[colKey];
        const [tempOp, setTempOp] = useState(filters[colKey]?.operator || 'contains');
        const [tempVal, setTempVal] = useState(filters[colKey]?.value || '');

        return (
            <Popover
                open={openPopover === colKey}
                onOpenChange={(_, d) => setOpenPopover(d.open ? colKey : null)}
                trapFocus
            >
                <PopoverTrigger disableButtonEnhancement>
                    <div className={styles.headerCellContent}>
                        <span onClick={() => {
                            // If just clicking header, toggle sort
                            if (column.sortable) {
                                const currentDir = sort?.key === colKey ? sort.dir : null;
                                const nextDir = currentDir === 'asc' ? 'desc' : 'asc';
                                handleSort(colKey, nextDir);
                            }
                        }}>
                            {column.label}
                            {sort?.key === colKey && (
                                sort.dir === 'asc' ? <ArrowSortUp24Regular style={{ height: 12 }} /> : <ArrowSortDown24Regular style={{ height: 12 }} />
                            )}
                        </span>

                        {(column.filterable !== false) && (
                            <div
                                className={`${styles.filterTrigger} ${isActive ? 'active' : ''}`}
                                onClick={(e) => {
                                    e.stopPropagation(); // Prevent sort
                                    // Popover trigger handles open
                                }}
                            >
                                <FilterIcon style={{ fontSize: 16 }} />
                            </div>
                        )}
                    </div>
                </PopoverTrigger>
                <PopoverSurface className={styles.popoverContent}>
                    {/* Sort Options */}
                    {column.sortable && (
                        <>
                            <div className={styles.menuItem} onClick={() => handleSort(colKey, 'asc')}>
                                <ArrowSortUp24Regular /> Seřadit A až Z
                            </div>
                            <div className={styles.menuItem} onClick={() => handleSort(colKey, 'desc')}>
                                <ArrowSortDown24Regular /> Seřadit Z až A
                            </div>
                            <Divider />
                        </>
                    )}

                    {/* Filter Form */}
                    <div className={styles.filterSection}>
                        <Text weight="semibold">{column.label}</Text>

                        <Dropdown
                            value={
                                tempOp === 'contains' ? 'Obsahuje' :
                                    tempOp === 'is_exactly' ? 'Je přesně' :
                                        tempOp === 'starts_with' ? 'Začíná na' :
                                            tempOp === 'not_contains' ? 'Neobsahuje' :
                                                tempOp === 'is_empty' ? 'Je prázdné' : 'Není prázdné'
                            }
                            selectedOptions={[tempOp]}
                            onOptionSelect={(_, d) => setTempOp(d.optionValue || 'contains')}
                        >
                            <Option value="contains">Obsahuje</Option>
                            <Option value="is_exactly">Je přesně</Option>
                            <Option value="starts_with">Začíná na</Option>
                            <Option value="not_contains">Neobsahuje</Option>
                            <Option value="is_empty">Je prázdné</Option>
                            <Option value="is_not_empty">Není prázdné</Option>
                        </Dropdown>

                        {tempOp !== 'is_empty' && tempOp !== 'is_not_empty' && (
                            <Input
                                placeholder="Hodnota..."
                                value={tempVal}
                                onChange={(_, d) => setTempVal(d.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleApplyFilter(colKey, tempOp, tempVal);
                                }}
                            />
                        )}
                    </div>

                    <div className={styles.footerLayout}>
                        <Button appearance="secondary" onClick={() => handleClearFilter(colKey)} icon={<Delete24Regular />}>
                            Vymazat
                        </Button>
                        <Button
                            appearance="primary"
                            onClick={() => handleApplyFilter(colKey, tempOp, tempVal)}
                            icon={<Checkmark24Regular />}
                        >
                            Použít
                        </Button>
                    </div>
                </PopoverSurface>
            </Popover>
        );
    };

    return (
        <div className={styles.tableContainer}>
            <Table aria-label="Data Grid">
                <TableHeader>
                    <TableRow>
                        {columns.map((col, idx) => (
                            <TableHeaderCell key={idx} style={{ width: col.width }}>
                                <HeaderFilter column={col} />
                            </TableHeaderCell>
                        ))}
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {paginatedData.length === 0 ? (
                        <TableRow>
                            <TableCell colSpan={columns.length} style={{ textAlign: 'center', padding: '40px' }}>
                                <Text style={{ color: '#605e5c' }}>{emptyMessage}</Text>
                            </TableCell>
                        </TableRow>
                    ) : (
                        paginatedData.map((item, idx) => (
                            <TableRow
                                key={idx}
                                onClick={() => onRowClick?.(item)}
                                style={{ cursor: onRowClick ? 'pointer' : 'default' }}
                            >
                                {columns.map((col, cIdx) => (
                                    <TableCell key={cIdx}>
                                        {col.render ? col.render(item) : String(item[col.key] ?? '')}
                                    </TableCell>
                                ))}
                            </TableRow>
                        ))
                    )}
                </TableBody>
            </Table>

            {showPagination && filteredData.length > pageSize && (
                <div className={styles.pagination}>
                    <div className={styles.paginationInfo}>
                        <Text>
                            Zobrazeno {((page - 1) * pageSize) + 1} - {Math.min(page * pageSize, filteredData.length)} z {filteredData.length}
                        </Text>
                    </div>
                    <div className={styles.paginationButtons}>
                        <Button
                            icon={<ChevronLeft24Regular />}
                            appearance="subtle"
                            disabled={page === 1}
                            onClick={() => setPage(p => p - 1)}
                        />
                        <Text>Strana {page} z {totalPages}</Text>
                        <Button
                            icon={<ChevronRight24Regular />}
                            appearance="subtle"
                            disabled={page === totalPages}
                            onClick={() => setPage(p => p + 1)}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}

export default DataGrid;
