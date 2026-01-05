
import React, { useState, useEffect } from "react";
import {
    Button,
    Card,
    CardHeader,
    CardPreview,
    Text,
    Spinner,
    Input,
    Label,
    mergeClasses,
    makeStyles,
    tokens,
    Divider,
} from "@fluentui/react-components";
import {
    Save24Regular,
    Checkmark24Regular,
    ArrowRight24Regular,
    ArrowLeft24Regular
} from "@fluentui/react-icons";
import axios from "axios";
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
        width: "400px",
        minWidth: "400px",
        display: "flex",
        flexDirection: "column",
        gap: "1rem",
        overflowY: "auto",
        paddingRight: "0.5rem",
        backgroundColor: tokens.colorNeutralBackground1,
        borderRadius: tokens.borderRadiusMedium,
        boxShadow: tokens.shadow4,
        padding: "1rem",
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
        marginBottom: "1rem",
    },
    actions: {
        display: "flex",
        justifyContent: "space-between",
        marginTop: "auto",
        paddingTop: "1rem",
        borderTop: `1px solid ${tokens.colorNeutralStroke1}`,
    },
    titleBar: {
        marginBottom: "1rem",
    }
});

interface DmsDocument {
    rec_id: number;
    display_name: string;
    ocr_status: string;
    storage_path: string;
    mime_type: string;
    metadata: {
        attributes?: Record<string, string>;
    };
}

interface Attribute {
    rec_id: number;
    code: string;
    name: string;
    data_type: string;
}

export const DmsReview: React.FC = () => {
    const styles = useStyles();
    const [docs, setDocs] = useState<DmsDocument[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [attributes, setAttributes] = useState<Attribute[]>([]);
    const [formData, setFormData] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    // Initial Fetch
    useEffect(() => {
        const load = async () => {
            try {
                // 1. Get Attributes Defs
                const attrRes = await axios.get('/api/api-dms.php?action=attributes');
                setAttributes(attrRes.data.data);

                // 2. Get Docs (TODO: Filter for 'pending review' etc. For now get all)
                const docRes = await axios.get('/api/api-dms.php?action=list');
                const allDocs = docRes.data.data;
                // Filter docs that have OCR done or are verified? 
                // Maybe checking specifically 'completed' or 'pending'.
                // Let's filter by ocr_status != 'verified' but has file
                const toReview = allDocs.filter((d: DmsDocument) => d.ocr_status === 'completed');

                setDocs(toReview);
                if (toReview.length > 0) {
                    loadDocData(toReview[0]);
                }
            } catch (err) {
                console.error(err);
            } finally {
                setLoading(false);
            }
        };
        load();
    }, []);

    const loadDocData = (doc: DmsDocument) => {
        // Hydrate form with extracted values
        const extracted = doc.metadata?.attributes || {};

        // Find extracted values by Code or Name
        const initData: Record<string, string> = {};

        attributes.forEach(attr => {
            // Priority 1: Key matches CODE
            if (attr.code && extracted[attr.code]) {
                initData[attr.code] = extracted[attr.code];
            }
            // Priority 2: Key matches NAME
            else if (extracted[attr.name]) {
                initData[attr.code] = extracted[attr.name];
            }
        });

        setFormData(initData);
    };

    const handleNext = () => {
        if (currentIndex < docs.length - 1) {
            const nextIdx = currentIndex + 1;
            setCurrentIndex(nextIdx);
            loadDocData(docs[nextIdx]);
        }
    };

    const handlePrev = () => {
        if (currentIndex > 0) {
            const prevIdx = currentIndex - 1;
            setCurrentIndex(prevIdx);
            loadDocData(docs[prevIdx]);
        }
    };

    const handleSave = async (verify: boolean = false) => {
        if (!currentDoc) return;
        setSaving(true);
        try {
            await axios.post('/api/api-dms.php?action=update_metadata', {
                id: currentDoc.rec_id,
                attributes: formData
            });

            if (verify) {
                // Remove from local list or mark verified
                // Move to next
                const newDocs = [...docs];
                newDocs.splice(currentIndex, 1);
                setDocs(newDocs);
                if (newDocs.length > 0) {
                    const nextIdx = currentIndex >= newDocs.length ? 0 : currentIndex;
                    setCurrentIndex(nextIdx);
                    loadDocData(newDocs[nextIdx]);
                } else {
                    setFormData({});
                }
            }
        } catch (err) {
            console.error(err);
            alert('Chyba při ukládání');
        } finally {
            setSaving(false);
        }
    };

    const currentDoc = docs[currentIndex];

    if (loading) return <Spinner />;

    if (!currentDoc) {
        return (
            <PageLayout>
                <PageHeader title="Kontrola vytěžení" />
                <PageContent>
                    <div style={{ textAlign: 'center', marginTop: '3rem' }}>
                        <Text size={600} weight="semibold">Vše hotovo!</Text>
                        <br />
                        <Text>Žádné další dokumenty ke kontrole.</Text>
                    </div>
                </PageContent>
            </PageLayout>
        );
    }

    const docUrl = `/api/api-dms.php?action=view&id=${currentDoc.rec_id}`;

    return (
        <PageLayout>
            <PageHeader title="Kontrola vytěžení">
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    <Text>Dokument {currentIndex + 1} z {docs.length}</Text>
                </div>
            </PageHeader>
            <PageContent>
                <div className={styles.container}>
                    {/* LEFT PANEL: FORM */}
                    <div className={styles.sidebar}>
                        <div className={styles.titleBar}>
                            <Text weight="semibold" size={400}>{currentDoc.display_name}</Text>
                        </div>

                        {attributes.map(attr => (
                            <div key={attr.rec_id} className={styles.fieldGroup}>
                                <Label htmlFor={`field-${attr.code}`}>
                                    {attr.name} <span style={{ fontSize: '0.8em', color: tokens.colorNeutralForeground3 }}>({attr.code})</span>
                                </Label>
                                <Input
                                    id={`field-${attr.code}`}
                                    value={formData[attr.code] || ''}
                                    onChange={(e, d) => setFormData({ ...formData, [attr.code]: d.value })}
                                />
                            </div>
                        ))}

                        <div className={styles.actions}>
                            <Button
                                appearance="secondary"
                                icon={<ArrowLeft24Regular />}
                                onClick={handlePrev}
                                disabled={currentIndex === 0}
                            >
                                Zpět
                            </Button>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <Button
                                    appearance="secondary"
                                    icon={<Save24Regular />}
                                    onClick={() => handleSave(false)}
                                    disabled={saving}
                                >
                                    Uložit
                                </Button>
                                <Button
                                    appearance="primary"
                                    icon={<Checkmark24Regular />}
                                    onClick={() => handleSave(true)}
                                    disabled={saving}
                                >
                                    Potvrdit
                                </Button>
                            </div>
                            <Button
                                appearance="secondary"
                                icon={<ArrowRight24Regular />}
                                onClick={handleNext}
                                disabled={currentIndex === docs.length - 1}
                            >
                                Další
                            </Button>
                        </div>
                    </div>

                    {/* RIGHT PANEL: PREVIEW */}
                    <div className={styles.viewer}>
                        {/* Using simple iframe for correct viewer behavior based on browser capabilities */}
                        <iframe
                            src={docUrl}
                            className={styles.iframe}
                            title="Document Preview"
                        />
                    </div>
                </div>
            </PageContent>
        </PageLayout>
    );
};
