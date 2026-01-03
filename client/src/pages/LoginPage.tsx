
import React, { useState } from 'react';
import {
    Card,
    Input,
    Label,
    Button,
    makeStyles,
    tokens,
    Title3,
    Image,
    Link
} from '@fluentui/react-components';
import { useAuth } from '../context/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';

const useStyles = makeStyles({
    container: {
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        backgroundColor: tokens.colorNeutralBackground2,
    },
    card: {
        width: '360px',
        padding: '32px 24px',
    },
    field: {
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        marginBottom: '16px',
    },
    error: {
        color: tokens.colorPaletteRedForeground1,
        marginBottom: '12px',
        fontSize: '12px',
    },
    success: {
        color: tokens.colorPaletteGreenForeground1,
        marginBottom: '12px',
        fontSize: '12px',
        textAlign: 'center',
    },
    logoContainer: {
        textAlign: 'center',
        marginBottom: '24px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '8px'
    }
});

export const LoginPage: React.FC = () => {
    const styles = useStyles();
    const auth = useAuth();
    const navigate = useNavigate();
    const location = useLocation();

    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [msg, setMsg] = useState((location.state as any)?.message || '');

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setMsg('');
        const success = await auth.login(username, password);
        if (success) {
            navigate('/');
        } else {
            setError('Invalid credentials');
        }
    };

    return (
        <div className={styles.container}>
            <Card className={styles.card}>
                <div className={styles.logoContainer}>
                    <Image src="/logo.png" height={32} fit="contain" alt="Shanon Logo" />
                    <Title3>Shanon</Title3>
                </div>

                {msg && <div className={styles.success}>{msg}</div>}

                <form onSubmit={handleLogin}>
                    <div className={styles.field}>
                        <Label htmlFor="username">Email</Label>
                        <Input
                            id="username"
                            value={username}
                            onChange={(_, d) => setUsername(d.value)}
                            placeholder="user@example.com"
                        />
                    </div>
                    <div className={styles.field}>
                        <Label htmlFor="password">Password</Label>
                        <Input
                            id="password"
                            type="password"
                            value={password}
                            onChange={(_, d) => setPassword(d.value)}
                        />
                    </div>
                    {error && <div className={styles.error}>{error}</div>}
                    <Button type="submit" appearance="primary" style={{ width: '100%' }}>
                        Login
                    </Button>
                </form>
            </Card>
        </div>
    );
};
