const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const backendDir = path.resolve(__dirname, '..');
const frontendDir = path.resolve(process.env.FRONTEND_DIR || path.join(backendDir, '..', 'frontend'));
const strategy = (process.env.PM2_GIT_STRATEGY || 'hard').toLowerCase();
const autoUpdate = process.env.PM2_AUTO_UPDATE !== 'false';
const skipInstall = process.env.PM2_SKIP_INSTALL === 'true';
const skipFrontendBuild = process.env.PM2_SKIP_FRONTEND_BUILD === 'true';

function log(message) {
  console.log(`[PM2 deploy] ${message}`);
}

function run(command, args, options = {}) {
  const label = [command, ...args].join(' ');
  log(`${options.cwd || process.cwd()} $ ${label}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...(options.env || {}) },
    shell: process.platform === 'win32',
    stdio: 'inherit'
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status}): ${label}`);
  }
}

function output(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    shell: process.platform === 'win32',
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (result.status !== 0) return '';
  return String(result.stdout || '').trim();
}

function hasFile(dir, file) {
  return fs.existsSync(path.join(dir, file));
}

function isGitRepo(dir) {
  return output('git', ['rev-parse', '--is-inside-work-tree'], dir) === 'true';
}

function upstreamRef(dir) {
  const configured = output('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], dir);
  if (configured) return configured;
  const branch = output('git', ['branch', '--show-current'], dir) || process.env.PM2_GIT_BRANCH || 'main';
  return `origin/${branch}`;
}

function updateRepo(dir, name) {
  if (!fs.existsSync(dir)) {
    throw new Error(`${name} directory does not exist: ${dir}`);
  }
  if (!isGitRepo(dir)) {
    log(`${name}: not a git repository, skipping git update.`);
    return;
  }

  run('git', ['fetch', '--prune', 'origin'], { cwd: dir });
  const ref = upstreamRef(dir);

  if (strategy === 'ff-only') {
    run('git', ['pull', '--ff-only'], { cwd: dir });
    return;
  }

  if (strategy !== 'hard') {
    throw new Error(`Unsupported PM2_GIT_STRATEGY="${strategy}". Use "hard" or "ff-only".`);
  }

  log(`${name}: resetting tracked files to ${ref}. Local uncommitted tracked changes on VPS will be overwritten.`);
  run('git', ['reset', '--hard', ref], { cwd: dir });
}

function installDependencies(dir, name, omitDev = false) {
  if (skipInstall) {
    log(`${name}: dependency install skipped by PM2_SKIP_INSTALL=true.`);
    return;
  }

  const hasLock = hasFile(dir, 'package-lock.json');
  if (hasLock) {
    const args = omitDev ? ['ci', '--omit=dev'] : ['ci', '--include=dev'];
    run('npm', args, { cwd: dir, env: omitDev ? {} : { NODE_ENV: 'development' } });
    return;
  }

  const args = omitDev ? ['install', '--omit=dev'] : ['install', '--include=dev'];
  run('npm', args, { cwd: dir, env: omitDev ? {} : { NODE_ENV: 'development' } });
}

function buildFrontend() {
  if (skipFrontendBuild) {
    log('frontend: build skipped by PM2_SKIP_FRONTEND_BUILD=true.');
    return;
  }
  if (!fs.existsSync(frontendDir)) {
    throw new Error(`Frontend directory does not exist: ${frontendDir}`);
  }
  installDependencies(frontendDir, 'frontend', false);
  run('npm', ['run', 'build'], { cwd: frontendDir });
}

function deploy() {
  if (!autoUpdate) {
    log('Auto-update disabled by PM2_AUTO_UPDATE=false.');
    return;
  }

  log(`Backend: ${backendDir}`);
  log(`Frontend: ${frontendDir}`);
  log(`Git strategy: ${strategy}`);

  updateRepo(backendDir, 'backend');
  installDependencies(backendDir, 'backend', true);
  updateRepo(frontendDir, 'frontend');
  buildFrontend();
}

try {
  deploy();
  log('Starting backend server...');
  require(path.join(backendDir, 'server.js'));
} catch (error) {
  console.error('[PM2 deploy] Startup failed:', error.message);
  process.exit(1);
}
