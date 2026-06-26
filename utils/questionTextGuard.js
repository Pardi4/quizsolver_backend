const { cleanQuizText } = require('./textSanitizer');

const QUESTION_COUNTER_SOURCE =
  '\\b(?:domanda|question|pytanie|pregunta|frage|aufgabe|vraag|pergunta|quesito)\\s*\\d+\\s*(?:di|of|de|del|von|z|/)\\s*\\d+\\b';

const QUESTION_TYPE_LABEL_SOURCE =
  '\\b(?:scelta\\s+multipla|multiple\\s+choice|single\\s+choice|single\\s+answer|multiple\\s+answers|true\\s*/\\s*false|vero\\s*/\\s*falso|opcion\\s+multiple|opcao\\s+multipla|choix\\s+multiple|mehrfachauswahl|wielokrotny\\s+wybor|jednokrotny\\s+wybor)\\b';

function normalizeMetaText(value) {
  return cleanQuizText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function stripQuestionChrome(value) {
  let text = cleanQuizText(value);
  if (!text) return '';

  text = text
    .replace(new RegExp(QUESTION_COUNTER_SOURCE, 'gi'), ' ')
    .replace(new RegExp(QUESTION_TYPE_LABEL_SOURCE, 'gi'), ' ')
    .replace(/\b(?:mandatory|required|obbligatoria|obligatoria|wymagane)\b/gi, ' ')
    .replace(/^[\s|:;.,\-*/\\\u00b7\u2022]+|[\s|:;.,\-*/\\\u00b7\u2022]+$/g, ' ');

  return cleanQuizText(text);
}

function isQuestionChromeOnly(value) {
  const compact = cleanQuizText(value);
  if (!compact) return false;

  const normalized = normalizeMetaText(compact);
  const stripped = stripQuestionChrome(compact);
  const words = stripped.split(/\s+/).filter(Boolean);
  const hasCounter = new RegExp(QUESTION_COUNTER_SOURCE, 'i').test(normalized);
  const hasTypeLabel = new RegExp(QUESTION_TYPE_LABEL_SOURCE, 'i').test(normalized);

  return (hasCounter || hasTypeLabel) && (stripped.length < 12 || words.length < 3);
}

function cacheSafeQuestionText(value) {
  const stripped = stripQuestionChrome(value);
  if (stripped) return stripped;
  return isQuestionChromeOnly(value) ? '' : cleanQuizText(value);
}

module.exports = {
  stripQuestionChrome,
  isQuestionChromeOnly,
  cacheSafeQuestionText
};
