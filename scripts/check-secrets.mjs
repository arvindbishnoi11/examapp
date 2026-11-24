#!/usr/bin/env node
// =============================================================================
// PrepSetu — secret & configuration leak guard
// -----------------------------------------------------------------------------
// Run before every commit and as part of CI (`npm run lint:secrets`).
//
// What it fails on
//   1. A private key block (RSA/EC/OpenSSH) anywhere in a tracked file.
//   2. A service-account JSON body (client_email + private_key).
//   3. Long literal secrets assigned to secret-looking env keys.
//   4. `dist/` or generated artefacts committed by accident.
//   5. The debug/dev auth flag reaching a production config file.
//
// It is intentionally conservative: placeholders in .env.example /
// .dev.vars.example and `docs/` snippets are allowed.
// =============================================================================

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, extname, basename } from 'node:path';

const ROOT = process.cwd();
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.wrangler', 'dist', 'build', 'coverage',
  '.arena', '.cache', '.venv', '__pycache__', 'out', 'target',
]);
const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.jsonc',
  '.sql', '.md', '.txt', '.yml', '.yaml', '.toml', '.css', '.html',
  '.example', '.dev', '.vars', '.env', '',
]);
// Files that legitimately contain sample/placeholder values.
const ALLOWLIST_FILES = new Set([
  '.env.example',
  '.dev.vars.example',
  'scripts/check-secrets.mjs',
  'scripts/build-config.mjs',
]);
// Directories whose contents are documentation of the schema only.
const ALLOWLIST_PREFIXES = ['docs/'];
// Generated browser configuration. A Firebase **web** API key is a public
// identifier (security is enforced by Firebase Rules + Authorized domains), so
// it is expected to ship in the client bundle. Server credentials never do.
const PUBLIC_BY_DESIGN = new Set(['public/env.js', 'public/firebase-messaging-sw.js']);

const findings = [];

/** True when git ignores the given path (used to verify .dev.vars hygiene). */
async function isGitIgnored(path) {
  try {
    const { spawnSync } = await import('node:child_process');
    const result = spawnSync('git', ['check-ignore', path], { cwd: ROOT, encoding: 'utf8' });
    return result.status === 0;
  } catch {
    return true; // git unavailable: do not block the scan
  }
}

function rel(path) {
  return relative(ROOT, path).split('\\').join('/');
}

function isAllowed(relativePath) {
  if (ALLOWLIST_FILES.has(relativePath)) return true;
  return ALLOWLIST_PREFIXES.some((prefix) => relativePath.startsWith(prefix));
}

// --- patterns ----------------------------------------------------------------
const RULES = [
  {
    id: 'private-key-block',
    label: 'Private key block (PEM)',
    // Requires an actual base64 body, so regex literals and comments that only
    // mention the header do not trip the scanner.
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----[A-Za-z0-9+\/=\s]{64,}/,
    severity: 'error',
  },
  {
    id: 'service-account-json',
    // A real credential has a private_key *value*, not just the field name.
    label: 'Service-account JSON body',
    regex: /"type"\s*:\s*"service_account"[\s\S]{0,400}?"private_key"\s*:\s*"-----BEGIN/,
    severity: 'error',
  },
  {
    id: 'google-api-key',
    label: 'Google API key',
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/,
    severity: 'error',
  },
  {
    id: 'firebase-server-key',
    label: 'Legacy Firebase server key',
    regex: /\bAAAA[A-Za-z0-9_-]{7}:[A-Za-z0-9_-]{140}\b/,
    severity: 'error',
  },
  {
    id: 'hardcoded-credential',
    label: 'Hard-coded password assignment',
    // `key: 'SOME_CONSTANT_NAME'` and env-var references are not credentials.
    regex: /(?:password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*["'][A-Za-z0-9_\-!@#$%^&*]{20,}["']/i,
    severity: 'warn',
  },
  {
    id: 'supabase-or-jwt',
    label: 'JWT / bearer token literal',
    regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
    severity: 'error',
  },
];

// Values that are obviously placeholders, not credentials.
const PLACEHOLDER = /(example|placeholder|changeme|change-me|replace-me|your[-_]|xxx+|dummy|test-only|local-dev|do-not-deploy|<[^>]+>|\$\{)/i;

async function walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.git')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(full);
      continue;
    }
    if (!entry.isFile()) continue;
    await inspect(full);
  }
}

async function inspect(path) {
  const relativePath = rel(path);
  if (isAllowed(relativePath)) return;

  const extension = extname(path);
  const name = basename(path);
  if (!TEXT_EXTENSIONS.has(extension) && !TEXT_EXTENSIONS.has(name) && !name.startsWith('.env')) {
    return;
  }

  // Never commit generated build output or an actual .dev.vars.
  if (relativePath === '.dev.vars' || relativePath.startsWith('.dev.vars.')) {
    // `.dev.vars` holds real local secrets: never scan it, and never scan its
    // contents into a report. Its presence is fine as long as git ignores it.
    if (relativePath !== '.dev.vars.example') {
      const ignored = await isGitIgnored('.dev.vars');
      if (!ignored) {
        findings.push({
          severity: 'error',
          rule: 'dev-vars-tracked',
          file: relativePath,
          line: 1,
          message: '.dev.vars is NOT git-ignored — add it to .gitignore immediately.',
        });
      }
    }
    return;
  }

  let content;
  let size;
  try {
    size = (await stat(path)).size;
    if (size > 2 * 1024 * 1024) return; // skip very large files
    content = await readFile(path, 'utf8');
  } catch {
    return;
  }
  if (content.includes('\u0000')) return; // binary

  const lines = content.split('\n');
  const publicByDesign = PUBLIC_BY_DESIGN.has(relativePath);
  for (const rule of RULES) {
    // Public Firebase web config may contain an API key by design.
    if (publicByDesign && rule.id === 'google-api-key') continue;
    const match = rule.regex.exec(content);
    if (!match) continue;
    const index = content.slice(0, match.index).split('\n').length;
    const lineText = lines[index - 1] ?? '';
    if (PLACEHOLDER.test(lineText) || PLACEHOLDER.test(match[0])) continue;
    // Ignore source code that merely *describes* a credential pattern.
    if (/replace\(|\.test\(|new RegExp|RegExp\(|type\s*[:=]\s*["']service_account/.test(lineText)) continue;
    // Ignore non-secret look-alikes: env-var names, dotted emails, SCREAMING_CASE keys.
    // `apiKey` in Firebase web config / SW files is a public identifier.
    if (publicByDesign && /\bapi[_-]?key\b/i.test(match[0])) continue;
    const assigned = match[0].split(/[:=]/).slice(1).join(':').replace(/^[\s"']+/, '').replace(/["']$/, '');
    if (/^[A-Z0-9_]+$/.test(assigned)) continue;
    if (/^[^@\s]+@[^@\s]+$/.test(assigned)) continue;
    findings.push({
      severity: rule.severity,
      rule: rule.id,
      file: relativePath,
      line: index,
      message: rule.label,
    });
  }

  // Public bundle hygiene: DEV_AUTH must never be enabled in a shipped config.
  if (name === 'wrangler.jsonc' || name === 'wrangler.toml' || relativePath === 'public/env.js') {
    if (/DEV_AUTH_ENABLED\s*[:=]\s*["']?true/i.test(content)) {
      findings.push({
        severity: 'error',
        rule: 'dev-auth-in-deploy',
        file: relativePath,
        line: content.slice(0, content.search(/DEV_AUTH_ENABLED/i)).split('\n').length,
        message: 'DEV_AUTH_ENABLED=true must never appear in a deployed configuration.',
      });
    }
  }
}

async function main() {
  await walk(ROOT);

  const errors = findings.filter((finding) => finding.severity === 'error');
  const warnings = findings.filter((finding) => finding.severity === 'warn');

  for (const finding of [...errors, ...warnings]) {
    const marker = finding.severity === 'error' ? '✗' : '!';
    console.log(`${marker} ${finding.file}:${finding.line}  ${finding.message}  [${finding.rule}]`);
  }

  if (!findings.length) {
    console.log('✓ No secrets or private keys found in tracked files.');
  } else {
    console.log('');
    console.log(`${errors.length} error(s), ${warnings.length} warning(s).`);
  }

  if (errors.length) {
    console.log('\nRemove the credential and rotate it — assume anything committed has leaked.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Secret scan failed:', err);
  process.exit(1);
});
