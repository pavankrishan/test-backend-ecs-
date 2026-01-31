#!/usr/bin/env ts-node
import 'dotenv/config';
import dns from 'dns';

function redactCreds(url: string): string {
  try {
    const u = new URL(url);
    if (u.username || u.password) {
      u.username = 'REDACTED';
      u.password = 'REDACTED';
    }
    return u.toString();
  } catch (e) {
    return url;
  }
}

async function main() {
  const url = process.env.POSTGRES_URL || process.env.POSTGRES_URI;
  if (!url) {
    console.error('No POSTGRES_URL or POSTGRES_URI found in environment.');
    process.exit(2);
  }

  console.log('Using DB URL (credentials redacted):', redactCreds(url));

  // parse host/port
  try {
    const u = new URL(url);
    const host = u.hostname;
    const port = u.port || '5432';
    const db = u.pathname ? u.pathname.replace(/^\//, '') : '';
    console.log('Host:', host);
    console.log('Port:', port);
    console.log('Database:', db || '(none)');
    console.log('Searching DNS for host...');
    dns.lookup(host, (err: NodeJS.ErrnoException | null, address?: string, family?: number) => {
      if (err) {
        console.error('DNS lookup failed:', err.message);
        process.exit(3);
      }
      console.log(`DNS lookup OK: ${host} -> ${address} (IPv${family})`);
      console.log('If DNS fails, ensure the host is the full domain name from your cloud provider.');
      process.exit(0);
    });
  } catch (err) {
    console.error('Failed to parse DB URL:', err);
    process.exit(4);
  }
}

main();
