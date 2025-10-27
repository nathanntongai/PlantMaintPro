-- This function MUST be defined first.
CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create or Add to the status enum type
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'status_enum') THEN
        CREATE TYPE status_enum AS ENUM ('Pending Approval', 'Reported', 'Acknowledged', 'In Progress', 'Resolved', 'Closed');
    END IF;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create or Add to the job order status enum type
DO $$ BEGIN
    CREATE TYPE job_order_status_enum AS ENUM ('Requested', 'Approved', 'Rejected', 'Assigned', 'In Progress', 'Completed', 'Closed');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create a custom type for inspection status
DO $$ BEGIN
    CREATE TYPE inspection_status_enum AS ENUM ('Okay', 'Not Okay');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Table for Companies
CREATE TABLE IF NOT EXISTS companies (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Table for Users
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL,
    phone_number VARCHAR(50) UNIQUE,
    whatsapp_state VARCHAR(50) DEFAULT 'IDLE',
    whatsapp_context JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Table for Machines
CREATE TABLE IF NOT EXISTS machines (
    id SERIAL PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    name VARCHAR(100) NOT NULL,
    location VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Table for Machine Breakdowns (with all columns)
CREATE TABLE IF NOT EXISTS breakdowns (
    id SERIAL PRIMARY KEY,
    machine_id INTEGER NOT NULL REFERENCES machines(id),
    company_id INTEGER NOT NULL REFERENCES companies(id),
    reported_by_id INTEGER NOT NULL REFERENCES users(id),
    assigned_to_id INTEGER REFERENCES users(id),
    approved_by_id INTEGER REFERENCES users(id),
    description TEXT NOT NULL,
    status status_enum NOT NULL DEFAULT 'Pending Approval',
    reported_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    manager_acknowledged_at TIMESTAMP WITH TIME ZONE -- This is the missing column
);

-- Table for Utilities
CREATE TABLE IF NOT EXISTS utilities (
    id SERIAL PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    name VARCHAR(100) NOT NULL,
    unit VARCHAR(20) NOT NULL,
    keyword VARCHAR(50) UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Table for Utility Readings
CREATE TABLE IF NOT EXISTS utility_readings (
    id SERIAL PRIMARY KEY,
    utility_id INTEGER NOT NULL REFERENCES utilities(id),
    company_id INTEGER NOT NULL REFERENCES companies(id),
    recorded_by_id INTEGER NOT NULL REFERENCES users(id),
    reading_value NUMERIC(10, 2) NOT NULL,
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Table for Preventive Maintenance Tasks
CREATE TABLE IF NOT EXISTS preventive_maintenance_tasks (
    id SERIAL PRIMARY KEY,
    machine_id INTEGER NOT NULL REFERENCES machines(id),
    company_id INTEGER NOT NULL REFERENCES companies(id),
    task_description TEXT NOT NULL,
    frequency_days INTEGER NOT NULL,
    next_due_date DATE NOT NULL,
    last_performed_at TIMESTAMP WITH TIME ZONE
);

-- Table for Job Orders
CREATE TABLE IF NOT EXISTS job_orders (
    id SERIAL PRIMARY KEY,
    machine_id INTEGER NOT NULL REFERENCES machines(id),
    company_id INTEGER NOT NULL REFERENCES companies(id),
    requested_by_id INTEGER NOT NULL REFERENCES users(id),
    assigned_to_id INTEGER REFERENCES users(id),
    description TEXT NOT NULL,
    status job_order_status_enum NOT NULL DEFAULT 'Requested',
    requested_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    approved_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Table for Machine Inspections
CREATE TABLE IF NOT EXISTS machine_inspections (
    id SERIAL PRIMARY KEY,
    machine_id INTEGER NOT NULL REFERENCES machines(id),
    company_id INTEGER NOT NULL REFERENCES companies(id),
    inspected_by_id INTEGER NOT NULL REFERENCES users(id),
    status inspection_status_enum NOT NULL,
    remarks TEXT,
    inspected_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Table for Notification Logs
CREATE TABLE IF NOT EXISTS notification_logs (
    id SERIAL PRIMARY KEY,
    breakdown_id INTEGER REFERENCES breakdowns(id),
    recipient_id INTEGER REFERENCES users(id),
    recipient_phone_number VARCHAR(50) NOT NULL,
    message_body TEXT,
    delivery_status VARCHAR(20) NOT NULL,
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Triggers (Must be at the very end)
DROP TRIGGER IF EXISTS set_timestamp ON breakdowns;
CREATE TRIGGER set_timestamp
BEFORE UPDATE ON breakdowns
FOR EACH ROW
EXECUTE PROCEDURE trigger_set_timestamp();

DROP TRIGGER IF EXISTS set_timestamp_job_orders ON job_orders;
CREATE TRIGGER set_timestamp_job_orders
BEFORE UPDATE ON job_orders
FOR EACH ROW
EXECUTE PROCEDURE trigger_set_timestamp();