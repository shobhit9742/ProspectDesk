import "dotenv/config";
export const config = {
  port: Number(process.env.PORT || 4120),
  appUrl: process.env.APP_URL || "http://127.0.0.1:5176",
  apiUrl: process.env.API_URL || "http://127.0.0.1:4120",
  mongo: process.env.MONGODB_URI || "mongodb://127.0.0.1:27019/prospectdesk",
  sessionSecret: process.env.SESSION_SECRET || "",
  credentialKey: process.env.CREDENTIAL_KEY || "",
  production: process.env.NODE_ENV === "production",
};
