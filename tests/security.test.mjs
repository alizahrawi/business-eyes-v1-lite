import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { boundedInteger, readJsonBody, RequestValidationError } from "../lib/request-security.ts";
import { authenticateTelegram } from "../lib/telegram-auth.ts";

const BOT_TOKEN = ["123456789", "local_test_token_that_is_never_used_online"].join(":");

function signedInitData(user, authDate = Math.floor(Date.now() / 1000)) {
  const values = new URLSearchParams({
    auth_date: String(authDate),
    query_id: "local-security-test",
    user: JSON.stringify(user),
  });
  const checkString = [...values.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  values.set("hash", createHmac("sha256", secret).update(checkString).digest("hex"));
  return values.toString();
}

test("accepts fresh, correctly signed Telegram initData", async () => {
  const initData = signedInitData({ id: 12345, first_name: "Zahra", username: "zahra_test" });
  const user = await authenticateTelegram(initData, BOT_TOKEN);
  assert.equal(user?.id, 12345);
});

test("rejects tampered and expired Telegram initData", async () => {
  const valid = signedInitData({ id: 12345, first_name: "Zahra" });
  assert.equal(await authenticateTelegram(valid.replace("Zahra", "Attacker"), BOT_TOKEN), null);
  const expired = signedInitData({ id: 12345, first_name: "Zahra" }, Math.floor(Date.now() / 1000) - 3601);
  assert.equal(await authenticateTelegram(expired, BOT_TOKEN), null);
});

test("rejects invalid Telegram user fields and oversized initData", async () => {
  const invalidId = signedInitData({ id: -1, first_name: "Invalid" });
  assert.equal(await authenticateTelegram(invalidId, BOT_TOKEN), null);
  assert.equal(await authenticateTelegram(`x=${"a".repeat(9000)}`, BOT_TOKEN), null);
});

test("reads bounded JSON requests", async () => {
  const request = new Request("https://example.test/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ safe: true }),
  });
  assert.deepEqual(await readJsonBody(request, 1024), { safe: true });
});

test("rejects unsupported content types and oversized bodies", async () => {
  const wrongType = new Request("https://example.test/api", { method: "POST", body: "{}" });
  await assert.rejects(() => readJsonBody(wrongType, 1024), (error) => error instanceof RequestValidationError && error.status === 415);

  const oversized = new Request("https://example.test/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value: "x".repeat(200) }),
  });
  await assert.rejects(() => readJsonBody(oversized, 32), (error) => error instanceof RequestValidationError && error.status === 413);
});

test("uses safe integer bounds for runtime security limits", () => {
  assert.equal(boundedInteger("6", 10, 1, 60), 6);
  assert.equal(boundedInteger("0", 10, 1, 60), 10);
  assert.equal(boundedInteger("999", 10, 1, 60), 10);
  assert.equal(boundedInteger("invalid", 10, 1, 60), 10);
});
