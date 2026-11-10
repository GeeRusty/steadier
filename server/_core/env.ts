// Self-hosted configuration, read at use time from the server environment.
export const ENV = {
  // Stamped into session tokens; changing it signs everyone out.
  get appId() { return process.env.APP_ID ?? "steadier"; },
  get cookieSecret() { return process.env.SESSION_SECRET ?? ""; },
  get databaseUrl() { return process.env.DATABASE_URL ?? ""; },
  // Email address whose account gets the admin role.
  get ownerEmail() { return (process.env.OWNER_EMAIL ?? "").trim().toLowerCase(); },
  get ownerOpenId() { return process.env.OWNER_OPEN_ID ?? ""; },
  // "false" closes new sign-ups. SIGNUP_CODE, when set, must be entered to create an account.
  get allowSignup() { return process.env.ALLOW_SIGNUP !== "false"; },
  get signupCode() { return process.env.SIGNUP_CODE ?? ""; },
  get isProduction() { return process.env.NODE_ENV === "production"; },
  // Unused leftovers from the Manus template (LLM, image, voice upload, storage).
  get forgeApiUrl() { return process.env.MANUS_API_URL ?? ""; },
  get forgeApiKey() { return process.env.MANUS_API_KEY ?? ""; },
};
