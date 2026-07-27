import { env } from '../../config/env';
import type { StoredPaymentMetadata } from '../../types/checkout';
import type { MonobankWebhookBody } from '../../types/monobank';
import { asNumber, asString, sha256 } from '../../utils/format';

export async function sendMetaPurchaseEvent(
  payment: StoredPaymentMetadata,
  webhookBody: MonobankWebhookBody,
): Promise<void> {
  if (!env.metaPixelId || !env.metaAccessToken) return;

  const customer = payment.customer || {};
  const tracking = payment.tracking || {};
  const eventId = `mono_${asString(webhookBody.invoiceId) || Date.now()}`;
  const amount = asNumber(webhookBody.finalAmount || webhookBody.amount) / 100 || asNumber(payment.amount);
  const payload = {
    data: [
      {
        event_name: 'Purchase',
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventId,
        action_source: 'website',
        event_source_url: asString(tracking.page_url || tracking.landing_page),
        user_data: {
          em: sha256(customer.email),
          ph: sha256(customer.phone),
          fn: sha256(customer.first_name),
          ln: sha256(customer.last_name),
          fbp: asString(tracking.fbp),
          fbc: asString(tracking.fbc),
          client_user_agent: asString(tracking.user_agent),
        },
        custom_data: {
          currency: 'UAH',
          value: amount,
          order_id: asString(payment.shopifyOrderName || payment.shopifyOrderId),
          content_type: 'product',
        },
      },
    ],
  };

  const response = await fetch(
    `https://graph.facebook.com/${env.metaGraphVersion}/${env.metaPixelId}/events?access_token=${encodeURIComponent(env.metaAccessToken)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );

  const text = await response.text();
  if (!response.ok) throw new Error(`Meta CAPI error ${response.status}: ${text}`);
  console.log('Meta Purchase sent:', text);
}
