/** [text] with every CRLF and lone CR as LF: a browser posts a textarea's breaks as CRLF. */
export function lfOf(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}
