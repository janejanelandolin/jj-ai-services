// GET  ?project_id=<uuid>          → list comments for a project
// POST { project_id, text }        → add a comment

const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  const token = (event.headers.authorization || '').replace('Bearer ', '');
  if (!token) return { statusCode: 401, body: 'Unauthorized' };

  const anonClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  const { data: { user }, error: authErr } = await anonClient.auth.getUser(token);
  if (authErr || !user) return { statusCode: 401, body: 'Unauthorized' };

  const adminClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const userName = user.user_metadata?.full_name || user.email?.split('@')[0] || 'Client';

  // ── GET: list comments ────────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    const projectId = event.queryStringParameters?.project_id;
    if (!projectId) return { statusCode: 400, body: 'project_id required' };

    // Verify ownership
    const { data: proj } = await adminClient.from('projects')
      .select('id').eq('id', projectId).eq('client_id', user.id).maybeSingle();
    if (!proj) return { statusCode: 403, body: 'Access denied' };

    const { data, error } = await adminClient
      .from('project_comments')
      .select('id, user_name, text, created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true });

    if (error) return { statusCode: 400, body: JSON.stringify({ error: error.message }) };
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
  }

  // ── POST: add comment ─────────────────────────────────────────────────
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: 'Bad JSON' }; }

    const { project_id, text } = body;
    if (!project_id || !text?.trim()) return { statusCode: 400, body: JSON.stringify({ error: 'project_id and text required' }) };

    // Verify ownership
    const { data: proj } = await adminClient.from('projects')
      .select('id').eq('id', project_id).eq('client_id', user.id).maybeSingle();
    if (!proj) return { statusCode: 403, body: 'Access denied' };

    const { data, error } = await adminClient.from('project_comments').insert({
      project_id,
      client_id: user.id,
      user_name: userName,
      text: text.trim(),
    }).select().single();

    if (error) return { statusCode: 400, body: JSON.stringify({ error: error.message }) };
    return { statusCode: 201, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
  }

  return { statusCode: 405, body: 'Method Not Allowed' };
};
