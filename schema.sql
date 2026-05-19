-- Run this once in your Supabase project's SQL Editor
-- Dashboard → SQL Editor → New Query → paste & run

CREATE TABLE public.signups (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at  TIMESTAMPTZ DEFAULT now(),
  first_name  TEXT        NOT NULL,
  last_name   TEXT        NOT NULL,
  email       TEXT        NOT NULL,
  phone       TEXT,
  company     TEXT,
  plan        TEXT        NOT NULL,
  challenge   TEXT,
  message     TEXT,
  sms_consent BOOLEAN     DEFAULT false
);

-- SMS subscribers — built from inbound START/STOP texts
CREATE TABLE public.sms_subscribers (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT now(),
  phone        TEXT        NOT NULL UNIQUE,
  opted_in     BOOLEAN     DEFAULT false,
  opted_in_at  TIMESTAMPTZ,
  opted_out_at TIMESTAMPTZ
);

ALTER TABLE public.sms_subscribers ENABLE ROW LEVEL SECURITY;

-- Only the service role (used by the Netlify function) can write
CREATE POLICY "service_all" ON public.sms_subscribers
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Admins can read
CREATE POLICY "admin_select" ON public.sms_subscribers
  FOR SELECT TO authenticated USING (true);

ALTER TABLE public.signups ENABLE ROW LEVEL SECURITY;

-- Public visitors can submit the contact form
CREATE POLICY "public_insert" ON public.signups
  FOR INSERT TO anon WITH CHECK (true);

-- Only authenticated admins can read the signups
CREATE POLICY "admin_select" ON public.signups
  FOR SELECT TO authenticated USING (true);
