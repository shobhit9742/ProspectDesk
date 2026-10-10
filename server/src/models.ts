import mongoose, { Schema } from "mongoose";
const options = { timestamps: true, strict: false };
export const User = mongoose.model(
  "User",
  new Schema(
    {
      email: { type: String, unique: true, required: true },
      name: String,
      passwordHash: String,
    },
    options,
  ),
);
export const Scan = mongoose.model(
  "Scan",
  new Schema(
    {
      userId: { type: String, required: true, index: true },
      url: String,
      company: String,
      status: String,
      pages: Array,
      facts: Array,
      warnings: Array,
      contexts: Array,
    },
    options,
  ),
);
export const Account = mongoose.model(
  "Account",
  new Schema(
    {
      userId: { type: String, required: true, index: true },
      email: String,
      name: String,
      provider: String,
      status: String,
      encrypted: { type: String, select: false },
      lastSync: Date,
      lastError: String,
    },
    options,
  ),
);
Account.schema.index({ userId: 1, email: 1 }, { unique: true });
export const Message = mongoose.model(
  "Message",
  new Schema(
    {
      userId: { type: String, required: true },
      accountId: String,
      externalId: String,
      messageId: String,
      references: Array,
      threadKey: String,
      from: String,
      to: Array,
      subject: String,
      body: String,
      date: Date,
      folder: String,
      unread: Boolean,
      isBounce: Boolean,
      status: String,
      providerThreadId: String,
      providerFolder: String,
      providerUid: Number,
    },
    options,
  ),
);
Message.schema.index({ accountId: 1, externalId: 1 }, { unique: true });
Message.schema.index({ userId: 1, threadKey: 1, date: -1 });
export const Draft = mongoose.model(
  "Draft",
  new Schema(
    {
      userId: { type: String, required: true, index: true },
      accountId: String,
      to: String,
      subject: String,
      body: String,
      replyMessageId: String,
      key: String,
    },
    options,
  ),
);
export const SendAttempt = mongoose.model(
  "SendAttempt",
  new Schema(
    { userId: String, key: String, status: String, messageId: String },
    options,
  ),
);
SendAttempt.schema.index({ userId: 1, key: 1 }, { unique: true });
