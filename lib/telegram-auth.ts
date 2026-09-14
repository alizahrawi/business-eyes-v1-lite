export type TelegramUser = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
};

function toHex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function encode(value: string) {
  return new TextEncoder().encode(value).buffer as ArrayBuffer;
}

async function hmac(key: ArrayBuffer, value: string) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, encode(value));
}

export async function authenticateTelegram(initData: string, botToken: string) {
  if (!initData || initData.length > 8192 || !botToken) return null;
  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash")?.toLowerCase();
  if (!receivedHash || !/^[a-f0-9]{64}$/i.test(receivedHash)) return null;

  params.delete("hash");
  params.delete("signature");
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = await hmac(encode("WebAppData"), botToken);
  const calculatedHash = toHex(await hmac(secret, dataCheckString));

  let difference = 0;
  for (let index = 0; index < calculatedHash.length; index += 1) {
    difference |= calculatedHash.charCodeAt(index) ^ receivedHash.charCodeAt(index);
  }

  const authDate = Number(params.get("auth_date"));
  const age = Math.floor(Date.now() / 1000) - authDate;
  if (difference !== 0 || !Number.isSafeInteger(authDate) || authDate <= 0 || age < 0 || age > 3600) return null;

  try {
    const user = JSON.parse(params.get("user") || "null") as TelegramUser | null;
    if (!user || !Number.isSafeInteger(user.id) || user.id <= 0) return null;
    if (typeof user.first_name !== "string" || user.first_name.length < 1 || user.first_name.length > 128) return null;
    if (user.last_name !== undefined && (typeof user.last_name !== "string" || user.last_name.length > 128)) return null;
    if (user.username !== undefined && (typeof user.username !== "string" || !/^[A-Za-z0-9_]{1,64}$/.test(user.username))) return null;
    return user;
  } catch {
    return null;
  }
}
