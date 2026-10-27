#!/usr/bin/env node
/**
 * Generates an admin TOTP secret and the otpauth:// URL for your authenticator app.
 * Turn the URL into a QR code locally, e.g.:
 *   python3 -c "import qrcode,sys; q=qrcode.QRCode(); q.add_data(sys.argv[1]); q.print_ascii()" "<otpauth url>"
 */
import { generateSecret, otpauthUrl, totp } from '../lib/totp.js';

const secret = process.argv[2] || generateSecret();
console.log(`ADMIN_TOTP_SECRET=${secret}`);
console.log(`\notpauth URL (add to your authenticator app):\n${otpauthUrl({ secret })}`);
console.log(`\nCurrent code, to check your app agrees: ${totp(secret)}`);
