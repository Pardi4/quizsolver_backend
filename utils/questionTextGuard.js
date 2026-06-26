const { cleanQuizText } = require('./textSanitizer');

const QUESTION_COUNTER_SOURCE =
  '\\b(?:domanda|question|pytanie|pytania|zadanie|pregunta|frage|aufgabe|vraag|pergunta|questao|quesito|soru|fraga|kysymys|otazka|otazka|otazky|otazka|feladat|pitanje|prasanje|vprasanje)\\s*\\d+\\s*(?:di|of|de|del|von|z|ze|/)\\s*\\d+\\b';

const QUESTION_LABEL_SOURCE =
  '\\b(?:domanda|question|pytanie|pytania|zadanie|pregunta|frage|aufgabe|vraag|pergunta|questao|quesito|soru|fraga|kysymys|otazka|otazky|feladat|pitanje|prasanje|vprasanje)\\s*(?:nr\\.?|no\\.?|n\\.?|#)?\\s*\\d+\\b';

const LANGUAGE_NEUTRAL_COUNTER_PREFIX_SOURCE =
  '^\\s*(?:(?:[#№]|q|qu|qs|p|ex|task|item)\\s*)?\\d{1,4}\\s*(?:(?:/|of|out\\s+of|z|ze|de|del|di|von|van|sur|av|af)\\s*\\d{1,4})?\\s*[\\u00b7\\u2022|:;.,\\-–—)]\\s*';

const QUESTION_TYPE_LABEL_SOURCE =
  '\\b(?:scelta\\s+multipla|multiple\\s+choice|single\\s+choice|single\\s+answer|multiple\\s+answers|true\\s*/\\s*false|vero\\s*/\\s*falso|opcion\\s+multiple|opcao\\s+multipla|choix\\s+multiple|mehrfachauswahl|wielokrotny\\s+wybor|jednokrotny\\s+wybor)\\b';

const QUESTION_INSTRUCTION_SOURCE =
  '\\b(?:select\\s+(?:(?:one|all)(?:\\s+answers?)?|the\\s+correct\\s+answer)|choose\\s+(?:(?:one|all)(?:\\s+answers?)?|the\\s+correct\\s+answer)|pick\\s+(?:one|all)(?:\\s+answers?)?|mark\\s+(?:(?:one|all)(?:\\s+answers?)?|the\\s+correct\\s+answer)|wybierz\\s+(?:jedna|jedno|wszystkie|poprawna|prawidlowa)(?:\\s+odpowiedz(?:i)?)?|zaznacz\\s+(?:jedna|jedno|wszystkie|poprawna|prawidlowa)(?:\\s+odpowiedz(?:i)?)?|scegli\\s+(?:una|tutte)(?:\\s+rispost[ae])?|scegli\\s+la\\s+risposta\\s+corretta|seleziona\\s+(?:una|tutte)(?:\\s+rispost[ae])?|seleziona\\s+la\\s+risposta\\s+corretta|elige\\s+(?:una|todas)(?:\\s+respuestas?)?|elige\\s+la\\s+respuesta\\s+correcta|selecciona\\s+(?:una|todas)(?:\\s+respuestas?)?|selecciona\\s+la\\s+respuesta\\s+correcta)\\b';

function normalizeMetaText(value) {
  return cleanQuizText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function hasStandaloneNumber(value) {
  return /(^|[^\p{L}\p{N}])\d{1,4}($|[^\p{L}\p{N}])/u.test(String(value || ''));
}

function isLanguageNeutralCounterOnly(value) {
  const normalized = normalizeMetaText(value);
  if (/[=+*<>]/.test(normalized)) return false;
  if (!normalized || /[?¿？]/.test(normalized)) return false;

  const compact = normalized
    .replace(new RegExp(QUESTION_TYPE_LABEL_SOURCE, 'gi'), ' ')
    .replace(new RegExp(QUESTION_INSTRUCTION_SOURCE, 'gi'), ' ')
    .replace(/\b(?:mandatory|required|obbligatoria|obligatoria|wymagane)\b/gi, ' ')
    .replace(/[\u00b7\u2022|:;.,\-–—()[\]{}]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!compact) return false;
  if (/^(?:(?:[#№]|q|qu|qs|p|ex|task|item)\s*)?\d{1,4}(?:\s*(?:\/|of|out\s+of|z|ze|de|del|di|von|van|sur|av|af)\s*\d{1,4})?$/.test(compact)) {
    return true;
  }

  const words = compact.split(/\s+/).filter(Boolean);
  return words.length <= 2 && hasStandaloneNumber(compact) &&
    !/^(?:what|which|who|when|where|why|how|co|jaki|jaka|jakie|ktory|ktora|kiedy|gdzie|dlaczego|come|cosa|quale|quando|donde|porque|por\s+que|que)\b/i.test(compact);
}

function stripQuestionChrome(value) {
  let text = cleanQuizText(value);
  if (!text) return '';

  text = text
    .replace(new RegExp(QUESTION_COUNTER_SOURCE, 'gi'), ' ')
    .replace(new RegExp(QUESTION_LABEL_SOURCE, 'gi'), ' ')
    .replace(new RegExp(LANGUAGE_NEUTRAL_COUNTER_PREFIX_SOURCE, 'iu'), ' ')
    .replace(new RegExp(QUESTION_TYPE_LABEL_SOURCE, 'gi'), ' ')
    .replace(new RegExp(QUESTION_INSTRUCTION_SOURCE, 'gi'), ' ')
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
  const hasLabel = new RegExp(QUESTION_LABEL_SOURCE, 'i').test(normalized);
  const hasTypeLabel = new RegExp(QUESTION_TYPE_LABEL_SOURCE, 'i').test(normalized);
  const hasInstruction = new RegExp(QUESTION_INSTRUCTION_SOURCE, 'i').test(normalized);
  const hasNeutralCounter = isLanguageNeutralCounterOnly(compact);

  return (hasCounter || hasLabel || hasTypeLabel || hasInstruction || hasNeutralCounter) &&
    (stripped.length < 12 || words.length < 3);
}

function cacheSafeQuestionText(value) {
  if (isQuestionChromeOnly(value)) return '';
  const stripped = stripQuestionChrome(value);
  if (stripped) return stripped;
  return cleanQuizText(value);
}

const QUESTION_WORD_PATTERN =
  /\b(?:what|which|who|when|where|why|how|define|identify|calculate|select|choose|co|jaki|jaka|jakie|ktory|ktora|kiedy|gdzie|dlaczego|ile|oblicz|wybierz|zaznacz|come|cosa|quale|quando|donde|porque|por\s+que|que|wie|was|welche|welcher|wann|wo|warum)\b/i;

const UI_ONLY_PATTERN =
  /^(?:next|submit|continue|skip|previous|back|send|confirm|cancel|start|finish|dalej|poprzednie|nastepne|pomin|wyslij|kontynuuj|zatwierdz|odpowiedz|login|sign in|score|result|time|remaining)$/i;

function assessQuestionQuality(value, questionData = {}) {
  const raw = cleanQuizText(value);
  const hasImage = !!(questionData.imageUrl || questionData.imageAlt || questionData.imageCaption);
  if (!raw) {
    return hasImage
      ? { ok: true, score: 35, reason: 'image-only-question' }
      : { ok: false, score: -100, reason: 'empty-question-text' };
  }

  if (isQuestionChromeOnly(raw)) {
    return hasImage
      ? { ok: true, score: 30, reason: 'image-with-chrome-text' }
      : { ok: false, score: -80, reason: 'quiz-metadata-only' };
  }

  const stripped = stripQuestionChrome(raw) || raw;
  const normalized = normalizeMetaText(stripped);
  const words = stripped.split(/\s+/).filter(Boolean);
  const options = Array.isArray(questionData.options) ? questionData.options.filter(Boolean) : [];
  const prompts = Array.isArray(questionData.prompts) ? questionData.prompts.filter(Boolean) : [];
  const rows = Array.isArray(questionData.rows) ? questionData.rows.filter(Boolean) : [];
  const isTextAnswer = questionData.type === 'text';
  const isManualSelection = questionData.manualSelection === true;
  const hasMathSignal = /[=+\-*/]|<|>/.test(stripped);
  const hasQuestionSignal = /[?=<>]/.test(stripped) || QUESTION_WORD_PATTERN.test(normalized);
  const hasStructuredContext = options.length >= 2 || prompts.length > 0 || rows.length > 0;

  let score = 0;
  if (stripped.length >= 12) score += 10;
  if (stripped.length >= 24) score += 15;
  if (words.length >= 3) score += 15;
  if (words.length >= 6) score += 10;
  if (hasQuestionSignal) score += 25;
  if (hasStructuredContext) score += 15;
  if (hasImage) score += 20;
  if (hasMathSignal) score += 15;
  if (isTextAnswer && hasMathSignal) score += 10;
  if (isManualSelection && stripped.length >= 8) score += 15;
  if (words.length < 2 && !hasImage && !/[=+\-*/<>]/.test(stripped)) score -= 35;
  if (UI_ONLY_PATTERN.test(normalized)) score -= 50;
  if (/\b(?:points?|score|result|time|remaining|answered|unanswered|correct|incorrect|pkt|punkty|punti|puntos|czas)\b/i.test(normalized) && !hasQuestionSignal) score -= 20;

  const threshold = isManualSelection ? 15 : 25;
  return {
    ok: hasImage || score >= threshold,
    score,
    reason: score >= threshold ? 'question-quality-ok' : 'low-question-quality'
  };
}

module.exports = {
  stripQuestionChrome,
  isQuestionChromeOnly,
  cacheSafeQuestionText,
  assessQuestionQuality
};
