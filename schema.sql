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
CREATE POLICY "admin_select_all" ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() = id OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));
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

-- ── Birthday Buddy ────────────────────────────────────────────────────────
CREATE TABLE public.bb_contacts (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT now(),
  client_id    UUID        REFERENCES auth.users(id) ON DELETE CASCADE,
  first_name   TEXT        NOT NULL,
  last_name    TEXT        NOT NULL,
  birthday     DATE        NOT NULL,
  phone_number TEXT        NOT NULL,
  message      TEXT        NOT NULL
);
ALTER TABLE public.bb_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "client_own"  ON public.bb_contacts FOR ALL TO authenticated
  USING (auth.uid() = client_id) WITH CHECK (auth.uid() = client_id);
CREATE POLICY "admin_all"   ON public.bb_contacts FOR ALL TO authenticated
  USING    (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "service_all" ON public.bb_contacts FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE public.bb_send_log (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_id   UUID        REFERENCES public.bb_contacts(id) ON DELETE CASCADE,
  year         INT         NOT NULL,
  sent_at      TIMESTAMPTZ DEFAULT now(),
  message_body TEXT,
  error        TEXT,
  UNIQUE(contact_id, year)
);
ALTER TABLE public.bb_send_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_all" ON public.bb_send_log FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "client_own"  ON public.bb_send_log FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.bb_contacts WHERE id = contact_id AND client_id = auth.uid()));

CREATE TABLE public.bb_send_attempts (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_id   UUID        REFERENCES public.bb_contacts(id) ON DELETE CASCADE,
  attempted_at TIMESTAMPTZ DEFAULT now(),
  trigger      TEXT        NOT NULL,
  success      BOOLEAN     NOT NULL DEFAULT false,
  message_body TEXT,
  twilio_sid   TEXT,
  error        TEXT
);
ALTER TABLE public.bb_send_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_all" ON public.bb_send_attempts FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "client_own"  ON public.bb_send_attempts FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.bb_contacts WHERE id = contact_id AND client_id = auth.uid()));
