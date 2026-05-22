/**
 * Template variable substitution for prompt strings.
 *
 * Replaces {{KEY}} placeholders with values.
 * Built-in vars: ITERATION, MAX_ITERATIONS, SESSION_ID.
 */

export function substitute(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
    return key in vars ? vars[key]! : `{{${key}}}`;
  });
}

// TODO(#3): test edge cases and add template.test.ts
