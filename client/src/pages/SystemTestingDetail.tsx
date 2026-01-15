
import React, { useState, useEffect } from "react";
import {
    makeStyles,
    tokens,
    Button,
    Card,
    CardHeader,
    Text,
    Badge,
    Spinner,
    Input,
    Textarea,
    type TextareaOnChangeData,
    type InputOnChangeData
} from "@fluentui/react-components";
import {
    Add24Regular,
    Play24Regular,
    CheckmarkCircle24Regular,
    DismissCircle24Regular,
    Edit24Regular,
    Delete24Regular,
    Save24Regular
} from "@fluentui/react-icons";
import axios from "axios";
import { PageLayout, PageHeader, PageContent } from "../components/PageLayout";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

const useStyles = makeStyles({
    container: {
        display: "flex",
        flexDirection: "column",
        gap: "1rem",
    },
    card: {
        marginBottom: "1rem",
    },
    stepRow: {
        display: "grid",
        gridTemplateColumns: "30px 1fr 1fr 40px",
        gap: "1rem",
        alignItems: "start",
        padding: "0.5rem 0",
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`
    },
    runRow: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0.5rem",
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`
    },
    statusOk: { color: "green" },
    statusNok: { color: "red" },
    statusNa: { color: "gray" },
    toolbar: {
        display: 'flex',
        gap: '8px',
        marginBottom: '16px'
    }
});

interface TestStep {
    rec_id?: number;
    step_order: number;
    instruction: string;
    expected_result: string;
}

interface TestRun {
    rec_id: number;
    run_date: string;
    run_by: string;
    overall_status: string;
    version_tag: string;
}

interface TestScenario {
    rec_id: number;
    title: string;
    description: string;
    category: string;
    last_status?: string;
}

export const SystemTestingDetail: React.FC = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const styles = useStyles();
    const { t } = useTranslation();

    // Scenario Data
    const [scenario, setScenario] = useState<TestScenario | null>(null);
    const [steps, setSteps] = useState<TestStep[]>([]);
    const [runs, setRuns] = useState<TestRun[]>([]);
    const [loading, setLoading] = useState(false);

    // Editor State
    const [isEditing, setIsEditing] = useState(false);
    const [editForm, setEditForm] = useState<Partial<TestScenario>>({});
    const [editSteps, setEditSteps] = useState<TestStep[]>([]);

    // Runner State
    const [activeRunId, setActiveRunId] = useState<number | null>(null);
    const [runResults, setRunResults] = useState<Record<number, string>>({}); // stepId -> status

    useEffect(() => {
        if (id && id !== 'new') {
            loadScenario(parseInt(id));
        } else if (id === 'new') {
            setIsEditing(true);
            setEditForm({ title: '', description: '', category: 'feature' });
            setEditSteps([{ step_order: 1, instruction: '', expected_result: '' }]);
        }
    }, [id]);

    const loadScenario = async (recId: number) => {
        setLoading(true);
        try {
            const res = await axios.get(`/api/api-system-testing.php?action=get_scenario&id=${recId}`);
            setScenario(res.data.data.scenario);
            setSteps(res.data.data.steps);
            setRuns(res.data.data.runs);

            // Sync edit state
            setEditForm(res.data.data.scenario);
            setEditSteps(res.data.data.steps);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        try {
            const payload = {
                rec_id: scenario?.rec_id, // 0 if new
                ...editForm,
                steps: editSteps
            };
            const res = await axios.post('/api/api-system-testing.php?action=save_scenario', payload);
            if (res.data.success) {
                setIsEditing(false);
                if (id === 'new') {
                    navigate(`/system/testing/${res.data.id}`);
                } else {
                    loadScenario(scenario!.rec_id);
                }
            }
        } catch (e) {
            alert("Error saving");
        }
    };

    const handleAddStep = () => {
        setEditSteps([...editSteps, { step_order: editSteps.length + 1, instruction: '', expected_result: '' }]);
    };

    const handleRemoveStep = (idx: number) => {
        const newSteps = [...editSteps];
        newSteps.splice(idx, 1);
        setEditSteps(newSteps);
    };

    const handleStepChange = (idx: number, field: keyof TestStep, val: string) => {
        const newSteps = [...editSteps];
        // @ts-ignore
        newSteps[idx][field] = val;
        setEditSteps(newSteps);
    };

    // RUNNER LOGIC
    const startRun = async () => {
        if (!scenario) return;
        const version = prompt("Version / Tag (e.g. v1.2):", "v1.0");
        if (!version) return;

        try {
            const res = await axios.post('/api/api-system-testing.php?action=start_run', {
                scenario_id: scenario.rec_id,
                version_tag: version
            });
            setActiveRunId(res.data.run_id);
            setRunResults({}); // Clear local results
        } catch (e) {
            alert("Error starting run");
        }
    };

    const markStep = async (stepId: number, status: 'ok' | 'nok' | 'na') => {
        if (!activeRunId) return;
        setRunResults(prev => ({ ...prev, [stepId]: status }));

        await axios.post('/api/api-system-testing.php?action=update_run_result', {
            run_id: activeRunId,
            step_id: stepId,
            status: status
        });
    };

    const finishRun = async () => {
        if (!activeRunId) return;
        // Simple logic: if any NOK -> Failed, else Passed
        const hasFail = Object.values(runResults).includes('nok');
        const status = hasFail ? 'failed' : 'passed';

        await axios.post('/api/api-system-testing.php?action=finish_run', {
            run_id: activeRunId,
            status: status
        });
        setActiveRunId(null);
        loadScenario(scenario!.rec_id); // Reload history
    };


    if (loading) return <Spinner />;

    return (
        <PageLayout>
            <PageHeader>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                    <Text size={500} weight="bold">
                        {isEditing ? 'Edit Scenario' : scenario?.title}
                    </Text>
                    <div>
                        {!isEditing && (
                            <>
                                <Button icon={<Play24Regular />} appearance="primary" onClick={startRun} disabled={activeRunId !== null}>
                                    Run Test
                                </Button>
                                <Button icon={<Edit24Regular />} onClick={() => setIsEditing(true)}>Edit</Button>
                            </>
                        )}
                        {isEditing && (
                            <Button icon={<Save24Regular />} appearance="primary" onClick={handleSave}>Save</Button>
                        )}
                    </div>
                </div>
            </PageHeader>
            <PageContent>
                {/* HEADER INFO */}
                <div className={styles.card} style={{ padding: '1rem', backgroundColor: 'white' }}>
                    {isEditing ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            <Input value={editForm.title} onChange={(e, d) => setEditForm({ ...editForm, title: d.value })} placeholder="Title" />
                            <Textarea value={editForm.description} onChange={(e, d) => setEditForm({ ...editForm, description: d.value })} placeholder="Description" />
                            <select
                                value={editForm.category}
                                onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                                style={{ padding: '8px' }}
                            >
                                <option value="process">Procesy (Process)</option>
                                <option value="feature">Programové úpravy (Feature)</option>
                                <option value="critical_path">Kritická cesta (Critical Path)</option>
                            </select>
                        </div>
                    ) : (
                        <div>
                            <Text block style={{ marginBottom: '8px' }}>{scenario?.description}</Text>
                            <Badge appearance="outline">{scenario?.category}</Badge>
                        </div>
                    )}
                </div>

                {/* ACTIVE RUNNER */}
                {activeRunId && (
                    <Card style={{ marginBottom: '2rem', border: '2px solid #0078d4' }}>
                        <CardHeader header={<Text weight="bold">▶ Running Test (ID: {activeRunId})</Text>} />
                        <div style={{ padding: '1rem' }}>
                            {steps.map(step => (
                                <div key={step.rec_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #eee' }}>
                                    <div style={{ flex: 1 }}>
                                        <Text weight="semibold" block>{step.instruction}</Text>
                                        <Text size={200} style={{ color: '#666' }}>{step.expected_result}</Text>
                                    </div>
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        <Button
                                            icon={<CheckmarkCircle24Regular />}
                                            appearance={runResults[step.rec_id!] === 'ok' ? 'primary' : 'subtle'}
                                            onClick={() => markStep(step.rec_id!, 'ok')}
                                        >OK</Button>
                                        <Button
                                            icon={<DismissCircle24Regular />}
                                            appearance={runResults[step.rec_id!] === 'nok' ? 'primary' : 'subtle'} // Primary red? Access style normally
                                            style={runResults[step.rec_id!] === 'nok' ? { backgroundColor: 'darkred', color: 'white' } : {}}
                                            onClick={() => markStep(step.rec_id!, 'nok')}
                                        >NOK</Button>
                                    </div>
                                </div>
                            ))}
                            <div style={{ marginTop: '1rem', textAlign: 'right' }}>
                                <Button appearance="primary" onClick={finishRun}>Finish Run</Button>
                            </div>
                        </div>
                    </Card>
                )}

                {/* STEPS LIST (READ ONLY OR EDIT) */}
                <Text size={400} weight="semibold" block style={{ marginBottom: '1rem' }}>Test Steps</Text>
                <div className={styles.card} style={{ backgroundColor: 'white', padding: '1rem' }}>
                    {isEditing ? (
                        <>
                            {editSteps.map((step, idx) => (
                                <div key={idx} className={styles.stepRow}>
                                    <Text>{idx + 1}.</Text>
                                    <Textarea rows={2} value={step.instruction} onChange={(e, d) => handleStepChange(idx, 'instruction', d.value)} placeholder="Instruction" />
                                    <Textarea rows={2} value={step.expected_result} onChange={(e, d) => handleStepChange(idx, 'expected_result', d.value)} placeholder="Expected Result" />
                                    <Button icon={<Delete24Regular />} onClick={() => handleRemoveStep(idx)} />
                                </div>
                            ))}
                            <Button icon={<Add24Regular />} onClick={handleAddStep} style={{ marginTop: '1rem' }}>Add Step</Button>
                        </>
                    ) : (
                        <div>
                            {steps.map((step, idx) => (
                                <div key={idx} className={styles.stepRow} style={{ gridTemplateColumns: "30px 1fr 1fr" }}>
                                    <Text>{idx + 1}.</Text>
                                    <Text>{step.instruction}</Text>
                                    <Text style={{ color: '#666' }}>{step.expected_result}</Text>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* RUN HISTORY */}
                {!isEditing && (
                    <>
                        <Text size={400} weight="semibold" block style={{ marginTop: '2rem', marginBottom: '1rem' }}>History</Text>
                        <div className={styles.card} style={{ backgroundColor: 'white' }}>
                            {runs.length === 0 && <div style={{ padding: '1rem' }}>No runs yet.</div>}
                            {runs.map(run => (
                                <div key={run.rec_id} className={styles.runRow}>
                                    <div>
                                        <Text weight="bold" style={{ marginRight: '10px' }}>{run.version_tag || 'No Ver'}</Text>
                                        <Text size={200}>{run.run_date}</Text>
                                    </div>
                                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                        <Text>{run.run_by}</Text>
                                        <Badge
                                            appearance={run.overall_status === 'passed' ? 'filled' : 'outline'}
                                            color={run.overall_status === 'passed' ? 'success' : run.overall_status === 'failed' ? 'danger' : 'brand'}
                                        >
                                            {run.overall_status}
                                        </Badge>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </>
                )}

            </PageContent>
        </PageLayout>
    );
};
