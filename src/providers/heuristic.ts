import type { DecisionProvider, DecisionRequest, ProviderResult } from "../types.js";
import { fnv1a } from "../hash.js";
import { overlapScore, sigmoid, softmax, tokenize } from "../text.js";

/**
 * Local heuristic "System 1" provider.
 *
 * A transparent, zero-dependency model that actually works: it ranks candidates
 * by lexical overlap with the question/context, detects sentiment-bearing
 * words for yes/no and score calls, and boosts urgency signals for ranking.
 *
 * It is the default provider: instant, free, offline, and fully explainable.
 * When the text carries no signal it falls back to a content-hashed guess with
 * appropriately low confidence.
 */
export class HeuristicProvider implements DecisionProvider {
  readonly name = "heuristic";
  readonly capabilities = {
    location: "local" as const,
    notes:
      "Lexical heuristics (EN + CJK): overlap, sentiment, urgency. Offline, explainable.",
  };
  readonly costPerCallUsd = 0;

  isAvailable(): boolean {
    return true;
  }

  async decide(request: DecisionRequest): Promise<ProviderResult> {
    switch (request.kind) {
      case "choice":
        return this.choose(request);
      case "yesno":
        return this.yesno(request);
      case "score":
        return this.score(request);
      case "rank":
        return this.rank(request);
    }
  }

  private fullText(r: DecisionRequest): string {
    return `${r.question ?? ""}\n${r.context ?? ""}`.toLowerCase();
  }

  private choose(r: Extract<DecisionRequest, { kind: "choice" }>): ProviderResult {
    const text = this.fullText(r);
    const textSet = new Set(tokenize(text));
    const logits = r.candidates.map((candidate) => {
      let logit = overlapScore(candidate, text) * 3;
      const label = candidate.toLowerCase();
      // Exact phrase / substring containment is a strong signal.
      if (label.length >= 2 && text.includes(label)) logit += 2.5;
      // When the question expresses urgency, candidates that name an
      // incident severity or a security issue are genuinely more likely.
      if (URGENCY_INTENT.test(r.question ?? "") || URGENCY_INTENT.test(r.context ?? "")) {
        if (/\b(p[0-4]|sev-?[0-2]|critical|blocker|outage|down)\b/.test(label)) logit += 1.7;
        if (/\b(leak|leakage|breach|security|vulnerab)\b/.test(label)) logit += 1.3;
        if (/紧急|故障|宕机|漏洞|高危|泄露/.test(label)) logit += 1.4;
      }
      // Label semantics: expand short labels (spam, billing...) with their
      // characteristic vocabulary so a message about "account locked, click
      // to pay" matches "spam" even if the word never appears.
      for (const [canonical, signals] of LABEL_SIGNALS) {
        if (label === canonical || label.includes(canonical)) {
          for (const sig of signals) {
            // "!" prefix marks a high-precision signal worth more weight.
            const strong = sig.startsWith("!");
            const needle = strong ? sig.slice(1) : sig;
            const hit = needle.length === 1 ? textSet.has(needle) : text.includes(needle);
            if (hit) logit += strong ? 2.0 : 1.1;
          }
        }
      }
      return logit;
    });

    if (logits.every((l) => l === 0)) {
      // No lexical signal: if labels include an explicit "none/other" bucket,
      // prefer it (a detector should not cry wolf on empty evidence);
      // otherwise fall back to a deterministic hash guess.
      const noneIdx = r.candidates.findIndex((c) => NONE_LABELS.has(c.toLowerCase()));
      if (noneIdx >= 0) {
        const probabilities = softmax(
          r.candidates.map((_, i) => (i === noneIdx ? 0.8 : 0)),
          1,
        );
        return { kind: "choice", index: noneIdx, probabilities };
      }
      const n = r.candidates.length;
      const probs = r.candidates.map(
        (c) => 0.5 + (fnv1a(JSON.stringify(r) + "::" + c) % 1000) / 1000,
      );
      const probabilities = softmax(probs.map((p) => p / n), 2);
      const index = probs.indexOf(Math.max(...probs));
      return { kind: "choice", index, probabilities };
    }

    // Weak signals with an explicit "none" bucket: let the detector abstain.
    const maxLogit = Math.max(...logits);
    if (maxLogit < 0.55) {
      const noneIdx = r.candidates.findIndex((c) => NONE_LABELS.has(c.toLowerCase()));
      if (noneIdx >= 0) logits[noneIdx] = Math.max(logits[noneIdx] ?? 0, 0.8);
    }

    const probabilities = softmax(logits, 1);
    const index = logits.indexOf(Math.max(...logits));
    return { kind: "choice", index, probabilities };
  }

  private yesno(r: Extract<DecisionRequest, { kind: "yesno" }>): ProviderResult {
    if (r.mode === "safety") return this.safetyGate(r);

    const tokens = new Set(tokenize(this.fullText(r)));
    let pos = 0;
    let neg = 0;
    for (const w of POSITIVE) if (tokens.has(w)) pos++;
    for (const w of NEGATIVE) if (tokens.has(w)) neg++;

    const text = this.fullText(r);
    // Direct phrase bonuses.
    if (/\b(yes|yeah|yep|sure|confirm|confirmed|approved|true)\b/.test(text)) pos += 2;
    if (/\b(no|nope|denied|rejected|false|cancel)\b/.test(text)) neg += 2;
    if (/可以|是的|确认|同意|批准|没问题/.test(text)) pos += 2;
    if (/不行|拒绝|否决|取消|没有|无法|禁止/.test(text)) neg += 2;

    const p = round(sigmoid((pos - neg) * 1.4));
    return { kind: "yesno", answer: p >= 0.5, probability: p };
  }

  /**
   * Fail-closed safety gate. Neutral technical text ("the test failed")
   * is NOT danger; only explicit attack / secret patterns score.
   * No signal at all => a low-confidence "no", never a silent "yes".
   */
  private safetyGate(r: Extract<DecisionRequest, { kind: "yesno" }>): ProviderResult {
    const text = this.fullText(r);
    let danger = 0;
    for (const pat of DANGER_STRONG) if (pat.test(text)) danger += 2;
    for (const pat of DANGER_WEAK) if (pat.test(text)) danger += 1;
    if (/sk-[a-z0-9_-]{8,}/i.test(text) || /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) {
      danger += 2;
    }
    const p = round(sigmoid(danger * 1.3 - 1.2));
    return { kind: "yesno", answer: p >= 0.5, probability: p };
  }

  private score(r: Extract<DecisionRequest, { kind: "score" }>): ProviderResult {
    const min = r.min ?? 0;
    const max = r.max ?? 10;
    const tokens = new Set(tokenize(this.fullText(r)));
    let pos = 0;
    let neg = 0;
    for (const w of POSITIVE) if (tokens.has(w)) pos++;
    for (const w of NEGATIVE) if (tokens.has(w)) neg++;
    const t = sigmoid((pos - neg) * 0.9); // (0,1)
    const score = round(min + t * (max - min));
    return { kind: "score", score };
  }

  private rank(r: Extract<DecisionRequest, { kind: "rank" }>): ProviderResult {
    const anchor = `${r.criterion ?? ""}\n${r.question ?? ""}`;
    const text = this.fullText(r);
    const raw = r.items.map((item, index) => {
      let s = overlapScore(item, anchor) * 2 + overlapScore(item, text) * 0.5;
      const lower = item.toLowerCase();
      if (URGENCY.some((u) => lower.includes(u))) s += 1.2;
      const m = lower.match(/\b(p[0-4]|sev-?[0-2]|critical|blocker)\b/);
      if (m) s += 1.5;
      if (/\b(leak|leakage|breach|data[ -]?loss|security|vulnerab)\b/.test(lower)) s += 1.4;
      if (/漏洞|泄漏|泄露|安全|高危/.test(item)) s += 1.4;
      if (s === 0) s = (fnv1a(JSON.stringify(r) + "::" + item) % 1000) / 2000;
      return { index, score: s };
    });
    const values = raw.map((x) => x.score);
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const normalized = raw.map((x) => ({
      index: x.index,
      score: hi === lo ? 0.5 : round((x.score - lo) / (hi - lo)),
    }));
    normalized.sort((a, b) => b.score - a.score);
    return { kind: "rank", ranking: normalized };
  }
}

const POSITIVE = new Set([
  "good", "great", "excellent", "amazing", "love", "perfect", "happy", "safe",
  "working", "works", "fixed", "pass", "passes", "passed", "success", "successful",
  "approve", "approved", "allow", "accept", "valid", "ready", "complete", "done",
  "yes", "true", "stable", "benefit", "healthy",
  "好", "棒", "优秀", "完美", "安全", "正常", "通过", "成功", "同意", "批准",
  "允许", "有效", "完成", "稳定", "健康", "喜欢",
]);

const NEGATIVE = new Set([
  "bad", "terrible", "awful", "hate", "broken", "bug", "error", "fail", "fails",
  "failed", "failure", "crash", "crashes", "danger", "dangerous", "risk", "risky",
  "reject", "rejected", "deny", "denied", "block", "blocked", "vulnerable",
  "spam", "scam", "phishing", "suspicious", "fraud", "urgent payment", "no",
  "false", "toxic", "leak", "outage", "critical bug",
  "坏", "差", "危险", "错误", "失败", "崩溃", "风险", "拒绝", "否决", "阻止",
  "漏洞", "垃圾", "诈骗", "钓鱼", "可疑", "欺诈", "泄漏", "中断", "严重",
]);

const URGENCY = ["urgent", "asap", "immediately", "emergency", "now", "立即", "紧急", "马上", "尽快"];

const URGENCY_INTENT =
  /urgent|urgency|priority|prioriti[sz]e|incident|critical|asap|first|sooner|emergency|紧急|优先|事故|严重|马上/;

/** Label names that mean "nothing detected / the default bucket". */
const NONE_LABELS = new Set([
  "none",
  "other",
  "normal",
  "clean",
  "ok",
  "safe",
  "benign",
  "无",
  "没有",
  "其他",
  "其它",
  "正常",
  "无异常",
]);

/**
 * Characteristic vocabulary for common classification labels.
 * Keys are matched exactly or as substrings of a candidate label
 * (e.g. "spam", "report-spam", "垃圾邮件"). Single chars/tokens use set
 * membership; longer phrases use substring matching.
 */
const LABEL_SIGNALS: ReadonlyArray<readonly [string, readonly string[]]> = [
  [
    "spam",
    ["click here", "verify your account", "account locked", "account suspended",
      "pay immediately", "within 24h", "wire transfer", "unsubscribe", "winner",
      "you have won", "free gift", "lottery", "nigerian", "confirm your identity",
      "垃圾", "诈骗", "钓鱼", "中奖", "退订", "点击链接", "立即支付", "账户冻结"],
  ],
  [
    "billing",
    ["invoice", "receipt", "payment due", "renewal", "subscription", "refund",
      "charge", "charged", "tax", "payroll", "账单", "发票", "收据", "续费",
      "订阅", "退款", "扣款", "缴费"],
  ],
  [
    "work",
    ["meeting", "standup", "sprint", "jira", "deploy", "pull request", "standby",
      "on-call", "timesheet", "stakeholder", "会议", "部署", "周报", "排期", "值班"],
  ],
  [
    "personal",
    ["family", "mom", "dad", "birthday", "dinner", "weekend plans", "vacation photo",
      "家人", "生日", "晚饭", "周末", "照片"],
  ],
  [
    "urgent",
    ["urgent", "asap", "emergency", "immediately", "outage", "down", "p0", "sev-1",
      "紧急", "立即", "故障", "宕机", "马上"],
  ],
  [
    "newsletter",
    ["newsletter", "this week in", "digest", "roundup", "unsubscribe",
      "订阅周刊", "日报", "周报精选", "newsletter"],
  ],
  [
    "phishing",
    ["verify", "suspicious login", "password reset you didn't", "fake invoice",
      "lookalike", "credential", "钓鱼", "仿冒", "盗用", "可疑登录"],
  ],
  [
    "support",
    ["ticket", "support request", "help center", "customer reported",
      "工单", "客服", "售后", "反馈"],
  ],
  // Chinese canonical label keys (substring-matched against CJK labels).
  [
    "垃圾",
    ["冻结", "封号", "验证", "点击链接", "立即", "中奖", "退订", "钓鱼", "诈骗",
      "可疑", "24小时", "永久", "账户异常", "陌生链接"],
  ],
  ["账单", ["发票", "收据", "续费", "扣款", "缴费", "账单", "报销", "对账单", "付款通知"]],
  ["工作", ["会议", "部署", "周报", "排期", "值班", "评审", "请假", "审批"]],
  ["个人", ["家人", "生日", "晚饭", "周末", "照片", "聚会"]],
  ["紧急", ["紧急", "立即", "故障", "宕机", "马上", "雪崩", "告警"]],
  ["钓鱼", ["钓鱼", "仿冒", "盗用", "可疑登录", "伪装", "骗取"]],
  ["客服", ["工单", "售后", "客服", "反馈", "投诉"]],
  // PII / secret labels.
  [
    "api-key",
    ["!api key", "!apikey", "!sk-", "!secret key", "access token", "!bearer ",
      "!private key", "!client secret", "密钥", "私钥", "令牌"],
  ],
  [
    "email",
    ["e-mail", "email address", "emailed", "@gmail", "@outlook", "@qq.com",
      "@163.com", "邮箱", "电子邮件"],
  ],
  [
    "phone",
    ["phone number", "call me at", "mobile:", "tel:", "电话", "手机", "手机号"],
  ],
  [
    "id-number",
    ["passport", "ssn", "social security", "id number", "identity card",
      "身份证", "护照", "证件号"],
  ],
  // Intent labels used by agent routers.
  [
    "faq",
    ["hours", "contact", "where is", "support hours", "location", "几点",
      "地址", "联系方式", "营业时间"],
  ],
  [
    "transactional",
    ["refund", "invoice", "payment", "charge", "billing", "subscription",
      "cancel order", "duplicate", "退款", "发票", "账单", "扣款", "取消订单", "续费"],
  ],
  [
    "reasoning",
    ["typescript", "javascript", "python", "compile", "compiler", "generic",
      "stack trace", "exception", "algorithm", "architecture", "explain why",
      "类型", "编译", "算法", "架构", "为什么", "原理"],
  ],
  [
    "attack",
    ["ignore previous", "system prompt", "jailbreak", "act as", "pretend",
      "export all", "注入", "忽略指令", "绕过", "提权", "未授权"],
  ],
  // Content-policy labels.
  [
    "allow",
    ["thank", "thanks", "welcome", "here is your", "have a nice", "hello",
      "sunny", "weather", "great", "appreciate", "谢谢", "祝您", "天气"],
  ],
  [
    "warn",
    ["reset link", "expires", "verification", "verify your email", "one-time code",
      "即将过期", "验证码", "重置", "请核验"],
  ],
  [
    "block",
    ["your api key", "your password", "sk-", "private key", "leaked",
      "credentials", "illegal", "malware", "phishing", "export all",
      "违法", "密钥", "泄露密码"],
  ],
];

/** High-confidence attack / dangerous-content patterns (weight 2). */
const DANGER_STRONG: RegExp[] = [
  /ignore\s+(?:all\s+)?(?:previous|prior|above|earlier|system)\s+(?:instructions?|prompts?|rules?)/i,
  /disregard\s+(?:the\s+|all\s+|your\s+)?(?:previous|above|prior|safety)/i,
  /reveal\s+(?:your\s+|the\s+)?(?:system\s+)?prompt|show\s+me\s+your\s+instructions/i,
  /export\s+(?:all\s+|the\s+|every\s+)?(?:passwords?|credentials?|customer|users?)\s*(?:data|table|list)?/i,
  /\brm\s+-rf\b|\bdrop\s+table\b|format\s+c:/i,
  /忽略(?:以上|前面|之前|所有).{0,6}(?:指令|提示|规则)/,
  /导出.{0,4}(?:所有)?(?:密码|凭证|用户数据)/,
];

/** Weaker signals — suspicious phrasing worth one vote (weight 1). */
const DANGER_WEAK: RegExp[] = [
  /\b(?:you are now|pretend to be|roleplay as|play the role of)\b/i,
  /\bjailbreak\b|\bprompt injection\b/i,
  /\bact as\b[^.]{0,40}(?:admin|root|developer|unrestricted)/i,
  /你现在是|扮演.{0,6}(?:管理员|开发者|无限制)/,
  /绕过.{0,4}(?:安全|权限|审核|限制)/,
];

function round(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}
