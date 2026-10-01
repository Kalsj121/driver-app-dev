// LCA Transfert v1.37.8 — Edge Function `send-bureau-push`
// Envoie une Web Push à tous les bureaux abonnés
// quand un chauffeur écrit un message.
//
// v1.37.8 : exige maintenant un `driver_token` valide dans le body
// (sauf si `alerts_only=true` : dans ce cas, un `bureau_token` est attendu
//  parce que c'est le dashboard d'un bureau qui déclenche l'alerte).
//
// À redéployer dans Supabase Studio → Edge Functions → send-bureau-push → Deploy.
// Secrets requis :
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   VAPID_PUBLIC_KEY
//   VAPID_PRIVATE_KEY
//   VAPID_SUBJECT

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { driver_token, bureau_token, fromDriverName, title, body, msgId, alerts_only } = await req.json();

    if (!title || !body) {
      return new Response(JSON.stringify({ error: "title et body requis" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // v1.37.8 : vérifier la session appelante selon le contexte
    const isAlert = alerts_only === true;
    if (isAlert) {
      // Alerte envoyée par un bureau (via le dashboard quand un chauffeur dépasse un seuil)
      if (!bureau_token) {
        return new Response(JSON.stringify({ error: "bureau_token requis pour les alertes" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const { data: bs } = await supabase
        .from("bureau_sessions")
        .select("username, expires_at")
        .eq("token", bureau_token)
        .limit(1);
      const sess = (bs && bs[0]) || null;
      if (!sess || new Date(sess.expires_at).getTime() <= Date.now()) {
        return new Response(JSON.stringify({ error: "session bureau invalide ou expirée" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    } else {
      // Message chauffeur → bureaux : exiger un driver_token valide
      if (!driver_token) {
        return new Response(JSON.stringify({ error: "driver_token requis" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const { data: ds } = await supabase
        .from("driver_sessions")
        .select("username, expires_at")
        .eq("token", driver_token)
        .limit(1);
      const sess = (ds && ds[0]) || null;
      if (!sess || new Date(sess.expires_at).getTime() <= Date.now()) {
        return new Response(JSON.stringify({ error: "session chauffeur invalide ou expirée" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // v1.36.5 : si alerts_only, filtrer sur alerts_enabled=true côté bureau
    let query = supabase.from("bureau_push_subscriptions").select("*");
    if (isAlert) query = query.eq("alerts_enabled", true);
    const { data: subs, error } = await query;
    if (error) throw error;
    if (!subs || subs.length === 0) {
      return new Response(JSON.stringify({ sent: 0, message: "Aucun bureau abonné" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const vapidPublic  = Deno.env.get("VAPID_PUBLIC_KEY")  ?? "";
    const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
    const vapidSubject = Deno.env.get("VAPID_SUBJECT")     ?? "mailto:quality@liegecargo.com";
    if (!vapidPublic || !vapidPrivate) {
      return new Response(JSON.stringify({ error: "VAPID keys manquantes" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

    const payload = JSON.stringify({
      title: isAlert ? title : ("🚛 " + (fromDriverName || "Chauffeur")),
      body,
      msgId: msgId || null,
      url:   "./dashboard.html",
      tag:   "lca-bureau-" + (msgId || Date.now())
    });

    let sent = 0, failed = 0;
    const stale: number[] = [];
    for (const sub of subs) {
      try {
        await webpush.sendNotification({
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth }
        }, payload, { TTL: 60 * 60 * 24 });
        sent++;
        await supabase.from("bureau_push_subscriptions")
          .update({ last_used_at: new Date().toISOString() })
          .eq("id", sub.id);
      } catch (err) {
        const status = (err as any)?.statusCode || (err as any)?.status;
        console.warn("[bureau-push] échec sub", sub.id, "status:", status, err);
        failed++;
        if (status === 410 || status === 404) stale.push(sub.id);
      }
    }
    if (stale.length) {
      await supabase.from("bureau_push_subscriptions").delete().in("id", stale);
      console.log("[bureau-push] nettoyage de", stale.length, "abonnement(s) périmé(s)");
    }
    return new Response(JSON.stringify({ sent, failed, stale: stale.length, total: subs.length }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[bureau-push] erreur:", err);
    return new Response(JSON.stringify({ error: String((err as any)?.message || err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
