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

-- ── Profiles ──────────────────────────────────────────────────────────────
CREATE TABLE public.profiles (
  id         UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now(),
  role       TEXT NOT NULL DEFAULT 'client',
  full_name  TEXT,
  company    TEXT,
  email      TEXT
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_own"   ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "service_all" ON public.profiles FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── Projects ──────────────────────────────────────────────────────────────
CREATE TABLE public.projects (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  client_id   UUID        REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  description TEXT,
  status      TEXT        DEFAULT 'planning',
  milestones  JSONB       DEFAULT '[]',
  links       JSONB       DEFAULT '[]',
  notes       TEXT,
  cover_color TEXT        DEFAULT '#00bcd4'
);
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

-- Clients see only their own projects
CREATE POLICY "client_select" ON public.projects
  FOR SELECT TO authenticated USING (auth.uid() = client_id);

-- Admins can do everything
CREATE POLICY "admin_all" ON public.projects
  FOR ALL TO authenticated
  USING    (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

-- Service role (Netlify functions) can do everything
CREATE POLICY "service_all" ON public.projects
  FOR ALL TO service_role USING (true) WITH CHECK (true);
