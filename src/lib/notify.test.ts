import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ create: vi.fn(), count: vi.fn(), queueEmail: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: { notification: { create: h.create, count: h.count } } }));
vi.mock("@/lib/email", () => ({ sendEmail: h.queueEmail }));

const { notify, sendMessage } = await import("./notify");

const email = { to: "a@b.co", kind: "agent_trade_buy", subject: "s", html: "h", text: "t" };

beforeEach(() => {
  h.create.mockReset().mockResolvedValue({});
  h.count.mockReset().mockResolvedValue(0);
  h.queueEmail.mockReset().mockResolvedValue("mail-id");
  delete process.env.NOTIFY_WEBHOOK_URL;
});

describe("notify", () => {
  it("delivers to in-app and email", async () => {
    expect(await notify({ inApp: { userId: "u", kind: "agent_trade", title: "Auto-Trader BUY: NVDA" }, email })).toEqual({ inApp: true, email: true, message: false });
  });

  it("never throws when email fails, and still delivers in-app", async () => {
    h.queueEmail.mockRejectedValue(new Error("SMTP down"));
    await expect(notify({ inApp: { userId: "u", kind: "agent_trade", title: "x" }, email })).resolves.toEqual({ inApp: true, email: false, message: false });
  });

  it("never throws when the in-app write fails, and still sends email", async () => {
    h.create.mockRejectedValue(new Error("db down"));
    await expect(notify({ inApp: { userId: "u", kind: "agent_trade", title: "x" }, email })).resolves.toEqual({ inApp: false, email: true, message: false });
  });

  it("drops a repeated event inside the dedupe window on every channel", async () => {
    h.count.mockResolvedValue(1);
    expect(await notify({ inApp: { userId: "u", kind: "agent_market_closed", title: "x", dedupeMs: 60_000 }, email })).toEqual({ inApp: false, email: false, message: false });
    expect(h.queueEmail).not.toHaveBeenCalled();
  });
});

describe("sendMessage", () => {
  it("does nothing without a configured webhook", async () => {
    expect(await sendMessage("hi")).toBe(false);
  });

  it("posts to the webhook and survives a network error", async () => {
    process.env.NOTIFY_WEBHOOK_URL = "https://hooks.example.test/x";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("ok")).mockRejectedValueOnce(new Error("offline"));
    expect(await sendMessage("Auto-Trader BUY NVDA")).toBe(true);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ text: "Auto-Trader BUY NVDA" });
    expect(await sendMessage("again")).toBe(false);
    fetchMock.mockRestore();
  });
});
