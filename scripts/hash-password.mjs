#!/usr/bin/env node
/** Usage: npm run hash-password -- 'your admin password'  → prints ADMIN_PASSWORD_HASH */
import { hashPassword } from '../lib/crypto.js';

const pw = process.argv[2];
if (!pw || pw.length < 12) {
  console.error('Give a password of at least 12 characters: npm run hash-password -- "..."');
  process.exit(1);
}
console.log(`ADMIN_PASSWORD_HASH=${hashPassword(pw)}`);
