// ============================================================
// ⚠️ CONFIG DEV — POINTE SUR LE PROJET SUPABASE DE DÉVELOPPEMENT
// Ne PAS confondre avec le supabase_config.js de la prod !
// Ce fichier est destiné UNIQUEMENT au repo driver-app-dev.
// ============================================================
const SUPABASE_URL  = 'https://qkvnggcecmukogctfgsl.supabase.co';
const SUPABASE_ANON = 'sb_publishable_oBsmqpo8oQVi8gqyKMjI8A_r7fnSAzK';

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
      dayStartTs:        fromISO(m.daystartts),
      dayEndTs:          fromISO(m.dayendts),
      tDispatchNotified: fromISO(m.tdispatchnotified),
      tDispatchReceived: fromISO(m.tdispatchreceived),
      isPaused:          m.ispaused === true,
      tPauseStart:       fromISO(m.tpausestart),
      stops:  (m.stops  || []).map(stopFromStorage),
      pauses: Array.isArray(m.pauses) ? m.pauses : [],
    }));
  } catch (e) { console.warn('[Supabase] Mission load failed:', e.message); return []; }
}

// v1.23 : option `lightSync` — quand true, n'écrit PAS la colonne `stops`
// (qui contient les photos CMR base64). Économise plusieurs MB d'IO disque
// à chaque appel. Les autres colonnes (timestamps d'état, completed, etc.)
// sont mises à jour normalement via UPDATE ciblé.
// À n'utiliser QUE pour les sync intermédiaires (syncActive). Les flux qui
// modifient les stops (doDoc, end of mission) doivent appeler sans lightSync.
async function saveMissionToSupabase(mission, opts) {
  if (!supabaseClient) return false;
  const lightSync = !!(opts && opts.lightSync);
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
    // v1.08 — sauvegarder explicitement les timestamps d'état (indispensable pour
    // que le dashboard voie "En attente de notification / d'instructions / En route").
    if (Array.isArray(mission.pauses))             payload.pauses            = mission.pauses;
    if (mission.tDispatchNotified != null)         payload.tdispatchnotified = toISO(mission.tDispatchNotified);
    if (mission.tDispatchReceived != null)         payload.tdispatchreceived = toISO(mission.tDispatchReceived);
    if (typeof mission.isPaused === 'boolean')     payload.ispaused          = mission.isPaused;
    if (mission.tPauseStart != null)               payload.tpausestart       = toISO(mission.tPauseStart);

    // v1.23 — lightSync : ne pas réécrire la colonne stops (lourde, contient
    // les photos base64). On UPDATE uniquement les colonnes légères.
    // En cas d'échec (ligne inexistante par ex.), on retombe sur l'upsert complet.
    if (lightSync) {
      const { stops: _heavy, ...lightPayload } = payload;
      const { error: lightErr } = await supabaseClient
        .from('missions').update(lightPayload).eq('id', mission.id);
      if (!lightErr) {
        console.log('[Supabase] ✅ lightSync', Math.round(JSON.stringify(lightPayload).length/1024), 'KB');
        return true;
      }
      console.warn('[Supabase] lightSync échec, fallback upsert complet:', lightErr.message);
    }

    // Retry robuste : si une colonne optionnelle n'existe pas encore dans la DB,
    // on l'enlève et on réessaie (jusqu'à épuisement des colonnes optionnelles).
    const OPT = ['pauses','tdispatchnotified','tdispatchreceived','ispaused','tpausestart','plate_remorque'];
    let attempt = 0;
    let error;
    while (attempt < OPT.length + 1) {
      const r = await supabaseClient.from('missions').upsert([payload], { onConflict: 'id' });
      error = r.error;
      if (!error) break;
      const msg = error.message || '';
      const col = OPT.find(c => c in payload && (msg.includes(`"${c}"`) || new RegExp(`column.*${c}|${c}.*column`, 'i').test(msg)));
      if (!col) break;
      console.warn('[Supabase] colonne manquante, retry sans:', col);
      delete payload[col];
      attempt++;
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
// LOCATIONS — Supabase Functions (v1.11)
// ============================================================

async function loadLocationsFromSupabase() {
  if (!supabaseClient) return [];
  try {
    const { data, error } = await supabaseClient.from('locations').select('*').order('name');
    if (error) { console.warn('[Supabase] Error loading locations:', error.message); return []; }
    return data || [];
  } catch (e) { console.warn('[Supabase] Locations load failed:', e.message); return []; }
}

async function loadActiveLocationsFromSupabase() {
  if (!supabaseClient) return [];
  try {
    const { data, error } = await supabaseClient.from('locations').select('*').eq('active', true).order('name');
    if (error) return [];
    return data || [];
  } catch (e) { return []; }
}

async function saveLocationToSupabase(location) {
  if (!supabaseClient) return false;
  try {
    const { error } = await supabaseClient.from('locations').upsert([location], { onConflict: 'name' });
    if (error) { console.warn('[Supabase] Error saving location:', error.message); return false; }
    return true;
  } catch (e) { return false; }
}

async function deleteLocationFromSupabase(name) {
  if (!supabaseClient) return false;
  try {
    const { error } = await supabaseClient.from('locations').delete().eq('name', name);
    return !error;
  } catch (e) { return false; }
}

async function toggleLocationActiveStatus(name, active) {
  if (!supabaseClient) return false;
  try {
    const { error } = await supabaseClient.from('locations').update({ active }).eq('name', name);
    if (error) { console.warn('[Supabase] Error toggling location:', error.message); return false; }
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
// v1.11 : locations
window.loadLocationsFromSupabase       = loadLocationsFromSupabase;
window.loadActiveLocationsFromSupabase = loadActiveLocationsFromSupabase;
window.saveLocationToSupabase          = saveLocationToSupabase;
window.deleteLocationFromSupabase      = deleteLocationFromSupabase;
window.toggleLocationActiveStatus      = toggleLocationActiveStatus;
window.initSupabase                   = initSupabase;
window.supabaseClient                 = supabaseClient;
// v1.13 : helpers de conversion timestamp pour la restauration de session
window.fromISO                        = fromISO;
window.stopFromStorage                = stopFromStorage;

console.log('[Supabase] Functions registered globally');

if (typeof supabase !== 'undefined') {
  initSupabase().catch(e => console.warn('[Supabase] Init error:', e.message));
} else {
  console.error('[Supabase] Library still not loaded!');
}
