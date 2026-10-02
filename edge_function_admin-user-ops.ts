// LCA Transfert v1.38.0 — Edge Function `admin-user-ops`
//
// Actions sur auth.users réservées à un super_admin :
//   - "reset_password" : changer le mdp d'un user existant
//   - "delete"         : supprimer un user (cascade sur profiles)
//   - "set_active"     : activer / désactiver un compte
//
// Body:
// {
//   "action": "reset_password" | "delete" | "set_active",
//   "username": "J.KALSCHEUER",
//   "password": "...",   // reset_password
//   "is_active": true    // set_active
// }
//
// Secrets requis : SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabaseUrl    = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !serviceRoleKey) return json(500, { error: "Secrets manquants" });

    // 1) Vérifier JWT appelant
    const authHeader = req.headers.get("Authorization") || "";
    const bearer = authHeader.replace(/^Bearer\s+/i, "");
    if (!bearer) return json(401, { error: "JWT requis" });

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: userData, error: userErr } = await admin.auth.getUser(bearer);
    if (userErr || !userData?.user) return json(401, { error: "JWT invalide" });

    const { data: callerProfile } = await admin
      .from("profiles").select("role, is_active")
      .eq("id", userData.user.id).limit(1);
    const prof = callerProfile?.[0];
    if (!prof || !prof.is_active || prof.role !== "super_admin") {
      return json(403, { error: "Réservé aux super_admin" });
    }

    const body = await req.json();
    const { action, username } = body;
    if (!action || !username) return json(400, { error: "action et username requis" });

    // 2) Résoudre user cible
    const { data: targetProfile } = await admin
      .from("profiles").select("id, role").eq("username", username).limit(1);
    const target = targetProfile?.[0];
    if (!target) return json(404, { error: "username introuvable" });

    // Garde-fou : jamais se supprimer soi-même, jamais virer le dernier super_admin
    if (target.id === userData.user.id && (action === "delete" || action === "set_active")) {
      return json(400, { error: "Impossible d'agir sur son propre compte" });
    }
    if (target.role === "super_admin" && (action === "delete" || (action === "set_active" && body.is_active === false))) {
      const { count } = await admin
        .from("profiles").select("*", { count: "exact", head: true })
        .eq("role", "super_admin").eq("is_active", true);
      if ((count ?? 0) <= 1) return json(400, { error: "Impossible de retirer le dernier super_admin" });
    }

    if (action === "reset_password") {
      const { password } = body;
      if (!password || password.length < 10) return json(400, { error: "password trop court (10 min)" });
      const { error } = await admin.auth.admin.updateUserById(target.id, { password });
      if (error) return json(500, { error: error.message });
      return json(200, { ok: true });
    }

    if (action === "delete") {
      // Supprimer de auth.users → cascade sur profiles (ON DELETE CASCADE)
      const { error } = await admin.auth.admin.deleteUser(target.id);
      if (error) return json(500, { error: error.message });
      return json(200, { ok: true });
    }

    if (action === "set_active") {
      const next = !!body.is_active;
      const { error } = await admin.from("profiles").update({ is_active: next, updated_at: new Date().toISOString() })
        .eq("id", target.id);
      if (error) return json(500, { error: error.message });
      return json(200, { ok: true });
    }

    return json(400, { error: "action inconnue" });
  } catch (err) {
    console.error("[admin-user-ops] erreur:", err);
    return json(500, { error: String((err as any)?.message || err) });
  }
});
