-- This function MUST be defined first, before the trigger uses it.
CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

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

-- Create a custom type for breakdown status
DO $$ BEGIN
    CREATE TYPE status_enum AS ENUM ('Reported', 'Acknowledged', 'In Progress', 'Resolved', 'Closed');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Table for Machine Breakdowns
CREATE TABLE IF NOT EXISTS breakdowns (
    id SERIAL PRIMARY KEY,
    machine_id INTEGER NOT NULL REFERENCES machines(id),
    company_id INTEGER NOT NULL REFERENCES companies(id),
    reported_by_id INTEGER NOT NULL REFERENCES users(id),
    assigned_to_id INTEGER REFERENCES users(id), -- Tracks assigned technician
    description TEXT NOT NULL,
    status status_enum NOT NULL DEFAULT 'Reported',
    reported_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP -- Tracks updates
);

-- Table to define the types of utilities a company tracks
CREATE TABLE IF NOT EXISTS utilities (
    id SERIAL PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    name VARCHAR(100) NOT NULL, -- e.g., "Mains Power Meter"
    unit VARCHAR(20) NOT NULL, -- e.g., "kWh", "m3", "liters"
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Table to store the actual utility meter readings
CREATE TABLE IF NOT EXISTS utility_readings (
    id SERIAL PRIMARY KEY,
    utility_id INTEGER NOT NULL REFERENCES utilities(id),
    company_id INTEGER NOT NULL REFERENCES companies(id),
    recorded_by_id INTEGER NOT NULL REFERENCES users(id),
    reading_value NUMERIC(10, 2) NOT NULL,
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Table for scheduled preventive maintenance tasks
CREATE TABLE IF NOT EXISTS preventive_maintenance_tasks (
    id SERIAL PRIMARY KEY,
    machine_id INTEGER NOT NULL REFERENCES machines(id),
    company_id INTEGER NOT NULL REFERENCES companies(id),
    task_description TEXT NOT NULL,
    frequency_days INTEGER NOT NULL,
    next_due_date DATE NOT NULL,
    last_performed_at TIMESTAMP WITH TIME ZONE
);

-- Table for logging notifications
CREATE TABLE IF NOT EXISTS notification_logs (
    id SERIAL PRIMARY KEY,
    breakdown_id INTEGER REFERENCES breakdowns(id),
    recipient_id INTEGER REFERENCES users(id),
    recipient_phone_number VARCHAR(50) NOT NULL,
    message_body TEXT,
    delivery_status VARCHAR(20) NOT NULL,
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- This trigger MUST come AFTER the function and the breakdowns table are defined
DROP TRIGGER IF EXISTS set_timestamp ON breakdowns;
CREATE TRIGGER set_timestamp
BEFORE UPDATE ON breakdowns
FOR EACH ROW
EXECUTE PROCEDURE trigger_set_timestamp();

-- Add this to the end of backend/database.sql

-- Create a custom type for job order status
DO $$ BEGIN
    CREATE TYPE job_order_status_enum AS ENUM ('Requested', 'Approved', 'Rejected', 'Assigned', 'In Progress', 'Completed', 'Closed');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Table for Job Orders (Improvement requests, non-breakdown tasks)
CREATE TABLE IF NOT EXISTS job_orders (
    id SERIAL PRIMARY KEY,
    machine_id INTEGER NOT NULL REFERENCES machines(id),
    company_id INTEGER NOT NULL REFERENCES companies(id),
    requested_by_id INTEGER NOT NULL REFERENCES users(id),
    assigned_to_id INTEGER REFERENCES users(id), -- Technician assigned
    description TEXT NOT NULL, -- Description of work needed
    status job_order_status_enum NOT NULL DEFAULT 'Requested',
    requested_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    approved_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Optional: Add a trigger to automatically update the 'updated_at' timestamp
-- This uses the same function we created for the breakdowns table.
DROP TRIGGER IF EXISTS set_timestamp_job_orders ON job_orders;
CREATE TRIGGER set_timestamp_job_orders
BEFORE UPDATE ON job_orders
FOR EACH ROW
EXECUTE PROCEDURE trigger_set_timestamp();