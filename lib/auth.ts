import { supabase } from "./supabase";

export async function requireUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error("Not signed in");
  return data.user; // has .id and .email
}