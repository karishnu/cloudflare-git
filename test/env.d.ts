import type { Env } from "../src/helpers/types.js";

declare module "cloudflare:workers" {
  interface ProvidedEnv extends Env {}
}
