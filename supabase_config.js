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

// Convertit un timestamp Unix (ms) ou une valeur déjà ISO en TIMESTAMPTZ ISO
// Retourne null si la valeur est absente/nulle
function toISO(val) {
  if (!val) return null;
  // Déjà une string ISO (ex: "2026-03-25T23:25:13.000Z")
  if (typeof val === 'string') return val;
  // Unix ms (number)
  return new Date(val).toISOString();
}

// Convertit une TIMESTAMPTZ Supabase (string ISO) en Unix ms
// pour que le reste du code JS continue à fonctionner avec des timestamps ms
function fromISO(val) {
  if (!val) return null;
  if (typeof val === 'number') return val;
  return new Date(val).getTime();
}

// Convertit tous les timestamps d'un stop (JSONB) de ms → ISO pour le stockage
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

// Reconvertit un stop stocké (ISO) en timestamps ms pour le JS
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
  if (!supabaseClient) {
    console.warn('[Supabase] Client not initialized for loading missions');
    return [];
  }
  try {
    const { data, error } = await supabaseClient
      .from('missions')
      .select('*')
      .order('daystartts', { ascending: false });

    if (error) {
      console.warn('[Supabase] Error loading missions:', error.message);
      return [];
    }

    // Reconvertir les TIMESTAMPTZ → Unix ms pour le reste du code
    const missions = (data || []).map(m => ({
      ...m,
      dayStartTs: fromISO(m.daystartts),
      dayEndTs:   fromISO(m.dayendts),
      stops: (m.stops || []).map(stopFromStorage),
    }));

    console.log('[Supabase] Loaded', missions.length, 'missions from Supabase');
    return missions;
  } catch (e) {
    console.warn('[Supabase] Mission load failed:', e.message);
    return [];
  }
}

async function saveMissionToSupabase(mission) {
  if (!supabaseClient) {
    console.warn('[Supabase] Client not initialized for saving mission');
    return false;
  }
  try {
    console.log('[Supabase] Saving mission:', mission.id, mission.driver);

    const { error } = await supabaseClient
      .from('missions')
      .upsert([{
        id:         mission.id,
        driver:     mission.driver,
        plate:      mission.plateTracteur || mission.plate || '',
        plate_remorque: mission.plateRemorque || '',
        date:       mission.date,
        daystartts: toISO(mission.dayStartTs),   // ← Unix ms → ISO
        dayendts:   toISO(mission.dayEndTs),      // ← Unix ms → ISO (ou null)
        completed:  mission.completed || false,
        stops:      (mission.stops || []).map(stopToStorage), // ← timestamps des stops → ISO
        updatedat:  new Date().toISOString()
      }], { onConflict: 'id' });

    if (error) {
      console.error('[Supabase] ❌ Error saving mission:', {
        message: error.message,
        code: error.code,
        hint: error.hint,
        details: error.details
      });
      return false;
    }
    console.log('[Supabase] ✅ Mission saved successfully');
    return true;
  } catch (e) {
    console.error('[Supabase] ❌ Mission save exception:', e.message);
    return false;
  }
}

// ============================================================
// MESSAGES — Supabase Functions
// ============================================================

async function loadMessagesFromSupabase() {
  if (!supabaseClient) {
    console.warn('[Supabase] Client not initialized for loading messages');
    return [];
  }
  try {
    const { data, error } = await supabaseClient
      .from('messages')
      .select('*')
      .order('ts', { ascending: true });

    if (error) {
      console.warn('[Supabase] Error loading messages:', error.message);
      return [];
    }

    // Reconvertir ts (TIMESTAMPTZ) → Unix ms
    const messages = (data || []).map(m => ({
      ...m,
      ts: fromISO(m.ts),
    }));

    console.log('[Supabase] Loaded', messages.length, 'messages from Supabase');
    return messages;
  } catch (e) {
    console.warn('[Supabase] Message load failed:', e.message);
    return [];
  }
}

async function saveMessageToSupabase(message) {
  if (!supabaseClient) {
    console.warn('[Supabase] Client not initialized for saving message');
    return false;
  }
  try {
    console.log('[Supabase] Saving message:', message.id, 'from:', message.from);

    const { error } = await supabaseClient
      .from('messages')
      .insert([{
        id:       message.id,
        from:     message.from,
        fromname: message.fromName || '',
        to:       message.to,
        tolabel:  message.toLabel || '',
        text:     message.text,
        ts:       toISO(message.ts),   // ← Unix ms → ISO
        read:     message.read || false
      }]);

    if (error) {
      console.error('[Supabase] ❌ Error saving message:', {
        message: error.message,
        code: error.code,
        hint: error.hint,
        details: error.details
      });
      return false;
    }
    console.log('[Supabase] ✅ Message saved successfully');
    return true;
  } catch (e) {
    console.error('[Supabase] ❌ Message save exception:', e.message);
    return false;
  }
}

async function updateMessageReadStatus(messageId, read) {
  if (!supabaseClient) {
    console.warn('[Supabase] Client not initialized for updating message');
    return false;
  }
  try {
    const { error } = await supabaseClient
      .from('messages')
      .update({ read })
      .eq('id', messageId);

    if (error) {
      console.warn('[Supabase] Error updating message:', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[Supabase] Message update failed:', e.message);
    return false;
  }
}

// ============================================================
// VEHICLES — Supabase Functions
// ============================================================

async function loadVehiclesFromSupabase(type) {
  if (!supabaseClient) {
    console.warn('[Supabase] Client not initialized for loading vehicles');
    return [];
  }
  try {
    let query = supabaseClient.from('vehicles').select('*').eq('active', true).order('plate', { ascending: true });
    if (type) query = query.eq('type', type);
    const { data, error } = await query;
    if (error) {
      console.warn('[Supabase] Error loading vehicles:', error.message);
      return [];
    }
    return data || [];
  } catch (e) {
    console.warn('[Supabase] Vehicle load failed:', e.message);
    return [];
  }
}

async function saveVehicleToSupabase(vehicle) {
  if (!supabaseClient) return false;
  try {
    const { error } = await supabaseClient.from('vehicles').upsert([{
      plate:      vehicle.plate.toUpperCase(),
      type:       vehicle.type,  // 'tracteur' or 'remorque'
      active:     vehicle.active !== false,
      created_at: vehicle.created_at || new Date().toISOString()
    }], { onConflict: 'plate' });
    if (error) { console.error('[Supabase] Error saving vehicle:', error.message); return false; }
    return true;
  } catch (e) {
    console.error('[Supabase] Vehicle save exception:', e.message);
    return false;
  }
}

async function deleteVehicleFromSupabase(plate) {
  if (!supabaseClient) return false;
  try {
    const { error } = await supabaseClient.from('vehicles').delete().eq('plate', plate);
    if (error) { console.error('[Supabase] Error deleting vehicle:', error.message); return false; }
    return true;
  } catch (e) {
    console.error('[Supabase] Vehicle delete exception:', e.message);
    return false;
  }
}

// ============================================================
// Initialization
// ============================================================

async function initSupabase() {
  console.log('[Supabase] Starting initialization...');

  const sbMissions = await loadMissionsFromSupabase();
  const sbMessages = await loadMessagesFromSupabase();

  if (sbMissions.length > 0) {
    window.missionsFromSupabase = sbMissions;
    console.log('[Supabase] Missions loaded into window');
  }
  if (sbMessages.length > 0) {
    window.messagesFromSupabase = sbMessages;
    console.log('[Supabase] Messages loaded into window');
  }

  console.log('[Supabase] Initialization complete');
  window._supabaseReady = true;
}

// Expose globally
window.saveMissionToSupabase      = saveMissionToSupabase;
window.saveMessageToSupabase      = saveMessageToSupabase;
window.updateMessageReadStatus    = updateMessageReadStatus;
window.loadMissionsFromSupabase   = loadMissionsFromSupabase;
window.loadMessagesFromSupabase   = loadMessagesFromSupabase;
window.loadVehiclesFromSupabase   = loadVehiclesFromSupabase;
window.saveVehicleToSupabase      = saveVehicleToSupabase;
window.deleteVehicleFromSupabase  = deleteVehicleFromSupabase;
window.initSupabase               = initSupabase;
window.supabaseClient             = supabaseClient; // pour les subscriptions realtime

console.log('[Supabase] Functions registered globally');

if (typeof supabase !== 'undefined') {
  initSupabase().catch(e => console.warn('[Supabase] Init error:', e.message));
} else {
  console.error('[Supabase] Library still not loaded!');
}
