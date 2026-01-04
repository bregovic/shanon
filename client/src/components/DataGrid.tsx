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
    Card,
    Text,
    Spinner,
    Badge,
    tokens,
    makeStyles
} from '@fluentui/react-components';
import {
    Search24Regular,
    Filter24Regular,
    ArrowUp24Regular,
    ArrowDown24Regular,
    ChevronLeft24Regular,
    ChevronRight24Regular,
    Dismiss16Regular
} from '@fluentui/react-icons';

const useStyles = makeStyles({
    toolbar: {
        display: 'flex',
        gap: '12px',
        alignItems: 'center',
        marginBottom: '16px',
        flexWrap: 'wrap'
    },
    searchBox: {
        minWidth: '250px',
        flex: '0 1 300px'
    },
    filterGroup: {
        display: 'flex',
        gap: '8px',
        alignItems: 'center'
    },
    pagination: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: '16px',
        padding: '12px 0',
        borderTop: `1px solid ${tokens.colorNeutralStroke2}`
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
    activeFilters: {
        display: 'flex',
        gap: '8px',
        flexWrap: 'wrap',
        marginBottom: '12px'
    },
    filterBadge: {
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        cursor: 'pointer'
    },
    sortableHeader: {
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        ':hover': {
            color: tokens.colorBrandForeground1
        }
    },
    emptyState: {
        textAlign: 'center',
        padding: '40px',
        color: tokens.colorNeutralForeground4
    }
});

// Column definition type
export interface DataGridColumn<T> {
    key: keyof T | string;
    label: string;
    width?: string;
    sortable?: boolean;
    filterable?: boolean;
    filterOptions?: { value: string; label: string }[];
    render?: (item: T) => React.ReactNode;
}

// Filter definition
export interface ActiveFilter {
    key: string;
    value: string;
    label: string;
}

interface DataGridProps<T> {
    data: T[];
    columns: DataGridColumn<T>[];
    loading?: boolean;
    pageSize?: number;
    searchPlaceholder?: string;
    onRowClick?: (item: T) => void;
    emptyMessage?: string;
    showSearch?: boolean;
    showFilters?: boolean;
    showPagination?: boolean;
}

export function DataGrid<T extends { [key: string]: any }>({
    data,
    columns,
    loading = false,
    pageSize = 20,
    searchPlaceholder = 'Hledat...',
    onRowClick,
    emptyMessage = 'Žádné záznamy',
    showSearch = true,
    showFilters = true,
    showPagination = true
}: DataGridProps<T>) {
    const styles = useStyles();

    // State
    const [searchQuery, setSearchQuery] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [sortColumn, setSortColumn] = useState<string | null>(null);
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
    const [activeFilters, setActiveFilters] = useState<ActiveFilter[]>([]);

    // Filter dropdown state
    const [filterColumn, setFilterColumn] = useState<string | null>(null);

    // Get filterable columns
    const filterableColumns = columns.filter(c => c.filterable && c.filterOptions);

    // Apply search and filters
    const filteredData = useMemo(() => {
        let result = [...data];

        // Apply search
        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase();
            result = result.filter(item =>
                columns.some(col => {
                    const value = item[col.key as keyof T];
                    return value && String(value).toLowerCase().includes(query);
                })
            );
        }

        // Apply filters
        activeFilters.forEach(filter => {
            result = result.filter(item => {
                const value = item[filter.key as keyof T];
                return String(value) === filter.value;
            });
        });

        // Apply sorting
        if (sortColumn) {
            result.sort((a, b) => {
                const aVal = a[sortColumn as keyof T];
                const bVal = b[sortColumn as keyof T];

                if (aVal == null) return 1;
                if (bVal == null) return -1;

                const comparison = String(aVal).localeCompare(String(bVal), 'cs', { numeric: true });
                return sortDirection === 'asc' ? comparison : -comparison;
            });
        }

        return result;
    }, [data, searchQuery, activeFilters, sortColumn, sortDirection, columns]);

    // Pagination
    const totalPages = Math.ceil(filteredData.length / pageSize);
    const paginatedData = useMemo(() => {
        const start = (currentPage - 1) * pageSize;
        return filteredData.slice(start, start + pageSize);
    }, [filteredData, currentPage, pageSize]);

    // Reset page when filters change
    React.useEffect(() => {
        setCurrentPage(1);
    }, [searchQuery, activeFilters]);

    // Handle sort
    const handleSort = (columnKey: string) => {
        if (sortColumn === columnKey) {
            setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
        } else {
            setSortColumn(columnKey);
            setSortDirection('asc');
        }
    };

    // Handle filter add
    const handleAddFilter = (columnKey: string, value: string, label: string) => {
        // Remove existing filter for same column
        setActiveFilters(prev => [
            ...prev.filter(f => f.key !== columnKey),
            { key: columnKey, value, label }
        ]);
        setFilterColumn(null);
    };

    // Handle filter remove
    const handleRemoveFilter = (key: string) => {
        setActiveFilters(prev => prev.filter(f => f.key !== key));
    };

    if (loading) {
        return (
            <Card style={{ padding: '40px', textAlign: 'center' }}>
                <Spinner label="Načítám data..." />
            </Card>
        );
    }

    return (
        <div>
            {/* Toolbar */}
            {(showSearch || showFilters) && (
                <div className={styles.toolbar}>
                    {showSearch && (
                        <Input
                            className={styles.searchBox}
                            contentBefore={<Search24Regular />}
                            placeholder={searchPlaceholder}
                            value={searchQuery}
                            onChange={(_, d) => setSearchQuery(d.value)}
                        />
                    )}

                    {showFilters && filterableColumns.length > 0 && (
                        <div className={styles.filterGroup}>
                            <Filter24Regular />
                            <Dropdown
                                placeholder="Filtrovat podle..."
                                value={filterColumn || ''}
                                onOptionSelect={(_, d) => setFilterColumn(d.optionValue || null)}
                            >
                                {filterableColumns.map(col => (
                                    <Option key={String(col.key)} value={String(col.key)}>
                                        {col.label}
                                    </Option>
                                ))}
                            </Dropdown>

                            {filterColumn && (
                                <Dropdown
                                    placeholder="Vyberte hodnotu..."
                                    onOptionSelect={(_, d) => {
                                        const col = filterableColumns.find(c => String(c.key) === filterColumn);
                                        const opt = col?.filterOptions?.find(o => o.value === d.optionValue);
                                        if (opt) {
                                            handleAddFilter(filterColumn, opt.value, `${col?.label}: ${opt.label}`);
                                        }
                                    }}
                                >
                                    {filterableColumns
                                        .find(c => String(c.key) === filterColumn)
                                        ?.filterOptions?.map(opt => (
                                            <Option key={opt.value} value={opt.value}>
                                                {opt.label}
                                            </Option>
                                        ))}
                                </Dropdown>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Active Filters */}
            {activeFilters.length > 0 && (
                <div className={styles.activeFilters}>
                    {activeFilters.map(filter => (
                        <Badge
                            key={filter.key}
                            appearance="outline"
                            className={styles.filterBadge}
                            onClick={() => handleRemoveFilter(filter.key)}
                        >
                            {filter.label}
                            <Dismiss16Regular />
                        </Badge>
                    ))}
                    <Button
                        size="small"
                        appearance="subtle"
                        onClick={() => setActiveFilters([])}
                    >
                        Zrušit vše
                    </Button>
                </div>
            )}

            {/* Table */}
            <Table aria-label="Data Grid">
                <TableHeader>
                    <TableRow>
                        {columns.map(col => (
                            <TableHeaderCell
                                key={String(col.key)}
                                style={{ width: col.width }}
                            >
                                {col.sortable ? (
                                    <div
                                        className={styles.sortableHeader}
                                        onClick={() => handleSort(String(col.key))}
                                    >
                                        {col.label}
                                        {sortColumn === col.key && (
                                            sortDirection === 'asc'
                                                ? <ArrowUp24Regular style={{ fontSize: '12px' }} />
                                                : <ArrowDown24Regular style={{ fontSize: '12px' }} />
                                        )}
                                    </div>
                                ) : (
                                    col.label
                                )}
                            </TableHeaderCell>
                        ))}
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {paginatedData.length === 0 ? (
                        <TableRow>
                            <TableCell colSpan={columns.length}>
                                <div className={styles.emptyState}>
                                    <Text>{emptyMessage}</Text>
                                </div>
                            </TableCell>
                        </TableRow>
                    ) : (
                        paginatedData.map((item, idx) => (
                            <TableRow
                                key={idx}
                                onClick={() => onRowClick?.(item)}
                                style={{ cursor: onRowClick ? 'pointer' : 'default' }}
                            >
                                {columns.map(col => (
                                    <TableCell key={String(col.key)}>
                                        {col.render
                                            ? col.render(item)
                                            : String(item[col.key as keyof T] ?? '-')
                                        }
                                    </TableCell>
                                ))}
                            </TableRow>
                        ))
                    )}
                </TableBody>
            </Table>

            {/* Pagination */}
            {showPagination && filteredData.length > pageSize && (
                <div className={styles.pagination}>
                    <div className={styles.paginationInfo}>
                        <Text>
                            Zobrazeno {((currentPage - 1) * pageSize) + 1} - {Math.min(currentPage * pageSize, filteredData.length)} z {filteredData.length}
                        </Text>
                        <Dropdown
                            value={`${pageSize}`}
                            style={{ minWidth: '100px' }}
                        >
                            <Option value="10">10 / stránka</Option>
                            <Option value="20">20 / stránka</Option>
                            <Option value="50">50 / stránka</Option>
                            <Option value="100">100 / stránka</Option>
                        </Dropdown>
                    </div>

                    <div className={styles.paginationButtons}>
                        <Button
                            icon={<ChevronLeft24Regular />}
                            appearance="subtle"
                            disabled={currentPage === 1}
                            onClick={() => setCurrentPage(p => p - 1)}
                        />
                        <Text>
                            Stránka {currentPage} z {totalPages}
                        </Text>
                        <Button
                            icon={<ChevronRight24Regular />}
                            appearance="subtle"
                            disabled={currentPage === totalPages}
                            onClick={() => setCurrentPage(p => p + 1)}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}

export default DataGrid;
