
import React from 'react';
import { makeStyles, tokens } from '@fluentui/react-components';

const useStyles = makeStyles({
    root: {
        backgroundColor: tokens.colorNeutralBackground1, // White/Clean
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        padding: '8px 24px',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        height: '44px', // Slightly taller
        flexShrink: 0
    }
});

interface ActionBarProps {
    children: React.ReactNode;
}

export const ActionBar: React.FC<ActionBarProps> = ({ children }) => {
    const styles = useStyles();
    return (
        <div className={styles.root}>
            {children}
        </div>
    );
};
