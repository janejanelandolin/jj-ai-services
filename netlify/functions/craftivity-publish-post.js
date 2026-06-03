const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const token = (event.headers.authorization || '').replace('Bearer ', '');
  if (!token) return { statusCode: 401, body: 'Unauthorized' };

  const anonClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  const { data: { user }, error: authErr } = await anonClient.auth.getUser(token);
  if (authErr || !user) return { statusCode: 401, body: 'Unauthorized' };

  const { postId, scheduleAt } = JSON.parse(event.body || '{}');
  if (!postId) return { statusCode: 400, body: 'postId required' };

  const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  const { data: post, error: postErr } = await svc.from('craftivity_posts').select('*').eq('id', postId).single();
  if (postErr || !post) return { statusCode: 404, body: 'Post not found' };
  if (post.client_id !== user.id) return { statusCode: 403, body: 'Forbidden' };
  if (!post.image_url) return { statusCode: 400, body: JSON.stringify({ error: 'Generate an image before posting.' }) };
  if (post.status !== 'approved') return { statusCode: 400, body: JSON.stringify({ error: 'Post must be approved before publishing.' }) };

  const igUserId    = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;

  if (!igUserId || !accessToken) {
    return { statusCode: 503, body: JSON.stringify({ error: 'Instagram credentials not configured. Add INSTAGRAM_BUSINESS_ACCOUNT_ID and INSTAGRAM_ACCESS_TOKEN to Netlify environment variables.' }) };
  }

  try {
    const caption = [post.caption, post.hashtags].filter(Boolean).join('\n\n');

    // Step 1: Create media container
    const containerParams = new URLSearchParams({
      image_url:    post.image_url,
      caption,
      access_token: accessToken,
    });

    if (scheduleAt) {
      const scheduleTs = Math.floor(new Date(scheduleAt).getTime() / 1000);
      containerParams.set('published', 'false');
      containerParams.set('scheduled_publish_time', scheduleTs.toString());
    }

    const containerRes  = await fetch(`https://graph.facebook.com/v18.0/${igUserId}/media`, { method: 'POST', body: containerParams });
    const containerData = await containerRes.json();
    if (containerData.error) throw new Error(containerData.error.message);

    // Step 2: Publish (or confirm scheduled)
    const publishRes  = await fetch(`https://graph.facebook.com/v18.0/${igUserId}/media_publish`, {
      method: 'POST',
      body: new URLSearchParams({ creation_id: containerData.id, access_token: accessToken }),
    });
    const publishData = await publishRes.json();
    if (publishData.error) throw new Error(publishData.error.message);

    const newStatus = scheduleAt ? 'scheduled' : 'posted';
    await svc.from('craftivity_posts').update({
      status:      newStatus,
      posted_at:   scheduleAt ? null : new Date().toISOString(),
      schedule_at: scheduleAt || null,
      ig_post_id:  publishData.id,
      updated_at:  new Date().toISOString(),
    }).eq('id', postId);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, status: newStatus, igPostId: publishData.id }),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
