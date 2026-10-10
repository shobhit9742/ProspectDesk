import express from "express";
import mongoose from "mongoose";
import MongoStore from "connect-mongo";
import { config } from "./src/config.js";
import { createApp } from "./src/app.js";

const app = express();
app.set("trust proxy", 1);
let initialization: Promise<ReturnType<typeof createApp>> | undefined;

async function initialize() {
  if (
    config.sessionSecret.length < 32 ||
    !/^[a-f\d]{64}$/i.test(config.credentialKey) ||
    !process.env.MONGODB_URI ||
    !process.env.APP_URL ||
    !process.env.API_URL
  ) {
    throw new Error("Required deployment environment variables are missing.");
  }
  await mongoose.connect(config.mongo, {
    serverSelectionTimeoutMS: 10000,
    maxPoolSize: 5,
  });
  return createApp({
    sessionStore: MongoStore.create({
      mongoUrl: config.mongo,
      mongoOptions: { maxPoolSize: 5 },
    }),
  });
}

app.use(async (req, res, next) => {
  try {
    if (!initialization) {
      initialization = initialize().catch((error) => {
        initialization = undefined;
        throw error;
      });
    }
    const handler = await initialization;
    handler(req, res, next);
  } catch {
    res.status(503).json({
      error: "The workspace database is unavailable. Please try again shortly.",
    });
  }
});

export default app;
