-- database.sql

-- We use "CREATE TABLE IF NOT EXISTS" to prevent errors if we run the script multiple times.

-- Table for Companies
-- Each company will have its own set of users, machines, etc.
CREATE TABLE IF NOT EXISTS companies (
    id SERIAL PRIMARY KEY, -- A unique, auto-incrementing ID for each company
    name VARCHAR(100) NOT NULL, -- The name of the company
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP -- The date and time the record was created
);

-- Table for Users
-- Stores login info and roles for all users in the system.
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY, -- A unique, auto-incrementing ID for each user
    company_id INTEGER NOT NULL REFERENCES companies(id), -- Links the user to a company. This is a "foreign key".
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL, -- Email must be unique across all users
    password_hash VARCHAR(255) NOT NULL, -- We will store a hashed password, not the plain text
    role VARCHAR(50) NOT NULL, -- e.g., 'Operator', 'Supervisor', 'Maintenance Technician' [cite: 55, 58, 60, 63]
    phone_number VARCHAR(50) UNIQUE,
    whatsapp_state VARCHAR(50) DEFAULT 'IDLE',
    whatsapp_context JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Table for Machines
-- Stores all the machinery for each company.
CREATE TABLE IF NOT EXISTS machines (
    id SERIAL PRIMARY KEY, -- A unique, auto-incrementing ID for each machine
    company_id INTEGER NOT NULL REFERENCES companies(id), -- Links the machine to a company
    name VARCHAR(100) NOT NULL, -- e.g., "Bottling Line 1"
    location VARCHAR(100), -- e.g., "Hall A, Section 3"
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- database.sql (add this to the end)

-- Create a custom type for breakdown status. This ensures data consistency.
DO $$ BEGIN
    CREATE TYPE status_enum AS ENUM ('Reported', 'Acknowledged', 'In Progress', 'Resolved', 'Closed');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Table for Machine Breakdowns
-- This is the core table for tracking maintenance tickets.
CREATE TABLE IF NOT EXISTS breakdowns (
    id SERIAL PRIMARY KEY,
    machine_id INTEGER NOT NULL REFERENCES machines(id),
    company_id INTEGER NOT NULL REFERENCES companies(id),
    reported_by_id INTEGER NOT NULL REFERENCES users(id),
    description TEXT NOT NULL, -- A description of the problem
    status status_enum NOT NULL DEFAULT 'Reported', -- The current status of the repair
    reported_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP WITH TIME ZONE -- Will be set when the issue is fixed
);

-- database.sql (add this to the end)

-- Table to define the types of utilities a company tracks (e.g., Power, Water)
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
    reading_value NUMERIC(10, 2) NOT NULL, -- The value from the meter
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- database.sql (add this to the end)

-- Table for scheduled preventive maintenance tasks
CREATE TABLE IF NOT EXISTS preventive_maintenance_tasks (
    id SERIAL PRIMARY KEY,
    machine_id INTEGER NOT NULL REFERENCES machines(id),
    company_id INTEGER NOT NULL REFERENCES companies(id),
    task_description TEXT NOT NULL, -- e.g., "Check and replace air filter"
    frequency_days INTEGER NOT NULL, -- How often the task repeats, in days
    next_due_date DATE NOT NULL, -- When the task is next scheduled to be done
    last_performed_at TIMESTAMP WITH TIME ZONE -- The last time the task was completed
);