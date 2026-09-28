import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { HttpProvider, normalizeResult } from "../src/providers/http.js";
import { ProviderError } from "../src/errors.js";
import type { DecisionRequest } from "../src/types.js";

let server: http.Server;
let baseUrl: string;
const receivedBodies: unknown[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      receivedBodies.push(JSON.parse(body || "{}"));
      const url = req.url ?? "";
      if (url.includes("/fail")) {
        res.writeHead(500).end("internal error");
        return;
      }
      if (url.includes("/yesno")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ answer: "yes", probability: 0.9 }));
        return;
      }
      if (url.includes("/choice-by-label")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ choice: "b" }));
        return;
      }
      if (url.includes("/rank-order")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ order: [2, 0, 1] }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ index: 1, probabilities: [0.2, 0.7, 0.1] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("HttpProvider (Decide Wire Protocol)", () => {
  it("posts the request and parses a choice response", async () => {
    const p = new HttpProvider({ name: "srv", url: baseUrl, location: "cloud" });
    const r = await p.decide({ kind: "choice", question: "q", candidates: ["a", "b", "c"] });
    if (r.kind !== "choice") throw new Error("wrong kind");
    expect(r.index).toBe(1);
    expect(receivedBodies.at(-1)).toMatchObject({ kind: "choice", candidates: ["a", "b", "c"] });
  });

  it("sends bearer auth when an API key is configured", async () => {
    const p = new HttpProvider({ name: "srv", url: baseUrl + "/yesno", apiKey: "secret" });
    const r = await p.decide({ kind: "yesno", question: "q?" });
    expect(r).toMatchObject({ kind: "yesno", answer: true });
    expect(p.isAvailable()).toBe(true);
  });

  it("accepts label-shaped choice responses", async () => {
    const p = new HttpProvider({ name: "srv", url: baseUrl + "/choice-by-label" });
    const r = await p.decide({ kind: "choice", question: "q", candidates: ["a", "b"] });
    if (r.kind !== "choice") throw new Error("wrong kind");
    expect(r.index).toBe(1);
  });

  it("accepts order-shaped rank responses", async () => {
    const p = new HttpProvider({ name: "srv", url: baseUrl + "/rank-order" });
    const r = await p.decide({ kind: "rank", items: ["x", "y", "z"] });
    if (r.kind !== "rank") throw new Error("wrong kind");
    expect(r.ranking.map((x) => x.index)).toEqual([2, 0, 1]);
  });

  it("wraps non-2xx responses in ProviderError", async () => {
    const p = new HttpProvider({ name: "srv", url: baseUrl + "/fail" });
    await expect(p.decide({ kind: "yesno", question: "q?" })).rejects.toBeInstanceOf(ProviderError);
  });

  it("reports unavailable without an API key when required", () => {
    const p = new HttpProvider({
      name: "jevish",
      url: baseUrl,
      requiresApiKey: true,
    });
    expect(p.isAvailable()).toBe(false);
  });

  it("times out via AbortSignal", async () => {
    const slow = http.createServer((_req, res) => setTimeout(() => res.end("{}"), 200));
    await new Promise<void>((resolve) => slow.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(slow.address() as AddressInfo).port}`;
    const p = new HttpProvider({ name: "slow", url, timeoutMs: 30 });
    await expect(p.decide({ kind: "yesno", question: "q?" })).rejects.toBeInstanceOf(
      ProviderError,
    );
    slow.close();
  });
});

describe("normalizeResult validation", () => {
  const choiceReq: DecisionRequest = { kind: "choice", candidates: ["a", "b"] };
  it("rejects malformed payloads", () => {
    expect(() => normalizeResult(choiceReq, { unhelpful: true }, "p")).toThrow();
    expect(() =>
      normalizeResult({ kind: "score" }, { nope: 1 }, "p"),
    ).toThrow();
    expect(() =>
      normalizeResult({ kind: "rank", items: ["a"] }, { weird: [] }, "p"),
    ).toThrow();
  });

  it("normalizes yesno boolean/string forms", () => {
    const r1 = normalizeResult({ kind: "yesno" }, { answer: "yes" }, "p");
    expect(r1).toMatchObject({ kind: "yesno", answer: true });
    const r2 = normalizeResult({ kind: "yesno" }, { probability: 0.2 }, "p");
    expect(r2).toMatchObject({ kind: "yesno", answer: false, probability: 0.2 });
  });
});
