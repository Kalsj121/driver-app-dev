// ============================================================
// supabase_config.js — Configuration Supabase
// ÉTAPE 1 : Remplacez les deux valeurs ci-dessous
// Trouvez-les dans : Supabase Dashboard → Settings → API
// ============================================================

const SUPABASE_URL  = 'https://pwaoxghgitobsxuiqlut.supabase.co';      // ← à remplacer
const SUPABASE_ANON = 'sb_publishable_biUSd_hIHmFdN0egFbyNCQ_MoTcNrdc';                     // ← à remplacer

// ============================================================
// Client Supabase (ne pas modifier)
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

// ============================================================
// HELPERS — Chauffeur
// ============================================================

// Sauvegarder un stop complet
export async function saveStop(stop) {
  const { data, error } = await supabase
    .from('stops')
    .insert([{
      driver_name:       stop.driver,
      plate:             stop.plate || '',
      date:              stop.date,
      location:          stop.location,
      operation:         stop.operation,
      dock:              stop.dock || '',
      t_arrival:         stop.tArrival,
      t_dock_assigned:   stop.tDockAssigned,
      t_dock_ready:      stop.tDockReady,
      t_ops_start:       stop.tOpsStart,
      t_ops_end:         stop.tOpsEnd,
      t_doc:             stop.tDoc,
      t_depart:          stop.tDepart,
      transit_from_prev: stop.transitFromPrev,
      min_transit:       stop.minTransit,
      min_wait:          stop.minWait,
      min_dock:          stop.minDock,
      min_ops:           stop.minOps,
      min_doc:           stop.minDoc,
      min_total:         stop.minTotal,
      cargo_type:        stop.cargoType || '',
      comment:           stop.comment || '',
    }])
    .select();
  if (error) { console.error('saveStop error:', error); return null; }
  // Sauvegarder les cargo items
  if (stop.cargo && stop.cargo.length && data[0]) {
    await supabase.from('cargo_items').insert(
      stop.cargo.map(c => ({
        stop_id: data[0].id,
        item_type: c.type,
        uld_number: c.uld || '',
        pieces: c.pieces ? parseInt(c.pieces) : null,
        awb: c.awb || ''
      }))
    );
  }
  return data[0];
}

// Mettre à jour le statut temps réel du chauffeur
export async function updateDriverStatus(status) {
  const { error } = await supabase
    .from('driver_status')
    .upsert([status], { onConflict: 'user_id' });
  if (error) console.error('updateDriverStatus error:', error);
}

// Supprimer le statut en fin de journée
export async function clearDriverStatus(userId) {
  await supabase.from('driver_status').delete().eq('user_id', userId);
}

// ============================================================
// HELPERS — Manager / Bureau
// ============================================================

// Récupérer tous les stops (avec filtres optionnels)
export async function getStops({ location, dateFrom, dateTo, operation } = {}) {
  let query = supabase.from('stops').select('*').order('date', {ascending:false}).order('t_arrival', {ascending:false});
  if (location)  query = query.eq('location', location);
  if (dateFrom)  query = query.gte('date', dateFrom);
  if (dateTo)    query = query.lte('date', dateTo);
  if (operation) query = query.ilike('operation', operation + '%');
  const { data, error } = await query.limit(1000);
  if (error) { console.error('getStops error:', error); return []; }
  return data || [];
}

// Récupérer les statuts temps réel
export async function getDriverStatus() {
  const { data, error } = await supabase
    .from('driver_status')
    .select('*')
    .gt('updated_at', new Date(Date.now() - 2*60*60*1000).toISOString());
  if (error) { console.error('getDriverStatus error:', error); return []; }
  return data || [];
}

// Écouter les mises à jour temps réel
export function subscribeToDriverStatus(callback) {
  return supabase
    .channel('driver_status_changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_status' }, callback)
    .subscribe();
}

// Messages
export async function sendMessage(msg) {
  const { error } = await supabase.from('messages').insert([msg]);
  if (error) console.error('sendMessage error:', error);
}

export async function getMessages({ toTarget, limit = 100 } = {}) {
  let query = supabase.from('messages').select('*').order('created_at', {ascending:false}).limit(limit);
  if (toTarget && toTarget !== 'all') {
    query = query.or(`to_target.eq.all,to_target.eq.${toTarget}`);
  }
  const { data, error } = await query;
  if (error) { console.error('getMessages error:', error); return []; }
  return data || [];
}

export function subscribeToMessages(callback) {
  return supabase
    .channel('messages_changes')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, callback)
    .subscribe();
}

// Synthèse par lieu (vue SQL)
export async function getSyntheseLieu() {
  const { data, error } = await supabase.from('v_synthese_lieu').select('*');
  if (error) { console.error('getSyntheseLieu error:', error); return []; }
  return data || [];
}
