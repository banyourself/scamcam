import { scamFamilyDescriptions } from "./ai-review";

const labelMention = new RegExp(`\\b(?:${Object.keys(scamFamilyDescriptions).filter((label) => label.includes("_")).join("|")})\\b`, "i");

const checkerPatterns = [
  /\b(?:ignore|disregard|forget|override)\s+(?:(?:all|any|the|your|of|my)\s+)*(?:(?:previous|prior|above|earlier|system|original)\s+)*(?:instructions|prompts?|guidelines|directions)\b/i,
  /\b(?:ignore|disregard|forget|override)\s+(?:(?:all|any|the|your)\s+)*(?:previous|prior|above|earlier|system|original)\s+rules\b/i,
  /\bSYSTEM\s*:/,
  /\b(?:system|assistant|developer)\s+(?:note|prompt|message|instructions?)\s*:/i,
  /\blabel["']?\s*[:=]/i,
  /\bclassification\s*:/i,
  /\b(?:valid|correct|final)\s+(?:label|classification)\b/i,
  /\bonly\s+one\s+word\s*:\s*["']?none\b/i,
  /\b(?:classify|categori[sz]e|label|mark)\s+(?:this|it|the message|this message)\s+as\b/i,
  /\b(?:answer|reply|respond|output|say|return)s?\s+(?:only\s+)?(?:with\s+)?(?:the\s+(?:word|label)\s+)?["']?none\b(?!["']?\s+of\b)/i,
  /\balways\s+(?:answers?|replies|responds?|says?)\s+["']?none\b/i,
  /\b(?:print|reveal|repeat|output)\b[^.!?\n]{0,20}\b(?:your|the)\s+(?:rules|instructions|prompt|system prompt)\b/i,
  /<\/?\s*(?:message|system|instructions?|prompt|input|output|start|end)\s*>/i,
  /(?:->|=>|→)\s*["']?none\b/i,
  /(?:\bnone\b[\s,.;:!]*){4,}/i,
  /\b(?:decode|base64)\b[^\n]{0,40}[A-Za-z0-9+/]{20,}={0,2}/i,
  /\bignora\b[^.!?\n]{0,40}\binstrucciones\b/i,
  /\bignore[sz]?\b[^.!?\n]{0,40}\binstru[cç](?:[oõ]es|tions)\b/i,
];

export function aimsAtCheckers(text: string): boolean {
  return labelMention.test(text) || checkerPatterns.some((pattern) => pattern.test(text));
}
