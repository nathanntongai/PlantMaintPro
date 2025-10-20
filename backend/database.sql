-- backend/database.sql (Part 1: Initial Schema)

CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS companies (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

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

CREATE TABLE IF NOT EXISTS machines (
    id SERIAL PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    name VARCHAR(100) NOT NULL,
    location VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Define the ENUM WITHOUT 'Pending Approval' initially
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'status_enum') THEN
        CREATE TYPE status_enum AS ENUM ('Reported', 'Acknowledged', 'In Progress', 'Resolved', 'Closed');
    END IF;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create the breakdowns table using 'Reported' as the default
CREATE TABLE IF NOT EXISTS breakdowns (
    id SERIAL PRIMARY KEY,
    machine_id INTEGER NOT NULL REFERENCES machines(id),
    company_id INTEGER NOT NULL REFERENCES companies(id),
    reported_by_id INTEGER NOT NULL REFERENCES users(id),
    assigned_to_id INTEGER REFERENCES users(id),
    approved_by_id INTEGER REFERENCES users(id),
    description TEXT NOT NULL,
    status status_enum NOT NULL DEFAULT 'Reported', -- Initial default
    reported_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- (All other table definitions: utilities, utility_readings, preventive_maintenance_tasks, job_orders, notification_logs remain the same)
CREATE TABLE IF NOT EXISTS utilities ( /* ... */ );
CREATE TABLE IF NOT EXISTS utility_readings ( /* ... */ );
CREATE TABLE IF NOT EXISTS preventive_maintenance_tasks ( /* ... */ );
DO $$ BEGIN CREATE TYPE job_order_status_enum AS ENUM ('Requested', 'Approved', 'Rejected', 'Assigned', 'In Progress', 'Completed', 'Closed'); EXCEPTION WHEN duplicate_object THEN null; END $$;
CREATE TABLE IF NOT EXISTS job_orders ( /* ... */ );
CREATE TABLE IF NOT EXISTS notification_logs ( /* ... */ );

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