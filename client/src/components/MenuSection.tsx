import React from 'react';
import {
    makeStyles,
    tokens,
    Text,
    shorthands,
    Spinner
} from '@fluentui/react-components';
import {
    ChevronRight16Regular,
    ChevronDown16Regular,
    ChevronUp16Regular
} from '@fluentui/react-icons';

const useStyles = makeStyles({
    menuItem: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        backgroundColor: tokens.colorNeutralBackground1,
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        borderRadius: '4px',
        cursor: 'pointer',
        transition: 'all 0.2s',
        ':hover': {
            backgroundColor: tokens.colorNeutralBackground1Hover,
            ...shorthands.borderColor(tokens.colorBrandStroke1),
            color: tokens.colorBrandForeground1
        }
    },
    menuItemContent: {
        display: 'flex',
        alignItems: 'center',
        gap: '12px'
    }
});

export const MenuItem = ({ icon, label, onClick, disabled }: { icon?: React.ReactNode, label: string, onClick?: () => void, disabled?: boolean }) => {
    const styles = useStyles();
    return (
        <div
            className={styles.menuItem}
            onClick={disabled ? undefined : onClick}
            style={disabled ? { opacity: 0.6, cursor: 'default', pointerEvents: 'none' } : {}}
        >
            <div className={styles.menuItemContent}>
                {icon && icon}
                <Text weight="medium">{label}</Text>
            </div>
            {disabled ? <Spinner size="extra-small" /> : <ChevronRight16Regular style={{ color: tokens.colorNeutralForeground3 }} />}
        </div>
    );
};

export const MenuSection = ({ id, title, icon, children, isOpen, onToggle }: { id: string, title: string, icon?: React.ReactNode, children: React.ReactNode, isOpen: boolean, onToggle: (id: string) => void }) => {
    return (
        <div style={{ marginBottom: '16px', breakInside: 'avoid' }}>
            <div
                onClick={() => onToggle(id)}
                style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '8px 0', cursor: 'pointer',
                    borderBottom: `2px solid ${tokens.colorNeutralStroke2}`,
                    marginBottom: '8px',
                    userSelect: 'none'
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {icon && <span style={{ color: tokens.colorBrandForeground1 }}>{icon}</span>}
                    <Text weight="semibold" style={{ fontSize: '15px', color: tokens.colorNeutralForeground1 }}>{title}</Text>
                </div>
                {isOpen ? <ChevronUp16Regular style={{ color: tokens.colorNeutralForeground3 }} /> : <ChevronDown16Regular style={{ color: tokens.colorNeutralForeground3 }} />}
            </div>
            {isOpen && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    {children}
                </div>
            )}
        </div>
    );
};
