// Only these public values may reach the browser. Never serialize process.env.
export function publicPlatformConfig(_env: NodeJS.ProcessEnv = process.env) {
  return {};
}

export function publicPlatformScript(env: NodeJS.ProcessEnv = process.env): string {
  const json = JSON.stringify(publicPlatformConfig(env)).replaceAll("<", "\\u003c");
  return `window.__MANUS_CONFIG__=${json};`;
}
