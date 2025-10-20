-- ===============================================
-- Safe migration for adding 'Pending Approval' enum
-- ===============================================

-- 1️⃣ Add the new ENUM value in its own transaction
DO $$
BEGIN
  -- Add value only if it does not already exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'Pending Approval'
      AND enumtypid = 'status_enum'::regtype
  ) THEN
    ALTER TYPE status_enum ADD VALUE 'Pending Approval' BEFORE 'Reported';
  END IF;
END$$;

-- ✅ Important: COMMIT is implicit here in DO block execution

-- 2️⃣ Now safely change default for breakdowns.status
ALTER TABLE breakdowns ALTER COLUMN status SET DEFAULT 'Pending Approval';

-- 3️⃣ Optional: Verify applied successfully
-- SELECT unnest(enum_range(NULL::status_enum)) AS allowed_statuses;
-- \d+ breakdowns
