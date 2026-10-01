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
      // v1.35 : Tâches LCA
      isLcaTasks:        m.is_lca_tasks === true,
      tLcaTasksStart:    fromISO(m.t_lca_tasks_start),
      lcaTasks:          Array.isArray(m.lca_tasks) ? m.lca_tasks : [],
      stops:  (m.stops  || []).map(stopFromStorage),
      pauses: Array.isArray(m.pauses) ? m.pauses : [],
    }));
  } catch (e) { console.warn('[Supabase] Mission load failed:', e.message); return []; }
}

// v1.24 — Sauvegarde de la mission. Le paramètre `opts` est conservé pour
// rétrocompatibilité mais ignoré : depuis la migration Storage, les photos
// ne sont plus en base64 dans `stops`, donc la colonne `stops` ne pèse plus
// que quelques Ko — l'upsert complet est désormais bon marché en IO.
// (L'optimisation `lightSync` v1.23 cassait les nouvelles missions car un
// UPDATE sur une ligne inexistante ne crée rien.)
async function saveMissionToSupabase(mission, opts) {
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
    // v1.08 — sauvegarder explicitement les timestamps d'état (indispensable pour
    // que le dashboard voie "En attente de notification / d'instructions / En route").
    if (Array.isArray(mission.pauses))             payload.pauses            = mission.pauses;
    if (mission.tDispatchNotified != null)         payload.tdispatchnotified = toISO(mission.tDispatchNotified);
    if (mission.tDispatchReceived != null)         payload.tdispatchreceived = toISO(mission.tDispatchReceived);
    if (typeof mission.isPaused === 'boolean')     payload.ispaused          = mission.isPaused;
    if (mission.tPauseStart != null)               payload.tpausestart       = toISO(mission.tPauseStart);
    // v1.35 : Tâches LCA — colonnes optionnelles (retry drop si absentes)
    if (typeof mission.isLcaTasks === 'boolean')   payload.is_lca_tasks       = mission.isLcaTasks;
    if (mission.tLcaTasksStart != null)            payload.t_lca_tasks_start  = toISO(mission.tLcaTasksStart);
    if (Array.isArray(mission.lcaTasks))           payload.lca_tasks          = mission.lcaTasks;

    // Retry robuste : si une colonne optionnelle n'existe pas encore dans la DB,
    // on l'enlève et on réessaie (jusqu'à épuisement des colonnes optionnelles).
    const OPT = ['pauses','tdispatchnotified','tdispatchreceived','ispaused','tpausestart','plate_remorque','is_lca_tasks','t_lca_tasks_start','lca_tasks'];
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
    // v1.25 : ajout attachmentUrl / attachmentType
    return (data || []).map(m => ({
      ...m,
      fromName:       m.fromName       || m.fromname       || '',
      toLabel:        m.toLabel        || m.tolabel        || '',
      attachmentUrl:  m.attachmentUrl  || m.attachment_url  || null,
      attachmentType: m.attachmentType || m.attachment_type || null,
      ts: fromISO(m.ts),
    }));
  } catch (e) { console.warn('[Supabase] Message load failed:', e.message); return []; }
}

async function saveMessageToSupabase(message) {
  if (!supabaseClient) return false;
  try {
    // v1.25 : payload avec attachment_* optionnels
    const payload = {
      id:       message.id,
      from:     message.from,
      fromname: message.fromName || '',
      to:       message.to,
      tolabel:  message.toLabel || '',
      text:     message.text || '',
      ts:       toISO(message.ts),
      read:     message.read || false
    };
    if (message.attachmentUrl)  payload.attachment_url  = message.attachmentUrl;
    if (message.attachmentType) payload.attachment_type = message.attachmentType;

    let { error } = await supabaseClient.from('messages').insert([payload]);
    if (error && /attachment_/i.test(error.message || '')) {
      delete payload.attachment_url;
      delete payload.attachment_type;
      const r = await supabaseClient.from('messages').insert([payload]);
      error = r.error;
    }
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
// v1.33 — BUREAU AUTH : hashage, sessions, brute-force protection
// ============================================================

const BUREAU_SALT = 'LCA-TRANSFERT-v1.33-SALT';   // salt fixe côté client
const BUREAU_SESSION_HOURS       = 2;              // durée session par défaut
const BUREAU_INACTIVITY_MINUTES  = 120;            // timeout inactivité
const BUREAU_MAX_FAILED_ATTEMPTS = 5;              // avant lock
const BUREAU_LOCK_MINUTES        = 30;             // durée du lock
const BUREAU_FAIL_WINDOW_MINUTES = 15;             // fenêtre de comptage des échecs
const BUREAU_COOKIE_NAME         = 'lca_bureau_session';

// Hash SHA-256 hex de (BUREAU_SALT + password) via Web Crypto natif.
// Aucune lib externe, marche sur tous les navigateurs modernes (dashboard = desktop).
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(BUREAU_SALT + String(password || ''));
  const hashBuf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Génère un token de session aléatoire cryptographiquement sûr (32 bytes → 64 hex chars)
function generateSessionToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Génère un mot de passe aléatoire fort (16 chars, alphanumérique + symboles)
function generateStrongPassword(length = 16) {
  const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!#$%&*+?';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < length; i++) out += charset[bytes[i] % charset.length];
  return out;
}

// Cookie helpers (utilisés pour le token de session bureau)
function setBureauCookie(token, hours = BUREAU_SESSION_HOURS) {
  const maxAge = Math.floor(hours * 3600);
  document.cookie = BUREAU_COOKIE_NAME + '=' + encodeURIComponent(token) +
    '; path=/; max-age=' + maxAge + '; SameSite=Lax';
}
function getBureauCookie() {
  const m = document.cookie.match(new RegExp('(?:^|;\\s*)' + BUREAU_COOKIE_NAME + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}
function clearBureauCookie() {
  document.cookie = BUREAU_COOKIE_NAME + '=; path=/; max-age=0; SameSite=Lax';
}

// Récupère l'user-agent + best-effort IP (l'IP réelle n'est pas dispo côté client,
// on log ce qu'on a — Supabase peut avoir accès au header X-Forwarded-For si besoin
// via une Edge Function, mais pour v1.33 on garde simple : IP = null).
function getClientContext() {
  return {
    ip: null,
    user_agent: (navigator && navigator.userAgent) ? navigator.userAgent.slice(0, 500) : ''
  };
}

// Log une tentative de connexion (succès ou échec) dans login_history
async function logLoginAttempt(username, success, reason) {
  if (!supabaseClient) return;
  try {
    const ctx = getClientContext();
    await supabaseClient.from('login_history').insert({
      username: username || '',
      success:  !!success,
      reason:   reason || (success ? 'ok' : 'unknown'),
      ip:       ctx.ip,
      user_agent: ctx.user_agent
    });
  } catch(e) { console.warn('[Auth] log attempt failed:', e.message); }
}

// v1.37.3 : tous les flux login / session passent désormais par des RPCs
// SECURITY DEFINER côté Postgres. Plus de SELECT direct sur bureau_accounts
// ou bureau_sessions côté client. Les hashes vivent dans bureau_credentials
// (table verrouillée, lecture impossible depuis le client).

// Récupération d'un compte bureau — utilisé uniquement pour l'affichage (sans mdp).
// Reste un SELECT sur bureau_accounts (plus de password_hash dedans).
async function getBureauAccountByUsername(username) {
  if (!supabaseClient || !username) return null;
  try {
    const { data, error } = await supabaseClient
      .from('bureau_accounts')
      .select('*')
      .eq('username', username)
      .limit(1);
    if (error) { console.warn('[Auth] fetch account:', error.message); return null; }
    return (data && data[0]) ? data[0] : null;
  } catch(e) { return null; }
}

// Tentative de login via l'RPC server-side (brute-force + session gérés en SQL).
async function attemptBureauLogin(username, password) {
  if (!supabaseClient) return { ok: false, reason: 'server_error' };
  try {
    const hash = await hashPassword(password);
    const ctx  = getClientContext();
    const { data, error } = await supabaseClient.rpc('attempt_bureau_login', {
      p_username: username, p_hash: hash, p_ip: ctx.ip, p_ua: ctx.user_agent
    });
    if (error) {
      console.warn('[Auth] attempt_bureau_login RPC:', error.message);
      return { ok: false, reason: 'server_error' };
    }
    if (!data || !data.ok) {
      return {
        ok: false,
        reason: (data && data.reason) || 'unknown',
        attempts_left: data && data.attempts_left,
        locked_until:  data && data.locked_until
      };
    }
    setBureauCookie(data.token);
    return { ok: true, session: { token: data.token, username: data.account.username, expires_at: data.expires_at }, account: data.account };
  } catch(e) {
    console.warn('[Auth] attempt_bureau_login exception:', e);
    return { ok: false, reason: 'server_error' };
  }
}

// Valide une session (via cookie) → RPC validate_bureau_session
async function validateBureauSession() {
  const token = getBureauCookie();
  if (!token) return { valid: false, reason: 'no_cookie' };
  if (!supabaseClient) return { valid: false, reason: 'supabase_not_ready' };
  try {
    const { data, error } = await supabaseClient.rpc('validate_bureau_session', {
      p_token: token,
      p_inactivity_minutes: BUREAU_INACTIVITY_MINUTES
    });
    if (error) {
      console.warn('[Auth] validate_bureau_session RPC:', error.message);
      return { valid: false, reason: 'server_error' };
    }
    if (!data || !data.valid) {
      clearBureauCookie();
      return { valid: false, reason: (data && data.reason) || 'invalid' };
    }
    return { valid: true, session: { token, expires_at: data.expires_at, username: data.account.username }, account: data.account };
  } catch(e) {
    console.warn('[Auth] validate exception:', e);
    return { valid: false, reason: 'server_error' };
  }
}

// Refresh last_activity de la session courante
async function touchBureauSession() {
  const token = getBureauCookie();
  if (!token || !supabaseClient) return;
  try { await supabaseClient.rpc('touch_bureau_session', { p_token: token }); } catch(e) {}
}

// Déconnexion : RPC end_bureau_session + clear cookie
async function endBureauSession() {
  const token = getBureauCookie();
  if (token && supabaseClient) {
    try { await supabaseClient.rpc('end_bureau_session', { p_token: token }); } catch(e) {}
  }
  clearBureauCookie();
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
// v1.33 : bureau auth helpers
window.hashPassword                   = hashPassword;
window.generateSessionToken           = generateSessionToken;
window.generateStrongPassword         = generateStrongPassword;
window.attemptBureauLogin             = attemptBureauLogin;
window.validateBureauSession          = validateBureauSession;
window.touchBureauSession             = touchBureauSession;
window.endBureauSession               = endBureauSession;
window.getBureauCookie                = getBureauCookie;  // v1.37.3 : exposé pour les RPCs CRUD
window.getBureauAccountByUsername     = getBureauAccountByUsername;
window.logLoginAttempt                = logLoginAttempt;
window.BUREAU_SALT                    = BUREAU_SALT;
window.BUREAU_INACTIVITY_MINUTES      = BUREAU_INACTIVITY_MINUTES;
window.BUREAU_MAX_FAILED_ATTEMPTS     = BUREAU_MAX_FAILED_ATTEMPTS;
// v1.13 : helpers de conversion timestamp pour la restauration de session
window.fromISO                        = fromISO;
window.stopFromStorage                = stopFromStorage;
// v1.23 : exposer l'URL pour la détection d'environnement (bandeau DEV)
window.SUPABASE_URL                   = SUPABASE_URL;
// v1.29 : exposer la anon key (pour appeler les Edge Functions depuis l'app)
//         et la clé publique VAPID (pour l'abonnement Web Push)
window.SUPABASE_ANON                  = SUPABASE_ANON;
window.VAPID_PUBLIC_KEY               = 'BOmlj45rRhgjl6fW_j0tvQPgwvxK23SKSWP8Cxa_GmqDHyuQD4U9OzeeBbp5kw2k-I0RTZz8WHfaAgQsLmkoFb8';

console.log('[Supabase] Functions registered globally');

if (typeof supabase !== 'undefined') {
  initSupabase().catch(e => console.warn('[Supabase] Init error:', e.message));
} else {
  console.error('[Supabase] Library still not loaded!');
}
