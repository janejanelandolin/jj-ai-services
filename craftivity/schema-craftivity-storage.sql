-- Run in Supabase SQL Editor to create the image storage bucket

INSERT INTO storage.buckets (id, name, public)
VALUES ('craftivity-images', 'craftivity-images', true)
ON CONFLICT (id) DO NOTHING;

-- Public read (images need to be accessible by Instagram when posting)
CREATE POLICY "public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'craftivity-images');

-- Authenticated clients can upload
CREATE POLICY "auth_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'craftivity-images');

-- Service role can do everything (Netlify functions)
CREATE POLICY "service_all" ON storage.objects
  FOR ALL TO service_role
  USING (bucket_id = 'craftivity-images') WITH CHECK (bucket_id = 'craftivity-images');
