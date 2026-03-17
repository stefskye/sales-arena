// GHL Webhook → Arena Sync
// POST /.netlify/functions/ghl-to-arena

const GHL_API_KEY  = process.env.GHL_API_KEY;
const PIPELINE_ID  = process.env.GHL_PIPELINE_ID  || 'nIIpZciGRZCX9ir8xQqk';
const LOCATION_ID  = process.env.GHL_LOCATION_ID  || 'WiRmG6z5Q8JYh5RrZ19E';
const SB_URL       = process.env.SUPABASE_URL      || 'https://acrejovjpicisuytmbqj.supabase.co';
const SB_KEY       = process.env.SUPABASE_SERVICE_KEY;
const PIPELINE_KEY = 'llc_pipeline_v1';

const GHL_TO_ARENA = {
  'New Lead':                  '🆕 Inbound New Lead',
  'Inbound New Lead':          '🆕 Inbound New Lead',
  'Outbound New Connection':   '📲 Outbound New Connections',
  'Having Conversations':      '🗣️ Prospect – Having Conversations',
  'Engaged':                   '💌 Engaged – Sent Info',
  'Unqualified Pre Call':      '⚠️ Unqualified (Pre Call) – Credit/Time Issue',
  'Call Booked':               '🎉 Call Booked',
  'Did Not Have Call':         '❌ Did Not Have Call',
  'Implementing in Financing': '💳 Implementing In Financing',
  'Closed Won':                '✅ Closed Won',
  'Not A Good Fit':            '❌ Closed / Lost (Not A Good Fit)',
  'open':                      '🆕 Inbound New Lead',
  'won':                       '✅ Closed Won',
  'lost':                      '❌ Closed / Lost (Not A Good Fit)',
};

async function sbGet(key) {
  const r = await fetch(`${SB_URL}/rest/v1/llc_data?key=eq.${encodeURIComponent(key)}&select=value`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }
  });
  if (!r.ok) return null;
  const rows = await r.json();
  if (!rows.length) return null;
  const val = rows[0].value;
  if (val && typeof val === 'object') return val;
  try { return JSON.parse(val); } catch { return null; }
}

async function sbSet(key, value) {
  const r = await fetch(`${SB_URL}/rest/v1/llc_data`, {
    method: 'POST',
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify({ key, value })
  });
  return r.ok;
}

async function ghlFetch(path) {
  const r = await fetch(`https://services.leadconnectorhq.com${path}`, {
    headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28' }
  });
  if (!r.ok) return null;
  return r.json();
}

export async function handler(event) {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method not allowed' };

  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, headers, body: 'Invalid JSON' }; }

  const { id, locationId } = payload;
  if (locationId && locationId !== LOCATION_ID) return { statusCode: 200, headers, body: JSON.stringify({ ok: true, ignored: 'wrong location' }) };

  const oppData = await ghlFetch(`/opportunities/${id}`);
  if (!oppData) return { statusCode: 200, headers, body: JSON.stringify({ ok: false, error: 'Could not fetch opportunity' }) };
  const opp = oppData.opportunity || oppData;

  if (opp.pipelineId && opp.pipelineId !== PIPELINE_ID) return { statusCode: 200, headers, body: JSON.stringify({ ok: true, ignored: 'wrong pipeline' }) };

  const contactData = opp.contactId ? await ghlFetch(`/contacts/${opp.contactId}`) : null;
  const contact = contactData?.contact || null;

  const name = contact ? `${contact.firstName || ''} ${contact.lastName || ''}`.trim() : (opp.name || 'Unknown');
  const [firstName, ...rest] = name.split(' ');
  const stageName = opp.pipelineStage?.name || opp.status || 'open';
  const arenaStage = GHL_TO_ARENA[stageName] || '🆕 Inbound New Lead';
  const today = new Date().toISOString().slice(0, 10);

  const newLead = {
    id: opp.id, ghlId: opp.id, ghlContactId: opp.contactId || '',
    firstName: firstName || '', lastName: rest.join(' '),
    email: contact?.email || '', phone: contact?.phone || '',
    stage: arenaStage, value: String(opp.monetaryValue || ''),
    notes: opp.notes || '', socialPlatform: contact?.source || '',
    contentShared: '', profileLink: contact?.website || '',
    firstContact: (opp.createdAt || today).slice(0, 10),
    lastContact: (opp.updatedAt || today).slice(0, 10),
    createdAt: (opp.createdAt || today).slice(0, 10),
    updatedAt: (opp.updatedAt || today).slice(0, 10),
    followUpDate: '', callDate
