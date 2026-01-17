import React from 'react';
import { Button, Tooltip } from '@fluentui/react-components';
import { ArrowClockwise24Regular } from '@fluentui/react-icons';
import { useTranslation } from '../context/TranslationContext';

interface RefreshButtonProps {
    onClick: () => void;
    disabled?: boolean;
    loading?: boolean;
}

/**
 * Standard Refresh Button Component
 * Per MANIFEST: "Refresh (Icon): Soft refresh (zachová filtry)."
 * Per CONTEXT_PROMPT: Action Bar Right side - Icon only.
 */
export const RefreshButton: React.FC<RefreshButtonProps> = ({ onClick, disabled, loading }) => {
    const { t } = useTranslation();

    return (
        <Tooltip content={t('common.refresh')} relationship="label">
            <Button
                appearance="subtle"
                icon={<ArrowClockwise24Regular />}
                aria-label={t('common.refresh')}
                onClick={onClick}
                disabled={disabled || loading}
            />
        </Tooltip>
    );
};
