-- backend/alter_schema.sql
ALTER TYPE status_enum ADD VALUE IF NOT EXISTS 'Pending Approval' BEFORE 'Reported';
ALTER TABLE breakdowns ALTER COLUMN status SET DEFAULT 'Pending Approval';