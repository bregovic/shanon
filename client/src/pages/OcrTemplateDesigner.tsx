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
import { useParams, useNavigate } from 'react-router-dom';
import { PageLayout, PageHeader, PageContent } from '../components/PageLayout';

const useStyles = makeStyles({
    designerContainer: {
        display: 'grid',
        gridTemplateColumns: '1fr 320px',
        height: 'calc(100vh - 180px)', // Adjust based on header/layout
        ...shorthands.gap('16px'),
    },
    canvasArea: {
        backgroundColor: tokens.colorNeutralBackground2,
        ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke1),
        ...shorthands.borderRadius('8px'),
        position: 'relative',
        overflow: 'hidden', // Scroll is handled inside if needed, or scale to fit
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        userSelect: 'none',
    },
    sidebar: {
        display: 'flex',
        flexDirection: 'column',
        ...shorthands.gap('12px'),
        overflowY: 'auto',
        ...shorthands.padding('4px'), // gutter
    },
    zoneItem: {
        ...shorthands.padding('8px'),
        ...shorthands.borderLeft('4px', 'solid', tokens.colorBrandBackground),
        display: 'flex',
        flexDirection: 'column',
        ...shorthands.gap('8px'),
        backgroundColor: tokens.colorNeutralBackground1,
    },
    imageOverlay: {
        position: 'relative',
        boxShadow: tokens.shadow16,
        cursor: 'crosshair',
    },
    zoneBox: {
        position: 'absolute',
        backgroundColor: 'rgba(0, 120, 212, 0.2)', // Fluent Brand Blue transparent
        border: `2px solid ${tokens.colorBrandStroke1}`,
        cursor: 'move',
        ':hover': {
            backgroundColor: 'rgba(0, 120, 212, 0.3)',
        }
    },
    zoneBoxSelected: {
        backgroundColor: 'rgba(0, 120, 212, 0.4)',
        border: `2px solid ${tokens.colorPaletteRedBorderActive}`,
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
    }
});

interface OCRZone {
    id: string; // temp id for UI
    attribute_code: string;
    x: number; // percentage 0-1
    y: number;
    width: number;
    height: number;
    data_type: 'text' | 'number' | 'date' | 'currency';
    regex_pattern: string;
}

interface OCRTemplate {
    rec_id?: number;
    name: string;
    doc_type_id: number | null;
    anchor_text: string;
    sample_doc_id: number | null;
}

export const OcrTemplateDesigner = () => {
    const styles = useStyles();
    const navigate = useNavigate();
    const { id: paramId } = useParams(); // if editing existing

    // State
    const [template, setTemplate] = useState<OCRTemplate>({ name: 'Nová šablona', doc_type_id: null, anchor_text: '', sample_doc_id: null });
    const [zones, setZones] = useState<OCRZone[]>([]);
    const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
    const [docTypes, setDocTypes] = useState<any[]>([]);
    const [availableAttributes, setAvailableAttributes] = useState<any[]>([]);

    // UI State
    const [imageUrl, setImageUrl] = useState<string | null>(null); // URL of the sample blob
    const [loading, setLoading] = useState(false);

    // Drawing State
    const [isDrawing, setIsDrawing] = useState(false);
    const [startPos, setStartPos] = useState<{ x: number, y: number } | null>(null);
    const [currentDrawRect, setCurrentDrawRect] = useState<{ x: number, y: number, w: number, h: number } | null>(null);
    const imageRef = useRef<HTMLImageElement>(null);

    // Mock Data Load (Replace with real API)
    useEffect(() => {
        // Fetch Dictionary Data
        const fetchDicts = async () => {
            // Mock Doc Types
            setDocTypes([
                { rec_id: 1, name: 'Faktura přijatá' },
                { rec_id: 2, name: 'Smlouva' },
                { rec_id: 3, name: 'Účtenka' }
            ]);

            // Mock Attributes (Sync with your dms_attributes table)
            setAvailableAttributes([
                { code: 'TOTAL_AMOUNT', name: 'Celková částka' },
                { code: 'ISSUE_DATE', name: 'Datum vystavení' },
                { code: 'DUE_DATE', name: 'Datum splatnosti' },
                { code: 'VS', name: 'Variabilní symbol' },
                { code: 'SUPPLIER_ICO', name: 'IČ Dodavatele' },
                { code: 'SUPPLIER_NAME', name: 'Název Dodavatele' }
            ]);
        };
        fetchDicts();

        // If ID provided, load template
        if (paramId && paramId !== 'new') {
            // fetchTemplate(paramId);
        }
    }, [paramId]);

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
