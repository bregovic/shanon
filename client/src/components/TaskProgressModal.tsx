import React, { useEffect, useState, useRef } from 'react';
import {
    Dialog,
    DialogSurface,
    DialogTitle,
    DialogBody,
    DialogActions,
    Button,
    ProgressBar,
    Text,
    makeStyles,
    tokens
} from '@fluentui/react-components';
import { Dismiss24Regular, CheckmarkCircle24Regular, ErrorCircle24Regular, Timer24Regular } from '@fluentui/react-icons';

const useStyles = makeStyles({
    logContainer: {
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        backgroundColor: tokens.colorNeutralBackground2,
        borderRadius: '4px',
        padding: '10px',
        marginTop: '16px',
        height: '200px',
        overflowY: 'auto',
        fontFamily: 'monospace',
        fontSize: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px'
    },
    logLine: {
        display: 'flex',
        borderBottom: '1px solid #eee0e0e0',
        paddingBottom: '2px'
    },
    logTime: {
        color: tokens.colorNeutralForeground4,
        marginRight: '8px',
        minWidth: '60px'
    },
    logText: {
        color: tokens.colorNeutralForeground1
    },
    statusRow: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '8px'
    }
});

export interface TaskProgressModalProps {
    isOpen: boolean;
    onClose: () => void; // Can create an issue if task is running, maybe disable close?
    title: string;
    totalSteps: number;
    currentStep: number;
    progress: number; // 0-100 or -1 for indeterminate
    statusMessage: string;
    isRunning: boolean;
    logs: Array<{ time: string, message: string, type?: 'info' | 'error' | 'success' }>;
    canClose: boolean; // Only true when finished or user explicitly stops
}

export const TaskProgressModal: React.FC<TaskProgressModalProps> = ({
    isOpen,
    onClose,
    title,
    totalSteps,
    currentStep,
    progress,
    statusMessage,
    isRunning,
    logs,
    canClose
}) => {
    const styles = useStyles();
    const logEndRef = useRef<HTMLDivElement>(null);

    // Auto-scroll logs
    useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    return (
        <Dialog open={isOpen} onOpenChange={(_, data) => {
            if (!data.open && canClose) onClose();
        }}>
            <DialogSurface style={{ minWidth: '500px' }}>
                <DialogBody>
                    <DialogTitle>{title}</DialogTitle>

                    <div style={{ padding: '16px 0' }}>
                        {/* Status Header */}
                        <div className={styles.statusRow}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                {isRunning ? <Timer24Regular /> : (progress >= 100 ? <CheckmarkCircle24Regular color="green" /> : <ErrorCircle24Regular color="red" />)}
                                <Text weight="semibold">{statusMessage}</Text>
                            </div>
                            <Text>{Math.round(progress)}% ({currentStep}/{totalSteps})</Text>
                        </div>

                        {/* Progress Bar */}
                        <ProgressBar
                            value={progress === -1 ? undefined : progress}
                            max={100}
                            color={progress >= 100 ? "success" : "brand"}
                        />

                        {/* Log Console */}
                        <div className={styles.logContainer}>
                            {logs.length === 0 && <Text style={{ color: '#999', fontStyle: 'italic' }}>Waiting to start...</Text>}
                            {logs.map((log, i) => (
                                <div key={i} className={styles.logLine}>
                                    <span className={styles.logTime}>[{log.time}]</span>
                                    <span className={styles.logText} style={{ color: log.type === 'error' ? 'red' : 'inherit' }}>
                                        {log.message}
                                    </span>
                                </div>
                            ))}
                            <div ref={logEndRef} />
                        </div>
                    </div>

                    <DialogActions>
                        <Button appearance="secondary" onClick={onClose} disabled={!canClose}>
                            {isRunning ? 'Pracuji...' : 'Zavřít'}
                        </Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};
