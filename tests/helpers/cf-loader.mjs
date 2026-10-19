import { pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

const projectRoot = path.resolve(import.meta.dirname, "../..");

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") {
    return {
      format: "module",
      shortCircuit: true,
      url: new URL("./cf-mock.mjs", import.meta.url).href,
    };
  }

  if (specifier.startsWith("@/")) {
    const rel = specifier.slice(2);
    let abs = path.join(projectRoot, rel);
    if (!path.extname(abs)) {
      if (fs.existsSync(abs + ".ts")) abs += ".ts";
      else if (fs.existsSync(abs + ".tsx")) abs += ".tsx";
      else if (fs.existsSync(path.join(abs, "route.ts"))) abs = path.join(abs, "route.ts");
    }
    return nextResolve(pathToFileURL(abs).href, context);
  }

  return nextResolve(specifier, context);
}
