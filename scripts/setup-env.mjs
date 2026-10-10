import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
const target = new URL("../server/.env", import.meta.url);
if (existsSync(target)) {
  console.log("server/.env already exists; it was preserved.");
  process.exit(0);
}
const text = readFileSync(
  new URL("../server/.env.example", import.meta.url),
  "utf8",
)
  .replace(
    "SESSION_SECRET=",
    `SESSION_SECRET=${randomBytes(48).toString("hex")}`,
  )
  .replace(
    "CREDENTIAL_KEY=",
    `CREDENTIAL_KEY=${randomBytes(32).toString("hex")}`,
  );
writeFileSync(target, text, { mode: 0o600 });
console.log(
  "Created server/.env with independent local secrets. Add provider credentials only here.",
);
