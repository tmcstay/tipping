import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
const publishableKey =
  process.env.SUPABASE_PUBLISHABLE_KEY ??
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !publishableKey || !serviceRoleKey) {
  throw new Error(
    "Set SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, and SUPABASE_SERVICE_ROLE_KEY. " +
      "The service role is used only to remove this script's test users."
  );
}

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const password = `Auth-test-${suffix}!`;
const firstEmail = `auth-a-${suffix}@example.test`;
const secondEmail = `auth-b-${suffix}@example.test`;

const first = createClient(url, publishableKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});
const second = createClient(url, publishableKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});
const admin = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const createdUserIds = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`✓ ${message}`);
}

try {
  const firstSignup = await first.auth.signUp({
    email: firstEmail,
    password,
    options: { data: { display_name: "Auth Tester" } }
  });
  if (firstSignup.error) throw firstSignup.error;
  if (firstSignup.data.user) createdUserIds.push(firstSignup.data.user.id);
  assert(Boolean(firstSignup.data.session), "email/password signup creates a session locally");

  const secondSignup = await second.auth.signUp({ email: secondEmail, password });
  if (secondSignup.error) throw secondSignup.error;
  if (secondSignup.data.user) createdUserIds.push(secondSignup.data.user.id);
  assert(Boolean(secondSignup.data.session), "a second user can sign up");

  const firstUserId = firstSignup.data.user.id;
  const secondUserId = secondSignup.data.user.id;

  const ownProfile = await first
    .from("profiles")
    .select("id,email,display_name,is_dummy")
    .eq("id", firstUserId)
    .single();
  if (ownProfile.error) throw ownProfile.error;
  assert(ownProfile.data.display_name === "Auth Tester", "signup trigger creates the requested profile");
  assert(ownProfile.data.is_dummy === false, "public signup cannot create a dummy profile");

  const editableProfile = await first
    .from("profiles")
    .update({ display_name: "Updated Auth Tester" })
    .eq("id", firstUserId)
    .select("display_name")
    .single();
  if (editableProfile.error) throw editableProfile.error;
  assert(
    editableProfile.data.display_name === "Updated Auth Tester",
    "a user can update their permitted profile fields"
  );

  const otherProfile = await first
    .from("profiles")
    .select("id")
    .eq("id", secondUserId);
  if (otherProfile.error) throw otherProfile.error;
  assert(otherProfile.data.length === 0, "RLS hides another user's private profile");

  const dummyEscalation = await first
    .from("profiles")
    .update({ is_dummy: true })
    .eq("id", firstUserId);
  assert(Boolean(dummyEscalation.error), "column grants block self-assignment of is_dummy");

  const memberships = await first
    .from("user_app_memberships")
    .select("id,role,status,apps!inner(code)");
  if (memberships.error) throw memberships.error;
  assert(
    memberships.data.some(
      (membership) =>
        membership.role === "user" &&
        membership.status === "active" &&
        membership.apps.code === "cycling"
    ),
    "signup trigger creates the default cycling app membership"
  );

  const membershipId = memberships.data[0].id;
  const roleEscalation = await first
    .from("user_app_memberships")
    .update({ role: "admin" })
    .eq("id", membershipId)
    .select("role");
  assert(
    !roleEscalation.error && roleEscalation.data.length === 0,
    "RLS prevents a user from promoting their own membership"
  );

  const roleCheck = await first
    .from("user_app_memberships")
    .select("role")
    .eq("id", membershipId)
    .single();
  if (roleCheck.error) throw roleCheck.error;
  assert(roleCheck.data.role === "user", "the stored app role remains user");

  const signout = await first.auth.signOut();
  if (signout.error) throw signout.error;
  const sessionAfterSignout = await first.auth.getSession();
  if (sessionAfterSignout.error) throw sessionAfterSignout.error;
  assert(sessionAfterSignout.data.session === null, "logout clears the client session");
} finally {
  for (const userId of createdUserIds) {
    const deletion = await admin.auth.admin.deleteUser(userId);
    if (deletion.error) console.warn(`Could not remove test user ${userId}: ${deletion.error.message}`);
  }
}
