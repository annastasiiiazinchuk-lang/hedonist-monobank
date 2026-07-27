export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),
  monoToken: process.env.MONO_TOKEN || '',
  webhookUrl: process.env.WEBHOOK_URL || '',
  redirectUrl: process.env.REDIRECT_URL || 'https://example.com',
  shopifyStoreDomain: normalizeShopDomain(
    process.env.SHOPIFY_STORE_DOMAIN || process.env.SHOPIFY_STORE_URL || '',
  ),
  shopifyClientId: process.env.SHOPIFY_CLIENT_ID || '',
  shopifyClientSecret: process.env.SHOPIFY_CLIENT_SECRET || '',
  shopifyAdminAccessToken: process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '',
  shopifyPaymentUpdateDelaySeconds: Number(process.env.SHOPIFY_PAYMENT_UPDATE_DELAY_SECONDS || 0),
  novaPoshtaApiKey: process.env.NOVA_POSHTA_API_KEY || '',
  metaPixelId: process.env.META_PIXEL_ID || '',
  metaAccessToken: process.env.META_ACCESS_TOKEN || '',
  metaGraphVersion: process.env.META_GRAPH_VERSION || 'v23.0',
  sitniksApiBaseUrl: normalizeBaseUrl(process.env.SITNIKS_API_BASE_URL || 'https://crm.sitniks.com'),
  sitniksApiToken: process.env.SITNIKS_API_TOKEN || '',
  sitniksStatusId: Number(process.env.SITNIKS_STATUS_ID || 0),
  sitniksPaidStatusId: Number(process.env.SITNIKS_PAID_STATUS_ID || 0),
  sitniksPrepaymentPaidStatusId: Number(
    process.env.SITNIKS_PREPAYMENT_PAID_STATUS_ID || process.env.SITNIKS_PAID_STATUS_ID || 0,
  ),
  sitniksSalesChannelId: Number(process.env.SITNIKS_SALES_CHANNEL_ID || 0),
  sitniksSettlementAccountId: Number(process.env.SITNIKS_SETTLEMENT_ACCOUNT_ID || 0),
};

export const PREPAYMENT_AMOUNT = 200;
export const SHOPIFY_SCOPES = 'read_orders,write_orders,write_order_edits,read_products';
export const SHOPIFY_API_VERSION = '2026-01';

export function normalizeShopDomain(value: string): string {
  return value.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

export function normalizeBaseUrl(value: string): string {
  return value.replace(/\/$/, '');
}

export function getPublicBaseUrl(): string {
  if (!env.webhookUrl) throw new Error('Missing WEBHOOK_URL');
  const webhookUrl = new URL(env.webhookUrl);
  return `${webhookUrl.protocol}//${webhookUrl.host}`;
}

export function requireEnv(name: keyof typeof env): string {
  const value = env[name];
  if (typeof value !== 'string' || !value) {
    throw new Error(`Missing ${String(name)}`);
  }
  return value;
}
