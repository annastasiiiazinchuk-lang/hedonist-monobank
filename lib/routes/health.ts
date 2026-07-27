import { env } from '../config/env';
import { json } from '../http/responses';
import { prisma } from '../prisma';
import { getShopifyTokenInfo } from '../services/shopify/shopify-auth';

export async function handleHealth(): Promise<Response> {
  let shopifyTokenReady = false;
  let shopifyTokenError: string | undefined;
  let shopifyTokenShop: string | undefined;

  try {
    const tokenInfo = await getShopifyTokenInfo();
    shopifyTokenReady = tokenInfo.ready;
    shopifyTokenShop = tokenInfo.shop;
  } catch (error) {
    shopifyTokenError = error instanceof Error ? error.message : String(error);
  }

  return json({
    status: 'ok',
    mode: 'refactored-server',
    release: 'hedonist-catalog-line-items-2026-07-27',
    shopifyTokenReady,
    shopifyStoreDomain: env.shopifyStoreDomain,
    ...(shopifyTokenShop ? { shopifyTokenShop } : {}),
    ...(shopifyTokenError ? { shopifyTokenError } : {}),
    novaPoshtaReady: Boolean(env.novaPoshtaApiKey),
    metaReady: Boolean(env.metaPixelId && env.metaAccessToken),
    sitniksReady: Boolean(env.sitniksApiToken),
  });
}

export async function handleHealthDb(): Promise<Response> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return json({ status: 'ok', database: 'connected', timestamp: new Date().toISOString() });
  } catch (error) {
    return json({
      status: 'error',
      database: 'disconnected',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    }, 503);
  }
}
