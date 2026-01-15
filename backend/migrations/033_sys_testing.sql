-- Migration: 033_sys_testing
-- Description: Creates tables for Test Management (Scenarios, Steps, Runs)

-- 1. Test Scenarios (Cases)
CREATE TABLE sys_test_scenarios (
    rec_id SERIAL PRIMARY KEY,
    tenant_id UUID NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(50) NOT NULL, -- 'process', 'feature', 'critical_path'
    priority VARCHAR(20) DEFAULT 'normal', -- 'low', 'normal', 'high', 'critical'
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(100),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Test Steps (Definition)
CREATE TABLE sys_test_steps (
    rec_id SERIAL PRIMARY KEY,
    scenario_id INTEGER REFERENCES sys_test_scenarios(rec_id) ON DELETE CASCADE,
    step_order INTEGER NOT NULL,
    instruction TEXT NOT NULL,
    expected_result TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Test Runs (Executions)
CREATE TABLE sys_test_runs (
    rec_id SERIAL PRIMARY KEY,
    scenario_id INTEGER REFERENCES sys_test_scenarios(rec_id) ON DELETE CASCADE,
    run_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    run_by VARCHAR(100),
    overall_status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'passed', 'failed', 'blocked'
    notes TEXT,
    version_tag VARCHAR(50) -- e.g. 'v1.0.5'
);

-- 4. Test Run Step Results
CREATE TABLE sys_test_run_results (
    rec_id SERIAL PRIMARY KEY,
    run_id INTEGER REFERENCES sys_test_runs(rec_id) ON DELETE CASCADE,
    step_id INTEGER REFERENCES sys_test_steps(rec_id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'none', -- 'ok', 'nok', 'na'
    comment TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_scenarios_category ON sys_test_scenarios(category);
CREATE INDEX idx_steps_scenario ON sys_test_steps(scenario_id);
CREATE INDEX idx_runs_scenario ON sys_test_runs(scenario_id);
CREATE INDEX idx_results_run ON sys_test_run_results(run_id);
