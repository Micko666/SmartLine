-- 004_expand_event_types.sql
-- Expand calendar_events.type CHECK constraint to include 'takeaway' and 'delivery'
-- Required for the new customer booking flow that separates dine-in, takeaway, delivery, and events.

ALTER TABLE calendar_events
  DROP CONSTRAINT IF EXISTS calendar_events_type_check;

ALTER TABLE calendar_events
  ADD CONSTRAINT calendar_events_type_check
  CHECK (type IN ('reservation', 'private_event', 'closure', 'takeaway', 'delivery'));
