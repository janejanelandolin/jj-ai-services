-- Run in Supabase SQL Editor: Dashboard → SQL Editor → New Query

-- ── Craftivity Brand Profile ──────────────────────────────────────────────
CREATE TABLE public.craftivity_brand_profile (
  client_id         UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now(),
  biz_name          TEXT DEFAULT 'Craftivity',
  ig_handle         TEXT,
  biz_location      TEXT DEFAULT 'San Francisco, CA',
  biz_audience      TEXT,
  brand_voice       TEXT,
  class_types       TEXT,
  price_range       TEXT,
  booking_link      TEXT,
  default_hashtags  TEXT DEFAULT '#craftivity #craftclass #sanfrancisco'
);
ALTER TABLE public.craftivity_brand_profile ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client_own" ON public.craftivity_brand_profile
  FOR ALL TO authenticated
  USING (auth.uid() = client_id) WITH CHECK (auth.uid() = client_id);

CREATE POLICY "admin_all" ON public.craftivity_brand_profile
  FOR ALL TO authenticated
  USING    (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "service_all" ON public.craftivity_brand_profile
  FOR ALL TO service_role USING (true) WITH CHECK (true);


-- ── Craftivity Posts (approval queue) ────────────────────────────────────
CREATE TABLE public.craftivity_posts (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now(),
  client_id    UUID        REFERENCES auth.users(id) ON DELETE CASCADE,
  topic        TEXT,
  caption      TEXT        NOT NULL,
  hashtags     TEXT,
  image_prompt TEXT,
  image_url    TEXT,
  schedule_at  TIMESTAMPTZ,
  status       TEXT        DEFAULT 'pending',  -- pending | approved | rejected | posted
  posted_at    TIMESTAMPTZ,
  ig_post_id   TEXT
);
ALTER TABLE public.craftivity_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client_own" ON public.craftivity_posts
  FOR ALL TO authenticated
  USING (auth.uid() = client_id) WITH CHECK (auth.uid() = client_id);

CREATE POLICY "admin_all" ON public.craftivity_posts
  FOR ALL TO authenticated
  USING    (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "service_all" ON public.craftivity_posts
  FOR ALL TO service_role USING (true) WITH CHECK (true);
