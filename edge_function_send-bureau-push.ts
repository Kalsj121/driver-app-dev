// LCA Transfert v1.38.0 — Edge Function `send-bureau-push`
// Push aux bureaux. Appelable par un chauffeur authentifié (message) ou
// un bureau authentifié (alerte).

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { fromDriverName, title, body, msgId, alerts_only } = await req.json();
    if (!title || !body) {
      return new Response(JSON.stringify({ error: "title et body requis" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!bearer) {
      return new Response(JSON.stringify({ error: "JWT requis" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data: ud, error: uErr } = await admin.auth.getUser(bearer);
    if (uErr || !ud?.user) {
      return new Response(JSON.stringify({ error: "JWT invalide" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { data: profs } = await admin.from("profiles").select("role,is_active").eq("id", ud.user.id).limit(1);
    const p = profs?.[0];
    if (!p || !p.is_active) {
      return new Response(JSON.stringify({ error: "Compte non actif" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Alertes : réservées aux bureaux. Messages : réservés aux chauffeurs.
    const isAlert = alerts_only === true;
    if (isAlert && !["operations","admin","super_admin"].includes(p.role)) {
      return new Response(JSON.stringify({ error: "Alertes réservées aux bureaux" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!isAlert && p.role !== "driver") {
      return new Response(JSON.stringify({ error: "Messages réservés aux chauffeurs" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let query = admin.from("bureau_push_subscriptions").select("*");
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
        await admin.from("bureau_push_subscriptions").update({ last_used_at: new Date().toISOString() }).eq("id", sub.id);
      } catch (err) {
        const status = (err as any)?.statusCode || (err as any)?.status;
        failed++;
        if (status === 410 || status === 404) stale.push(sub.id);
      }
    }
    if (stale.length) await admin.from("bureau_push_subscriptions").delete().in("id", stale);

    return new Response(JSON.stringify({ sent, failed, stale: stale.length, total: subs.length }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[bureau-push] erreur:", err);
    return new Response(JSON.stringify({ error: String((err as any)?.message || err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
