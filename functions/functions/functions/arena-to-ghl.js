// Arena → GHL Sync
// POST /.netlify/functions/arena-to-ghl

const GHL_API_KEY = process.env.GHL_API_KEY;
const PIPELINE_ID = process.env.GHL_PIPELINE_ID || 'nIIpZciGRZCX9ir8xQqk';
const LOCATION_ID = process.env.GHL_LOCATION_ID || 'WiRmG6z5Q8JYh5RrZ19E';

const ARENA_TO_GHL = {
  '🆕 Inbound New Lead':                          'New Lead',
  '📲 Outbound New Connections':                   'Outbound New Connection',
  '🗣️ Prospect – Having Conversations':            'Having Conversations',
  '💌 Engaged – Sent Info':                        'Engaged',
  '⚠️ Unqualified (Pre Call) – Credit/Time Issue': 'Unqualified Pre Call',
  '🎉 Call Booked':                                'Call Booked',
  '❌ Did Not Have Call':                           'Did Not Have Call',
  '💳 Implementing In Financing':                  'Implementing in Financing',
  '✅ Closed Won':                                  'Closed Won',
  '❌ Closed / Lost (Not A Good Fit)':              'Not A Good Fit',
};

async function ghlGet(path) {
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

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, headers, body: 'Invalid JSON' }; }

  const { action, lead, note } = body;
  if (!lead) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'Missing lead' }) };

  if (action === 'note' && lead.ghlContactId && note) {
    const r = await fetch(`https://services.leadconnectorhq.com/contacts/${lead.ghlContactId}/notes`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: note })
    });
    return { statusCode: 200, headers, body: JSON.stringify({ ok: r.ok }) };
  }

  if (lead.ghlId) {
    const stages = await ghlGet(`/opportunities/pipelines/${PIPELINE_ID}?locationId=${LOCATION_ID}`);
    const stageName = ARENA_TO_GHL[lead.stage] || 'New Lead';
    const stage = (stages?.stages || []).find(s => s.name === stageName);
    const updates = { status: lead.stage === '✅ Closed Won' ? 'won' : lead.stage?.includes('Lost') ? 'lost' : 'open' };
    if (stage?.id) updates.pipelineStageId = stage.id;
    if (lead.value) updates.monetaryValue = parseFloat(lead.value) || 0;

    const r = await fetch(`https://services.leadconnectorhq.com/opportunities/${lead.ghlId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${GHL_API_KEY}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });
    return { statusCode: 200, headers, body: JSON.stringify({ ok: r.ok, action: 'updated' }) };
  }

  return { statusCode: 200, headers, body: JSON.stringify({ ok: true, action: 'no_ghl_id' }) };
}
