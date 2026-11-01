// A job description, stored as one run of plain text (modules/jobs/normalize.ts plainText strips the board's markup and
// every line break), turned back into something a person can read: headings, paragraphs and labelled lists. Only
// recognised from the words themselves, so it never adds, drops or reorders text: joining every block gives the input
// back (scripts/description-test.ts). Free of server code; the job page renders the blocks as plain React text.

export type DescriptionBlock =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: Array<{ label: string | null; text: string }> };

// Section names boards use, at the start of a sentence, with or without a colon after them.
const SECTION =
  /^(about (?:the|this) (?:role|job|team|position|opportunity|company)|about us|about you|the role|your role|role overview|job (?:summary|description|overview)|overview|summary|(?:key |main |your |core |job )?responsibilities|(?:the )?roles? (?:and|&) responsibilities|your (?:experience|skills|background|profile)|experience (?:and|&) qualifications|(?:key |main )?duties|(?:minimum |basic |preferred |required |desired )?(?:qualifications|requirements)|(?:required |preferred |key |technical )?skills(?: (?:and|&) (?:experience|qualifications))?|nice to have|good to have|bonus points|must[- ]haves?|(?:what )?(?:benefits|perks)(?: and perks| & perks)?|what we offer|what's in it for you|why join us|why us|our values|our culture|who you are|who we are|what you(?:'ll|’ll| will) (?:do|bring|need|get|learn)(?: at [A-Z][\w.&'-]*)?|what (?:we're|we’re|we are) looking for|what you bring|the impact you(?:'ll|’ll| will) have|how to apply|location|compensation)\b/i;

// A question that opens a section ("Who are we?", "What is this role all about?").
const QUESTION_START = /^(who|what|why|how|where|are you|do you|is this)\b/i;

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** A sentence's opening section name, the colon after it included, when it has one; and the rest of the sentence. */
function splitSection(sentence: string): { heading: string; rest: string } | null {
  const named = SECTION.exec(sentence);
  if (named) {
    const end = named[0].length;
    const after = sentence.slice(end);
    // "Responsibilities: Build…" or "About the Role We are seeking…": the name stands alone, then a new capitalised start.
    const colon = /^\s*:\s*/.exec(after);
    if (colon) return { heading: sentence.slice(0, end + colon[0].trimEnd().length), rest: after.slice(colon[0].length) };
    if (/^\s+[A-Z0-9]/.test(after) || after.trim() === "") return { heading: sentence.slice(0, end), rest: after.trimStart() };
  }
  // ALL-CAPS lead-in ("LIFE AT UIPATH The people at UiPath…"): two or more capitalised words, then normal text.
  const caps = /^((?:[A-Z][A-Z0-9&'’-]+\s+){1,5}[A-Z][A-Z0-9&'’-]+)\s+(?=[A-Z][a-z])/.exec(sentence);
  if (caps && caps[1].length >= 6) return { heading: caps[1], rest: sentence.slice(caps[0].length) };
  // A short lead-in that ends in a colon and is not a label for one item ("The impact you will have: …").
  const lead = /^([A-Z][^.:?!]{2,70}?):\s+/.exec(sentence);
  // It speaks to the reader or for the company ("you", "we") or opens like a section ("What…", "Here is…"); a label
  // for one item ("Partnership with our technology teams:") does not.
  const speaks = !!lead && (/\b(you|you'll|you’ll|we|we'll|we’ll|we're|we’re|we've|we’ve)\b/i.test(lead[1]) || /^(what|who|why|how|here|in this|to thrive|our)\b/i.test(lead[1]));
  if (lead && speaks && !/[,[(]/.test(lead[1]) && words(lead[1]) >= 3 && words(lead[1]) <= 8 && !/^[A-Z][\w&/-]*(\s+[A-Z&][\w&/-]*)*$/.test(lead[1])) {
    return { heading: `${lead[1]}:`, rest: sentence.slice(lead[0].length) };
  }
  return null;
}

/** "C-Suite Scoping & Value Definition: Partner with Sales…": a short Title Case label, a colon, then its text. */
function labelled(sentence: string): { label: string; text: string } | null {
  const match = /^([A-Z][\w&/'’-]*(?:\s+(?:[A-Z&][\w&/'’-]*|of|and|for|to|in|the|with|a)){0,6}):\s+(\S.*)$/.exec(sentence);
  if (!match || words(match[1]) > 7) return null;
  return { label: match[1], text: match[2] };
}

function sentencesOf(text: string) {
  // A sentence ends at . ! ? before a space and a capital, digit, quote or bracket; "e.g. Python" stays together.
  return text
    .split(/(?<=[.!?])\s+(?=["“(\[]?[A-Z0-9])/)
    .flatMap((part) => {
      // "Experience: 2-3 years Who are we?": a closing question that opens a section is split off on its own.
      const question = /^(.*\S)\s+((?:Who|What|Why|How|Where|Are you|Do you)\b[^.?!]{2,70}\?)$/.exec(part);
      return question && words(question[1]) >= 1 ? [question[1], question[2]] : [part];
    })
    .map((part) => part.trim())
    .filter(Boolean);
}

const PARAGRAPH_MAX = 360;

// Words a flattened bullet usually starts with ("…new logos Cultivate sales… SQLs Work closely with…").
const BULLET_START =
  "Develop|Build|Design|Lead|Work|Manage|Create|Drive|Own|Support|Collaborate|Partner|Implement|Ensure|Write|Maintain|Define|Identify|Prepare|Analy[sz]e|Conduct|Deliver|Coordinate|Establish|Monitor|Provide|Participate|Contribute|Mentor|Review|Cultivate|Explore|Improve|Optimi[sz]e|Track|Present|Communicate|Translate|Help|Serve|Run|Ship|Test|Debug|Automate|Integrate|Evaluate|Research|Plan|Execute|Handle|Assist|Oversee|Negotiate|Close|Generate|Engage|Influence|Champion|Act|Feed|Shape|Guide|Scale|Bring|Use|Apply|Solve|Grow|Coach|Recruit|Source|Interview|Onboard|Ability|Strong|Excellent|Proven|Familiarity|Knowledge|Experience|Hands-on|Solid|Deep|Understanding|Exposure|Comfortable|Demonstrated|Expertise|Fluency|Proficiency|Proficient|Bachelor|Bachelor's|Bachelor’s|Master's|Master’s|Minimum|Prior|Good|Must|Willingness|Passion|Attention";
// Joining words: a capitalised word right after one of these is a name inside the line, not a new bullet.
const JOINERS = new Set(["and", "or", "as", "of", "the", "to", "with", "in", "for", "a", "an", "such", "on", "at", "by", "from", "including", "like", "via"]);
const BULLET_SPLIT = new RegExp(`\\s+(?=(?:${BULLET_START})\\b)`);
const BULLET_FIRST = new RegExp(`^(?:${BULLET_START}|\\d+\\+? years)\\b`);

/** A long run with no sentence ends that is really a flattened list: its pieces, or null when it is prose. */
function flattenedList(sentence: string): string[] | null {
  if (sentence.length < 240) return null;
  const pieces: string[] = [];
  for (const part of sentence.split(BULLET_SPLIT)) {
    const previous = pieces[pieces.length - 1];
    const lastWord = previous?.split(/\s+/).pop()?.toLowerCase().replace(/[^a-z]/g, "") ?? "";
    // Join back a split after a joining word, after a comma, or into a piece too short to stand alone.
    if (previous !== undefined && (JOINERS.has(lastWord) || /,$/.test(previous) || previous.length < 15)) pieces[pieces.length - 1] = `${previous} ${part}`;
    else pieces.push(part);
  }
  return pieces.length >= 3 ? pieces : null;
}

/** The description as blocks. `text` is the stored plain text. */
export function describe(text: string): DescriptionBlock[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const blocks: DescriptionBlock[] = [];
  let paragraph: string[] = [];
  let list: Array<{ label: string | null; text: string }> = [];

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
    paragraph = [];
  };
  const flushList = () => {
    // One line alone reads better as a paragraph (with its label, when it has one).
    if (list.length === 1) blocks.push({ kind: "paragraph", text: list[0].label ? `${list[0].label}: ${list[0].text}` : list[0].text });
    else if (list.length > 1) blocks.push({ kind: "list", items: list });
    list = [];
  };
  const addSentence = (sentence: string) => {
    const pieces = flattenedList(sentence);
    if (pieces) {
      flushParagraph();
      flushList();
      // "Key responsibilities include: Develop… Build…": the opening words before the first bullet are its heading.
      const [first, ...rest] = pieces;
      if (/:$/.test(first) && words(first) <= 8) {
        blocks.push({ kind: "heading", text: first });
        list = rest.map((text) => ({ label: null, text }));
      } else list = pieces.map((text) => ({ label: null, text }));
      if (list.length === 1) blocks.push({ kind: "paragraph", text: list[0].text });
      else blocks.push({ kind: "list", items: list });
      list = [];
      return;
    }
    const item = labelled(sentence);
    if (item) {
      flushParagraph();
      list.push(item);
      return;
    }
    // A short sentence that opens like a bullet ("Design and implement…", "Proven experience…") joins a list of them;
    // a run of one stays a paragraph (flushList), so prose that happens to start with "Strong" is left alone.
    if (sentence.length < 280 && BULLET_FIRST.test(sentence) && (list.length === 0 || list[list.length - 1].label === null)) {
      if (list.length === 0) flushParagraph();
      list.push({ label: null, text: sentence });
      return;
    }
    // A sentence that follows a labelled item continues it while the item is short; after that it is prose again
    // ("Company Profile: …" followed by the whole company story).
    if (list.length && list[list.length - 1].label !== null && list[list.length - 1].text.length < 220) {
      list[list.length - 1].text += ` ${sentence}`;
      return;
    }
    flushList();
    if (paragraph.length && (paragraph.join(" ").length + sentence.length > PARAGRAPH_MAX || paragraph.length >= 3)) flushParagraph();
    paragraph.push(sentence);
  };

  for (const sentence of sentencesOf(clean)) {
    const isQuestion = sentence.endsWith("?") && words(sentence) <= 9 && QUESTION_START.test(sentence);
    const section = isQuestion ? { heading: sentence, rest: "" } : splitSection(sentence);
    if (section) {
      flushParagraph();
      flushList();
      blocks.push({ kind: "heading", text: section.heading });
      if (section.rest) addSentence(section.rest);
      continue;
    }
    addSentence(sentence);
  }
  flushParagraph();
  flushList();
  return blocks;
}

/** Every block's text in order, for the "nothing lost" check and for counting. */
export function blockText(block: DescriptionBlock): string {
  if (block.kind === "list") return block.items.map((item) => (item.label ? `${item.label}: ${item.text}` : item.text)).join(" ");
  return block.text;
}

/** How many blocks to show before "Read the full description": about `chars` characters, never cutting a list. */
export function previewCount(blocks: DescriptionBlock[], chars = 700): number {
  let total = 0;
  for (let index = 0; index < blocks.length; index += 1) {
    total += blockText(blocks[index]).length;
    if (total >= chars) return Math.min(blocks.length, index + 1);
  }
  return blocks.length;
}
