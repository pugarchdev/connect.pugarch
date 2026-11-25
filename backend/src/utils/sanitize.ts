const URL_REGEX = /(https?:\/\/|www\.)\S+/gi;
const ABUSIVE_TERMS = [/\b(abuse|hate|kill|terror|bomb)\b/i];

export const sanitizeText = (text: string = '', max = 100): string =>
  String(text || '')
    .replace(URL_REGEX, '')
    // Allow alphanumeric characters from all languages, plus common punctuation (including colons for time)
    .replace(/[^\p{L}\p{N} .,?!:\-()]/gu, '')
    .substring(0, max)
    .trim();

function redactAbusiveTerms(text: string): string {
  return ABUSIVE_TERMS.reduce((acc, pattern) => acc.replace(pattern, '[redacted]'), text);
}

function stripUnsafeControlChars(text: string): string {
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

export function sanitizeGrievanceDetailsForStorage(text: string = ''): string {
  const cleaned = stripUnsafeControlChars(String(text || ''))
    .replace(/\r\n/g, '\n')
    .trim();

  return redactAbusiveTerms(cleaned);
}

export function sanitizeGrievanceDetailsForTemplate(text: string = '', max = 1000): string {
  const cleaned = sanitizeGrievanceDetailsForStorage(text)
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return '';
  return cleaned.substring(0, max).trim();
}

export function sanitizeGrievanceDetails(text: string = ''): string {
  return sanitizeGrievanceDetailsForTemplate(text, 1000);
}

export function sanitizeRemarks(text: string = ''): string {
  return sanitizeText(text, 400);
}


export function sanitizeDateTimeText(text: string = '', max = 80): string {
  return String(text || '')
    .replace(URL_REGEX, '')
    .replace(/[^\p{L}\p{N} :\-]/gu, '')
    .substring(0, max)
    .trim();
}

export function sanitizeNote(text: string = ''): string {
  return String(text || '')
    .replace(URL_REGEX, '')
    .replace(/[^\p{L}\p{N} .,?!:\-()\n]/gu, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .substring(0, 400)
    .trim();
}
