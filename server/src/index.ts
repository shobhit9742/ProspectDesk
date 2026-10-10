import mongoose from "mongoose";
import { config } from "./config.js";
import { createApp } from "./app.js";
import { Account } from "./models.js";
import { syncAccount } from "./mail.js";
if (
  config.sessionSecret.length < 32 ||
  !/^[a-f\d]{64}$/i.test(config.credentialKey)
)
  throw new Error(
    "Set SESSION_SECRET (32+ characters) and CREDENTIAL_KEY (64 hex characters) in server/.env.",
  );
await mongoose.connect(config.mongo, { serverSelectionTimeoutMS: 10000 });
const server = createApp().listen(
  config.port,
  process.env.HOST || "127.0.0.1",
  () => console.log(`ProspectDesk API listening on port ${config.port}`),
);
let running = false;
const worker = process.env.SYNC_MODE === "manual" ? undefined : setInterval(
  async () => {
    if (running) return;
    running = true;
    try {
      const accounts = await Account.find({ status: "connected" }).limit(100);
      for (const a of accounts) {
        try {
          await syncAccount(String(a._id), a.userId);
        } catch {
          /* Account status retains safe, user-visible diagnostics. */
        }
      }
    } finally {
      running = false;
    }
  },
  Math.max(60000, Number(process.env.SYNC_INTERVAL_MS) || 120000),
);
worker?.unref();
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    if (worker) clearInterval(worker);
    server.close(async () => {
      await mongoose.disconnect();
      process.exit(0);
    });
  });
