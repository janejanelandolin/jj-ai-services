-- Run this once in your Supabase project's SQL Editor
-- Dashboard → SQL Editor → New Query → paste & run

CREATE TABLE public.signups (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at  TIMESTAMPTZ DEFAULT now(),
  first_name  TEXT        NOT NULL,
  last_name   TEXT        NOT NULL,
  email       TEXT        NOT NULL,
  company     TEXT,
  plan        TEXT        NOT NULL,
  challenge   TEXT,
  message     TEXT,
  sms_consent BOOLEAN DEFAULT false
);

ALTER TABLE public.signups ENABLE ROW LEVEL SECURITY;

-- Public visitors can submit the contact form
CREATE POLICY "public_insert" ON public.signups
  FOR INSERT TO anon WITH CHECK (true);

-- Only authenticated admins can read the signups
CREATE POLICY "admin_select" ON public.signups
  FOR SELECT TO authenticated USING (true);
