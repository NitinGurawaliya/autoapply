import type { ResolvedValue } from "./adapter";

/**
 * Cover letters asked for as a file (20 Nov: a Greenhouse "Cover Letter" upload was asked of the user as a one-line
 * answer, and the runner only ever uploaded the resume). The letter is text: the user's own saved letter, or an AI draft
 * from the resume and the job (essay.ts, kind "cover_letter", within max_ai_drafts_per_application and never for a user
 * who said No to drafts). The runner turns it into a one-page PDF here and attaches it to its own field.
 */

export const LETTER_KEY = "cover_letter";
export const LETTER_FILE = "Cover letter.pdf";

/** A file field the runner fills with the cover letter, not the resume. */
export const isLetterFile = (value: Pick<ResolvedValue, "key" | "type">) => value.type === "file" && value.key === LETTER_KEY;

// A4 in points, 2 cm margins, Helvetica 11 on 15.
const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 56;
const SIZE = 11;
const LEADING = 15;
// Helvetica averages about half the font size per character; a little under keeps every line inside the margin.
const LINE_CHARS = Math.floor((PAGE_W - 2 * MARGIN) / (SIZE * 0.52));
const PAGE_LINES = Math.floor((PAGE_H - 2 * MARGIN) / LEADING);

/** The letter as Latin-1 text: typographic quotes and dashes made plain, anything else outside Latin-1 dropped. */
function latin1(text: string) {
  return text
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/…/g, "...")
    .replace(/[   ]/g, " ")
    .replace(/[•●]/g, "-")
    .replace(/[^\n\x20-\x7E\xA1-\xFF]/g, "");
}

/** Paragraphs wrapped to LINE_CHARS, a blank line between paragraphs; a word longer than a line is cut. */
export function wrapLetter(text: string, width = LINE_CHARS): string[] {
  const lines: string[] = [];
  const paragraphs = latin1(text).replace(/\r\n?/g, "\n").split("\n");
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
      continue;
    }
    let line = "";
    for (let word of words) {
      while (word.length > width) {
        if (line) lines.push(line);
        lines.push(word.slice(0, width));
        word = word.slice(width);
        line = "";
      }
      if (!line) line = word;
      else if (line.length + 1 + word.length <= width) line += ` ${word}`;
      else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
  }
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

const escapePdf = (line: string) => line.replace(/[\\()]/g, (char) => `\\${char}`);

/** A plain PDF of the letter (Helvetica, A4, as many pages as it needs), built by hand: no library for one page of text. */
export function letterPdf(text: string): Uint8Array {
  const lines = wrapLetter(text);
  const pages: string[][] = [];
  for (let i = 0; i < Math.max(1, lines.length); i += PAGE_LINES) pages.push(lines.slice(i, i + PAGE_LINES));
  // Objects: 1 catalog, 2 page tree, 3 font, then a page and its content stream for each page.
  const objects: string[] = [];
  const pageIds = pages.map((_, n) => 4 + 2 * n);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  pages.forEach((page, n) => {
    const body = [`BT /F1 ${SIZE} Tf ${LEADING} TL ${MARGIN} ${PAGE_H - MARGIN - SIZE} Td`, ...page.map((line) => `(${escapePdf(line)}) Tj T*`), "ET"].join("\n");
    objects[pageIds[n]] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageIds[n] + 1} 0 R >>`;
    objects[pageIds[n] + 1] = `<< /Length ${Buffer.byteLength(body, "latin1")} >>\nstream\n${body}\nendstream`;
  });
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = Buffer.byteLength(out, "latin1");
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) out += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}
