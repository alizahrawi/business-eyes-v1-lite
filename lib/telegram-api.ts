export async function telegramApi<T>(
  botToken: string,
  method: string,
  body: Record<string, unknown>,
) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json()) as { ok: boolean; result?: T; description?: string };
  if (!response.ok || !data.ok) {
    throw new Error(data.description || `Telegram API error: ${method}`);
  }
  return data.result as T;
}
