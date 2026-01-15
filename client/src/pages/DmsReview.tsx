
import React, { useState, useEffect, useRef } from "react";
import {
    Button,
    Text,
    Spinner,
    Input,
    Label,
    makeStyles,
    tokens,
    ProgressBar,
    Badge
} from "@fluentui/react-components";
import {
    Save24Regular,
    Checkmark24Regular,
    ArrowRight24Regular,
    ArrowLeft24Regular,
    Dismiss24Regular
} from "@fluentui/react-icons";
import axios from "axios";
import { useTranslation } from "react-i18next";
import { PageLayout, PageHeader, PageContent } from "../components/PageLayout";

const useStyles = makeStyles({
    container: {
        display: "flex",
        flexDirection: "row",
        gap: "1rem",
        height: "calc(100vh - 150px)",
        maxWidth: "100%",
    },
    sidebar: {
        width: "350px",
        minWidth: "350px",
        display: "flex",
        flexDirection: "column",
        gap: "1rem",
        overflowY: "auto",
        paddingRight: "0.5rem",
        backgroundColor: tokens.colorNeutralBackground1,
        borderRadius: tokens.borderRadiusMedium,
        boxShadow: tokens.shadow4,
        padding: "1rem",
        borderRight: `1px solid ${tokens.colorNeutralStroke1}`
    },
    viewer: {
        flexGrow: 1,
        display: "flex",
        flexDirection: "column",
        backgroundColor: tokens.colorNeutralBackground2,
        borderRadius: tokens.borderRadiusMedium,
        overflow: "hidden",
        position: "relative",
    },
    iframe: {
        width: "100%",
        height: "100%",
        border: "none",
    },
    fieldGroup: {
        display: "flex",
        flexDirection: "column",
        marginBottom: "12px",
    },
    actions: {
        display: "flex",
        justifyContent: "space-between",
        marginTop: "auto",
        paddingTop: "1rem",
        borderTop: `1px solid ${tokens.colorNeutralStroke1}`,
    },
    docHeader: {
        marginBottom: "1rem",
        paddingBottom: "1rem",
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    }
});

interface DmsDocument {
    rec_id: number;
    doc_type_id: number;
    doc_type_name?: string;
    display_name: string;
    ocr_status: string; // 'pending', 'processing', 'completed', 'verified', 'mapping'
    status?: string;
    storage_path: string;
    mime_type: string;
    metadata: {
        attributes?: Record<string, string>;
    };
}

interface LinkedAttribute {
    rec_id: number; // attribute id
    code: string;
    name: string;
    data_type: string;
    is_linked_required: boolean;
    display_order: number;
}

export const DmsReview: React.FC = () => {
    const { t } = useTranslation();
    const styles = useStyles();
    const [docs, setDocs] = useState<DmsDocument[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);

    // Attributes specific to the current document's type
    const [currentAttributes, setCurrentAttributes] = useState<LinkedAttribute[]>([]);

    // Interactive Zoning State
    const [imageUrl, setImageUrl] = useState<string | null>(null);
    const [activeField, setActiveField] = useState<string | null>(null);
    const [isDrawing, setIsDrawing] = useState(false);

    // Drawing refs
    const imageRef = useRef<HTMLImageElement>(null);
    const [startPos, setStartPos] = useState<{ x: number, y: number } | null>(null);
    const [currentDrawRect, setCurrentDrawRect] = useState<{ x: number, y: number, w: number, h: number } | null>(null);

    const [formData, setFormData] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(true);
    const [loadingAttrs, setLoadingAttrs] = useState(false);
    const [saving, setSaving] = useState(false);

    // DRAWING HANDLERS
    const handleMouseDown = (e: React.MouseEvent) => {
        if (!imageRef.current || !activeField) return;
        const rect = imageRef.current.getBoundingClientRect();
        setIsDrawing(true);
        setStartPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
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

    // Helper to find next field
    const getNextField = (currentCode: string) => {
        const idx = currentAttributes.findIndex(a => a.code === currentCode);
        if (idx >= 0 && idx < currentAttributes.length - 1) {
            return currentAttributes[idx + 1].code;
        }
        return null; // or loop back? usually stop.
    };

    const handleSkip = (currentCode: string) => {
        const next = getNextField(currentCode);
        if (next) setActiveField(next);
        else setActiveField(null); // finish
    };

    const handleMouseUp = async () => {
        if (!isDrawing || !currentDrawRect || !imageRef.current || !activeField) {
            setIsDrawing(false); setStartPos(null); setCurrentDrawRect(null); return;
        }

        const imgW = imageRef.current.width;
        const imgH = imageRef.current.height;

        const rectPct = {
            x: currentDrawRect.x / imgW,
            y: currentDrawRect.y / imgH,
            w: currentDrawRect.w / imgW,
            h: currentDrawRect.h / imgH
        };

        const fieldCode = activeField;
        const currentCode = fieldCode; // capture for closure

        setFormData(prev => ({ ...prev, [fieldCode]: t('common.loading') }));

        try {
            const res = await axios.post('/api/api-dms.php?action=ocr_region', {
                doc_id: currentDoc?.rec_id,
                rect: rectPct
            });
            if (res.data.success) {
                setFormData(prev => ({ ...prev, [fieldCode]: res.data.text }));
                // AUTO ADVANCE
                handleSkip(currentCode);
            } else {
                alert(t('common.error') + ': ' + res.data.error);
                setFormData(prev => ({ ...prev, [fieldCode]: '' }));
            }
        } catch (e) {
            console.error(e);
            alert(t('common.error'));
        } finally {
            setIsDrawing(false); setStartPos(null); setCurrentDrawRect(null);
        }
    };


    // 1. Fetch Documents to Review
    useEffect(() => {
        const loadDocs = async () => {
            try {
                const res = await axios.get('/api/api-dms.php?action=list');
                const all = res.data.data;
                // Filter documents needing review or mapping
                // status 'mapping' means no template matched / needs manual extraction
                // status 'done'/'completed' means OCR finished but needs verification
                const toReview = all.filter((d: DmsDocument) =>
                    d.ocr_status === 'done' ||
                    d.ocr_status === 'completed' ||
                    d.ocr_status === 'mapping' ||
                    (d.status !== 'verified' && d.ocr_status !== 'pending' && d.ocr_status !== 'processing')
                );

                setDocs(toReview);
            } catch (err) {
                console.error("Error loading docs", err);
            } finally {
                setLoading(false);
            }
        };
        loadDocs();
    }, []);

    const currentDoc = docs[currentIndex];

    // 2. Fetch Attributes when Current Doc changes
    useEffect(() => {
        if (!currentDoc) return;

        // Interactive Zoom Setup
        setImageUrl(null);
        setActiveField(null);
        if (currentDoc.mime_type.startsWith('image/')) {
            setImageUrl(`/api/api-dms.php?action=view&id=${currentDoc.rec_id}`);
        }

        const loadAttrs = async () => {
            setLoadingAttrs(true);
            try {
                if (currentDoc.doc_type_id) {
                    try {
                        const res = await axios.get(`/api/api-dms.php?action=doc_type_attributes&id=${currentDoc.doc_type_id}`);
                        const attrs = res.data.data;
                        if (attrs && attrs.length > 0) {
                            setCurrentAttributes(attrs);
                        } else {
                            throw new Error('No linked attributes');
                        }
                    } catch (e) {
                        const allRes = await axios.get('/api/api-dms.php?action=attributes');
                        setCurrentAttributes(allRes.data.data.map((a: any) => ({ ...a, is_linked_required: false, display_order: 0 })));
                    }
                } else {
                    const allRes = await axios.get('/api/api-dms.php?action=attributes');
                    setCurrentAttributes(allRes.data.data.map((a: any) => ({ ...a, is_linked_required: false, display_order: 0 })));
                }
                const existing = currentDoc.metadata?.attributes || {};
                setFormData(existing);
            } catch (e) {
                console.error(e);
            } finally {
                setLoadingAttrs(false);
            }
        };
        loadAttrs();
    }, [currentDoc]);


    const handleNext = () => {
        if (currentIndex < docs.length - 1) setCurrentIndex(p => p + 1);
    };

    const handlePrev = () => {
        if (currentIndex > 0) setCurrentIndex(p => p - 1);
    };

    const handleSave = async (markVerified: boolean = false) => {
        if (!currentDoc) return;
        setSaving(true);
        try {
            await axios.post('/api/api-dms.php?action=update_metadata', {
                id: currentDoc.rec_id,
                attributes: formData,
                status: markVerified ? 'verified' : undefined
            });

            if (markVerified) {
                const newDocs = docs.filter(d => d.rec_id !== currentDoc.rec_id);
                setDocs(newDocs);
                if (newDocs.length > 0) {
                    if (currentIndex >= newDocs.length) setCurrentIndex(newDocs.length - 1);
                }
            } else {
                // Just save draft
                alert(t('common.success'));
            }
        } catch (e) {
            console.error(e);
            alert(t('common.error'));
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <PageLayout><PageContent><Spinner label={t('dms.loading_queue')} /></PageContent></PageLayout>;

    if (!currentDoc) {
        return (
            <PageLayout>
                <PageHeader>
                    <Text size={500} weight="semibold">{t('dms.review.title')}</Text>
                </PageHeader>
                <PageContent>
                    <div style={{ textAlign: 'center', marginTop: '100px', opacity: 0.6 }}>
                        <Checkmark24Regular style={{ fontSize: '48px', color: 'green' }} />
                        <Text size={500} block>{t('dms.review.all_done')}</Text>
                        <Text>{t('dms.review.no_docs')}</Text>
                    </div>
                </PageContent>
            </PageLayout>
        );
    }

    const docUrl = `/api/api-dms.php?action=view&id=${currentDoc.rec_id}`;

    return (
        <PageLayout>
            <PageHeader>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <Text weight="semibold">{t('dms.review.title')}</Text>
                        <Badge appearance="tint">{currentIndex + 1} / {docs.length}</Badge>
                    </div>
                    <div>
                        <Button
                            appearance="subtle"
                            disabled={currentIndex === 0}
                            onClick={handlePrev}
                            icon={<ArrowLeft24Regular />}
                        >
                            {t('dms.review.prev')}
                        </Button>
                        <Button
                            appearance="subtle"
                            disabled={currentIndex === docs.length - 1}
                            onClick={handleNext}
                            icon={<ArrowRight24Regular />}
                            iconPosition="after"
                        >
                            {t('dms.review.next')}
                        </Button>
                    </div>
                </div>
            </PageHeader>
            <PageContent>
                <div className={styles.container}>
                    {/* LEFT SIDEBAR: ATTRIBUTES */}
                    <div className={styles.sidebar}>
                        <div className={styles.docHeader}>
                            <Text weight="bold" size={400} block>{currentDoc.display_name}</Text>
                            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                                {currentDoc.doc_type_name || 'Neurčený typ'}
                            </Text>
                        </div>

                        {loadingAttrs ? (
                            <ProgressBar />
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {currentAttributes.map(attr => (
                                    <div key={attr.rec_id} className={styles.fieldGroup}>
                                        <Label
                                            htmlFor={`field-${attr.code}`}
                                            required={attr.is_linked_required}
                                            style={{ color: activeField === attr.code ? tokens.colorBrandForeground1 : 'inherit', fontWeight: activeField === attr.code ? 'bold' : 'normal' }}
                                        >
                                            {attr.name} {activeField === attr.code && `(${t('common.edit')})`}
                                        </Label>
                                        <div style={{ display: 'flex', gap: '4px' }}>
                                            <Input
                                                id={`field-${attr.code}`}
                                                value={formData[attr.code] || ''}
                                                onChange={(_e, d) => setFormData({ ...formData, [attr.code]: d.value })}
                                                style={{ flexGrow: 1, borderColor: activeField === attr.code ? tokens.colorBrandStroke1 : undefined }}
                                                placeholder={attr.data_type === 'date' ? 'DD.MM.RRRR' : ''}
                                                onFocus={() => { if (imageUrl) setActiveField(attr.code); }}
                                                contentAfter={
                                                    activeField === attr.code ?
                                                        <Dismiss24Regular
                                                            style={{ cursor: 'pointer' }}
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleSkip(attr.code);
                                                            }}
                                                            title={t('dms.review.skip_tooltip')}
                                                        />
                                                        : null
                                                }
                                            />
                                        </div>
                                    </div>
                                ))}
                                {currentAttributes.length === 0 && (
                                    <div style={{ marginTop: '16px', padding: '12px', backgroundColor: '#fff4f4', border: '1px solid #fed9cc', borderRadius: '4px' }}>
                                        <Text style={{ color: tokens.colorPaletteRedForeground1 }} block>
                                            {t('dms.review.no_layout')}
                                        </Text>
                                        <Button
                                            appearance="transparent"
                                            size="small"
                                            style={{ paddingLeft: 0, color: tokens.colorBrandForegroundLink }}
                                            onClick={() => window.open('/dms/settings', '_blank')}
                                        >
                                            {t('dms.review.manage_attributes')}
                                        </Button>
                                    </div>
                                )}
                            </div>
                        )}

                        <div className={styles.actions}>
                            <Button
                                appearance="secondary"
                                icon={<Save24Regular />}
                                onClick={() => handleSave(false)}
                                disabled={saving}
                            >
                                {t('dms.review.save')}
                            </Button>
                            <Button
                                appearance="primary"
                                icon={<Checkmark24Regular />}
                                onClick={() => handleSave(true)}
                                disabled={saving}
                            >
                                {t('dms.review.approve')}
                            </Button>
                        </div>
                    </div>

                    {/* RIGHT SIDE: PREVIEW */}
                    <div className={styles.viewer}>
                        {imageUrl ? (
                            <div
                                style={{ position: 'relative', overflow: 'auto', maxHeight: '100%', display: 'flex', justifyContent: 'center', backgroundColor: '#333', height: '100%' }}
                                onMouseDown={handleMouseDown}
                                onMouseMove={handleMouseMove}
                                onMouseUp={handleMouseUp}
                            >
                                <img
                                    ref={imageRef}
                                    src={imageUrl}
                                    alt="Review"
                                    style={{ maxWidth: '100%', display: 'block', cursor: activeField ? 'crosshair' : 'default', alignSelf: 'start' }}
                                    draggable={false}
                                />
                                {currentDrawRect && (
                                    <div
                                        style={{
                                            position: 'absolute',
                                            left: currentDrawRect.x,
                                            top: currentDrawRect.y,
                                            width: currentDrawRect.w,
                                            height: currentDrawRect.h,
                                            border: '2px solid red',
                                            backgroundColor: 'rgba(255, 0, 0, 0.2)',
                                            pointerEvents: 'none'
                                        }}
                                    />
                                )}
                                {activeField && !isDrawing && (
                                    <div style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', backgroundColor: 'rgba(0,0,0,0.7)', color: 'white', padding: '4px 8px', borderRadius: '4px', pointerEvents: 'none' }}>
                                        {t('dms.review.select_region')} {currentAttributes.find(a => a.code === activeField)?.name}
                                    </div>
                                )}
                            </div>
                        ) : (
                            <iframe
                                src={docUrl}
                                className={styles.iframe}
                                title="Document Preview"
                            />
                        )}
                    </div>
                </div>
            </PageContent>
        </PageLayout>
    );
};
