import type { LeafStep } from "./snippetFlatten";
import type { DynamicContext, ParsedVariable } from "./snippetParser";
import {
  parseVariables, buildDynamicValues, buildDefaultValues, needsUserInput, resolveTemplate,
} from "./snippetParser";
import { buildDisplaySafeTemplate } from "./snippetPreview";

export function leafTemplateText(steps: LeafStep[]): string {
  const parts: string[] = [];
  for (const s of steps) {
    if (s.kind === "script") parts.push(s.content);
    else parts.push(s.from_path, s.to_path);
  }
  return parts.join("\n");
}

export function resolveLeafSteps(steps: LeafStep[], values: Record<string, string>): LeafStep[] {
  return steps.map((s) =>
    s.kind === "script"
      ? { ...s, content: resolveTemplate(s.content, values) }
      : { ...s, from_path: resolveTemplate(s.from_path, values), to_path: resolveTemplate(s.to_path, values) },
  );
}

export interface SequenceVars {
  userVars: ParsedVariable[];
  partialTemplate: string;
  displayPartialTemplate: string;
  initialValues: Record<string, string>;
  missing: ParsedVariable[];
  dynValues: Record<string, string>;
}

export function collectSequenceVars(steps: LeafStep[], ctx: DynamicContext): SequenceVars {
  const text = leafTemplateText(steps);
  const vars = parseVariables(text);
  const dynValues = buildDynamicValues(vars, ctx);
  const partialTemplate = resolveTemplate(text, dynValues);
  const displayPartialTemplate = buildDisplaySafeTemplate(text, vars, dynValues);
  const userVars = vars.filter((v) => !v.dynamic);
  const initialValues = buildDefaultValues(userVars);
  const missing = userVars.filter((v) => needsUserInput(v));
  return { userVars, partialTemplate, displayPartialTemplate, initialValues, missing, dynValues };
}
