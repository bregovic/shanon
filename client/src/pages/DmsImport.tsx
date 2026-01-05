
import React, { useState, useRef, useEffect } from 'react';
import { ActionBar } from '../components/ActionBar';
import {
    Button,
    Title3,
    Text,
    Card,
    Dropdown,
    Option,
    Checkbox,
    Spinner,
    tokens,
    Field,
    Input,
    MessageBar,
    MessageBarBody
} from '@fluentui/react-components';
import {
    ArrowLeft24Regular,
    DocumentAdd24Regular,
    ArrowUpload24Regular,
    Dismiss24Regular
} from '@fluentui/react-icons';
import { useNavigate } from 'react-router-dom';

interface DocType {
    rec_id: number;
    name: string;
    code: string;
}

export const DmsImport: React.FC = () => {
    const navigate = useNavigate();
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [file, setFile] = useState<File | null>(null);
    const [docTypes, setDocTypes] = useState<DocType[]>([]);
    const [selectedType, setSelectedType] = useState<string>('');
    const [displayName, setDisplayName] = useState('');
    const [enableOcr, setEnableOcr] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState('');
    const [warning, setWarning] = useState('');
    const [success, setSuccess] = useState(false);
    const [dragOver, setDragOver] = useState(false);

    const [targetStorage, setTargetStorage] = useState('');

    // Load document types and storage info
    useEffect(() => {
        // Types
        fetch('/api/api-dms.php?action=types&t=' + Date.now())
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    const types = data.data || [];
                    setDocTypes(types);
                    if (types.length > 0) {
                        setSelectedType(types[0].rec_id.toString());
                    }
                }
            })
            .catch(console.error);

        // Storage Profile (find default)
        fetch('/api/api-dms.php?action=storage_profiles&t=' + Date.now())
            .then(res => res.json())
            .then(data => {
                if (data.success && data.data) {
                    const def = data.data.find((p: any) => p.is_default) || data.data[0];
                    if (def) {
                        setTargetStorage(def.name + (def.provider_type === 'google_drive' ? ' (Google Drive)' : ' (Local)'));
                    }
                }
            })
            .catch(() => { });
    }, []);

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selected = e.target.files?.[0];
        if (selected) {
            setFile(selected);
            setDisplayName(selected.name.replace(/\.[^/.]+$/, '')); // Remove extension
            setError('');
            setWarning('');
            setSuccess(false);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        const dropped = e.dataTransfer.files?.[0];
        if (dropped) {
            setFile(dropped);
            setDisplayName(dropped.name.replace(/\.[^/.]+$/, ''));
            setError('');
            setWarning('');
            setSuccess(false);
        }
    };

    const handleUpload = async () => {
        if (!file) {
            setError('Vyberte soubor k nahrání.');
            return;
        }
        if (!selectedType) {
            setError('Vyberte typ dokumentu.');
            return;
        }

        setUploading(true);
        setError('');

        const formData = new FormData();
        formData.append('file', file);
        formData.append('display_name', displayName || file.name);
        formData.append('doc_type_id', selectedType);
        formData.append('enable_ocr', enableOcr ? '1' : '0');

        try {
            const res = await fetch('/api/api-dms.php?action=upload', {
                method: 'POST',
                body: formData
            });
            const json = await res.json();

            if (json.success) {
                setSuccess(true);
                if (json.warning) setWarning(json.warning);
                setFile(null);
                setDisplayName('');
                // If warning, maybe don't redirect immediately so user can see it?
                if (!json.warning) {
                    setTimeout(() => navigate('/dms/list'), 1500);
                }
            } else {
                setError(json.error || 'Nahrání selhalo.');
            }
        } catch (err) {
            setError('Chyba při komunikaci se serverem.');
        } finally {
            setUploading(false);
        }
    };

    const formatBytes = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <ActionBar>
                <Button appearance="subtle" icon={<ArrowLeft24Regular />} onClick={() => navigate('/dms/list')}>
                    Zpět
                </Button>
                <div style={{ width: '24px' }} />
                <Title3>Import dokumentu</Title3>
            </ActionBar>

            <div style={{ padding: '24px', maxWidth: '600px' }}>
                <Text size={200} style={{ marginBottom: '16px', display: 'block', color: tokens.colorNeutralForeground2 }}>
                    Cílové úložiště: <strong>{targetStorage || 'Zjišťuji...'}</strong>
                </Text>

                {error && (
                    <MessageBar intent="error" style={{ marginBottom: '16px' }}>
                        <MessageBarBody>{error}</MessageBarBody>
                    </MessageBar>
                )}

                {success && (
                    <MessageBar intent="success" style={{ marginBottom: '16px' }}>
                        <MessageBarBody>
                            Dokument byl úspěšně nahrán!
                            {!warning && ' Přesměrování...'}
                        </MessageBarBody>
                    </MessageBar>
                )}

                {warning && (
                    <MessageBar intent="warning" style={{ marginBottom: '16px' }}>
                        <MessageBarBody>
                            <strong>Upozornění:</strong> {warning}
                        </MessageBarBody>
                    </MessageBar>
                )}

                {/* Drop Zone */}
                <Card
                    style={{
                        padding: '40px',
                        textAlign: 'center',
                        border: `2px dashed ${dragOver ? tokens.colorBrandForeground1 : tokens.colorNeutralStroke1}`,
                        backgroundColor: dragOver ? tokens.colorBrandBackground2 : tokens.colorNeutralBackground1,
                        cursor: 'pointer',
                        marginBottom: '24px',
                        transition: 'all 0.2s'
                    }}
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleDrop}
                >
                    <input
                        type="file"
                        ref={fileInputRef}
                        style={{ display: 'none' }}
                        onChange={handleFileSelect}
                        accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.txt"
                    />
                    <ArrowUpload24Regular style={{ fontSize: '48px', color: tokens.colorBrandForeground1 }} />
                    <Text block style={{ marginTop: '12px' }}>
                        Přetáhněte soubor sem nebo klikněte pro výběr
                    </Text>
                    <Text size={200} style={{ color: tokens.colorNeutralForeground4, marginTop: '8px' }}>
                        PDF, Word, Excel, Obrázky (max 10 MB)
                    </Text>
                </Card>

                {/* Selected File Preview */}
                {file && (
                    <Card style={{ padding: '16px', marginBottom: '24px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div>
                                <Text weight="semibold">{file.name}</Text>
                                <Text size={200} style={{ marginLeft: '12px', color: tokens.colorNeutralForeground4 }}>
                                    {formatBytes(file.size)}
                                </Text>
                            </div>
                            <Button
                                icon={<Dismiss24Regular />}
                                appearance="subtle"
                                onClick={() => { setFile(null); setDisplayName(''); }}
                            />
                        </div>
                    </Card>
                )}

                {/* Form Fields */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <Field label="Název dokumentu">
                        <Input
                            value={displayName}
                            onChange={(_, data) => setDisplayName(data.value)}
                            placeholder="Zadejte název..."
                        />
                    </Field>

                    <Field label="Typ dokumentu">
                        <Dropdown
                            placeholder="Vyberte typ..."
                            value={docTypes.find(t => t.rec_id.toString() === selectedType)?.name || ''}
                            onOptionSelect={(_, data) => setSelectedType(data.optionValue || '')}
                        >
                            {docTypes.map(type => (
                                <Option key={type.rec_id} value={type.rec_id.toString()}>
                                    {type.name}
                                </Option>
                            ))}
                        </Dropdown>
                    </Field>

                    <Checkbox
                        checked={enableOcr}
                        onChange={(_, data) => setEnableOcr(!!data.checked)}
                        label="Provést OCR (rozpoznání textu)"
                    />
                </div>

                {/* Submit Button */}
                <div style={{ marginTop: '24px', display: 'flex', gap: '12px' }}>
                    <Button
                        appearance="primary"
                        icon={uploading ? <Spinner size="tiny" /> : <DocumentAdd24Regular />}
                        onClick={handleUpload}
                        disabled={!file || uploading}
                    >
                        {uploading ? 'Nahrávám...' : 'Nahrát dokument'}
                    </Button>
                    <Button appearance="secondary" onClick={() => navigate('/dms/list')}>
                        Zrušit
                    </Button>
                </div>
            </div>
        </div>
    );
};
