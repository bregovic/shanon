import React, { useState, useEffect } from 'react';
import {
    makeStyles,
    tokens,
    Button,
    Card,
    CardHeader,
    Text,
    Subtitle2,
    Input,
    Label,
    Link,
    MessageBar,
    MessageBarTitle,
    MessageBarBody
} from '@fluentui/react-components';
import {
    ArrowLeft24Regular,
    Key24Regular,
    LockClosed24Regular,
    Open24Regular,
    CheckmarkCircle24Regular
} from '@fluentui/react-icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PageLayout, PageHeader, PageContent } from '../components/PageLayout';
import { ActionBar } from '../components/ActionBar';
import { useTranslation } from '../context/TranslationContext';

const useStyles = makeStyles({
    card: {
        width: '100%',
        maxWidth: '600px',
        margin: '0 auto',
        marginTop: '24px'
    },
    section: {
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        marginBottom: '24px'
    },
    codeBlock: {
        fontFamily: 'monospace',
        backgroundColor: tokens.colorNeutralBackground3,
        padding: '12px',
        borderRadius: tokens.borderRadiusMedium,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
        fontSize: '12px',
        maxHeight: '300px',
        overflowY: 'auto',
        border: `1px solid ${tokens.colorNeutralStroke1}`
    }
});

export const DmsGoogleSetup: React.FC = () => {
    const styles = useStyles();
    const navigate = useNavigate();
    const { t } = useTranslation();
    const [searchParams] = useSearchParams();

    // Form State
    const [clientId, setClientId] = useState('');
    const [clientSecret, setClientSecret] = useState('');

    // Result State
    const [resultJson, setResultJson] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        // Check if we returned from Google with a result
        const res = searchParams.get('result');
        const err = searchParams.get('error');

        if (res) {
            try {
                // Decode and verify JSON
                const decoded = JSON.parse(res);
                setResultJson(JSON.stringify(decoded, null, 2));
            } catch (e) {
                setResultJson(res); // Fail-safe
            }
        }
        if (err) {
            setError(err);
        }
    }, [searchParams]);

    const handleConnect = () => {
        if (!clientId || !clientSecret) {
            alert(t('dms.google.fill_client_info'));
            return;
        }

        // We use the existing PHP script as a proxy to handle the OAuth flow and session storage
        // But we initiate it via a direct form submit logic on the client side to control the redirect URI?
        // Actually, easiest is to construct the URL that points to api-setup-google.php's initiation logic
        // But we need to pass params via POST preferably.

        // Instead, let's create a hidden form and submit it
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = '/api/api-setup-google.php';

        const inputId = document.createElement('input');
        inputId.type = 'hidden';
        inputId.name = 'client_id';
        inputId.value = clientId;
        form.appendChild(inputId);

        const inputSecret = document.createElement('input');
        inputSecret.type = 'hidden';
        inputSecret.name = 'client_secret';
        inputSecret.value = clientSecret;
        form.appendChild(inputSecret);

        // We want the PHP script to eventually redirect back to US, not echo HTML.
        // We'll trust the PHP script update to handle `redirect_back=true` or we modify PHP first.
        // For now, let's assume standard behavior and we'll "style" the PHP separately or accept the rough edges for a moment?
        // NO, user asked to "edit tool into design".
        // SO: We MUST modify api-setup-google.php to redirect back to /dms/google-setup?result=...
        // Let's add a flag
        const inputRedirect = document.createElement('input');
        inputRedirect.type = 'hidden';
        inputRedirect.name = 'return_to_app';
        inputRedirect.value = 'true';
        form.appendChild(inputRedirect);

        document.body.appendChild(form);
        form.submit();
    };

    return (
        <PageLayout>
            <PageHeader>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <Button
                        appearance="subtle"
                        icon={<ArrowLeft24Regular />}
                        onClick={() => navigate('/dms')}
                    />
                    <Text size={500} weight="semibold">{t('dms.google.title')}</Text>
                </div>
            </PageHeader>
            <PageContent>
                <Card className={styles.card}>
                    <CardHeader
                        header={<Subtitle2>{t('dms.google.access_generator')}</Subtitle2>}
                        description={<Text>{t('dms.google.access_desc')}</Text>}
                    />

                    <div style={{ padding: '0 16px 16px' }}>
                        {error && (
                            <MessageBar intent="error" style={{ marginBottom: '16px' }}>
                                <MessageBarBody>
                                    <MessageBarTitle>{t('auth.verification_error')}</MessageBarTitle>
                                    {error}
                                </MessageBarBody>
                            </MessageBar>
                        )}

                        {!resultJson ? (
                            <>
                                <MessageBar intent="info" style={{ marginBottom: '24px' }}>
                                    <MessageBarBody>
                                        {t('dms.google.setup_instruction_1')} <Link href="https://console.cloud.google.com/apis/credentials" target="_blank">Google Cloud Console</Link> {t('dms.google.setup_instruction_2')} <br />
                                        <code style={{ fontWeight: 'bold' }}>{window.location.origin}/api/api-setup-google.php</code>
                                    </MessageBarBody>
                                </MessageBar>

                                <div className={styles.section}>
                                    <Label required>{t('dms.google.client_id')}</Label>
                                    <Input
                                        value={clientId}
                                        onChange={(e) => setClientId(e.target.value)}
                                        contentBefore={<Key24Regular />}
                                        placeholder="...apps.googleusercontent.com"
                                    />
                                </div>

                                <div className={styles.section}>
                                    <Label required>{t('dms.google.client_secret')}</Label>
                                    <Input
                                        value={clientSecret}
                                        onChange={(e) => setClientSecret(e.target.value)}
                                        contentBefore={<LockClosed24Regular />}
                                        type="password"
                                        placeholder="GOCSPX-..."
                                    />
                                </div>

                                <Button
                                    appearance="primary"
                                    size="large"
                                    icon={<Open24Regular />}
                                    onClick={handleConnect}
                                    style={{ width: '100%' }}
                                >
                                    {t('auth.login_google')}
                                </Button>
                            </>
                        ) : (
                            <div className={styles.section}>
                                <MessageBar intent="success" style={{ marginBottom: '16px' }}>
                                    <MessageBarBody>
                                        <MessageBarTitle>{t('dms.google.success')}</MessageBarTitle>
                                        {t('dms.google.json_instruction_1')} <strong>{t('dms.storage.sa_json')}</strong> {t('dms.google.json_instruction_2')}
                                    </MessageBarBody>
                                </MessageBar>

                                <Label>Výsledná konfigurace (Refresh Token)</Label>
                                <div className={styles.codeBlock}>
                                    {resultJson}
                                </div>

                                <Button
                                    appearance="secondary"
                                    onClick={() => navigate('/dms/settings')}
                                    icon={<CheckmarkCircle24Regular />}
                                    style={{ marginTop: '16px' }}
                                >
                                    {t('dms.google.go_to_settings')}
                                </Button>
                            </div>
                        )}
                    </div>
                </Card>
            </PageContent>
        </PageLayout>
    );
};
