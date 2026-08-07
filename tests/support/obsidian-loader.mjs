const STUB = new URL("./obsidian-stub.ts", import.meta.url).href;

export async function resolve(specifier, context, next) {
  if (specifier === "obsidian") return { url: STUB, shortCircuit: true };
  return next(specifier, context);
}
