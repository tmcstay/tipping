import { getSupabaseClient } from "./client";

export async function getCurrentUser() {
  const { data, error } = await getSupabaseClient().auth.getUser();

  if (error) {
    throw error;
  }

  return data.user;
}
