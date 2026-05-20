const TECHNICAL_CONTROL_TOKEN_PATTERN = /\b(?:zoom[-_\s]*(?:in|out)|fullscreen|full[-_\s]*screen|image[-_\s]*(?:preview|zoom|viewer)|lightbox|magnify|viewer[-_\s]*(?:button|control))\b/gi;

function normalizeControlText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isStandaloneControlLine(value) {
  const normalized = normalizeControlText(value);
  if (!normalized) return true;
  return /^(?:zoom (?:in|out)|fullscreen|full screen|image (?:preview|zoom|viewer)|lightbox|magnify|viewer (?:button|control))$/.test(normalized);
}

function stripQuizUiNoise(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .split(/\r?\n/)
    .map(line => {
      if (isStandaloneControlLine(line)) return '';
      return String(line || '')
        .replace(TECHNICAL_CONTROL_TOKEN_PATTERN, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    })
    .filter(Boolean)
    .join(' ');
}

function cleanQuizText(value) {
  return stripQuizUiNoise(value)
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = { cleanQuizText, stripQuizUiNoise, isStandaloneControlLine };
