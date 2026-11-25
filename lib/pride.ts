import { createHash } from "node:crypto";

export const MIN_ENTRY_LENGTH = 1;
export const MAX_ENTRY_LENGTH = 240;

export const PRIDE_ENTRY =
  "After seven months of night classes, Tomas reads the landlord's notice at the kitchen table, catches an illegal fee in paragraph three, and circles it in blue ballpoint without calling his daughter over to check.";

export const ENTRY_LINE = PRIDE_ENTRY;

export interface PrideValidationResult {
  readonly valid: boolean;
  readonly length: number;
  readonly byteLength: number;
  readonly codePointCount: number;
  readonly isSingleLine: boolean;
  readonly isTrimmed: boolean;
  readonly isPrintableAscii: boolean;
  readonly errors: readonly string[];
}

export interface PrideSceneElements {
  readonly person: string;
  readonly setting: string;
  readonly sustainedEffort: string;
  readonly concreteAction: string;
  readonly quietEarnedMoment: string;
}

export interface PrideCraftMetadata {
  readonly schemaVersion: "pride-craft/1";
  readonly line: string;
  readonly sha256: string;
  readonly length: number;
  readonly byteLength: number;
  readonly codePointCount: number;
  readonly wordCount: number;
  readonly sentenceCount: number;
  readonly minLength: number;
  readonly maxLength: number;
  readonly remainingCharacters: number;
  readonly validation: PrideValidationResult;
  readonly scene: PrideSceneElements;
  readonly rubricSignals: {
    readonly genuineEarnedPride: boolean;
    readonly concreteSceneWithRealPerson: boolean;
    readonly landsInOneRead: boolean;
    readonly avoidsClichePhrasing: boolean;
  };
}

export interface PrideEntryArtifact {
  readonly text: string;
  readonly metadata: PrideCraftMetadata;
}

const CONTROL_CHAR_PATTERN = /[\u0000-\u001F\u007F]/;
const LINE_BREAK_PATTERN = /[\r\n\u2028\u2029]/;
const PRINTABLE_ASCII_PATTERN = /^[\u0020-\u007E]+$/;

const CLICHE_PATTERNS: readonly RegExp[] = [
  /\bsmiled quietly\b/i,
  /\bnobody clapped\b/i,
  /\bnobody saw\b/i,
  /\btears welled\b/i,
  /\bbreath (?:he|she|they) didn't know\b/i,
  /\bfor the first time in years\b/i,
  /\bfelt (?:a surge of |so )?proud\b/i,
];

export const PRIDE_SCENE_ELEMENTS: PrideSceneElements = {
  person: "Tomas",
  setting: "kitchen table with a landlord's notice and a blue ballpoint pen",
  sustainedEffort: "seven months of night classes",
  concreteAction: "catching an illegal fee in paragraph three and circling it",
  quietEarnedMoment: "handling the notice himself without calling his daughter over to check",
};

export function countCodePoints(text: string): number {
  let count = 0;
  for (const _ of text) {
    count += 1;
  }
  return count;
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return 0;
  }
  return trimmed.split(/\s+/).length;
}

export function countSentences(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return 0;
  }
  const matches = trimmed.match(/[.!?]+(?=\s|$)/g);
  return matches ? matches.length : 1;
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function hasClichePhrasing(text: string): boolean {
  return CLICHE_PATTERNS.some((pattern) => pattern.test(text));
}

export function validatePrideLine(text: string): PrideValidationResult {
  const errors: string[] = [];
  const length = text.length;
  const byteLength = Buffer.byteLength(text, "utf8");
  const codePointCount = countCodePoints(text);
  const isSingleLine = !LINE_BREAK_PATTERN.test(text);
  const isTrimmed = text === text.trim();
  const isPrintableAscii = length > 0 && PRINTABLE_ASCII_PATTERN.test(text);

  if (length < MIN_ENTRY_LENGTH) {
    errors.push(`Entry must be at least ${MIN_ENTRY_LENGTH} character long (got ${length}).`);
  }
  if (length > MAX_ENTRY_LENGTH) {
    errors.push(`Entry must be at most ${MAX_ENTRY_LENGTH} characters long (got ${length}).`);
  }
  if (codePointCount > MAX_ENTRY_LENGTH) {
    errors.push(
      `Entry code point count must be at most ${MAX_ENTRY_LENGTH} (got ${codePointCount}).`,
    );
  }
  if (!isSingleLine) {
    errors.push("Entry must be a single line without line breaks.");
  }
  if (CONTROL_CHAR_PATTERN.test(text)) {
    errors.push("Entry must not contain control characters.");
  }
  if (!isTrimmed) {
    errors.push("Entry must not have leading or trailing whitespace.");
  }

  return {
    valid: errors.length === 0,
    length,
    byteLength,
    codePointCount,
    isSingleLine,
    isTrimmed,
    isPrintableAscii,
    errors,
  };
}

export function assertValidPrideLine(text: string): string {
  const result = validatePrideLine(text);
  if (!result.valid) {
    throw new Error(`Invalid earned-pride entry: ${result.errors.join(" ")}`);
  }
  return text;
}

export function getPrideEntry(): string {
  return assertValidPrideLine(PRIDE_ENTRY);
}

export function buildPrideMetadata(
  line: string = PRIDE_ENTRY,
  scene: PrideSceneElements = PRIDE_SCENE_ELEMENTS,
): PrideCraftMetadata {
  const validated = assertValidPrideLine(line);
  const validation = validatePrideLine(validated);
  const sentenceCount = countSentences(validated);
  const wordCount = countWords(validated);

  return {
    schemaVersion: "pride-craft/1",
    line: validated,
    sha256: sha256Hex(validated),
    length: validation.length,
    byteLength: validation.byteLength,
    codePointCount: validation.codePointCount,
    wordCount,
    sentenceCount,
    minLength: MIN_ENTRY_LENGTH,
    maxLength: MAX_ENTRY_LENGTH,
    remainingCharacters: MAX_ENTRY_LENGTH - validation.length,
    validation,
    scene,
    rubricSignals: {
      genuineEarnedPride:
        scene.sustainedEffort.length > 0 && scene.quietEarnedMoment.length > 0,
      concreteSceneWithRealPerson:
        scene.person.length > 0 && scene.setting.length > 0 && scene.concreteAction.length > 0,
      landsInOneRead: validation.isSingleLine && sentenceCount === 1 && validation.length <= MAX_ENTRY_LENGTH,
      avoidsClichePhrasing: !hasClichePhrasing(validated),
    },
  };
}

export const PRIDE_CRAFT_METADATA: PrideCraftMetadata = buildPrideMetadata(
  PRIDE_ENTRY,
  PRIDE_SCENE_ELEMENTS,
);

export function createPrideEntry(): PrideEntryArtifact {
  const text = getPrideEntry();
  const metadata = buildPrideMetadata(text, PRIDE_SCENE_ELEMENTS);
  return { text, metadata };
}

export default {
  MIN_ENTRY_LENGTH,
  MAX_ENTRY_LENGTH,
  PRIDE_ENTRY,
  ENTRY_LINE,
  PRIDE_SCENE_ELEMENTS,
  PRIDE_CRAFT_METADATA,
  validatePrideLine,
  assertValidPrideLine,
  getPrideEntry,
  buildPrideMetadata,
  createPrideEntry,
};