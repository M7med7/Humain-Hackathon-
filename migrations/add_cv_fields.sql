ALTER TABLE users ADD COLUMN skills TEXT[] DEFAULT '{}';
ALTER TABLE users ADD COLUMN experience_summary TEXT;
ALTER TABLE users ADD COLUMN cv_parsed_at TIMESTAMPTZ;
