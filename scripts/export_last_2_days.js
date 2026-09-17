#!/usr/bin/env node
/**
 * Export Dataset Script for QuizSolver / Quizonator
 *
 * Exports questions, page HTML snapshots, parser outputs, and AI answers
 * from the last 2 days (or custom timeframe) for offline analysis & testing.
 *
 * Usage:
 *   node scripts/export_last_2_days.js
 *   node scripts/export_last_2_days.js --days 2
 *   node scripts/export_last_2_days.js --hours 48
 *   node scripts/export_last_2_days.js --all
 *   node scripts/export_last_2_days.js --out ./exports/dataset.json
 *   node scripts/export_last_2_days.js --uri "mongodb://127.0.0.1:27017/quizsolver"
 *   node scripts/export_last_2_days.js --snapshots-only
 */

const fs = require('fs');
const path = require('path');

// Load .env
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');

// CLI Arguments parser
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    days: 2,
    hours: null,
    all: false,
    outFile: null,
    mongoUri: null,
    htmlDir: null,
    compact: false,
    snapshotsOnly: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--days' && args[i + 1]) {
      options.days = parseFloat(args[++i]);
    } else if (arg === '--hours' && args[i + 1]) {
      options.hours = parseFloat(args[++i]);
    } else if (arg === '--all') {
      options.all = true;
    } else if (arg === '--out' && args[i + 1]) {
      options.outFile = args[++i];
    } else if (arg === '--uri' && args[i + 1]) {
      options.mongoUri = args[++i];
    } else if (arg === '--html-dir' && args[i + 1]) {
      options.htmlDir = args[++i];
    } else if (arg === '--compact') {
      options.compact = true;
    } else if (arg === '--snapshots-only') {
      options.snapshotsOnly = true;
    }
  }

  return options;
}

// Extract HTML body from snapshot file by removing diagnostic header block
function extractHtmlFromSnapshotText(rawText) {
  if (!rawText) return '';
  const crlfSplit = rawText.indexOf('\r\n\r\n');
  if (crlfSplit !== -1) {
    return rawText.slice(crlfSplit + 4).trim();
  }
  const lfSplit = rawText.indexOf('\n\n');
  if (lfSplit !== -1) {
    return rawText.slice(lfSplit + 2).trim();
  }
  return rawText.trim();
}

// Parse metadata header + HTML from diagnostic snapshot file
function parseSnapshotFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const lines = raw.split(/\r?\n/);
    const metadata = {};
    let bodyIndex = -1;

    for (let i = 0; i < Math.min(lines.length, 30); i++) {
      const line = lines[i];
      if (line.trim() === '') {
        bodyIndex = i;
        break;
      }
      const match = line.match(/^([A-Za-z0-9 _-]+):\s*(.*)$/);
      if (match) {
        metadata[match[1].trim().toLowerCase()] = match[2].trim();
      }
    }

    const html = bodyIndex !== -1 ? lines.slice(bodyIndex + 1).join('\n').trim() : raw.trim();
    let createdAt = null;
    if (metadata.created) {
      const parsed = new Date(metadata.created);
      if (!isNaN(parsed.getTime())) createdAt = parsed;
    }
    if (!createdAt) {
      createdAt = fs.statSync(filePath).mtime;
    }

    return {
      filePath,
      fileName: path.basename(filePath),
      id: path.basename(filePath).replace(/\.(txt|html)$/i, ''),
      createdAt,
      url: metadata.url || '',
      platform: metadata.platform || 'universal',
      source: metadata.source || '',
      outcome: metadata.outcome || 'empty',
      userId: metadata['user id'] || '',
      html
    };
  } catch (err) {
    return null;
  }
}

// Scan directories for HTML snapshot text files
function buildSnapshotFileIndex(extraDir) {
  const candidateDirs = [
    extraDir,
    process.env.PARSER_SNAPSHOT_DIR,
    path.join(__dirname, '..', 'storage', 'parser-page-snapshots'),
    path.join(__dirname, '..', '..', 'bledyparser'),
    path.join(__dirname, '..', 'bledyparser'),
    path.join(process.cwd(), 'storage', 'parser-page-snapshots'),
    path.join(process.cwd(), 'bledyparser'),
    path.join(process.cwd(), '..', 'bledyparser')
  ].filter(Boolean);

  const fileMap = new Map(); // key -> absolute path
  const parsedSnapshots = [];

  for (const dir of candidateDirs) {
    const resolved = path.resolve(dir);
    if (!fs.existsSync(resolved)) continue;

    try {
      const files = fs.readdirSync(resolved);
      for (const file of files) {
        if (!file.endsWith('.txt') && !file.endsWith('.html')) continue;
        const fullPath = path.join(resolved, file);
        const baseName = path.basename(file);
        const idOnly = baseName.replace(/\.(txt|html)$/i, '');

        if (!fileMap.has(baseName)) {
          fileMap.set(baseName, fullPath);
          fileMap.set(idOnly, fullPath);

          const parsed = parseSnapshotFile(fullPath);
          if (parsed) parsedSnapshots.push(parsed);
        }
      }
    } catch (err) {
      // ignore unreadable directory
    }
  }

  return { fileMap, parsedSnapshots };
}

// Retrieve HTML snapshot content given snapshot info
function readSnapshotHtml(snapshotInfo, fileMap) {
  if (!snapshotInfo) return '';

  const fullFile = snapshotInfo.fullHtmlFile;
  const candidates = [
    fullFile?.filename,
    fullFile?.id,
    snapshotInfo.id,
    snapshotInfo.filename
  ].filter(Boolean);

  for (const key of candidates) {
    const filePath = fileMap.get(key);
    if (filePath && fs.existsSync(filePath)) {
      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const html = extractHtmlFromSnapshotText(raw);
        if (html) return html;
      } catch {}
    }
  }

  // Fallbacks stored directly in Mongo document
  if (snapshotInfo.fullPageHtml) return snapshotInfo.fullPageHtml;
  if (snapshotInfo.htmlSnippet) return snapshotInfo.htmlSnippet;
  if (snapshotInfo.bodyText) return `<pre>${snapshotInfo.bodyText}</pre>`;

  return '';
}

function normalizeText(text) {
  return String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Export purely from local snapshot files (offline mode)
function runOfflineSnapshotExport(parsedSnapshots, options, sinceDate, timeLabel) {
  console.log(`\n📦 Running offline snapshot export from local files...`);
  const filtered = options.all
    ? parsedSnapshots
    : parsedSnapshots.filter(s => s.createdAt >= sinceDate);

  console.log(`📂 Found ${filtered.length} matching snapshot files for timeframe (${timeLabel}).`);

  const dataset = filtered.map(snap => ({
    id: snap.id,
    timestamp: snap.createdAt,
    url: snap.url,
    platform: snap.platform,
    html: snap.html,
    parserOutput: {
      questionText: '',
      questionType: 'unknown',
      options: [],
      prompts: [],
      rows: [],
      imageUrl: null,
      confidence: 0,
      outcome: snap.outcome
    },
    aiResponse: null,
    feedback: {
      wasCorrect: false,
      userReportedError: false,
      expectedAnswer: null,
      notes: `Snapshot source: ${snap.source || 'diagnostic snapshot'}, outcome: ${snap.outcome}`
    }
  }));

  saveAndPrintSummary(dataset, options);
}

function saveAndPrintSummary(dataset, options) {
  // Sort dataset by timestamp descending (newest first)
  dataset.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  // Prepare destination
  const exportsDir = path.join(__dirname, '..', 'exports');
  if (!fs.existsSync(exportsDir)) {
    fs.mkdirSync(exportsDir, { recursive: true });
  }

  const timestampStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outPath = options.outFile
    ? path.resolve(options.outFile)
    : path.join(exportsDir, `dataset_export_${timestampStr}.json`);

  const jsonContent = options.compact
    ? JSON.stringify(dataset)
    : JSON.stringify(dataset, null, 2);

  fs.writeFileSync(outPath, jsonContent, 'utf8');

  // Stats calculation
  const total = dataset.length;
  const withHtml = dataset.filter(r => r.html && r.html.trim().length > 0).length;
  const withAi = dataset.filter(r => r.aiResponse !== null).length;
  const parserFailures = dataset.filter(r => r.aiResponse === null).length;
  const bugReported = dataset.filter(r => r.feedback?.userReportedError).length;

  const platformStats = {};
  for (const r of dataset) {
    platformStats[r.platform] = (platformStats[r.platform] || 0) + 1;
  }

  const fileSizeBytes = Buffer.byteLength(jsonContent, 'utf8');
  const fileSizeMb = (fileSizeBytes / (1024 * 1024)).toFixed(2);

  console.log(`\n======================================================`);
  console.log(`🎉 Export Completed Successfully!`);
  console.log(`======================================================`);
  console.log(`📁 File written to:     ${outPath}`);
  console.log(`📊 File size:           ${fileSizeMb} MB (${fileSizeBytes} bytes)`);
  console.log(`📋 Total records:       ${total}`);
  console.log(`🤖 Questions with AI:   ${withAi}`);
  console.log(`⚠️ Parser failures:     ${parserFailures}`);
  console.log(`🌐 Records with HTML:   ${withHtml} / ${total} (${total > 0 ? Math.round((withHtml / total) * 100) : 0}%)`);
  console.log(`🐛 Bug reports linked:  ${bugReported}`);
  console.log(`\n🏷️ Breakdown by platform:`);
  for (const [plt, count] of Object.entries(platformStats)) {
    console.log(`   - ${plt}: ${count}`);
  }
  console.log(`======================================================\n`);
}

async function main() {
  const options = parseArgs();
  const mongoUri = options.mongoUri || process.env.MONGODB_URI;

  // Calculate cutoff date
  let sinceDate = new Date(0);
  let timeLabel = 'all time';

  if (!options.all) {
    const hours = options.hours !== null ? options.hours : options.days * 24;
    sinceDate = new Date(Date.now() - hours * 60 * 60 * 1000);
    timeLabel = `last ${hours} hours (since ${sinceDate.toISOString()})`;
  }

  console.log(`\n======================================================`);
  console.log(`🚀 QuizSolver Dataset Exporter`);
  console.log(`📅 Target window: ${timeLabel}`);
  console.log(`======================================================\n`);

  // Build snapshot file index from local disks
  const { fileMap, parsedSnapshots } = buildSnapshotFileIndex(options.htmlDir);
  console.log(`📂 Found ${fileMap.size / 2} unique snapshot files on disk.`);

  if (options.snapshotsOnly) {
    runOfflineSnapshotExport(parsedSnapshots, options, sinceDate, timeLabel);
    return;
  }

  if (!mongoUri) {
    console.warn('⚠️ MONGODB_URI not set. Falling back to snapshots-only export.');
    runOfflineSnapshotExport(parsedSnapshots, options, sinceDate, timeLabel);
    return;
  }

  console.log(`📡 Connecting to MongoDB...`);

  try {
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 6000 });
  } catch (err) {
    console.warn('⚠️ Could not connect to MongoDB:', err.message);
    console.log('\n💡 Note: If MongoDB is hosted on your VPS, you can:');
    console.log('   1. Run this script directly on the VPS:');
    console.log('      cd /var/www/quizsolver/backend && node scripts/export_last_2_days.js');
    console.log('   2. Or pass a reachable MongoDB URI: --uri "mongodb://..."');
    console.log('   3. Or export local snapshot files with: node scripts/export_last_2_days.js --snapshots-only\n');

    if (parsedSnapshots.length > 0) {
      console.log('⚡ Exporting available offline snapshots instead...');
      runOfflineSnapshotExport(parsedSnapshots, options, sinceDate, timeLabel);
      return;
    }

    process.exit(1);
  }

  console.log('✅ Connected to MongoDB.');

  // Load models
  const CachedAnswer = require('../models/CachedAnswer');
  const ParserEvent = require('../models/ParserEvent');
  const StudyNote = require('../models/StudyNote');
  const CreditUsage = require('../models/CreditUsage');
  const BugReport = require('../models/BugReport');

  // Query collections
  console.log(`🔍 Querying database collections...`);
  const dateFilter = options.all ? {} : { $gte: sinceDate };

  const [cachedAnswers, parserEvents, studyNotes, creditUsages, bugReports] = await Promise.all([
    CachedAnswer.find(options.all ? {} : {
      $or: [{ createdAt: dateFilter }, { lastUsedAt: dateFilter }]
    }).lean(),

    ParserEvent.find(options.all ? {} : { createdAt: dateFilter }).lean(),

    StudyNote.find(options.all ? {} : {
      $or: [{ createdAt: dateFilter }, { updatedAt: dateFilter }, { lastSeenAt: dateFilter }]
    }).lean(),

    CreditUsage.find(options.all ? {} : { claimedAt: dateFilter }).lean(),

    BugReport.find(options.all ? {} : { createdAt: dateFilter }).lean()
  ]);

  console.log(`   - CachedAnswer entries: ${cachedAnswers.length}`);
  console.log(`   - ParserEvent entries:   ${parserEvents.length}`);
  console.log(`   - StudyNote entries:     ${studyNotes.length}`);
  console.log(`   - CreditUsage entries:   ${creditUsages.length}`);
  console.log(`   - BugReport entries:     ${bugReports.length}`);

  // Lookup maps
  const studyNotesByHash = new Map();
  for (const note of studyNotes) {
    if (note.questionHash && !studyNotesByHash.has(note.questionHash)) {
      studyNotesByHash.set(note.questionHash, note);
    }
  }

  const creditUsageByHash = new Map();
  for (const usage of creditUsages) {
    if (usage.questionHash && !creditUsageByHash.has(usage.questionHash)) {
      creditUsageByHash.set(usage.questionHash, usage);
    }
  }

  const bugReportsByEventId = new Map();
  const bugReportsByUrl = new Map();
  for (const bug of bugReports) {
    if (bug.parserEventId) bugReportsByEventId.set(String(bug.parserEventId), bug);
    if (bug.url) bugReportsByUrl.set(bug.url, bug);
  }

  // Pre-index ParserEvents by question text and URL
  const parserEventsByQuestionText = new Map();
  const parserEventsByUrl = new Map();
  for (const event of parserEvents) {
    const qTexts = event.snapshot?.questionTexts || [];
    for (const qText of qTexts) {
      const norm = normalizeText(qText);
      if (norm && !parserEventsByQuestionText.has(norm)) {
        parserEventsByQuestionText.set(norm, event);
      }
    }
    if (event.url && !parserEventsByUrl.has(event.url)) {
      parserEventsByUrl.set(event.url, event);
    }
  }

  const matchedEventIds = new Set();
  const dataset = [];

  // 1. Process Solved Questions (CachedAnswer)
  for (const cache of cachedAnswers) {
    const hash = cache.questionHash;
    const note = studyNotesByHash.get(hash);
    const usage = creditUsageByHash.get(hash);

    // Try finding corresponding ParserEvent
    const normText = normalizeText(cache.questionText);
    let matchedEvent = parserEventsByQuestionText.get(normText);

    if (!matchedEvent && note?.sourceUrl) {
      matchedEvent = parserEventsByUrl.get(note.sourceUrl);
    }

    if (matchedEvent) {
      matchedEventIds.add(String(matchedEvent._id));
    }

    // Resolve snapshot HTML
    let pageHtml = '';
    if (matchedEvent?.snapshot) {
      pageHtml = readSnapshotHtml(matchedEvent.snapshot, fileMap);
    } else if (note?.snapshot) {
      pageHtml = readSnapshotHtml(note.snapshot, fileMap);
    }

    // Correlate bug report
    const associatedBug = (matchedEvent && bugReportsByEventId.get(String(matchedEvent._id))) ||
                          (note?.sourceUrl && bugReportsByUrl.get(note.sourceUrl)) ||
                          null;

    const record = {
      id: String(cache._id),
      timestamp: cache.createdAt || cache.lastUsedAt || (usage?.claimedAt) || new Date(),
      url: note?.sourceUrl || matchedEvent?.url || '',
      platform: note?.platform || matchedEvent?.platform || 'universal',

      // 1. HTML code of page
      html: pageHtml || '',

      // 2. Parser output
      parserOutput: {
        questionText: cache.questionText,
        questionType: cache.questionType || 'radio',
        options: cache.options || [],
        prompts: cache.prompts || [],
        rows: cache.rows || [],
        imageUrl: cache.imageUrl || null,
        confidence: matchedEvent?.confidence ?? 1.0,
        outcome: matchedEvent?.outcome || 'success'
      },

      // 3. AI response
      aiResponse: {
        answer: cache.answer,
        explanation: note?.explanation || null,
        cached: Boolean(cache.hitCount > 1)
      },

      // 4. Feedback / Error reports
      feedback: {
        wasCorrect: null,
        userReportedError: Boolean(associatedBug),
        expectedAnswer: null,
        bugReport: associatedBug ? {
          description: associatedBug.description,
          source: associatedBug.source,
          createdAt: associatedBug.createdAt
        } : null
      }
    };

    dataset.push(record);
  }

  // 2. Process Unmatched ParserEvents (Failures / Diagnostic / Empty outcomes)
  for (const event of parserEvents) {
    if (matchedEventIds.has(String(event._id))) continue;

    const pageHtml = readSnapshotHtml(event.snapshot, fileMap);
    const associatedBug = bugReportsByEventId.get(String(event._id)) ||
                          (event.url && bugReportsByUrl.get(event.url)) ||
                          null;

    const firstQuestion = (event.snapshot?.questionTexts && event.snapshot.questionTexts[0]) || '';
    const optionsSample = event.snapshot?.optionsSample || [];
    const questionType = (event.questionTypes && event.questionTypes[0]) || 'unknown';

    const record = {
      id: String(event._id),
      timestamp: event.createdAt || new Date(),
      url: event.url || '',
      platform: event.platform || 'universal',

      // 1. HTML code of page
      html: pageHtml || '',

      // 2. Parser output
      parserOutput: {
        questionText: firstQuestion,
        questionType: questionType,
        options: optionsSample,
        prompts: [],
        rows: [],
        imageUrl: null,
        confidence: event.confidence ?? 0,
        outcome: event.outcome || 'empty',
        reason: event.reason || '',
        questionCountFound: event.questionCount || 0,
        optionCountFound: event.optionCount || 0,
        attemptedTypes: event.attemptedTypes || []
      },

      // 3. AI response (none, because parser failed or it was diagnostic)
      aiResponse: null,

      // 4. Feedback
      feedback: {
        wasCorrect: false,
        userReportedError: Boolean(associatedBug),
        expectedAnswer: null,
        notes: `Parser event outcome: ${event.outcome}${event.reason ? ` (${event.reason})` : ''}`,
        bugReport: associatedBug ? {
          description: associatedBug.description,
          source: associatedBug.source,
          createdAt: associatedBug.createdAt
        } : null
      }
    };

    dataset.push(record);
  }

  saveAndPrintSummary(dataset, options);
  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Fatal error during export:', err);
  process.exit(1);
});
