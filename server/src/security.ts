import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { config } from "./config.js";
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function encrypt(value: unknown) {
  const iv = randomBytes(12),
    key = Buffer.from(config.credentialKey, "hex");
  if (key.length !== 32)
    throw new AppError(
      503,
      "Mailbox encryption is not configured. Set CREDENTIAL_KEY.",
    );
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const bytes = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return [
    iv.toString("hex"),
    cipher.getAuthTag().toString("hex"),
    bytes.toString("hex"),
  ].join(":");
}
export function decrypt(value: string): any {
  const [iv, tag, bytes] = value.split(":");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(config.credentialKey, "hex"),
    Buffer.from(iv, "hex"),
  );
  decipher.setAuthTag(Buffer.from(tag, "hex"));
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(bytes, "hex")),
      decipher.final(),
    ]).toString(),
  );
}
export function isPublicIp(address: string) {
  try {
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}
export async function publicHost(host: string) {
  const clean = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    clean === "localhost" ||
    clean.endsWith(".localhost") ||
    clean.endsWith(".local")
  )
    throw new AppError(400, "Use a public website or mail server hostname.");
  const addresses = await lookup(clean, { all: true });
  if (!addresses.length || addresses.some((x) => !isPublicIp(x.address)))
    throw new AppError(
      400,
      "Private or reserved network addresses are not supported.",
    );
  return addresses;
}
export function cleanUrl(value: string) {
  let u: URL;
  try {
    u = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`,
    );
  } catch {
    throw new AppError(400, "Enter a valid website URL.");
  }
  if (
    !["https:", "http:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    (u.port && !["80", "443"].includes(u.port))
  )
    throw new AppError(
      400,
      "Use a public HTTP or HTTPS website without credentials or custom ports.",
    );
  u.hash = "";
  return u;
}
export function safeError(error: any) {
  const message = String(error?.message || "Operation failed");
  if (
    error?.responseCode === 535 ||
    /authentication failed|invalid credentials|invalid_grant/i.test(message)
  )
    return "Authentication failed. Reconnect the account or check the app password.";
  if (/ENOTFOUND/i.test(message))
    return "Server hostname could not be resolved. Check the address.";
  if (/timeout|ETIMEDOUT/i.test(message))
    return "The server timed out. Try again later.";
  return message
    .replace(/Bearer\s+\S+/gi, "[redacted]")
    .replace(/(password|token|secret)=\S+/gi, "$1=[redacted]")
    .slice(0, 300);
}
