// Proves out Supabase Edge Function -> Resend API -> recipient mailbox.
// Requires a genuine authenticated Supabase session AND an active cycling
// admin role (public.is_current_user_cycling_admin(), the same RPC
// apps/mobile/api/admin/grandtour/run-official-check.mjs already uses to
// authorize its own admin-only route) - not weakened from the prior
// per-session-only check, strengthened. This function can send to any
// address the caller supplies, so once real production Resend secrets
// exist it must never be reachable by an ordinary signed-up app user, only
// an admin proving the integration still works. See CLAUDE.md's "Resend
// transactional email" section, "Keep or remove the test function".
// Only POST is supported. Secrets are read from environment variables only
// (never the request body, never logged).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.108.2";

const RESEND_API_URL = "https://api.resend.com/emails";

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function isValidEmail(value: unknown): value is string {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const authHeader = req.headers.get("Authorization");

  if (!supabaseUrl || !supabaseAnonKey) {
    return jsonResponse({ success: false, error: "Server misconfiguration" }, 500);
  }

  if (!authHeader) {
    return jsonResponse({ success: false, error: "Unauthorized" }, 401);
  }

  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: authData, error: authError } = await authClient.auth.getUser();
  if (authError || !authData?.user) {
    return jsonResponse({ success: false, error: "Unauthorized" }, 401);
  }

  const { data: isAdmin, error: adminCheckError } = await authClient.rpc("is_current_user_cycling_admin");
  if (adminCheckError || isAdmin !== true) {
    return jsonResponse({ success: false, error: "Forbidden" }, 403);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ success: false, error: "Invalid JSON body" }, 400);
  }

  const to = (body as { to?: unknown } | null)?.to;
  if (!isValidEmail(to)) {
    return jsonResponse(
      { success: false, error: "A valid 'to' email address is required" },
      400,
    );
  }

  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("RESULTS_EMAIL_FROM");
  const replyTo = Deno.env.get("RESULTS_EMAIL_REPLY_TO");
  const appUrl = Deno.env.get("APP_PUBLIC_URL");

  if (!resendApiKey || !from) {
    return jsonResponse({ success: false, error: "Email service is not configured" }, 500);
  }

  const subject = "GrandTour — Resend test email";
  const text = [
    "This is a test email from GrandTour.",
    "",
    "If you received this, the Supabase Edge Function -> Resend integration is working.",
    appUrl ? `\n${appUrl}` : "",
  ]
    .join("\n")
    .trim();
  const html = `
    <div style="font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #1a1a1a;">
      <h1 style="font-size: 18px; margin: 0 0 12px 0;">GrandTour test email</h1>
      <p style="font-size: 14px; line-height: 1.5; margin: 0 0 8px 0;">This is a test email from GrandTour.</p>
      <p style="font-size: 14px; line-height: 1.5; margin: 0 0 8px 0;">If you received this, the Supabase Edge Function &rarr; Resend integration is working.</p>
      ${appUrl ? `<p style="font-size: 12px; color: #666666; margin: 16px 0 0 0;">${appUrl}</p>` : ""}
    </div>
  `.trim();

  const resendPayload: Record<string, unknown> = {
    from,
    to: [to],
    subject,
    html,
    text,
  };
  if (replyTo) {
    resendPayload.reply_to = replyTo;
  }

  let resendResponse: Response;
  try {
    resendResponse = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(resendPayload),
    });
  } catch {
    return jsonResponse({ success: false, error: "Failed to reach email provider" }, 502);
  }

  let resendBody: { id?: string; message?: string } | null = null;
  try {
    resendBody = await resendResponse.json();
  } catch {
    resendBody = null;
  }

  if (!resendResponse.ok) {
    return jsonResponse(
      { success: false, error: "Email provider rejected the request", status: resendResponse.status },
      502,
    );
  }

  return jsonResponse({ success: true, id: resendBody?.id ?? null }, 200);
});
