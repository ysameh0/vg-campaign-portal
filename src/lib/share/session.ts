import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

const TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

// A signed, short-lived token proving verify_campaign_share_password already
// succeeded for this share_id — so the results page doesn't need to re-ask
// for the password on every request, but a guessed share_id with no correct
// password submission can never reach get_campaign_share_summary.
export function signShareSession(shareId: string): string {
  const expires = Date.now() + TTL_MS;
  const payload = `${shareId}.${expires}`;
  const mac = createHmac("sha256", env.shareSessionSecret()).update(payload).digest("hex");
  return `${expires}.${mac}`;
}

export function verifyShareSession(shareId: string, token: string | undefined): boolean {
  if (!token) {
    console.error("[share-debug] no token cookie present for", shareId);
    return false;
  }
  const [expiresRaw, mac] = token.split(".");
  const expires = Number(expiresRaw);
  if (!expires || !mac || Date.now() > expires) {
    console.error("[share-debug] bad token shape or expired", { token, expiresRaw, expires, mac, now: Date.now() });
    return false;
  }

  const payload = `${shareId}.${expires}`;
  const expectedMac = createHmac("sha256", env.shareSessionSecret()).update(payload).digest("hex");
  const macBuf = Buffer.from(mac);
  const expectedBuf = Buffer.from(expectedMac);
  const result = macBuf.length === expectedBuf.length && timingSafeEqual(macBuf, expectedBuf);
  if (!result) {
    console.error("[share-debug] mac mismatch", { mac, expectedMac, secretLen: env.shareSessionSecret().length });
  }
  return result;
}

export function shareCookieName(shareId: string): string {
  return `vg_share_${shareId}`;
}
