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
let user = await findUserByEmail(supabase, email);

if (!user) {
  const password = await readSecret("New owner password: ");
  const confirmation = await readSecret("Confirm password: ");
  if (password !== confirmation) throw new Error("Passwords do not match");
  if (password.length < 12) throw new Error("Use at least 12 characters");

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  user = data.user;
  process.stdout.write(`Created the TeachNotes owner (${user.id}).\n`);
} else {
  process.stdout.write(`Found the existing TeachNotes owner (${user.id}).\n`);
}

await protectOwnerAccount(supabase, user);
process.stdout.write("The configured owner is the protected, approved administrator.\n");
