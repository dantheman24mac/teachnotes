import process from "node:process";
import {
  createAdminClient,
  findUserByEmail,
  protectOwnerAccount,
  readSecret,
} from "./auth-helpers.mjs";

const supabase = createAdminClient();
const email = process.env.TEACHNOTES_LOGIN_EMAIL;
if (!email) throw new Error("Set TEACHNOTES_LOGIN_EMAIL first");
const user = await findUserByEmail(supabase, email);
if (!user) throw new Error("The configured TeachNotes owner does not exist");

const password = await readSecret("New owner password: ");
const confirmation = await readSecret("Confirm password: ");
if (password !== confirmation) throw new Error("Passwords do not match");
if (password.length < 12) throw new Error("Use at least 12 characters");

const { error } = await supabase.auth.admin.updateUserById(user.id, { password });
if (error) throw error;

await protectOwnerAccount(supabase, user);
process.stdout.write(`Reset the protected TeachNotes owner password (${user.id}).\n`);
