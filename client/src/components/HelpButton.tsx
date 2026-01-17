import React from 'react';
import { Button, Tooltip } from '@fluentui/react-components';
import { QuestionCircle24Regular } from '@fluentui/react-icons';
import { useHelp } from '../context/HelpContext';

interface HelpButtonProps {
    topicKey?: string;
    label?: string; // Text label if needed
    appearance?: 'subtle' | 'primary' | 'outline' | 'secondary' | 'transparent';
}

export const HelpButton: React.FC<HelpButtonProps> = ({ topicKey, label, appearance = 'subtle' }) => {
    const { openHelp } = useHelp();

    return (
        <Tooltip content="Otevřít nápovědu" relationship="label">
            <Button
                appearance={appearance}
                icon={<QuestionCircle24Regular />}
                onClick={() => openHelp(topicKey)}
            >
                {label}
            </Button>
        </Tooltip>
    );
};
