export const flagReasons = ["safe_but_warned", "scam_but_missed", "detail_wrong", "other"] as const;

export type FlagReason = (typeof flagReasons)[number];

export const flagReasonLabels: Record<FlagReason, string> = {
  safe_but_warned: "It is safe, but ScamCam warned about it",
  scam_but_missed: "It is a scam, but ScamCam missed it",
  detail_wrong: "A detail in the report is wrong",
  other: "Something else",
};

export const flagNoteMaxLength = 300;
export const flagWindowHours = 24;
export const flagKeepDays = 30;
export const flagIdPattern = /^[A-Za-z0-9_-]{22}$/;
