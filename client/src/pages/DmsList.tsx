
import React from 'react';
import { ActionBar } from '../components/ActionBar';
import { Button, Title3 } from '@fluentui/react-components';
import { ArrowLeft24Regular } from '@fluentui/react-icons';
import { useNavigate } from 'react-router-dom';

export const DmsList: React.FC = () => {
    const navigate = useNavigate();
    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <ActionBar>
                <Button appearance="subtle" icon={<ArrowLeft24Regular />} onClick={() => navigate('/dms')}>Zpět</Button>
                <div style={{ flex: 1 }} />
                <Button appearance="primary">Nový záznam</Button>
            </ActionBar>
            <div style={{ padding: '24px' }}>
                <Title3>Seznam dokumentů</Title3>
                <p>Grid s dokumenty bude zde...</p>
            </div>
        </div>
    );
};
