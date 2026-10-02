// ============================================================
// ⚠️ CONFIG DEV — POINTE SUR LE PROJET SUPABASE DE DÉVELOPPEMENT
// Ne PAS confondre avec le supabase_config.js de la prod !
// Ce fichier est destiné UNIQUEMENT au repo driver-app-dev.
// ============================================================
// v1.38.0 — Phase 4.5a : refonte complète sur Supabase Auth
//
// Changements majeurs :
//   - Plus de hashPassword SHA-256 custom, plus de BUREAU_SALT.
//   - Plus de cookies de session maison (bureau/driver).
//   - Plus de token transmis manuellement en paramètre des RPCs.
//   - Toute l'auth passe par supabase.auth (JWT standard).
//   - Toutes les écritures passent par les RPCs _v2 qui lisent auth.uid().
//
// L'API publique garde le même nom (attemptBureauLogin, verifyDriverLogin,
// saveMissionToSupabase, etc.) pour éviter de casser les appelants, mais le
// corps est entièrement réécrit.
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
  supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storage: window.localStorage
    }
  });
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
  return { ...stop,
    tArrival: toISO(stop.tArrival), tDockAssigned: toISO(stop.tDockAssigned),
    tDockReady: toISO(stop.tDockReady), tOpsStart: toISO(stop.tOpsStart),
    tOpsEnd: toISO(stop.tOpsEnd), tDoc: toISO(stop.tDoc), tDepart: toISO(stop.tDepart) };
}
function stopFromStorage(stop) {
  if (!stop) return stop;
  return { ...stop,
    tArrival: fromISO(stop.tArrival), tDockAssigned: fromISO(stop.tDockAssigned),
    tDockReady: fromISO(stop.tDockReady), tOpsStart: fromISO(stop.tOpsStart),
    tOpsEnd: fromISO(stop.tOpsEnd), tDoc: fromISO(stop.tDoc), tDepart: fromISO(stop.tDepart) };
}

// ============================================================
// MISSIONS — reads via SELECT, writes via RPC _v2
// ============================================================
async function loadMissionsFromSupabase() {
  if (!supabaseClient) return [];
  try {
    const { data, error } = await supabaseClient.from('missions').select('*').order('daystartts', { ascending: false });
    if (error) { console.warn('[Supabase] Error loading missions:', error.message); return []; }
    return (data || []).map(m => ({
      ...m,
      dayStartTs: fromISO(m.daystartts), dayEndTs: fromISO(m.dayendts),
      tDispatchNotified: fromISO(m.tdispatchnotified), tDispatchReceived: fromISO(m.tdispatchreceived),
      isPaused: m.ispaused === true, tPauseStart: fromISO(m.tpausestart),
      isLcaTasks: m.is_lca_tasks === true, tLcaTasksStart: fromISO(m.t_lca_tasks_start),
      lcaTasks: Array.isArray(m.lca_tasks) ? m.lca_tasks : [],
      stops: (m.stops || []).map(stopFromStorage),
      pauses: Array.isArray(m.pauses) ? m.pauses : [],
    }));
  } catch (e) { console.warn('[Supabase] Mission load failed:', e.message); return []; }
}

async function saveMissionToSupabase(mission, opts) {
  if (!supabaseClient) return false;
  try {
    const payload = {
      id: mission.id,
      plate: mission.plateTracteur || mission.plate || '',
      plate_remorque: mission.plateRemorque || mission.plate_remorque || '',
      date: mission.date,
      daystartts: toISO(mission.dayStartTs),
      dayendts: toISO(mission.dayEndTs),
      completed: mission.completed || false,
      stops: (mission.stops || []).map(stopToStorage),
    };
    if (Array.isArray(mission.pauses))             payload.pauses            = mission.pauses;
    if (mission.tDispatchNotified != null)         payload.tdispatchnotified = toISO(mission.tDispatchNotified);
    if (mission.tDispatchReceived != null)         payload.tdispatchreceived = toISO(mission.tDispatchReceived);
    if (typeof mission.isPaused === 'boolean')     payload.ispaused          = mission.isPaused;
    if (mission.tPauseStart != null)               payload.tpausestart       = toISO(mission.tPauseStart);
    if (typeof mission.isLcaTasks === 'boolean')   payload.is_lca_tasks       = mission.isLcaTasks;
    if (mission.tLcaTasksStart != null)            payload.t_lca_tasks_start  = toISO(mission.tLcaTasksStart);
    if (Array.isArray(mission.lcaTasks))           payload.lca_tasks          = mission.lcaTasks;

    const { data, error } = await supabaseClient.rpc('driver_save_mission_v2', { p_payload: payload });
    if (error) { console.error('[Supabase] driver_save_mission_v2:', error.message); return false; }
    if (!data || !data.ok) { console.error('[Supabase] driver_save_mission_v2 refused:', data && data.reason); return false; }
    console.log('[Supabase] ✅ Mission saved (id=' + data.id + ')');
    return true;
  } catch (e) { console.error('[Supabase] Mission save exception:', e.message); return false; }
}

// ============================================================
// MESSAGES — reads via SELECT, writes via RPC _v2
// ============================================================
async function loadMessagesFromSupabase() {
  if (!supabaseClient) return [];
  try {
    const { data, error } = await supabaseClient.from('messages').select('*').order('ts', { ascending: true });
    if (error) { console.warn('[Supabase] Error loading messages:', error.message); return []; }
    return (data || []).map(m => ({
      ...m,
      fromName: m.fromName || m.fromname || '',
      toLabel: m.toLabel || m.tolabel || '',
      attachmentUrl: m.attachmentUrl || m.attachment_url || null,
      attachmentType: m.attachmentType || m.attachment_type || null,
      ts: fromISO(m.ts),
    }));
  } catch (e) { console.warn('[Supabase] Message load failed:', e.message); return []; }
}

async function saveMessageToSupabase(message) {
  if (!supabaseClient) return false;
  // Détection auto chauffeur vs bureau selon le role du profile courant
  const prof = await _getCurrentProfile();
  if (!prof) { console.warn('[Supabase] saveMessage : non authentifié'); return false; }
  const isBureau = ['operations','admin','super_admin'].includes(prof.role);
  const rpcName = isBureau ? 'bureau_send_message_v2' : 'driver_send_message_v2';
  try {
    const { data, error } = await supabaseClient.rpc(rpcName, {
      p_client_id:       message.id || null,
      p_to:              message.to || null,
      p_tolabel:         message.toLabel || null,
      p_text:            message.text || '',
      p_attachment_url:  message.attachmentUrl || null,
      p_attachment_type: message.attachmentType || null
    });
    if (error) { console.error('[Supabase] ' + rpcName + ':', error.message); return false; }
    if (!data || !data.ok) { console.error('[Supabase] ' + rpcName + ' refused:', data && data.reason); return false; }
    return true;
  } catch (e) { console.error('[Supabase] saveMessage exception:', e); return false; }
}

async function updateMessageReadStatus(messageId, read) {
  if (!supabaseClient || !read) return true;  // on ne « dé-marque » jamais
  try {
    const { error } = await supabaseClient.rpc('mark_messages_read', { p_ids: [messageId] });
    return !error;
  } catch (e) { return false; }
}

// ============================================================
// VEHICLES — reads via SELECT, writes via RPC _v2
// ============================================================
async function loadVehiclesFromSupabase(type) {
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
    const { data, error } = await supabaseClient.rpc('vehicles_upsert_v2', { p_payload: vehicle });
    return !error && data && data.ok;
  } catch (e) { return false; }
}
async function deleteVehicleFromSupabase(plate) {
  if (!supabaseClient) return false;
  try {
    const { data, error } = await supabaseClient.rpc('vehicles_delete_v2', { p_plate: plate });
    return !error && data && data.ok;
  } catch (e) { return false; }
}
async function toggleVehicleActiveStatus(plate, active) {
  if (!supabaseClient) return false;
  try {
    const { data, error } = await supabaseClient.rpc('vehicles_toggle_v2', { p_plate: plate, p_active: active });
    if (error) { console.warn('[Supabase] Error toggling vehicle:', error.message); return false; }
    return !!(data && data.ok);
  } catch (e) { return false; }
}

// ============================================================
// LOCATIONS
// ============================================================
async function loadLocationsFromSupabase() {
  if (!supabaseClient) return [];
  try {
    const { data } = await supabaseClient.from('locations').select('*').order('name');
    return data || [];
  } catch (e) { return []; }
}
async function loadActiveLocationsFromSupabase() {
  if (!supabaseClient) return [];
  try {
    const { data } = await supabaseClient.from('locations').select('*').eq('active', true).order('name');
    return data || [];
  } catch (e) { return []; }
}

// ============================================================
// AUTH — Phase 4.5a : tout passe par supabase.auth
// Les anciennes API (attemptBureauLogin, verifyDriverLogin, etc.) sont
// conservées pour que les callers (index.html / dashboard.html) n'aient
// qu'un minimum de changements.
// ============================================================

const DRIVER_EMAIL_DOMAIN = 'drivers.liegecargo.local';
const BUREAU_EMAIL_DOMAIN = 'bureau.liegecargo.local';
const BUREAU_INACTIVITY_MINUTES = 120;

function _usernameToEmail(username, isBureau) {
  const lower = String(username || '').trim().toLowerCase();
  return lower + '@' + (isBureau ? BUREAU_EMAIL_DOMAIN : DRIVER_EMAIL_DOMAIN);
}

async function _getCurrentProfile() {
  if (!supabaseClient) return null;
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return null;
    const { data, error } = await supabaseClient.rpc('me');
    if (error || !data) return null;
    return data;
  } catch (e) { return null; }
}

async function _attemptLogin(username, password, isBureau) {
  if (!supabaseClient) return { ok: false, reason: 'server_error' };
  if (!username || !password) return { ok: false, reason: 'missing_credentials' };
  try {
    const email = _usernameToEmail(username, isBureau);
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) {
      const msg = (error.message || '').toLowerCase();
      if (msg.includes('invalid login') || msg.includes('invalid credentials'))
        return { ok: false, reason: 'bad_password' };
      if (msg.includes('user not found')) return { ok: false, reason: 'unknown_user' };
      if (msg.includes('email not confirmed')) return { ok: false, reason: 'account_disabled' };
      return { ok: false, reason: 'server_error', detail: error.message };
    }
    if (!data || !data.user || !data.session) return { ok: false, reason: 'server_error' };

    const { data: prof, error: pErr } = await supabaseClient.rpc('me');
    if (pErr || !prof) {
      await supabaseClient.auth.signOut();
      return { ok: false, reason: 'profile_missing' };
    }
    if (prof.is_active === false) {
      await supabaseClient.auth.signOut();
      return { ok: false, reason: 'account_disabled' };
    }
    const isBureauRole = ['operations','admin','super_admin'].includes(prof.role);
    if (isBureau && !isBureauRole) {
      await supabaseClient.auth.signOut();
      return { ok: false, reason: 'wrong_role' };
    }
    if (!isBureau && prof.role !== 'driver') {
      await supabaseClient.auth.signOut();
      return { ok: false, reason: 'wrong_role' };
    }
    return { ok: true, session: data.session, account: prof, profile: prof };
  } catch (e) {
    console.warn('[auth] exception:', e);
    return { ok: false, reason: 'server_error' };
  }
}

// ---- Bureau API (compat) ----
async function attemptBureauLogin(username, password) {
  return await _attemptLogin(username, password, true);
}
async function validateBureauSession() {
  const prof = await _getCurrentProfile();
  if (!prof) return { valid: false, reason: 'no_session' };
  const isBureauRole = ['operations','admin','super_admin'].includes(prof.role);
  if (!isBureauRole) return { valid: false, reason: 'wrong_role' };
  if (prof.is_active === false) {
    await supabaseClient.auth.signOut();
    return { valid: false, reason: 'account_disabled' };
  }
  const { data: { session } } = await supabaseClient.auth.getSession();
  return { valid: true, session, account: prof };
}
async function touchBureauSession() {
  // Supabase Auth gère son propre refresh automatiquement, rien à faire.
}
async function endBureauSession() {
  if (supabaseClient) try { await supabaseClient.auth.signOut(); } catch(e) {}
}

// ---- Driver API (compat) ----
async function verifyDriverLogin(username, password) {
  const r = await _attemptLogin(username, password, false);
  if (!r.ok) return { ok: false, reachable: true, reason: r.reason };
  return { ok: true, reachable: true, account: {
    username:    r.profile.username,
    fullname:    r.profile.fullname,
    pdf_allowed: r.profile.pdf_allowed,
    entity:      r.profile.entity
  } };
}
async function validateDriverSession() {
  const prof = await _getCurrentProfile();
  if (!prof) return { valid: false, reason: 'no_session' };
  if (prof.role !== 'driver') return { valid: false, reason: 'wrong_role' };
  if (prof.is_active === false) {
    await supabaseClient.auth.signOut();
    return { valid: false, reason: 'account_disabled' };
  }
  return { valid: true, account: prof };
}
async function endDriverSession() {
  if (supabaseClient) try { await supabaseClient.auth.signOut(); } catch(e) {}
}

// ============================================================
// Helpers divers encore utilisés
// ============================================================
function generateStrongPassword(length = 16) {
  const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!#$%&*+?';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < length; i++) out += charset[bytes[i] % charset.length];
  return out;
}

// ============================================================
// Admin ops — appel aux Edge Functions avec JWT
// ============================================================
async function _authedFetch(path, bodyObj) {
  if (!supabaseClient) throw new Error('server_not_ready');
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) throw new Error('not_authenticated');
  const r = await fetch(SUPABASE_URL + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session.access_token },
    body: JSON.stringify(bodyObj)
  });
  return await r.json();
}
async function adminCreateUser(payload) { return await _authedFetch('/functions/v1/admin-create-user', payload); }
async function adminUserOps(payload)    { return await _authedFetch('/functions/v1/admin-user-ops', payload); }

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

// ============================================================
// Expose globally
// ============================================================
window.supabaseClient                 = supabaseClient;
window.loadMissionsFromSupabase       = loadMissionsFromSupabase;
window.saveMissionToSupabase          = saveMissionToSupabase;
window.loadMessagesFromSupabase       = loadMessagesFromSupabase;
window.saveMessageToSupabase          = saveMessageToSupabase;
window.updateMessageReadStatus        = updateMessageReadStatus;
window.loadVehiclesFromSupabase       = loadVehiclesFromSupabase;
window.saveVehicleToSupabase          = saveVehicleToSupabase;
window.deleteVehicleFromSupabase      = deleteVehicleFromSupabase;
window.toggleVehicleActiveStatus      = toggleVehicleActiveStatus;
window.loadLocationsFromSupabase      = loadLocationsFromSupabase;
window.loadActiveLocationsFromSupabase = loadActiveLocationsFromSupabase;
// Auth compat
window.attemptBureauLogin             = attemptBureauLogin;
window.validateBureauSession          = validateBureauSession;
window.touchBureauSession             = touchBureauSession;
window.endBureauSession               = endBureauSession;
window.verifyDriverLogin              = verifyDriverLogin;
window.validateDriverSession          = validateDriverSession;
window.endDriverSession               = endDriverSession;
// Admin
window.adminCreateUser                = adminCreateUser;
window.adminUserOps                   = adminUserOps;
// Helpers
window.generateStrongPassword         = generateStrongPassword;
window.BUREAU_INACTIVITY_MINUTES      = BUREAU_INACTIVITY_MINUTES;
window.fromISO                        = fromISO;
window.stopFromStorage                = stopFromStorage;
window.SUPABASE_URL                   = SUPABASE_URL;
window.SUPABASE_ANON                  = SUPABASE_ANON;
window.VAPID_PUBLIC_KEY               = 'BOmlj45rRhgjl6fW_j0tvQPgwvxK23SKSWP8Cxa_GmqDHyuQD4U9OzeeBbp5kw2k-I0RTZz8WHfaAgQsLmkoFb8';

console.log('[Supabase] v1.38.0 — Phase 4.5a : fonctions enregistrées');

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSupabase);
} else {
  initSupabase();
}
