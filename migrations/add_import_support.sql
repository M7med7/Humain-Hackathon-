-- Add Jira/Linear import tracking to tasks
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS external_source TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS external_id TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS labels TEXT[] DEFAULT '{}';

-- Prevent duplicate imports from the same external source
CREATE UNIQUE INDEX IF NOT EXISTS tasks_external_dedup
  ON tasks (project_id, external_source, external_id)
  WHERE external_source IS NOT NULL AND external_id IS NOT NULL;
