// npm run set-admin-password -- <username> <password>
// Creates the admin or resets its password. The user must pick a new password at next login.
import { query } from '../db.js';
import { hashPassword } from '../lib/password.js';

const [username, password] = process.argv.slice(2);
if (!process.env.DATABASE_URL || !username || !password) {
  console.error('Usage: npm run set-admin-password -- <username> <password> (DATABASE_URL in .env.local)');
  process.exit(1);
}

await query(
  `insert into admin_users (username, password_hash, must_change_password)
   values ($1, $2, true)
   on conflict (username) do update
     set password_hash = excluded.password_hash, must_change_password = true, updated_at = now()`,
  [username, await hashPassword(password)],
);
console.log(`Set password for ${username}; a new password is required at next login.`);
