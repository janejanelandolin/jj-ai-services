const _sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Auth guard
let _token = null;
_sb.auth.getSession().then(({ data: { session } }) => {
  if (!session) { window.location.href = '/client-login.html'; return; }
  _token = session.access_token;
  loadContacts();
});

async function doLogout() {
  await _sb.auth.signOut();
  window.location.href = '/client-login.html';
}

function authHeaders() {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${_token}` };
}

// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.tab).classList.add('active');
  });
});

// Toast
function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast ${type} show`;
  setTimeout(() => toast.classList.remove('show'), 3500);
}

function formatBirthday(dateStr) {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-');
  return `${m}/${d}/${y}`;
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderStatus(c) {
  if (!c.sent_at) return `<span class="badge badge-scheduled">Scheduled</span>`;
  if (c.send_error) {
    return `<span class="badge badge-failed" title="${escHtml(c.send_error)}">Failed</span>
            <div class="status-detail error-detail">${escHtml(c.send_error)}</div>`;
  }
  const formatted = new Date(c.sent_at).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
  return `<span class="badge badge-sent">Sent</span>
          <div class="status-detail">${formatted}</div>
          ${c.sent_message ? `<div class="status-msg" title="${escHtml(c.sent_message)}">${escHtml(c.sent_message)}</div>` : ''}`;
}

// Load contacts
async function loadContacts() {
  const tbody = document.getElementById('contacts-body');
  try {
    const res  = await fetch('/.netlify/functions/bb-contacts', { headers: authHeaders() });
    const data = await res.json();
    if (!res.ok) { tbody.innerHTML = `<tr><td colspan="7" class="empty">${escHtml(data.error || 'Error loading contacts')}</td></tr>`; return; }
    if (!data.length) { tbody.innerHTML = '<tr><td colspan="7" class="empty">No contacts yet. Add one above!</td></tr>'; return; }
    tbody.innerHTML = data.map(c => `
      <tr>
        <td>${escHtml(c.first_name)} ${escHtml(c.last_name)}</td>
        <td>${formatBirthday(c.birthday)}</td>
        <td>${escHtml(c.phone_number)}</td>
        <td class="msg-cell" title="${escHtml(c.message)}">${escHtml(c.message)}</td>
        <td>${renderStatus(c)}</td>
        <td><button class="log-btn" onclick="toggleLog('${c.id}', this)">▶ View</button></td>
        <td>
          <button class="send-btn" onclick="sendNow('${c.id}', this)">Send Now</button>
          <button class="delete-btn" onclick="deleteContact('${c.id}')">✕</button>
        </td>
      </tr>
      <tr class="log-row" id="log-row-${c.id}" style="display:none">
        <td colspan="7"><div id="log-content-${c.id}" class="log-content">Loading…</div></td>
      </tr>
    `).join('');
  } catch {
    tbody.innerHTML = '<tr><td colspan="7" class="empty">Failed to load contacts.</td></tr>';
  }
}

async function toggleLog(id, btn) {
  const row     = document.getElementById(`log-row-${id}`);
  const content = document.getElementById(`log-content-${id}`);
  if (row.style.display !== 'none') { row.style.display = 'none'; btn.textContent = '▶ View'; return; }
  row.style.display = ''; btn.textContent = '▼ Hide'; content.textContent = 'Loading…';
  try {
    const res      = await fetch('/.netlify/functions/bb-contact-action', {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({ action: 'attempts', id }),
    });
    const attempts = await res.json();
    if (!attempts.length) { content.innerHTML = '<p class="log-empty">No send attempts yet.</p>'; return; }
    content.innerHTML = `
      <table class="log-table">
        <thead><tr><th>Time</th><th>Trigger</th><th>Result</th><th>Message</th><th>Twilio SID</th><th>Error</th></tr></thead>
        <tbody>${attempts.map(a => `
          <tr class="${a.success ? 'log-success' : 'log-fail'}">
            <td>${new Date(a.attempted_at).toLocaleString()}</td>
            <td><span class="trigger-badge">${escHtml(a.trigger)}</span></td>
            <td>${a.success ? '<span class="badge badge-sent">Sent</span>' : '<span class="badge badge-failed">Failed</span>'}</td>
            <td class="log-msg" title="${escHtml(a.message_body || '')}">${escHtml(a.message_body || '—')}</td>
            <td class="log-sid">${a.twilio_sid ? `<code>${escHtml(a.twilio_sid)}</code>` : '—'}</td>
            <td class="log-error">${a.error ? escHtml(a.error) : '—'}</td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  } catch { content.innerHTML = '<p class="log-empty">Failed to load log.</p>'; }
}

async function sendNow(id, btn) {
  if (!confirm('Send this message immediately?')) return;
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    const res  = await fetch('/.netlify/functions/bb-contact-action', {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({ action: 'send', id }),
    });
    const json = await res.json();
    showToast(res.ok ? json.message : (json.error || 'Failed to send'), res.ok ? 'success' : 'error');
    loadContacts();
  } catch { showToast('Network error', 'error'); }
  finally { btn.disabled = false; btn.textContent = 'Send Now'; }
}

async function deleteContact(id) {
  if (!confirm('Remove this contact from the campaign?')) return;
  const res = await fetch('/.netlify/functions/bb-contact-action', {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ action: 'delete', id }),
  });
  if (res.ok) { showToast('Contact removed'); loadContacts(); }
  else showToast('Failed to remove contact', 'error');
}

// Single entry form
document.getElementById('single-form').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = document.getElementById('add-btn');
  btn.disabled = true; btn.textContent = 'Adding…';
  const body = {
    first_name:   document.getElementById('first_name').value,
    last_name:    document.getElementById('last_name').value,
    birthday:     document.getElementById('birthday').value,
    phone_number: document.getElementById('phone_number').value,
    message:      document.getElementById('message').value,
  };
  try {
    const res  = await fetch('/.netlify/functions/bb-contacts', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
    const json = await res.json();
    if (res.ok) { showToast('Contact added and scheduled!'); e.target.reset(); loadContacts(); }
    else showToast(json.error || 'Failed to add contact', 'error');
  } catch { showToast('Network error', 'error'); }
  finally { btn.disabled = false; btn.textContent = 'Add Contact'; }
});

// File upload
const dropZone  = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const uploadBtn = document.getElementById('upload-btn');
const fileNameEl = document.getElementById('file-name');
let _selectedFile = null;

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => { e.preventDefault(); dropZone.classList.remove('dragover'); if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]); });
fileInput.addEventListener('change', () => { if (fileInput.files[0]) setFile(fileInput.files[0]); });

function setFile(file) { _selectedFile = file; fileNameEl.textContent = file.name; uploadBtn.disabled = false; }

document.getElementById('upload-form').addEventListener('submit', async e => {
  e.preventDefault();
  if (!_selectedFile) { showToast('Please select a file', 'error'); return; }
  uploadBtn.disabled = true; uploadBtn.textContent = 'Uploading…';
  try {
    const arrayBuffer = await _selectedFile.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
    const res  = await fetch('/.netlify/functions/bb-contacts-upload', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ fileBase64: base64, fileName: _selectedFile.name }),
    });
    const json = await res.json();
    if (res.ok) {
      let msg = `${json.added} contact(s) scheduled`;
      if (json.errors?.length) msg += `, ${json.errors.length} row(s) skipped`;
      showToast(msg, json.errors?.length && !json.added ? 'error' : 'success');
      fileNameEl.textContent = ''; _selectedFile = null; fileInput.value = '';
      loadContacts();
    } else { showToast(json.error || 'Upload failed', 'error'); }
  } catch { showToast('Network error', 'error'); }
  finally { uploadBtn.disabled = false; uploadBtn.textContent = 'Upload & Schedule'; }
});

document.getElementById('refresh-btn').addEventListener('click', loadContacts);
