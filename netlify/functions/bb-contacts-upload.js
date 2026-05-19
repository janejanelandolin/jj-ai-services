// POST { fileBase64, fileName, client_id? }
// Accepts base64-encoded CSV or XLSX, parses rows, bulk-inserts contacts.

const { createClient } = require('@supabase/supabase-js');
const { parse }        = require('csv-parse/sync');
const ExcelJS          = require('exceljs');

function normalizePhone(raw) {
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return `+${digits}`;
}

function normalizeDate(raw) {
  if (!raw) return null;
  if (raw instanceof Date) {
    const m = String(raw.getMonth() + 1).padStart(2, '0');
    const d = String(raw.getDate()).padStart(2, '0');
    return `${raw.getFullYear()}-${m}-${d}`;
  }
  const s = String(raw).trim();
  const mdy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2,'0')}-${mdy[2].padStart(2,'0')}`;
  const ymd = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (ymd) return `${ymd[1]}-${ymd[2].padStart(2,'0')}-${ymd[3].padStart(2,'0')}`;
  return null;
}

const FIELD_MAP = {
  first_name:   ['first_name','firstname','first name'],
  last_name:    ['last_name','lastname','last name'],
  birthday:     ['birthday','birth_date','birthdate','date_of_birth','dob'],
  phone_number: ['phone_number','phone','phonenumber','mobile','cell'],
  message:      ['message','msg','text'],
};

function findField(row, aliases) {
  const keys = Object.keys(row).map(k => k.toLowerCase().replace(/\s+/g, '_'));
  for (const alias of aliases) {
    const idx = keys.indexOf(alias);
    if (idx !== -1) return Object.values(row)[idx];
  }
  return undefined;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const token = (event.headers.authorization || '').replace('Bearer ', '');
  if (!token) return { statusCode: 401, body: 'Unauthorized' };

  const supabaseUrl = process.env.SUPABASE_URL;
  const { data: { user }, error: authErr } = await createClient(supabaseUrl, process.env.SUPABASE_ANON_KEY).auth.getUser(token);
  if (authErr || !user) return { statusCode: 401, body: 'Unauthorized' };

  const svc = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_KEY);
  const { data: profile } = await svc.from('profiles').select('role').eq('id', user.id).single();
  const isAdmin = profile?.role === 'admin';

  const body = JSON.parse(event.body || '{}');
  const { fileBase64, fileName } = body;
  if (!fileBase64 || !fileName) return { statusCode: 400, body: JSON.stringify({ error: 'fileBase64 and fileName required' }) };

  const client_id = (isAdmin && body.client_id) ? body.client_id : user.id;
  const buffer    = Buffer.from(fileBase64, 'base64');
  const nameLower = fileName.toLowerCase();
  let rows = [];

  try {
    if (nameLower.endsWith('.csv')) {
      rows = parse(buffer.toString('utf8'), { columns: true, skip_empty_lines: true, trim: true });
    } else if (nameLower.endsWith('.xlsx') || nameLower.endsWith('.xls')) {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      const sheet = workbook.worksheets[0];
      const headers = [];
      sheet.getRow(1).eachCell(cell => headers.push(String(cell.value || '').trim().toLowerCase().replace(/\s+/g, '_')));
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const obj = {};
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => { obj[headers[colNumber - 1]] = cell.value; });
        if (Object.values(obj).some(v => v !== null && v !== undefined && v !== '')) rows.push(obj);
      });
    } else {
      return { statusCode: 400, body: JSON.stringify({ error: 'Only .csv, .xlsx, and .xls files are supported' }) };
    }
  } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: `Failed to parse file: ${err.message}` }) };
  }

  const results = { added: 0, errors: [] };
  const toInsert = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const first_name   = String(findField(row, FIELD_MAP.first_name)   ?? '').trim();
    const last_name    = String(findField(row, FIELD_MAP.last_name)    ?? '').trim();
    const birthdayRaw  = findField(row, FIELD_MAP.birthday);
    const phone_number = String(findField(row, FIELD_MAP.phone_number) ?? '').trim();
    const messageRaw   = String(findField(row, FIELD_MAP.message)      ?? '').trim();

    if (!first_name || !last_name || !birthdayRaw || !phone_number) {
      results.errors.push({ row: i + 2, error: 'Missing required fields' });
      continue;
    }
    const birthday = normalizeDate(birthdayRaw);
    if (!birthday) { results.errors.push({ row: i + 2, error: `Invalid birthday: ${birthdayRaw}` }); continue; }

    toInsert.push({
      client_id,
      first_name, last_name, birthday,
      phone_number: normalizePhone(phone_number),
      message: messageRaw || `Happy Birthday ${first_name}! 🎂 - from your friends at LAB Wealth Management`,
    });
  }

  if (toInsert.length) {
    const { error } = await svc.from('bb_contacts').insert(toInsert);
    if (error) return { statusCode: 400, body: JSON.stringify({ error: error.message }) };
    results.added = toInsert.length;
  }

  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(results) };
};
