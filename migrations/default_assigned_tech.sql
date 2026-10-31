-- Tasks written without technologies (such as Autopilot's) stored NULL, which the frontend reads as a list.
-- Give the column an empty-list default like labels, acceptance_criteria and definition_of_done.

UPDATE public.tasks SET assigned_tech = '{}' WHERE assigned_tech IS NULL;

ALTER TABLE public.tasks ALTER COLUMN assigned_tech SET DEFAULT '{}';
