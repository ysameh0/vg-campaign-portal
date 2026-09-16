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
  if (!token) return false;
  const [expiresRaw, mac] = token.split(".");
  const expires = Number(expiresRaw);
  if (!expires || !mac || Date.now() > expires) return false;

  const payload = `${shareId}.${expires}`;
  const expectedMac = createHmac("sha256", env.shareSessionSecret()).update(payload).digest("hex");
  const macBuf = Buffer.from(mac);
  const expectedBuf = Buffer.from(expectedMac);
  return macBuf.length === expectedBuf.length && timingSafeEqual(macBuf, expectedBuf);
}

export function shareCookieName(shareId: string): string {
  return `vg_share_${shareId}`;
}
