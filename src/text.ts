/**
 * Dependency-free multilingual text primitives used by the local
 * heuristic provider. English-focused with basic CJK bigram support;
 * intentionally simple, fast and explainable.
 */

export function softmax(logits: number[], temperature = 1): number[] {
  const t = Math.max(temperature, 1e-6);
  const scaled = logits.map((l) => l / t);
  const max = Math.max(...scaled);
  const exps = scaled.map((l) => Math.exp(l - max));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map((e) => e / sum);
}

export function sigmoid(x: number): number {
  if (x >= 0) {
    const e = Math.exp(-x);
    return 1 / (1 + e);
  }
  const e = Math.exp(x);
  return e / (1 + e);
}

export function clamp(x: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, x));
}

const STOPWORDS = new Set([
  // English
  "the", "a", "an", "and", "or", "but", "is", "are", "was", "were", "be",
  "been", "being", "to", "of", "in", "on", "at", "for", "with", "by", "from",
  "as", "it", "this", "that", "these", "those", "i", "you", "he", "she", "we",
  "they", "me", "him", "her", "us", "them", "my", "your", "his", "its", "our",
  "their", "do", "does", "did", "have", "has", "had", "will", "would", "can",
  "could", "should", "shall", "may", "might", "must", "not", "no", "yes",
  "if", "then", "than", "so", "if", "about", "into", "over", "after", "before",
  // Chinese common particles / pronouns
  "的", "了", "是", "在", "我", "你", "他", "她", "它", "们", "这", "那", "和",
  "与", "或", "就", "都", "也", "要", "会", "能", "可", "吗", "呢", "吧", "啊",
]);

/**
 * Tokenize mixed English/CJK text.
 * - Latin/digit runs >= 2 chars (or single meaningful CJK chars)
 * - CJK bigrams to capture phrases like 垃圾/邮件
 */
export function tokenize(text: string): string[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  const tokens: string[] = [];

  // Latin / numeric words
  const latin = lower.match(/[a-z0-9][a-z0-9'_-]*/g) ?? [];
  for (const w of latin) {
    if (w.length >= 2 && !STOPWORDS.has(w)) tokens.push(w);
  }

  // CJK chars + adjacent bigrams
  const cjkChars: string[] = [];
  for (const ch of lower) {
    if (/[一-鿿぀-ヿ가-힯]/.test(ch)) {
      if (!STOPWORDS.has(ch)) cjkChars.push(ch);
    }
  }
  for (let i = 0; i < cjkChars.length; i++) {
    tokens.push(cjkChars[i]!);
    if (i + 1 < cjkChars.length) {
      tokens.push(cjkChars[i]! + cjkChars[i + 1]!);
    }
  }
  return tokens;
}

/** Word-overlap logit: how strongly `text` matches `label`. */
export function overlapScore(label: string, text: string): number {
  const labelTokens = tokenize(label);
  if (labelTokens.length === 0) return 0;
  const textSet = new Set(tokenize(text));
  let hits = 0;
  for (const t of labelTokens) if (textSet.has(t)) hits++;
  // Normalize by label length so long labels don't dominate unfairly.
  return hits / Math.sqrt(labelTokens.length);
}

export function normalize(s: string | undefined | null): string {
  return (s ?? "").trim();
}
