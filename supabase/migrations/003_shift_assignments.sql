-- 003_shift_assignments.sql
-- Migrate shifts table to support per-employee role assignments,
-- shift name, color accent, and optional station link.

-- ─── New columns ─────────────────────────────────────────────────────────────

ALTER TABLE shifts
  ADD COLUMN IF NOT EXISTS name       text,
  ADD COLUMN IF NOT EXISTS color      text    NOT NULL DEFAULT '#6366f1',
  ADD COLUMN IF NOT EXISTS station_id text,
  ADD COLUMN IF NOT EXISTS assignments jsonb  NOT NULL DEFAULT '[]'::jsonb;

-- ─── Backfill: migrate role → name, employee_ids → assignments ───────────────
-- Each legacy employee_id gets the shift's own role label as their assignment role.

UPDATE shifts
SET
  name = COALESCE(role, 'Shift'),
  assignments = CASE
    WHEN employee_ids IS NULL OR jsonb_array_length(COALESCE(employee_ids, '[]'::jsonb)) = 0
    THEN '[]'::jsonb
    ELSE (
      SELECT jsonb_agg(
        jsonb_build_object(
          'employeeId', e::text,
          'role',       COALESCE(role, 'Staff')
        )
      )
      FROM jsonb_array_elements_text(employee_ids) AS e
    )
  END
WHERE name IS NULL;

-- Make name NOT NULL now that backfill is done
ALTER TABLE shifts ALTER COLUMN name SET NOT NULL;

-- ─── Index for analytics queries (employee work log) ─────────────────────────

CREATE INDEX IF NOT EXISTS shifts_date_user ON shifts (user_id, date DESC);
