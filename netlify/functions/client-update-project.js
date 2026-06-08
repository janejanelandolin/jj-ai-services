// Allows an authenticated client to update their own project.
// POST { id, name?, description?, status?, milestones?, links?, notes? }
// Only fields present in the body are updated.

const { createClient } = require('@supabase/supabase-js');

const ALLOWED_FIELDS = ['name', 'description', 'status', 'milestones', 'links', 'notes'];

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const token = (event.headers.authorization || '').replace('Bearer ', '');
  if (!token) return { statusCode: 401, body: 'Unauthorized' };

  const anonClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  const { data: { user }, error: authErr } = await anonClient.auth.getUser(token);
  if (authErr || !user) return { statusCode: 401, body: 'Unauthorized' };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: 'Bad JSON' }; }

  const { id, ...rest } = body;
  if (!id) return { statusCode: 400, body: JSON.stringify({ error: 'id required' }) };

  // Build update payload — only allowed fields
  const updates = {};
  for (const key of ALLOWED_FIELDS) {
    if (rest[key] !== undefined) updates[key] = rest[key];
  }
  if (!Object.keys(updates).length) return { statusCode: 400, body: JSON.stringify({ error: 'No fields to update' }) };
  updates.updated_at = new Date().toISOString();

  // Use service key but restrict to the authenticated user's projects
  const adminClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data, error } = await adminClient
    .from('projects')
    .update(updates)
    .eq('id', id)
    .eq('client_id', user.id)   // ownership check
    .select()
    .single();

  if (error) return { statusCode: 400, body: JSON.stringify({ error: error.message }) };
  if (!data)  return { statusCode: 404, body: JSON.stringify({ error: 'Project not found or access denied' }) };

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  };
};
