const fs = require('fs');
const path = require('path');
const util = require('util');

const DEFAULT_LOGS_DIR = path.resolve(__dirname, '..', 'logs');
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB per file
const MAX_BACKUP_FILES = 5;

// Strip ANSI terminal color escape codes from log files
const ANSI_REGEX = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;

function stripAnsi(text) {
  return typeof text === 'string' ? text.replace(ANSI_REGEX, '') : text;
}

class AsyncLogWriter {
  constructor(filePath, maxSize = MAX_FILE_SIZE, maxFiles = MAX_BACKUP_FILES) {
    this.filePath = filePath;
    this.maxSize = maxSize;
    this.maxFiles = maxFiles;
    this.queue = [];
    this.writing = false;
    this.currentSize = 0;
    this.init();
  }

  init() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      if (fs.existsSync(this.filePath)) {
        this.currentSize = fs.statSync(this.filePath).size;
      }
    } catch {}
  }

  write(message) {
    this.queue.push(stripAnsi(message));
    this.flush();
  }

  async flush() {
    if (this.writing || this.queue.length === 0) return;
    this.writing = true;

    try {
      const chunk = this.queue.join('');
      this.queue.length = 0;
      const bytes = Buffer.byteLength(chunk, 'utf8');

      if (this.currentSize + bytes > this.maxSize) {
        this.rotateSync();
      }

      await fs.promises.appendFile(this.filePath, chunk, 'utf8');
      this.currentSize += bytes;
    } catch (err) {
      try { process.stderr.write(`[LogWriter] ${err.message}\n`); } catch {}
    } finally {
      this.writing = false;
      if (this.queue.length > 0) {
        setImmediate(() => this.flush());
      }
    }
  }

  rotateSync() {
    try {
      for (let i = this.maxFiles - 1; i >= 1; i--) {
        const older = `${this.filePath}.${i + 1}`;
        const newer = `${this.filePath}.${i}`;
        if (fs.existsSync(newer)) {
          try { fs.renameSync(newer, older); } catch {}
        }
      }
      if (fs.existsSync(this.filePath)) {
        try { fs.renameSync(this.filePath, `${this.filePath}.1`); } catch {}
      }
      this.currentSize = 0;
    } catch (err) {
      try { process.stderr.write(`[LogWriter rotation error] ${err.message}\n`); } catch {}
    }
  }
}

let isInitialized = false;
let activeLogsDir = DEFAULT_LOGS_DIR;
let appWriter = null;
let errorWriter = null;
let originalConsole = null;

function formatLog(level, args) {
  const timestamp = new Date().toISOString();
  const formattedArgs = util.formatWithOptions
    ? util.formatWithOptions({ depth: 5, colors: false }, ...args)
    : util.format(...args);
  return `[${timestamp}] [${level}] ${formattedArgs}\n`;
}

function initLogger(options = {}) {
  if (isInitialized) return;
  isInitialized = true;

  activeLogsDir = options.logsDir || DEFAULT_LOGS_DIR;
  const appLogPath = path.join(activeLogsDir, 'app.log');
  const errorLogPath = path.join(activeLogsDir, 'error.log');

  appWriter = new AsyncLogWriter(appLogPath, options.maxSize, options.maxFiles);
  errorWriter = new AsyncLogWriter(errorLogPath, options.maxSize, options.maxFiles);

  originalConsole = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug ? console.debug.bind(console) : console.log.bind(console)
  };

  console.log = function(...args) {
    originalConsole.log(...args);
    try { appWriter.write(formatLog('INFO', args)); } catch {}
  };

  console.info = function(...args) {
    originalConsole.info(...args);
    try { appWriter.write(formatLog('INFO', args)); } catch {}
  };

  console.warn = function(...args) {
    originalConsole.warn(...args);
    try {
      const line = formatLog('WARN', args);
      appWriter.write(line);
      errorWriter.write(line);
    } catch {}
  };

  console.error = function(...args) {
    originalConsole.error(...args);
    try {
      const line = formatLog('ERROR', args);
      appWriter.write(line);
      errorWriter.write(line);
    } catch {}
  };

  console.debug = function(...args) {
    originalConsole.debug(...args);
    try { appWriter.write(formatLog('DEBUG', args)); } catch {}
  };

  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? (reason.stack || reason.message) : String(reason);
    const line = formatLog('UNHANDLED_REJECTION', [err]);
    try {
      appWriter.write(line);
      errorWriter.write(line);
    } catch {}
  });

  process.on('uncaughtException', (err) => {
    const line = formatLog('UNCAUGHT_EXCEPTION', [err?.stack || err?.message || err]);
    try {
      appWriter.write(line);
      errorWriter.write(line);
    } catch {}
  });

  console.log(`[Logger] Backend console logging active -> ${appLogPath} (all logs) & ${errorLogPath} (errors only)`);
}

async function getRecentLogs(type = 'app', maxLines = 300) {
  const filePath = path.join(activeLogsDir, type === 'error' ? 'error.log' : 'app.log');
  if (!fs.existsSync(filePath)) return [];
  try {
    const content = await fs.promises.readFile(filePath, 'utf8');
    const lines = content.trim().split('\n');
    return lines.slice(-maxLines);
  } catch (err) {
    return [`Error reading logs: ${err.message}`];
  }
}

function getLogFilesInfo() {
  if (!fs.existsSync(activeLogsDir)) return [];
  try {
    const files = fs.readdirSync(activeLogsDir);
    return files.map(file => {
      const fullPath = path.join(activeLogsDir, file);
      const stat = fs.statSync(fullPath);
      return {
        name: file,
        sizeBytes: stat.size,
        sizeMb: (stat.size / (1024 * 1024)).toFixed(2),
        updatedAt: stat.mtime
      };
    });
  } catch {
    return [];
  }
}

module.exports = {
  initLogger,
  getRecentLogs,
  getLogFilesInfo,
  LOGS_DIR: DEFAULT_LOGS_DIR
};
