// A "select all that apply" answer (field type checkbox-group) keeps every choice in one stored string, one per line:
// option texts are single lines, so a line break never splits an option. Used by the needs-you sheet, the value
// resolver and the adapters that tick the boxes.
export const CHOICE_SEPARATOR = "\n";

/** The choices in one stored answer, trimmed, empty lines dropped. A one-choice answer is just that choice. */
export function splitChoices(value: string): string[] {
  return value
    .split(CHOICE_SEPARATOR)
    .map((choice) => choice.trim())
    .filter(Boolean);
}

export function joinChoices(choices: string[]): string {
  return choices.join(CHOICE_SEPARATOR);
}
