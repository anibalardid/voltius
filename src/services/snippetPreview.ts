import type { ParsedVariable } from "./snippetParser";

const SECRET_NAME = /(?:password|passphrase|secret|token|credential|api[_-]?key|private[_-]?key)/i;

/** Names that should not be echoed into a command preview, even when a snippet
 * author declared them as an ordinary text variable. */
export function isSecretLikeVariable(variable: ParsedVariable): boolean {
  return variable.type === "password" || variable.name === "clipboard" || SECRET_NAME.test(variable.name);
}

/** Resolve a display-only preview. This deliberately never returns the payload
 * used for injection: secret-like values are replaced with a fixed marker. */
export function buildDisplaySafePreview(
  template: string,
  variables: ParsedVariable[],
  values: Record<string, string>,
): string {
  const byName = new Map(variables.map((variable) => [variable.name, variable]));
  return template.replace(/\{\{([^}]+)\}\}/g, (match, raw: string) => {
    const name = raw.split("|")[0].split(":")[0].trim();
    if (!(name in values)) return match;
    const variable = byName.get(name);
    return variable && isSecretLikeVariable(variable) ? "••••••••" : values[name];
  });
}

/** Resolve a dynamic template into a display-only template while masking any
 * sensitive dynamic values such as clipboard content. */
export function buildDisplaySafeTemplate(
  template: string,
  variables: ParsedVariable[],
  values: Record<string, string>,
): string {
  const displayValues = { ...values };
  for (const variable of variables) {
    if (isSecretLikeVariable(variable) && variable.name in displayValues) {
      displayValues[variable.name] = "••••••••";
    }
  }
  return buildDisplaySafePreview(template, variables, displayValues);
}
