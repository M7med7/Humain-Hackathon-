-- Add social links and job title to the users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS github_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS linkedin_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS x_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS job_title TEXT;
