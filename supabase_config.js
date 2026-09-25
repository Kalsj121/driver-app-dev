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

// Fetch le compte bureau — retourne null si inconnu ou verrouillé/inactif
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

// Tentative de login — retourne { ok: bool, reason: string, session: object|null }
async function attemptBureauLogin(username, password) {
  const acc = await getBureauAccountByUsername(username);
  if (!acc) {
    await logLoginAttempt(username, false, 'unknown_user');
    return { ok: false, reason: 'unknown_user' };
  }
  if (!acc.is_active) {
    await logLoginAttempt(username, false, 'account_disabled');
    return { ok: false, reason: 'account_disabled' };
  }
  // Compte verrouillé encore ?
  if (acc.locked_until && new Date(acc.locked_until).getTime() > Date.now()) {
    await logLoginAttempt(username, false, 'account_locked');
    return { ok: false, reason: 'account_locked', locked_until: acc.locked_until };
  }
  const hash = await hashPassword(password);
  if (hash !== acc.password_hash) {
    // Incrément compteur d'échec + éventuel lock
    const newAttempts = (acc.failed_attempts || 0) + 1;
    const update = { failed_attempts: newAttempts, updated_at: new Date().toISOString() };
    if (newAttempts >= BUREAU_MAX_FAILED_ATTEMPTS) {
      update.locked_until = new Date(Date.now() + BUREAU_LOCK_MINUTES * 60000).toISOString();
      update.failed_attempts = 0; // reset compteur pendant le lock
    }
    await supabaseClient.from('bureau_accounts').update(update).eq('id', acc.id);
    await logLoginAttempt(username, false, 'bad_password');
    return {
      ok: false,
      reason: newAttempts >= BUREAU_MAX_FAILED_ATTEMPTS ? 'account_locked' : 'bad_password',
      attempts_left: Math.max(0, BUREAU_MAX_FAILED_ATTEMPTS - newAttempts)
    };
  }
  // Auth OK → créer session
  const token = generateSessionToken();
  const now   = new Date();
  const exp   = new Date(now.getTime() + BUREAU_SESSION_HOURS * 3600 * 1000);
  const ctx   = getClientContext();
  try {
    await supabaseClient.from('bureau_sessions').insert({
      token,
      username: acc.username,
      created_at: now.toISOString(),
      expires_at: exp.toISOString(),
      last_activity: now.toISOString(),
      ip: ctx.ip,
      user_agent: ctx.user_agent
    });
    await supabaseClient.from('bureau_accounts').update({
      failed_attempts: 0, locked_until: null,
      last_login: now.toISOString(),
      updated_at: now.toISOString()
    }).eq('id', acc.id);
    await logLoginAttempt(username, true, 'ok');
    setBureauCookie(token);
    return { ok: true, session: { token, username: acc.username, expires_at: exp.toISOString() }, account: acc };
  } catch(e) {
    console.warn('[Auth] session create failed:', e.message);
    return { ok: false, reason: 'server_error' };
  }
}

// Valide une session (via cookie). Retourne { valid, account } ou { valid: false, reason }.
async function validateBureauSession() {
  const token = getBureauCookie();
  if (!token) return { valid: false, reason: 'no_cookie' };
  if (!supabaseClient) return { valid: false, reason: 'supabase_not_ready' };
  try {
    const { data: sessions } = await supabaseClient
      .from('bureau_sessions')
      .select('*')
      .eq('token', token)
      .limit(1);
    if (!sessions || !sessions.length) { clearBureauCookie(); return { valid: false, reason: 'unknown_token' }; }
    const s = sessions[0];
    const now = Date.now();
    const expiresAt = new Date(s.expires_at).getTime();
    if (expiresAt < now) {
      await supabaseClient.from('bureau_sessions').delete().eq('token', token);
      clearBureauCookie();
      return { valid: false, reason: 'expired' };
    }
    // Timeout d'inactivité
    const lastActivity = new Date(s.last_activity || s.created_at).getTime();
    const inactivityMs = BUREAU_INACTIVITY_MINUTES * 60 * 1000;
    if ((now - lastActivity) > inactivityMs) {
      await supabaseClient.from('bureau_sessions').delete().eq('token', token);
      clearBureauCookie();
      return { valid: false, reason: 'inactivity_timeout' };
    }
    // Session OK — récup account
    const acc = await getBureauAccountByUsername(s.username);
    if (!acc || !acc.is_active) {
      await supabaseClient.from('bureau_sessions').delete().eq('token', token);
      clearBureauCookie();
      return { valid: false, reason: 'account_disabled' };
    }
    return { valid: true, session: s, account: acc };
  } catch(e) {
    console.warn('[Auth] validate session:', e.message);
    return { valid: false, reason: 'server_error' };
  }
}

// Refresh last_activity de la session courante (throttled côté appelant)
async function touchBureauSession() {
  const token = getBureauCookie();
  if (!token || !supabaseClient) return;
  try {
    await supabaseClient.from('bureau_sessions')
      .update({ last_activity: new Date().toISOString() })
      .eq('token', token);
  } catch(e) {}
}

// Déconnexion : delete session + clear cookie
async function endBureauSession() {
  const token = getBureauCookie();
  if (token && supabaseClient) {
    try { await supabaseClient.from('bureau_sessions').delete().eq('token', token); } catch(e) {}
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
