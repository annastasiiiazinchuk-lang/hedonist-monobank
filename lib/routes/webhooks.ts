import { processMonobankWebhook } from '../services/monobank/monobank-webhook';
import type { MonobankWebhookBody } from '../types/monobank';
import { json } from '../http/responses';

export async function handleMonobankWebhook(request: Request): Promise<Response> {
  let body: MonobankWebhookBody;
  try {
    body = await request.json() as MonobankWebhookBody;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  try {
    return await processMonobankWebhook(body);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[Webhooks] Error processing Monobank webhook:', errMsg);
    return json({ error: 'Internal server error' }, 500);
  }
}
