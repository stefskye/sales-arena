// GHL Full Pipeline Pull — Sales Arena Sync
// GET /.netlify/functions/ghl-pull-all

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
  'Prospect':                  '🗣️ Prospect – Having Conversations',
  'Having Conversations':      '🗣️ Prospect – Having Conversations',
  'Engaged':                   '💌 Engaged – Sent Info',
  'Sent Info':                 '💌 Engaged – Sent Info',
  'Unqualified Pre Call':      '⚠️ Unqualified (Pre Call) – Credit/Time Issue',
  'Call Booked':               '🎉 Call Booked',
  'Did Not Have Call':         '❌ Did Not Have Call',
  'Implementing in Financing': '💳 Implementing In Financing',
  'Closed Won':                '✅ Closed Won',
  'Closed Lost':               '❌ Closed / Lost (Not A Good Fit)',
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
  if (!r.ok) { console.error('GHL fetch failed:', path, r.status); return null; }
  return r.json();
}

function localDate(iso) {
  if (!iso) return new Date().toISOString().slice(0, 10);
  return iso.slice(0, 10);
}

function mapOpp(opp, contact) {
  const name = contact
    ? `${contact.firstName || ''} ${contact.lastName || ''}`.trim()
    : (opp.name || opp.contactName || 'Unknown');
  const [firstName, ...rest] = name.split(' ');

  // Try stage name first, fall back to status
  const stageName = opp.pipelineStage?.name || opp.status || 'open';
  const arenaStage = GHL_TO_ARENA[stageName] || '🆕 Inbound New Lead';

  return {
    id:            opp.id,
    ghlId:         opp.id,
    ghlContactId:  opp.contactId || contact?.id || '',
    firstName:     firstName || '',
    lastName:      rest.join(' '),
    email:         contact?.email || '',
    phone:         contact?.phone || '',
    stage:         arenaStage,
    value:         String(opp.monetaryValue || ''),
    notes:         opp.notes || '',
    socialPlatform: contact?.source || opp.source || '',
    contentShared: '',
    profileLink:   contact?.website || '',
    firstContact:  localDate(opp.createdAt),
    lastContact:   localDate(opp.updatedAt),
    createdAt:     localDate(opp.createdAt),
    updatedAt:     localDate(opp.updatedAt),
    followUpDate:  '',
    callDate:      '',
    activityLog:   [],
    _ghlSync:      true,
    _ghlLastSynced: new Date().toISOString(),
  };
}

export async function handler(event) {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  console.log('GHL Pull All started. PIPELINE_ID:', PIPELINE_ID, 'LOCATION_ID:', LOCATION_ID);
  console.log('GHL_API_KEY set:', !!GHL_API_KEY, 'SB_KEY set:', !!SB_KEY);

  if (!GHL_API_KEY) return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: 'GHL_API_KEY not set' }) };
  if (!SB_KEY)      return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: 'SUPABASE_SERVICE_KEY not set' }) };

  // Fetch all opportunities from pipeline
  let allOpps = [];
  let page = 1;
  while (true) {
    const data = await ghlFetch(`/opportunities/search?location_id=${LOCATION_ID}&pipeline_id=${PIPELINE_ID}&limit=100&page=${page}`);
    if (!data) break;
    const opps = data.opportunities || [];
    console.log(`Page ${page}: ${opps.length} opportunities`);
    allOpps = allOpps.concat(opps);
    if (opps.length < 100) break;
    page++;
  }

  console.log('Total opportunities fetched:', allOpps.length);
  if (!allOpps.length) {
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, synced: 0, message: 'No opportunities found in pipeline' }) };
  }

  // Fetch contacts in parallel batches of 5
  const contactCache = {};
  const contactIds = [...new Set(allOpps.map(o => o.contactId).filter(Boolean))];
  console.log('Fetching', contactIds.length, 'contacts');
  for (let i = 0; i < contactIds.length; i += 5) {
    const batch = contactIds.slice(i, i + 5);
    await Promise.all(batch.map(async id => {
      if (!contactCache[id]) {
        const data = await ghlFetch(`/contacts/${id}`);
        contactCache[id] = data?.contact || null;
      }
    }));
  }

  // Load existing pipeline data to preserve Arena-only fields
  const pipelineData = (await sbGet(PIPELINE_KEY)) || {};

  // Build lookup of existing leads by ghlId
  const existingByGhlId = {};
  for (const [member, md] of Object.entries(pipelineData)) {
    for (const lead of (md?.leads || [])) {
      if (lead.ghlId) existingByGhlId[lead.ghlId] = { member, lead };
    }
  }

  // Map and upsert all opportunities
  // Group by assigned user → try to match to Arena member
  const arenaMembers = Object.keys(pipelineData).filter(k => Array.isArray(pipelineData[k]?.leads));

  let synced = 0;
  for (const opp of allOpps) {
    const contact = contactCache[opp.contactId] || null;
    const newLead = mapOpp(opp, contact);

    // Find target Arena member
    const assignedName = opp.user?.name || opp.assignedTo || '';
    let targetMember = arenaMembers.find(m =>
      assignedName && (
        m.toLowerCase().includes(assignedName.toLowerCase().split(' ')[0]) ||
        assignedName.toLowerCase().includes(m.toLowerCase().split(' ')[0])
      )
    );

    // If no match, check if lead already exists somewhere
    if (!targetMember && existingByGhlId[opp.id]) {
      targetMember = existingByGhlId[opp.id].member;
    }

    // Last resort — use assigned name as key or '_ghl_unassigned'
    if (!targetMember) targetMember = assignedName || '_ghl_unassigned';

    if (!pipelineData[targetMember]) pipelineData[targetMember] = { leads: [] };
    if (!Array.isArray(pipelineData[targetMember].leads)) pipelineData[targetMember].leads = [];

    const existing = existingByGhlId[opp.id];
    if (existing) {
      const kept = existing.lead;
      const idx = pipelineData[existing.member].leads.findIndex(l => l.ghlId === opp.id);
      if (idx !== -1) {
        pipelineData[existing.member].leads[idx] = {
          ...kept,
          ...newLead,
          followUpDate: kept.followUpDate || '',
          callDate:     kept.callDate     || '',
          notes:        newLead.notes     || kept.notes || '',
          activityLog:  kept.activityLog  || [],
        };
      }
    } else {
      pipelineData[targetMember].leads.push(newLead);
    }
    synced++;
  }

  const saved = await sbSet(PIPELINE_KEY, pipelineData);
  console.log('Saved to Supabase:', saved, 'synced:', synced);

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ ok: true, synced, total: allOpps.length, saved }),
  };
}
