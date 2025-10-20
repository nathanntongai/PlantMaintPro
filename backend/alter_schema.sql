-- backend/alter_schema.sql

-- Add the new value to the existing ENUM type
ALTER TYPE status_enum ADD VALUE IF NOT EXISTS 'Pending Approval' BEFORE 'Reported';

-- NOW change the default value for the table column
ALTER TABLE breakdowns ALTER COLUMN status SET DEFAULT 'Pending Approval';