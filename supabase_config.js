const SUPABASE_URL  = 'https://pwaoxghgitobsxuiqlut.supabase.co';
const SUPABASE_ANON = 'sb_publishable_biUSd_hIHmFdN0egFbyNCQ_MoTcNrdc';

console.log('[Supabase] Initializing with URL:', SUPABASE_URL);

if (typeof supabase === 'undefined') {
  console.error('[Supabase] Library not loaded! CDN script may have failed.');
} else {
  console.log('[Supabase] Library loaded successfully');
}

let supabaseClient = null;
try {
  supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
  console.log('[Supabase] Client created successfully');
} catch (e) {
  console.error('[Supabase] Failed to create client:', e.message);
}

// ============================================================
// UTILS — conversion timestamps
// ============================================================

function toISO(val) {
  if (!val) return null;
  if (typeof val === 'string') return val;
  return new Date(val).toISOString();
}

function fromISO(val) {
  if (!val) return null;
  if (typeof val === 'number') return val;
  return new Date(val).getTime();
}

function stopToStorage(stop) {
  if (!stop) return stop;
  return {
    ...stop,
    tArrival:      toISO(stop.tArrival),
    tDockAssigned: toISO(stop.tDockAssigned),
    tDockReady:    toISO(stop.tDockReady),
    tOpsStart:     toISO(stop.tOpsStart),
    tOpsEnd:       toISO(stop.tOpsEnd),
    tDoc:          toISO(stop.tDoc),
    tDepart:       toISO(stop.tDepart),
  };
}

function stopFromStorage(stop) {
  if (!stop) return stop;
  return {
    ...stop,
    tArrival:      fromISO(stop.tArrival),
    tDockAssigned: fromISO(stop.tDockAssigned),
    tDockReady:    fromISO(stop.tDockReady),
    tOpsStart:     fromISO(stop.tOpsStart),
    tOpsEnd:       fromISO(stop.tOpsEnd),
    tDoc:          fromISO(stop.tDoc),
    tDepart:       fromISO(stop.tDepart),
  };
}

// ============================================================
// MISSIONS — Supabase Functions
// ============================================================

async function loadMissionsFromSupabase() {
  if (!supabaseClient) return [];
  try {
    const { data, error } = await supabaseClient
      .from('missions')
      .select('*')
      .order('daystartts', { ascending: false });
    if (error) { console.warn('[Supabase] Error loading missions:', error.message); return []; }
    return (data || []).map(m => ({
      ...m,
      dayStartTs: fromISO(m.daystartts),
      dayEndTs:   fromISO(m.dayendts),
      stops:  (m.stops  || []).map(stopFromStorage),
      pauses: Array.isArray(m.pauses) ? m.pauses : [],
    }));
  } catch (e) { console.warn('[Supabase] Mission load failed:', e.message); return []; }
}

async function saveMissionToSupabase(mission) {
  if (!supabaseClient) return false;
  try {
    const payload = {
      id:             mission.id,
      driver:         mission.driver,
      plate:          mission.plateTracteur || mission.plate || '',
      plate_remorque: mission.plateRemorque || mission.plate_remorque || '',
      date:           mission.date,
      daystartts:     toISO(mission.dayStartTs),
      dayendts:       toISO(mission.dayEndTs),
      completed:      mission.completed || false,
      stops:          (mission.stops || []).map(stopToStorage),
      updatedat:      new Date().toISOString()
    };
    // Inclure les pauses si disponibles (colonne ajoutée par la migration v1.02)
    if (Array.isArray(mission.pauses)) payload.pauses = mission.pauses;
    let { error } = await supabaseClient
      .from('missions')
      .upsert([payload], { onConflict: 'id' });
    // Retry sans le champ pauses si la colonne n'existe pas encore
    if (error && 'pauses' in payload && /column.+pauses|pauses.+column/i.test(error.message || '')) {
      delete payload.pauses;
      const retry = await supabaseClient.from('missions').upsert([payload], { onConflict: 'id' });
      error = retry.error;
    }
    if (error) { console.error('[Supabase] Error saving mission:', error.message); return false; }
    console.log('[Supabase] ✅ Mission saved');
    return true;
  } catch (e) { console.error('[Supabase] Mission save exception:', e.message); return false; }
}

// ============================================================
// MESSAGES — Supabase Functions
// ============================================================

async function loadMessagesFromSupabase() {
  if (!supabaseClient) return [];
  try {
    const { data, error } = await supabaseClient
      .from('messages')
      .select('*')
      .order('ts', { ascending: true });
    if (error) { console.warn('[Supabase] Error loading messages:', error.message); return []; }
    // Normalise snake_case DB columns (fromname, tolabel) → camelCase JS (fromName, toLabel)
    return (data || []).map(m => ({
      ...m,
      fromName: m.fromName || m.fromname || '',
      toLabel:  m.toLabel  || m.tolabel  || '',
      ts: fromISO(m.ts),
    }));
  } catch (e) { console.warn('[Supabase] Message load failed:', e.message); return []; }
}

async function saveMessageToSupabase(message) {
  if (!supabaseClient) return false;
  try {
    const { error } = await supabaseClient
      .from('messages')
      .insert([{
        id:       message.id,
        from:     message.from,
        fromname: message.fromName || '',
        to:       message.to,
        tolabel:  message.toLabel || '',
        text:     message.text,
        ts:       toISO(message.ts),
        read:     message.read || false
      }]);
    if (error) { console.error('[Supabase] Error saving message:', error.message); return false; }
    return true;
  } catch (e) { return false; }
}

async function updateMessageReadStatus(messageId, read) {
  if (!supabaseClient) return false;
  try {
    const { error } = await supabaseClient.from('messages').update({ read }).eq('id', messageId);
    return !error;
  } catch (e) { return false; }
}

// ============================================================
// VEHICLES — Supabase Functions
// ============================================================

async function loadVehiclesFromSupabase(type) {
  if (!supabaseClient) return [];
  try {
    let query = supabaseClient.from('vehicles').select('*').order('plate');
    if (type) query = query.eq('type', type);
    const { data, error } = await query;
    if (error) { console.warn('[Supabase] Error loading vehicles:', error.message); return []; }
    return data || [];
  } catch (e) { return []; }
}

async function loadActiveVehiclesFromSupabase(type) {
  if (!supabaseClient) return [];
  try {
    let query = supabaseClient.from('vehicles').select('*').eq('active', true).order('plate');
    if (type) query = query.eq('type', type);
    const { data, error } = await query;
    if (error) return [];
    return data || [];
  } catch (e) { return []; }
}

async function saveVehicleToSupabase(vehicle) {
  if (!supabaseClient) return false;
  try {
    const { error } = await supabaseClient.from('vehicles').upsert([vehicle], { onConflict: 'plate' });
    return !error;
  } catch (e) { return false; }
}

async function deleteVehicleFromSupabase(plate) {
  if (!supabaseClient) return false;
  try {
    const { error } = await supabaseClient.from('vehicles').delete().eq('plate', plate);
    return !error;
  } catch (e) { return false; }
}

async function toggleVehicleActiveStatus(plate, active) {
  if (!supabaseClient) return false;
  try {
    const { error } = await supabaseClient.from('vehicles').update({ active }).eq('plate', plate);
    if (error) { console.warn('[Supabase] Error toggling vehicle:', error.message); return false; }
    return true;
  } catch (e) { return false; }
}

// ============================================================
// DRIVER ACCOUNTS — Supabase Functions
// ============================================================

async function loadDriverAccountsFromSupabase() {
  if (!supabaseClient) return [];
  try {
    const { data, error } = await supabaseClient.from('driver_accounts').select('*');
    if (error) { console.warn('[Supabase] Error loading accounts:', error.message); return []; }
    return data || [];
  } catch (e) { return []; }
}

// ============================================================
// Initialization
// ============================================================

async function initSupabase() {
  console.log('[Supabase] Starting initialization...');
  const sbMissions = await loadMissionsFromSupabase();
  const sbMessages = await loadMessagesFromSupabase();
  if (sbMissions.length > 0) { window.missionsFromSupabase = sbMissions; }
  if (sbMessages.length > 0) { window.messagesFromSupabase = sbMessages; }
  console.log('[Supabase] Initialization complete');
  window._supabaseReady = true;
}

// Expose globally
window.saveMissionToSupabase          = saveMissionToSupabase;
window.saveMessageToSupabase          = saveMessageToSupabase;
window.updateMessageReadStatus        = updateMessageReadStatus;
window.loadMissionsFromSupabase       = loadMissionsFromSupabase;
window.loadMessagesFromSupabase       = loadMessagesFromSupabase;
window.loadVehiclesFromSupabase       = loadVehiclesFromSupabase;
window.loadActiveVehiclesFromSupabase = loadActiveVehiclesFromSupabase;
window.saveVehicleToSupabase          = saveVehicleToSupabase;
window.deleteVehicleFromSupabase      = deleteVehicleFromSupabase;
window.toggleVehicleActiveStatus      = toggleVehicleActiveStatus;
window.loadDriverAccountsFromSupabase = loadDriverAccountsFromSupabase;
window.initSupabase                   = initSupabase;
window.supabaseClient                 = supabaseClient;

console.log('[Supabase] Functions registered globally');

if (typeof supabase !== 'undefined') {
  initSupabase().catch(e => console.warn('[Supabase] Init error:', e.message));
} else {
  console.error('[Supabase] Library still not loaded!');
}
