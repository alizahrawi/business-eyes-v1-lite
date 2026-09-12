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

async function hmac(key: ArrayBuffer | Uint8Array, value: string) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(value));
}

export async function authenticateTelegram(initData: string, botToken: string) {
  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");
  if (!receivedHash || !/^[a-f0-9]{64}$/i.test(receivedHash)) return null;

  params.delete("hash");
  params.delete("signature");
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = await hmac(new TextEncoder().encode("WebAppData"), botToken);
  const calculatedHash = toHex(await hmac(secret, dataCheckString));

  let difference = 0;
  for (let index = 0; index < calculatedHash.length; index += 1) {
    difference |= calculatedHash.charCodeAt(index) ^ receivedHash.charCodeAt(index);
  }

  const authDate = Number(params.get("auth_date"));
  const age = Math.floor(Date.now() / 1000) - authDate;
  if (difference !== 0 || !authDate || age < 0 || age > 3600) return null;

  try {
    const user = JSON.parse(params.get("user") || "null") as TelegramUser | null;
    return user && Number.isSafeInteger(user.id) ? user : null;
  } catch {
    return null;
  }
}
