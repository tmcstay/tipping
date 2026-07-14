import { getAuthRedirectUrl } from "./authRedirect";
import { getSupabaseClient } from "./client";

export type UserProfile = {
  id: string;
  email: string | null;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  is_dummy: boolean;
  created_at: string;
  updated_at: string | null;
};

export type SignUpInput = {
  email: string;
  password: string;
  displayName?: string;
};

export async function signUpWithPassword({
  displayName,
  email,
  password
}: SignUpInput) {
  const { data, error } = await getSupabaseClient().auth.signUp({
    email: email.trim(),
    password,
    options: {
      data: displayName?.trim() ? { display_name: displayName.trim() } : {},
      emailRedirectTo: getAuthRedirectUrl("/auth/callback")
    }
  });

  if (error) throw error;
  return data;
}

export async function signInWithPassword(email: string, password: string) {
  const { data, error } = await getSupabaseClient().auth.signInWithPassword({
    email: email.trim(),
    password
  });

  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await getSupabaseClient().auth.signOut();
  if (error) throw error;
}

export async function getCurrentSession() {
  const { data, error } = await getSupabaseClient().auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function getCurrentUser() {
  const { data, error } = await getSupabaseClient().auth.getUser();

  if (error) {
    throw error;
  }

  return data.user;
}

export async function getCurrentUserProfile(userId?: string) {
  const resolvedUserId = userId ?? (await getCurrentUser())?.id;
  if (!resolvedUserId) return null;

  const { data, error } = await getSupabaseClient()
    .from("profiles")
    .select("id,email,display_name,first_name,last_name,avatar_url,is_dummy,created_at,updated_at")
    .eq("id", resolvedUserId)
    .single();

  if (error) throw error;
  return data as UserProfile;
}

export async function updateCurrentUserProfile(input: {
  displayName: string;
  firstName?: string;
  lastName?: string;
  avatarUrl?: string | null;
}) {
  const user = await getCurrentUser();
  if (!user) throw new Error("You must be signed in to update your profile.");

  const changes: { display_name: string; first_name?: string; last_name?: string; avatar_url?: string | null } = {
    display_name: input.displayName.trim()
  };
  if (input.firstName !== undefined) changes.first_name = input.firstName.trim();
  if (input.lastName !== undefined) changes.last_name = input.lastName.trim();
  if (input.avatarUrl !== undefined) changes.avatar_url = input.avatarUrl;

  const { data, error } = await getSupabaseClient()
    .from("profiles")
    .update(changes)
    .eq("id", user.id)
    .select("id,email,display_name,first_name,last_name,avatar_url,is_dummy,created_at,updated_at")
    .single();

  if (error) throw error;
  return data as UserProfile;
}

export async function sendPasswordResetEmail(email: string, redirectTo?: string) {
  const { error } = await getSupabaseClient().auth.resetPasswordForEmail(
    email.trim(),
    redirectTo ? { redirectTo } : undefined
  );
  if (error) throw error;
}

export async function updatePassword(password: string) {
  const { error } = await getSupabaseClient().auth.updateUser({ password });
  if (error) throw error;
}
