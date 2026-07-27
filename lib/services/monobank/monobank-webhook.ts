import { PREPAYMENT_AMOUNT, env } from '../../config/env';
import { json } from '../../http/responses';
import type { MonobankWebhookBody } from '../../types/monobank';
import { asNumber } from '../../utils/format';
import {
  getPaymentByInvoiceId,
  markPaymentSuccess,
  markSitniksPaymentSynced,
  markSitniksPaymentSyncFailed,
  paymentToMetadata,
} from '../payments/payment-store';
import { getOrderIdFromMonobankReference, updateShopifyOrderAfterPayment } from '../shopify/shopify-order';
import { sendSitniksPaymentTransaction, updateSitniksPaymentStatus } from '../sitniks/sitniks-order';
import { sendMetaPurchaseEvent } from '../tracking/meta';

async function syncShopifyAfterMonobankSuccess(
  payment: Awaited<ReturnType<typeof paymentToMetadata>>,
  body: MonobankWebhookBody,
) {
  if (!payment?.shopifyOrderId) return;

  await updateShopifyOrderAfterPayment(
    payment.shopifyOrderId,
    payment.amount,
    body.invoiceId,
    payment.paymentType,
  );
}

async function syncSitniksAfterMonobankSuccess(
  updatedPayment: Awaited<ReturnType<typeof markPaymentSuccess>> | undefined,
  body: MonobankWebhookBody,
) {
  if (!updatedPayment) return;
  try {
    const statusUpdate = await updateSitniksPaymentStatus(updatedPayment, body);
    const transaction = await sendSitniksPaymentTransaction(updatedPayment, body);
    if (statusUpdate || transaction) {
      await markSitniksPaymentSynced(updatedPayment.id);
    }
  } catch (error) {
    console.error('[Sitniks] Failed to sync payment after Monobank success:', error);
    await markSitniksPaymentSyncFailed(updatedPayment.id, error).catch((syncError) => {
      console.error('[Sitniks] Failed to save payment sync error:', syncError);
    });
  }
}

export async function processMonobankWebhook(body: MonobankWebhookBody): Promise<Response> {
  console.log('Monobank webhook:', body);

  if (body.status !== 'success' || !body.invoiceId) {
    return json({ ok: true });
  }

  const storedPayment = await getPaymentByInvoiceId(body.invoiceId);
  const fallbackPayment = {
    shopifyOrderId: getOrderIdFromMonobankReference(body.reference),
    amount: asNumber(body.finalAmount || body.amount) / 100,
    paymentType: asNumber(body.finalAmount || body.amount) === PREPAYMENT_AMOUNT * 100 ? 'prepayment' as const : 'full' as const,
    customer: {},
    tracking: {},
    cartTotal: asNumber(body.finalAmount || body.amount) / 100,
    reference: body.reference || '',
  };
  const payment = paymentToMetadata(storedPayment) || fallbackPayment;

  if (!payment.shopifyOrderId) {
    console.error('Shopify order id not found for invoice:', body.invoiceId);
    return json({ error: 'Shopify order id not found' }, 404);
  }

  try {
    console.log('Payment mapping resolved:', {
      invoiceId: body.invoiceId,
      shopifyOrderId: payment.shopifyOrderId,
      paymentType: payment.paymentType,
      amount: payment.amount,
    });

    let updatedPayment: Awaited<ReturnType<typeof markPaymentSuccess>> | undefined;
    if (storedPayment) {
      updatedPayment = await markPaymentSuccess(storedPayment.id, body);
    }

    await syncSitniksAfterMonobankSuccess(updatedPayment, body);

    if (env.shopifyPaymentUpdateDelaySeconds > 0) {
      const delayMs = env.shopifyPaymentUpdateDelaySeconds * 1000;
      console.log('Delaying Shopify payment update:', {
        invoiceId: body.invoiceId,
        shopifyOrderId: payment.shopifyOrderId,
        delaySeconds: env.shopifyPaymentUpdateDelaySeconds,
      });
      setTimeout(() => {
        syncShopifyAfterMonobankSuccess(payment, body).catch((error) => {
          console.error('Delayed Monobank success sync failed:', error);
        });
      }, delayMs);
    } else {
      await syncShopifyAfterMonobankSuccess(payment, body);
    }

    await sendMetaPurchaseEvent(payment, body).catch((error) => {
      console.error('Failed to send Meta Purchase:', error);
    });

    return json({ ok: true });
  } catch (error) {
    console.error('Failed to process successful Monobank payment:', error);
    return json({
      error: 'Failed to process successful Monobank payment',
      details: error instanceof Error ? error.message : String(error),
    }, 500);
  }
}
