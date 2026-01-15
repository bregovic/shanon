import { useState, useRef, useEffect } from 'react';
import {
    makeStyles,
    shorthands,
    tokens,
    Title2,
    Button,
    Card,
    CardHeader,
    Input,
    Label,
    Dropdown,
    Option,
    Text,
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbDivider
} from '@fluentui/react-components';
import {
    Save24Regular,
    Delete24Regular
} from '@fluentui/react-icons';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { PageLayout, PageHeader, PageContent } from '../components/PageLayout';

// ... (previous imports and styles remain same until Line 110)

interface OCRZone {
    id: string;
    attribute_code: string;
    x: number;
    y: number;
    width: number;
    height: number;
    data_type: 'text' | 'number' | 'date' | 'currency';
    regex_pattern?: string;
}

interface OCRTemplate {
    rec_id?: number;
    name: string;
    doc_type_id: number | null;
    anchor_text: string;
    sample_doc_id: number | null;
}

const useStyles = makeStyles({
    designerContainer: {
        display: 'flex',
        flexDirection: 'row',
        height: 'calc(100vh - 160px)',
        gap: '16px',
        marginTop: '16px',
    },
    canvasArea: {
        flexGrow: 1,
        backgroundColor: tokens.colorNeutralBackground2,
        borderRadius: tokens.borderRadiusMedium,
        overflow: 'auto',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'start',
        position: 'relative',
        border: `1px solid ${tokens.colorNeutralStroke1}`,
    },
    sidebar: {
        width: '320px',
        minWidth: '320px',
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto'
    },
    imageOverlay: {
        position: 'relative',
        display: 'inline-block',
        userSelect: 'none',
    },
    zoneBox: {
        position: 'absolute',
        border: '2px solid rgba(0, 120, 212, 0.5)',
        backgroundColor: 'rgba(0, 120, 212, 0.1)',
        cursor: 'pointer',
        ':hover': {
            border: '2px solid rgba(0, 120, 212, 1)',
            backgroundColor: 'rgba(0, 120, 212, 0.2)',
        }
    },
    zoneBoxSelected: {
        border: '2px solid #d13438', // Red for selected
        backgroundColor: 'rgba(209, 52, 56, 0.2)',
        zIndex: 10,
    },
    zoneLabel: {
        position: 'absolute',
        top: '-20px',
        left: '0',
        backgroundColor: tokens.colorBrandBackground,
        color: tokens.colorNeutralForegroundOnBrand,
        padding: '2px 4px',
        fontSize: '10px',
        borderRadius: '2px',
        whiteSpace: 'nowrap',
    },
    zoneItem: {
        padding: '8px',
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        borderRadius: tokens.borderRadiusMedium,
        borderLeft: `4px solid ${tokens.colorNeutralStroke2}`,
        marginBottom: '8px',
        backgroundColor: tokens.colorNeutralBackground1
    }
});

export const OcrTemplateDesigner = () => {
    const styles = useStyles();
    const navigate = useNavigate();
    const { id: paramId } = useParams();
    const [searchParams] = useSearchParams();
    const sourceDocId = searchParams.get('doc_id');

    // State
    const [template, setTemplate] = useState<OCRTemplate>({ name: 'Nová šablona', doc_type_id: null, anchor_text: '', sample_doc_id: sourceDocId ? parseInt(sourceDocId) : null });
    const [zones, setZones] = useState<OCRZone[]>([]);
    const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
    const [docTypes, setDocTypes] = useState<any[]>([]);
    const [availableAttributes, setAvailableAttributes] = useState<any[]>([]);

    // UI State
    const [imageUrl, setImageUrl] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    // Drawing State
    const [isDrawing, setIsDrawing] = useState(false);
    const [startPos, setStartPos] = useState<{ x: number, y: number } | null>(null);
    const [currentDrawRect, setCurrentDrawRect] = useState<{ x: number, y: number, w: number, h: number } | null>(null);
    const imageRef = useRef<HTMLImageElement>(null);

    // Data Load
    useEffect(() => {
        const fetchData = async () => {
            try {
                // 1. Fetch Dicts
                const [resTypes, resAttrs] = await Promise.all([
                    fetch('/api/api-dms.php?action=doc_types').then(r => r.json()),
                    fetch('/api/api-dms.php?action=attributes').then(r => r.json())
                ]);

                if (resTypes.success) setDocTypes(resTypes.data);
                if (resAttrs.success) setAvailableAttributes(resAttrs.data);

                // 2. Load Template if editing
                if (paramId && paramId !== 'new') {
                    const resTpl = await fetch(`/api/api-ocr-templates.php?action=get&id=${paramId}`).then(r => r.json());
                    if (resTpl.success) {
                        const t = resTpl.data.template;
                        setTemplate({
                            rec_id: t.rec_id,
                            name: t.name,
                            doc_type_id: t.doc_type_id,
                            anchor_text: t.anchor_text || '',
                            sample_doc_id: t.sample_doc_id
                        });
                        setZones(resTpl.data.zones || []);

                        // If we have a sample doc, load it
                        if (t.sample_doc_id) {
                            loadDocumentImage(t.sample_doc_id);
                        }
                    }
                }
                // 3. Or New with Source Doc
                else if (sourceDocId) {
                    loadDocumentImage(parseInt(sourceDocId));
                }

            } catch (e) {
                console.error(e);
            }
        };

        fetchData();
    }, [paramId, sourceDocId]);

    const loadDocumentImage = async (docId: number) => {
        try {
            setLoading(true);
            const res = await fetch(`/api/api-dms.php?action=view&id=${docId}`);
            if (res.ok) {
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                setImageUrl(url);
            } else {
                console.error("Failed to load document image");
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    // DRAWING LOGIC
    const handleMouseDown = (e: React.MouseEvent) => {
        if (!imageRef.current) return;

        const rect = imageRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        setIsDrawing(true);
        setStartPos({ x, y });
        setSelectedZoneId(null); // Deselect on draw start
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!isDrawing || !startPos || !imageRef.current) return;

        const rect = imageRef.current.getBoundingClientRect();
        const curX = e.clientX - rect.left;
        const curY = e.clientY - rect.top;

        const w = Math.abs(curX - startPos.x);
        const h = Math.abs(curY - startPos.y);
        const x = Math.min(curX, startPos.x);
        const y = Math.min(curY, startPos.y);

        setCurrentDrawRect({ x, y, w, h });
    };

    const handleMouseUp = () => {
        if (!isDrawing || !currentDrawRect || !imageRef.current) {
            setIsDrawing(false);
            setStartPos(null);
            setCurrentDrawRect(null);
            return;
        }

        // Commit new zone
        const imgW = imageRef.current.width;
        const imgH = imageRef.current.height;

        // Convert to percentage
        const newZone: OCRZone = {
            id: crypto.randomUUID(),
            attribute_code: '', // User must select
            x: currentDrawRect.x / imgW,
            y: currentDrawRect.y / imgH,
            width: currentDrawRect.w / imgW,
            height: currentDrawRect.h / imgH,
            data_type: 'text',
            regex_pattern: ''
        };

        setZones(prev => [...prev, newZone]);
        setSelectedZoneId(newZone.id);

        // Reset
        setIsDrawing(false);
        setStartPos(null);
        setCurrentDrawRect(null);
    };

    const handleSave = async () => {
        // Validation
        if (!template.name) return alert('Název je povinný');

        setLoading(true);
        try {
            const payload = {
                ...template,
                zones: zones
            };

            const res = await fetch('/api/api-ocr-templates.php?action=save', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (data.success) {
                alert('Uloženo!');
                // navigate back or update ID
            } else {
                alert('Chyba: ' + data.error);
            }
        } catch (e) {
            console.error(e);
            alert('Chyba spojení');
        } finally {
            setLoading(false);
        }
    };

    // MOCK IMAGE LOADER (For demo)
    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const url = URL.createObjectURL(e.target.files[0]);
            setImageUrl(url);
        }
    };

    return (
        <PageLayout>
            <PageHeader>
                <Breadcrumb>
                    <BreadcrumbItem onClick={() => navigate('/dms/settings')}>Nastavení DMS</BreadcrumbItem>
                    <BreadcrumbDivider />
                    <BreadcrumbItem>OCR Designer</BreadcrumbItem>
                </Breadcrumb>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginTop: '8px' }}>
                    <Title2>{template.name || 'Nova šablona'}</Title2>
                    <div style={{ flex: 1 }} />
                    <Button icon={<Save24Regular />} appearance="primary" onClick={handleSave} disabled={loading}>
                        Uložit šablonu
                    </Button>
                </div>
            </PageHeader>

            <PageContent>
                <div className={styles.designerContainer}>
                    {/* LEFT: CANVAS / PREVIEW */}
                    <div className={styles.canvasArea}>
                        {imageUrl ? (
                            <div
                                className={styles.imageOverlay}
                                onMouseDown={handleMouseDown}
                                onMouseMove={handleMouseMove}
                                onMouseUp={handleMouseUp}
                                style={{
                                    cursor: isDrawing ? 'crosshair' : 'default'
                                }}
                            >
                                <img
                                    ref={imageRef}
                                    src={imageUrl}
                                    alt="Document"
                                    style={{ display: 'block', maxWidth: '100%', maxHeight: '600px', pointerEvents: 'none' }} // Ensure img doesn't capture mouse events
                                />

                                {/* Render Existing Zones */}
                                {zones.map(zone => (
                                    <div
                                        key={zone.id}
                                        className={`${styles.zoneBox} ${selectedZoneId === zone.id ? styles.zoneBoxSelected : ''}`}
                                        style={{
                                            left: (zone.x * 100) + '%',
                                            top: (zone.y * 100) + '%',
                                            width: (zone.width * 100) + '%',
                                            height: (zone.height * 100) + '%'
                                        }}
                                        onClick={(e) => { e.stopPropagation(); setSelectedZoneId(zone.id); }}
                                    >
                                        <div className={styles.zoneLabel}>
                                            {availableAttributes.find(a => a.code === zone.attribute_code)?.name || 'Neznámé pole'}
                                        </div>
                                    </div>
                                ))}

                                {/* Render Active Draw Rect */}
                                {currentDrawRect && (
                                    <div
                                        className={styles.zoneBox}
                                        style={{
                                            left: currentDrawRect.x,
                                            top: currentDrawRect.y,
                                            width: currentDrawRect.w,
                                            height: currentDrawRect.h,
                                            border: '1px dashed red',
                                            backgroundColor: 'rgba(255,0,0,0.1)'
                                        }}
                                    />
                                )}
                            </div>
                        ) : (
                            <div style={{ textAlign: 'center' }}>
                                <Text>Nejprve vyberte vzorový dokument</Text>
                                <br /><br />
                                <input type="file" accept="image/*" onChange={handleFileSelect} />
                                {/* TODO: Replace with DMS Document Picker */}
                            </div>
                        )}
                    </div>

                    {/* RIGHT: SETTINGS */}
                    <Card className={styles.sidebar}>
                        <CardHeader header={<Text weight="semibold">Vlastnosti šablony</Text>} />

                        <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <div>
                                <Label>Název šablony</Label>
                                <Input value={template.name} onChange={(_e, d) => setTemplate(p => ({ ...p, name: d.value }))} />
                            </div>

                            <div>
                                <Label>Typ dokladu</Label>
                                <Dropdown
                                    placeholder="Vyberte typ"
                                    value={docTypes.find(t => t.rec_id === template.doc_type_id)?.name || ''}
                                    onOptionSelect={(_e, d) => {
                                        // find ID
                                        const sel = docTypes.find(t => t.name === d.optionText);
                                        if (sel) setTemplate(p => ({ ...p, doc_type_id: sel.rec_id }));
                                    }}
                                >
                                    {docTypes.map(t => (
                                        <Option key={t.rec_id} text={t.name}>{t.name}</Option>
                                    ))}
                                </Dropdown>
                            </div>

                            <div>
                                <Label>Kotva (Textový identifikátor)</Label>
                                <Input
                                    value={template.anchor_text}
                                    onChange={(_e, d) => setTemplate(p => ({ ...p, anchor_text: d.value }))}
                                    placeholder="např. 'Alza.cz'"
                                />
                                <Text size={100} style={{ color: tokens.colorNeutralForeground4 }}>
                                    Text, podle kterého systém pozná tento typ dokumentu.
                                </Text>
                            </div>

                            <div style={{ borderTop: `1px solid ${tokens.colorNeutralStroke2}`, margin: '8px 0' }} />
                        </div>

                        <CardHeader header={<Text weight="semibold">Zóny ({zones.length})</Text>} />

                        {selectedZoneId ? (
                            <div className={styles.zoneItem} style={{ borderLeftColor: tokens.colorPaletteGreenBorderActive }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <Text weight="semibold">Upravit zónu</Text>
                                    <Button
                                        icon={<Delete24Regular />}
                                        size="small"
                                        appearance="subtle"
                                        onClick={() => {
                                            setZones(prev => prev.filter(z => z.id !== selectedZoneId));
                                            setSelectedZoneId(null);
                                        }}
                                    />
                                </div>

                                <Label>Atribut (Pole)</Label>
                                <Dropdown
                                    placeholder="Vyberte pole"
                                    value={availableAttributes.find(a => a.code === zones.find(z => z.id === selectedZoneId)?.attribute_code)?.name || ''}
                                    onOptionSelect={(_e, d) => {
                                        setZones(prev => prev.map(z => z.id === selectedZoneId ? { ...z, attribute_code: d.optionValue as string } : z));
                                    }}
                                >
                                    {availableAttributes.map(attr => (
                                        <Option key={attr.code} value={attr.code}>{attr.name}</Option>
                                    ))}
                                </Dropdown>

                                <Label>Datový typ</Label>
                                <Dropdown
                                    value={zones.find(z => z.id === selectedZoneId)?.data_type || 'text'}
                                    onOptionSelect={(_e, d) => {
                                        setZones(prev => prev.map(z => z.id === selectedZoneId ? { ...z, data_type: d.optionValue as any } : z));
                                    }}
                                >
                                    <Option value="text">Text</Option>
                                    <Option value="number">Číslo</Option>
                                    <Option value="date">Datum</Option>
                                    <Option value="currency">Měna</Option>
                                </Dropdown>

                                <Label>Regex (Volitelné)</Label>
                                <Input
                                    value={zones.find(z => z.id === selectedZoneId)?.regex_pattern || ''}
                                    onChange={(_e, d) => {
                                        setZones(prev => prev.map(z => z.id === selectedZoneId ? { ...z, regex_pattern: d.value } : z));
                                    }}
                                    placeholder="např. \d{2}\.\d{2}\.\d{4}"
                                />
                            </div>
                        ) : (
                            <div style={{ padding: '16px', textAlign: 'center', color: tokens.colorNeutralForeground3 }}>
                                Klikněte na zónu v náhledu pro úpravu, nebo nakreslete novou.
                            </div>
                        )}

                        {zones.map(zone => (
                            zone.id !== selectedZoneId && (
                                <div
                                    key={zone.id}
                                    className={styles.zoneItem}
                                    style={{ cursor: 'pointer', opacity: 0.8 }}
                                    onClick={() => setSelectedZoneId(zone.id)}
                                >
                                    <Text>{availableAttributes.find(a => a.code === zone.attribute_code)?.name || 'Neznámé pole'}</Text>
                                    <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                                        {Math.round(zone.width * 100)}% x {Math.round(zone.height * 100)}%
                                    </Text>
                                </div>
                            )
                        ))}
                    </Card>
                </div>
            </PageContent>
        </PageLayout>
    );
};
