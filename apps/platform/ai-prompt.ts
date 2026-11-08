export function getBrowserDefaultLanguage() {
  return globalThis.navigator?.languages?.[0] || globalThis.navigator?.language || "en";
}

export function buildLlmPrompt(template: string, text: string) {
  // Resolve the instruction template before inserting the untrusted selection.
  const prompt = template.replaceAll("{{browserDefault}}", getBrowserDefaultLanguage());
  if (prompt.includes("{{selectedText}}")) return prompt.replace("{{selectedText}}", () => text);
  return `${prompt}\n\n${text}`;
}
