const { OpenAI } = require('openai');
const { cleanQuizText } = require('../utils/textSanitizer');

const FAST_MODEL = process.env.OPENAI_MODEL_FAST || process.env.OPENAI_MODEL || 'gpt-4o-mini';
const ACCURATE_MODEL = process.env.OPENAI_MODEL_ACCURATE || process.env.OPENAI_FALLBACK_MODEL || 'gpt-4o';
const BASE_MODEL = FAST_MODEL;
const MAX_IMAGE_DATA_URL_LENGTH = 5.5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

let openaiInstance = null;

function getOpenAI() {
  if (!openaiInstance) {
    if (!process.env.OPENAI_API_KEY) {
      throw new AIError('MODEL_ERROR', 'OPENAI_API_KEY not configured.');
    }
    openaiInstance = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiInstance;
}

class AIError extends Error {
  constructor(type, message) {
    super(message);
    this.type = type;
  }
}

function parseDataImage(imageUrl) {
  const match = String(imageUrl || '').match(/^data:(image\/(?:jpeg|png|gif|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  return { base64: match[2], mimeType: match[1] };
}

async function fetchImageAsBase64(imageUrl) {
  const dataImage = parseDataImage(imageUrl);
  if (dataImage) return dataImage;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  let res;
  try {
    res = await fetch(imageUrl, { signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    throw new AIError('IMAGE_FETCH', err.name === 'AbortError'
      ? 'Image fetch timed out.'
      : `Image fetch failed: ${err.message}`);
  }
  clearTimeout(timer);

  if (!res.ok) throw new AIError('IMAGE_FETCH', `Image server returned ${res.status}.`);

  const mimeType = (res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
  if (!ALLOWED_IMAGE_TYPES.has(mimeType))
    throw new AIError('IMAGE_FETCH', `Unsupported image type: ${mimeType}`);

  const buffer = await res.arrayBuffer();
  return { base64: Buffer.from(buffer).toString('base64'), mimeType };
}

function imageUrlFromBase64(base64, mimeType) {
  return `data:${mimeType};base64,${base64}`;
}

function getSystemMessage(type) {
  if (type === 'checkbox') {
    return 'You answer quiz questions. Return ONLY correct zero-based option numbers separated by commas. Example: 0,2,3. No words. If unsure, still choose the best options.';
  }
  if (type === 'text') {
    return 'You answer quiz questions. Return ONLY the final answer in the shortest useful form. No explanation, no markdown, no lead-in sentence, no final period. If the question asks what an acronym stands for, return only the expanded phrase in lowercase unless proper nouns require capitals. Example question: what is html? Example answer: hypertext markup language.';
  }
  return 'You answer quiz questions. Return ONLY the correct zero-based option number. Example: 2. No words. If unsure, still choose the best option.';
}

function buildUserPrompt(text, options) {
  if (!options || options.length === 0) return text;
  return text + '\n' + options.map((o, i) => `${i}. ${o}`).join('\n');
}

function getMaxTokens(type) {
  if (type === 'checkbox') return 20;
  if (type === 'text') return 40;
  return 5;
}

const LETTER_MAP = { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5 };

function shortenTextAnswer(text) {
  let value = String(text || '')
    .replace(/\*\*/g, '')
    .replace(/^[-*•]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();

  const acronymExpansion = value.match(/^\s*[A-Z0-9]{2,}\s+(?:stands\s+for|means|oznacza|to\s+skrot\s+od|to\s+skrót\s+od)\s+([^.!?]+)/i);
  if (acronymExpansion) {
    return acronymExpansion[1].replace(/^[:\-–—]\s*/, '').replace(/[.!?。]+$/g, '').trim().toLowerCase();
  }

  value = value
    .replace(/^(?:the\s+answer\s+is|answer\s*:|correct\s+answer\s*:|odpowiedz\s*:|odpowiedź\s*:|poprawna\s+odpowiedź\s*:)\s*/i, '')
    .trim();

  const firstLine = value.split(/\r?\n/)[0].trim();
  const firstSentence = firstLine.match(/^(.{1,160}?[.!?])\s+/);
  return (firstSentence ? firstSentence[1] : firstLine).replace(/[.!?。]+$/g, '').trim();
}

function parseAnswer(raw, type, options) {
  if (!raw || typeof raw !== 'string') {
    throw new AIError('INVALID_RESPONSE', 'Empty AI response.');
  }

  let text = raw
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();

  if (/^(uncertain|unknown|not sure|nie wiem|niepewne)\b/i.test(text)) {
    throw new AIError('INVALID_RESPONSE', `Uncertain AI response: "${raw}"`);
  }

  text = text
    .replace(/^(answer|response|correct|correct answer|odpowiedz|odpowiedź|poprawna odpowiedź)\s*[:=]\s*/i, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/[.!?。]+$/g, '')
    .trim();

  text = text.replace(/\bOption\s+([A-F])\b/gi, (_, l) => LETTER_MAP[l.toUpperCase()] ?? l);
  text = text.replace(/\b([A-F])[.)]\s/gi, (_, l) => LETTER_MAP[l.toUpperCase()] ?? l);
  text = text.replace(/^([A-F])$/gi, (_, l) => LETTER_MAP[l.toUpperCase()] ?? l);

  if (type === 'checkbox') {
    if (text === '') return [];
    const indices = [...new Set(text
      .split(/[,\s;]+/)
      .map(s => parseInt(s.trim(), 10))
      .filter(n => !isNaN(n) && n >= 0 && (!options || n < options.length)))];
    if (indices.length === 0) {
      throw new AIError('INVALID_RESPONSE', `Cannot parse checkbox answer: "${raw}"`);
    }
    return indices;
  }

  if (type === 'text') {
    if (!text) throw new AIError('INVALID_RESPONSE', 'AI returned empty text answer.');
    return shortenTextAnswer(text);
  }

  const match = text.match(/(\d+)/);
  if (!match) {
    throw new AIError('INVALID_RESPONSE', `Cannot parse radio answer: "${raw}"`);
  }
  const idx = parseInt(match[1], 10);
  if (options && (idx < 0 || idx >= options.length)) {
    throw new AIError('INVALID_RESPONSE', `Index ${idx} out of range (${options.length} options).`);
  }
  return idx;
}

const HARD_QUESTION_PATTERN = /\b(image|photo|picture|diagram|chart|graph|table|screenshot|calculate|equation|formula|select all|choose all|all that apply|multiple answers|obraz|zdjec|grafik|wykres|diagram|tabela|rysun|oblicz|wzor|zaznacz|wybierz wszystkie|wielokrot)\b/i;

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function detectModelReason(questionData) {
  const options = Array.isArray(questionData.options) ? questionData.options : [];
  const text = String(questionData.text || '');
  const combined = normalizeSearchText(`${text} ${options.join(' ')}`);

  if (questionData.imageUrl) return 'image';
  if (questionData.type === 'checkbox') return 'multiple-choice';
  if (options.length > 6) return 'many-options';
  if (text.length > 650) return 'long-question';
  if (HARD_QUESTION_PATTERN.test(combined)) return 'hard-keyword';
  return 'simple';
}

function getInitialAIRoute(questionData) {
  const reason = detectModelReason(questionData);
  const useAccurate = reason !== 'simple';
  return {
    model: useAccurate ? ACCURATE_MODEL : FAST_MODEL,
    imageDetail: 'low',
    reason
  };
}

function isFallbackableModelError(error) {
  if (error.type === 'INVALID_RESPONSE') return true;
  if (error.type !== 'MODEL_ERROR') return false;
  return /model|unsupported|unavailable|overloaded|temporarily|rate limit|not found|does not exist/i.test(error.message || '');
}

function getFallbackAIRoute(questionData, error, attemptedRoute) {
  if (!isFallbackableModelError(error)) return null;

  if (attemptedRoute.model !== ACCURATE_MODEL) {
    return {
      model: ACCURATE_MODEL,
      imageDetail: questionData.imageUrl ? 'high' : 'low',
      reason: `fallback:${error.type || 'error'}`
    };
  }

  if (questionData.imageUrl && attemptedRoute.imageDetail !== 'high' && error.type === 'INVALID_RESPONSE') {
    return {
      model: ACCURATE_MODEL,
      imageDetail: 'high',
      reason: 'retry:image-high-detail'
    };
  }

  return null;
}

async function buildQuestionContent(questionData, imageDetail = 'low') {
  const { text, options, imageUrl } = questionData;
  const userContent = [{ type: 'text', text: buildUserPrompt(text, options) }];

  if (imageUrl) {
    const { base64, mimeType } = await fetchImageAsBase64(imageUrl);
    userContent.push({
      type: 'image_url',
      image_url: { url: imageUrlFromBase64(base64, mimeType), detail: imageDetail }
    });
  }

  return userContent;
}

async function requestChatCompletion(body) {
  const openai = getOpenAI();
  try {
    const response = await openai.chat.completions.create({
      model: body.model,
      temperature: body.temperature,
      max_tokens: body.max_completion_tokens,
      messages: body.messages,
    }, { timeout: 30000 });

    return response.choices[0]?.message?.content?.trim() || '';
  } catch (err) {
    if (err.status === 408 || err.message.includes('timeout')) {
      throw new AIError('AI_TIMEOUT', 'AI request timed out (30s).');
    }
    throw new AIError('MODEL_ERROR', err.message);
  }
}

async function callAIWithModel(questionData, model, imageDetail = 'low') {
  const { type, imageUrl, text, options } = questionData;
  const body = {
    model,
    temperature: 0,
    max_completion_tokens: getMaxTokens(type),
    messages: [
      { role: 'system', content: getSystemMessage(type) },
      { role: 'user', content: await buildQuestionContent(questionData, imageDetail) }
    ]
  };

  console.log('[AI] ->', JSON.stringify({ model, type, hasImage: !!imageUrl, imageDetail, textLen: text.length }));
  const raw = await requestChatCompletion(body);
  console.log('[AI] <-', raw.substring(0, 120));
  return parseAnswer(raw, type, options);
}

async function callAI(questionData) {
  const initialRoute = getInitialAIRoute(questionData);
  try {
    console.log('[AI Route]', JSON.stringify(initialRoute));
    return await callAIWithModel(questionData, initialRoute.model, initialRoute.imageDetail);
  } catch (error) {
    const fallbackRoute = getFallbackAIRoute(questionData, error, initialRoute);
    if (!fallbackRoute) throw error;
    console.warn('[AI] fallback ->', JSON.stringify({
      from: initialRoute.model,
      to: fallbackRoute.model,
      reason: fallbackRoute.reason,
      error: error.type || error.message
    }));
    return callAIWithModel(questionData, fallbackRoute.model, fallbackRoute.imageDetail);
  }
}

function parseSnapshotPayload(raw) {
  const cleaned = String(raw || '')
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    const answer = shortenTextAnswer(parsed.answer || parsed.finalAnswer || '');
    const question = (parsed.question || parsed.extractedQuestion || '').substring(0, 1000);
    if (!answer) throw new Error('Missing answer.');
    return { answer, extractedQuestion: question || 'FocusScan image question' };
  } catch {
    const answerMatch = cleaned.match(/answer["']?\s*[:=-]\s*([^{}\n]+)/i);
    const questionMatch = cleaned.match(/question["']?\s*[:=-]\s*([^{}\n]+)/i);
    const answer = shortenTextAnswer(answerMatch ? answerMatch[1] : cleaned);
    if (!answer) throw new AIError('INVALID_RESPONSE', 'Could not parse FocusScan answer.');
    return {
      answer,
      extractedQuestion: (questionMatch ? questionMatch[1] : 'FocusScan image question').substring(0, 1000)
    };
  }
}

async function callSnapshotAI(imageData, model, imageDetail = 'low') {
  const { base64, mimeType } = await fetchImageAsBase64(imageData);
  const body = {
    model,
    temperature: 0,
    max_completion_tokens: 160,
    messages: [
      {
        role: 'system',
        content: 'You solve quiz questions from screenshots. Return compact JSON only: {"question":"short extracted question","answer":"shortest final answer without a final period"}. If choices are visible, answer with the exact choice text, not its letter. No markdown.'
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Extract the visible question from this selected screenshot region and solve it. Keep the answer as short as possible.' },
          { type: 'image_url', image_url: { url: imageUrlFromBase64(base64, mimeType), detail: imageDetail } }
        ]
      }
    ]
  };

  console.log('[AI Snapshot] ->', JSON.stringify({ model, imageDetail, size: imageData.length }));
  const raw = await requestChatCompletion(body);
  console.log('[AI Snapshot] <-', raw.substring(0, 160));
  return parseSnapshotPayload(raw);
}

async function solveSnapshotImage(imageData) {
  const initialRoute = { model: ACCURATE_MODEL, imageDetail: 'low', reason: 'focusscan' };
  try {
    console.log('[AI Snapshot Route]', JSON.stringify(initialRoute));
    return await callSnapshotAI(imageData, initialRoute.model, initialRoute.imageDetail);
  } catch (error) {
    if (error.type !== 'INVALID_RESPONSE' || initialRoute.imageDetail === 'high') throw error;
    console.warn('[AI Snapshot] retry ->', JSON.stringify({
      model: ACCURATE_MODEL,
      reason: 'image-high-detail',
      error: error.type || error.message
    }));
    return callSnapshotAI(imageData, ACCURATE_MODEL, 'high');
  }
}

async function callExplanationAI(text, options, answer, type, explanationLanguage = 'auto') {
  let answerText = '';
  if (type === 'radio' && options) answerText = options[answer] || String(answer);
  else if (type === 'checkbox' && options) answerText = answer.map(i => options[i] || i).join(', ');
  else answerText = String(answer);

  const languageHint = explanationLanguage === 'pl'
    ? 'Answer in Polish.'
    : explanationLanguage === 'en'
      ? 'Answer in English.'
      : 'Answer in the same language as the question when clear.';

  const body = {
    model: BASE_MODEL,
    temperature: 0,
    max_completion_tokens: 80,
    messages: [
      { role: 'system', content: `Explain briefly why this answer is correct. Max 2 sentences. Be concise. ${languageHint}` },
      { role: 'user', content: `Question: ${text}\nCorrect answer: ${answerText}` }
    ]
  };

  const raw = await requestChatCompletion(body);
  return raw || 'No explanation available.';
}

module.exports = {
  AIError,
  MAX_IMAGE_DATA_URL_LENGTH,
  parseDataImage,
  shortenTextAnswer,
  callAI,
  solveSnapshotImage,
  callExplanationAI
};
