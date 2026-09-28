// LCA Transfert v1.36 — Edge Function `send-bureau-push`
// Envoie une notification Web Push à tous les bureaux abonnés
// quand un chauffeur écrit un message.
//
// Déploiement Supabase Studio → Edge Functions → Deploy a new function
// Nom : send-bureau-push (Via Editor → coller ce code)
//
// Secrets requis (les mêmes que send-driver-push) :
//   VAPID_PUBLIC_KEY
//   VAPID_PRIVATE_KEY
//   VAPID_SUBJECT   (ex: mailto:quality@liegecargo.com)

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
    const { fromDriverName, title, body, msgId } = await req.json();
    if (!title || !body) {
      return new Response(JSON.stringify({ error: "title et body requis" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );
    const { data: subs, error } = await supabase
      .from("bureau_push_subscriptions")
      .select("*");
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
      title: "🚛 " + (fromDriverName || "Chauffeur"),
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
