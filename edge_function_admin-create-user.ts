// LCA Transfert v1.38.0 — Edge Function `admin-create-user`
//
// Appelée depuis le dashboard par un super_admin pour créer un compte
// chauffeur ou bureau dans auth.users + remplir la ligne profiles.
//
// Flow :
//   1. Vérifie que l'appelant a un JWT valide
//   2. Vérifie que l'appelant est super_admin (via profiles.role)
//   3. Construit un email synthétique à partir du username
//   4. Crée le user avec la service_role_key (bypass policies)
//   5. Met à jour la ligne profiles créée par le trigger avec les métadonnées
//
// Body attendu :
// {
//   "username": "J.KALSCHEUER",
//   "password": "Mdp9!xpQZ",
//   "fullname": "Jan KALSCHEUER (TEST)",
//   "role": "driver" | "operations" | "admin" | "super_admin",
//   "pdf_allowed": false,                  // chauffeurs seulement
//   "entity": "Liege Cargo Agency SA",      // chauffeurs seulement
//   "allowed_views": [...],                 // bureaux seulement
//   "allowed_entities": [...]               // bureaux seulement
// }
//
// Secrets requis :
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DRIVER_EMAIL_DOMAIN = "drivers.liegecargo.local";
const BUREAU_EMAIL_DOMAIN = "bureau.liegecargo.local";

function usernameToEmail(username: string, role: string): string {
  const lower = username.trim().toLowerCase();
  const domain = role === "driver" ? DRIVER_EMAIL_DOMAIN : BUREAU_EMAIL_DOMAIN;
  return `${lower}@${domain}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl    = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(JSON.stringify({ error: "Secrets manquants" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 1) Vérifier le JWT de l'appelant
    const authHeader = req.headers.get("Authorization") || "";
    const bearer = authHeader.replace(/^Bearer\s+/i, "");
    if (!bearer) {
      return new Response(JSON.stringify({ error: "JWT requis" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Client qui parse le JWT du caller
    const callerClient = createClient(supabaseUrl, serviceRoleKey, {
      global: { headers: { Authorization: `Bearer ${bearer}` } }
    });
    const { data: userData, error: userErr } = await callerClient.auth.getUser(bearer);
    if (userErr || !userData || !userData.user) {
      return new Response(JSON.stringify({ error: "JWT invalide" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 2) Vérifier role super_admin
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: callerProfile } = await admin
      .from("profiles").select("role, is_active")
      .eq("id", userData.user.id).limit(1);
    const prof = callerProfile && callerProfile[0];
    if (!prof || !prof.is_active || prof.role !== "super_admin") {
      return new Response(JSON.stringify({ error: "Réservé aux super_admin" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 3) Parser body
    const body = await req.json();
    const { username, password, fullname, role,
            pdf_allowed, entity, allowed_views, allowed_entities } = body;

    if (!username || !password || !role) {
      return new Response(JSON.stringify({ error: "username, password, role requis" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!['driver','operations','admin','super_admin'].includes(role)) {
      return new Response(JSON.stringify({ error: "role invalide" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (password.length < 10) {
      return new Response(JSON.stringify({ error: "password trop court (10 min)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Username unique ?
    const { data: existing } = await admin
      .from("profiles").select("username").eq("username", username).limit(1);
    if (existing && existing.length > 0) {
      return new Response(JSON.stringify({ error: "username déjà pris" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const email = usernameToEmail(username, role);

    // 4) Créer le user auth
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { username, fullname: fullname || username, role }
    });
    if (createErr || !created || !created.user) {
      return new Response(JSON.stringify({ error: createErr?.message || "création user échouée" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const newUserId = created.user.id;

    // 5) Compléter le profile créé par le trigger
    const profileUpdate: Record<string, unknown> = {
      fullname:         fullname || username,
      role,
      is_active:        true
    };
    if (role === "driver") {
      profileUpdate.pdf_allowed = !!pdf_allowed;
      profileUpdate.entity      = entity || "";
    } else {
      profileUpdate.allowed_views    = allowed_views    || ["dashboard"];
      profileUpdate.allowed_entities = allowed_entities || [];
    }

    const { error: updErr } = await admin
      .from("profiles").update(profileUpdate).eq("id", newUserId);
    if (updErr) console.warn("[admin-create-user] profile update:", updErr.message);

    return new Response(JSON.stringify({
      ok: true,
      user_id: newUserId,
      username,
      email,
      role
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[admin-create-user] erreur:", err);
    return new Response(JSON.stringify({ error: String((err as any)?.message || err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
