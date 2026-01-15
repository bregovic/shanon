
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

    const [files, setFiles] = useState<File[]>([]);
    const [docTypes, setDocTypes] = useState<DocType[]>([]);
    const [selectedType, setSelectedType] = useState<string>('');

    // Valid only for single file upload override
    const [displayName, setDisplayName] = useState('');

    const [enableOcr, setEnableOcr] = useState(true);
    const [manualMap, setManualMap] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState('');
    const [warning, setWarning] = useState('');
    const [successMsg, setSuccessMsg] = useState('');
    const [dragOver, setDragOver] = useState(false);

    const [progress, setProgress] = useState(0);

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
        const selected = e.target.files;
        if (selected && selected.length > 0) {
            const newFiles = Array.from(selected);
            setFiles(prev => [...prev, ...newFiles]);

            // If single file total, set display name defaults
            if (files.length + newFiles.length === 1) {
                setDisplayName(newFiles[0].name.replace(/\.[^/.]+$/, ''));
            } else {
                setDisplayName(''); // Batch mode -> clear manual name
            }

            setError('');
            setWarning('');
            setSuccessMsg('');
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        const dropped = e.dataTransfer.files;
        if (dropped && dropped.length > 0) {
            const newFiles = Array.from(dropped);
            setFiles(prev => [...prev, ...newFiles]);

            if (files.length + newFiles.length === 1) {
                setDisplayName(newFiles[0].name.replace(/\.[^/.]+$/, ''));
            } else {
                setDisplayName('');
            }

            setError('');
            setWarning('');
            setSuccessMsg('');
        }
    };

    const removeFile = (index: number) => {
        setFiles(prev => prev.filter((_, i) => i !== index));
    };

    const handleUpload = async () => {
        if (files.length === 0) {
            setError('Vyberte soubor(y) k nahrání.');
            return;
        }
        if (!selectedType) {
            setError('Vyberte typ dokumentu.');
            return;
        }

        setUploading(true);
        setError('');
        setSuccessMsg('');
        setProgress(0);

        let successCount = 0;
        let failCount = 0;
        let lastWarning = '';

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const formData = new FormData();
            formData.append('file', file);

            // Use custom name if only 1 file and specified, else filename
            let nameToSend = file.name;
            if (files.length === 1 && displayName) {
                nameToSend = displayName;
            }
            formData.append('display_name', nameToSend);
            formData.append('doc_type_id', selectedType);
            formData.append('enable_ocr', enableOcr ? '1' : '0');
            formData.append('force_manual', manualMap ? '1' : '0');

            try {
                const res = await fetch('/api/api-dms.php?action=upload', {
                    method: 'POST',
                    body: formData
                });
                const json = await res.json();
                if (json.success) {
                    successCount++;
                    if (json.warning) lastWarning = json.warning;
                } else {
                    failCount++;
                    console.error('Upload failed for', file.name, json.error);
                }
            } catch (err) {
                failCount++;
            }

            setProgress(i + 1);
        }

        setUploading(false);
        setFiles([]); // Clear queue
        setDisplayName('');

        if (failCount === 0) {
            setSuccessMsg(`Všechny dokumenty (${successCount}) byly úspěšně nahrány.`);
            if (lastWarning) setWarning(lastWarning);
            setTimeout(() => navigate('/dms/list'), 1500);
        } else {
            setError(`Nahráno: ${successCount}, Chyba: ${failCount}. Zkontrolujte prosím konzoli nebo logy.`);
            if (lastWarning) setWarning(lastWarning);
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
                <Title3>Import dokumentů</Title3>
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

                {successMsg && (
                    <MessageBar intent="success" style={{ marginBottom: '16px' }}>
                        <MessageBarBody>
                            {successMsg}
                            {!warning && !error && ' Přesměrování...'}
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
                        multiple
                        accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.txt"
                    />
                    <ArrowUpload24Regular style={{ fontSize: '48px', color: tokens.colorBrandForeground1 }} />
                    <Text block style={{ marginTop: '12px' }}>
                        Přetáhněte soubory sem (více naráz) nebo klikněte
                    </Text>
                    <Text size={200} style={{ color: tokens.colorNeutralForeground4, marginTop: '8px' }}>
                        PDF, Word, Excel, Obrázky (max 10 MB)
                    </Text>
                </Card>

                {/* Selected Files List */}
                {files.length > 0 && (
                    <div style={{ marginBottom: '24px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <Text weight="medium">Vybrané soubory ({files.length}):</Text>
                        {files.map((f, i) => (
                            <Card key={i} style={{ padding: '8px 16px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        <Text>{f.name}</Text>
                                        <Text size={200} style={{ marginLeft: '8px', color: tokens.colorNeutralForeground4 }}>
                                            {formatBytes(f.size)}
                                        </Text>
                                    </div>
                                    <Button
                                        icon={<Dismiss24Regular />}
                                        appearance="subtle"
                                        size="small"
                                        onClick={() => removeFile(i)}
                                    />
                                </div>
                            </Card>
                        ))}
                    </div>
                )}


                {/* Form Fields */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {files.length === 1 && (
                        <Field label="Název dokumentu (volitelné)">
                            <Input
                                value={displayName}
                                onChange={(_, data) => setDisplayName(data.value)}
                                placeholder={files[0].name}
                            />
                        </Field>
                    )}

                    <Field label="Typ dokumentů (společný pro všechny)">
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
                        onChange={(_, data) => {
                            setEnableOcr(!!data.checked);
                            if (data.checked) setManualMap(false);
                        }}
                        label="Provést automatické vytěžení dat (OCR)"
                    />

                    <Checkbox
                        checked={manualMap}
                        onChange={(_, data) => {
                            setManualMap(!!data.checked);
                            if (data.checked) setEnableOcr(false);
                        }}
                        label="Jen připravit k revizi (status Mapování)"
                    />
                </div>

                {/* Submit Button */}
                <div style={{ marginTop: '24px', display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <Button
                        appearance="primary"
                        icon={uploading ? <Spinner size="tiny" /> : <DocumentAdd24Regular />}
                        onClick={handleUpload}
                        disabled={files.length === 0 || uploading}
                    >
                        {uploading ? `Nahrávám ${progress} / ${files.length}...` : 'Nahrát vše'}
                    </Button>
                    <Button appearance="secondary" onClick={() => navigate('/dms/list')} disabled={uploading}>
                        Zrušit
                    </Button>
                </div>
            </div>
        </div>
    );
};
