#!/usr/bin/env node
/**
 * Applies supabase/migrations/*.sql (and optionally seed.sql) to a hosted
 * Supabase project via the Management API.
 *
 * Why this exists: `supabase db push` needs the Supabase CLI plus Docker, and
 * `psql` needs a Postgres client install. On a Windows dev box that is three
 * dependencies to run some SQL. This needs only Node, which the project already
 * requires.
 *
 *   SUPABASE_ACCESS_TOKEN=sbp_... node scripts/db-push.mjs --project-ref <ref>
 *   ... node scripts/db-push.mjs --project-ref <ref> --seed
 *   ... node scripts/db-push.mjs --project-ref <ref> --dry-run
 *
 * The token is a personal access token from
 * https://supabase.com/dashboard/account/tokens. It is read from the
 * environment and never written anywhere — do not pass it on the command line,
 * where it would land in your shell history.
 *
 * Migrations are applied in filename order and each one runs as a single
 * request, so a migration that fails part-way leaves the statements before it
 * applied. Every migration here is written to be re-runnable (`create or
 * replace`, `if not exists`, `on conflict do nothing`), so the fix is to
 * correct the file and re-run.
 */

import {readFile, readdir} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.supabase.com/v1';

function parseArgs(argv) {
  const args = {seed: false, dryRun: false, projectRef: null};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--seed') args.seed = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--project-ref') args.projectRef = argv[++i];
    else if (arg.startsWith('--project-ref=')) args.projectRef = arg.split('=')[1];
  }
  return args;
}

async function runSql(token, projectRef, sql) {
  const response = await fetch(`${API}/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({query: sql}),
  });

  const text = await response.text();
  if (!response.ok) {
    // The API returns the Postgres error message, which is the useful part.
    let message = text;
    try {
      message = JSON.parse(text).message ?? text;
    } catch {
      /* keep the raw body */
    }
    throw new Error(message);
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function main() {
  const {seed, dryRun, projectRef} = parseArgs(process.argv.slice(2));
  const token = process.env.SUPABASE_ACCESS_TOKEN;

  if (!projectRef) {
    console.error('Missing --project-ref <ref>. Find it in your project URL.');
    process.exit(1);
  }
  if (!token && !dryRun) {
    console.error('Missing SUPABASE_ACCESS_TOKEN. Create one at:');
    console.error('  https://supabase.com/dashboard/account/tokens');
    process.exit(1);
  }

  const migrationsDir = join(ROOT, 'supabase', 'migrations');
  const files = (await readdir(migrationsDir)).filter(f => f.endsWith('.sql')).sort();

  if (files.length === 0) {
    console.error(`No migrations found in ${migrationsDir}`);
    process.exit(1);
  }

  console.log(`Applying ${files.length} migrations to ${projectRef}${dryRun ? ' (dry run)' : ''}`);

  for (const file of files) {
    const sql = await readFile(join(migrationsDir, file), 'utf8');
    process.stdout.write(`  ${file} ... `);

    if (dryRun) {
      console.log(`skipped (${sql.length} bytes)`);
      continue;
    }

    try {
      await runSql(token, projectRef, sql);
      console.log('ok');
    } catch (error) {
      console.log('FAILED');
      console.error(`\n${file}:\n${error.message}\n`);
      process.exit(1);
    }
  }

  if (seed) {
    process.stdout.write('  seed.sql ... ');
    if (dryRun) {
      console.log('skipped');
    } else {
      try {
        await runSql(token, projectRef, await readFile(join(ROOT, 'supabase', 'seed.sql'), 'utf8'));
        console.log('ok');
      } catch (error) {
        console.log('FAILED');
        console.error(`\nseed.sql:\n${error.message}\n`);
        process.exit(1);
      }
    }
  }

  console.log('\nDone.');
  if (!seed && !dryRun) {
    console.log('Run again with --seed to load game_config — every rule function');
    console.log('reads it and RAISES on a missing key, so claims fail without it.');
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
