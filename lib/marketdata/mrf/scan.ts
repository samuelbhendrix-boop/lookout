/**
 * Constant-memory scanner for Transparency in Coverage in-network rate files.
 *
 * These files are a single JSON object that can be hundreds of GB uncompressed. A general JSON tokenizer
 * runs at ~35 MB/s here; this scanner works on raw bytes, jumps over strings with Buffer.indexOf, and
 * skips the negotiated_rates of codes we don't want by bracket counting alone — never materializing them.
 * Only small pieces are JSON.parse'd: each provider_references element, the header of each in_network
 * item, and each negotiated_rates element of a code we keep.
 *
 *   root{ provider_references:[ {…}* ], in_network:[ { billing_code…, negotiated_rates:[ {…}* ] }* ] }
 *   depth:1                   2  3                 2  3                                 4  5
 */
export type ScanHandlers = {
  /** One provider_references element. */
  providerRef(obj: unknown): void;
  /** Header text of an in_network item (everything before "negotiated_rates"). Return true to keep its rates. */
  header(text: string): boolean;
  /** One negotiated_rates element of a kept item. */
  rate(obj: unknown): void;
  /** A whole in_network item, only when its header had no billing_code before negotiated_rates (non-standard key order). */
  whole?(obj: unknown): void;
};

const Q = 34, BS = 92, LB = 123, RB = 125, LS = 91, RS = 93, COLON = 58;
const WHOLE_CAP = 256 * 1024 * 1024;

type Mode = "scan" | "skip" | "pendingSkip";

export class MrfScanner {
  depth = 0;
  bytes = 0;
  items = 0;
  kept = 0;
  oversize = 0;
  head = "";
  private inStr = false;
  private esc = false;
  private mode: Mode = "scan";
  private section = "";
  private keep = false;
  private keyDepth1 = "";
  // string capture (keys at depth 1 and 3 only)
  private strParts: Buffer[] | null = null;
  private strStart = -1;
  private lastStr = "";
  // byte capture
  private cap: Buffer[] | null = null;
  private capStart = -1;
  private capBytes = 0;
  private capKind: "ref" | "header" | "rate" | "whole" | null = null;

  constructor(private h: ScanHandlers) {}

  write(buf: Buffer) {
    if (this.head.length < 65536) this.head += buf.subarray(0, 65536 - this.head.length).toString("latin1");
    this.bytes += buf.length;
    let i = 0;
    const len = buf.length;
    if (this.cap) this.capStart = 0;
    if (this.strParts) this.strStart = 0;
    while (i < len) {
      if (this.inStr) {
        const end = this.stringEnd(buf, i);
        if (end < 0) {
          if (this.strParts) this.strParts.push(buf.subarray(this.strStart));
          i = len;
          break;
        }
        this.inStr = false;
        if (this.strParts) {
          this.strParts.push(buf.subarray(this.strStart, end));
          this.lastStr = Buffer.concat(this.strParts).toString("utf8");
          this.strParts = null;
        }
        i = end + 1;
        continue;
      }
      if (this.mode === "skip") {
        // Fast path: only quotes and brackets matter until we climb back to the item (depth 3).
        for (; i < len; i++) {
          const c = buf[i];
          if (c === Q) break;
          if (c === LB || c === LS) this.depth++;
          else if (c === RB || c === RS) {
            this.depth--;
            if (this.depth === 3) { this.mode = "scan"; i++; break; }
          }
        }
        if (i < len && buf[i] === Q && this.mode === "skip") { this.inStr = true; this.esc = false; i++; }
        continue;
      }
      const c = buf[i];
      if (c === Q) {
        this.inStr = true;
        this.esc = false;
        if (this.depth === 1 || this.depth === 3) { this.strParts = []; this.strStart = i + 1; }
      } else if (c === COLON) {
        if (this.depth === 1) this.keyDepth1 = this.lastStr;
        else if (this.depth === 3 && this.section === "in_network" && this.lastStr === "negotiated_rates" && this.capKind === "header") {
          const raw = this.endCapture(buf, i);
          if (/"billing_code"\s*:/.test(raw)) {
            this.keep = this.h.header(raw.replace(/,?\s*"negotiated_rates"\s*:$/, "}"));
            if (this.keep) this.kept++;
            else this.mode = "pendingSkip"; // switch once the array opens
          } else {
            // Unusual key order: keep capturing the whole item.
            this.startCaptureFrom(Buffer.from(raw), "whole");
            this.capStart = i + 1;
          }
        }
      } else if (c === LB || c === LS) {
        this.depth++;
        if (this.depth === 2) this.section = c === LS ? this.keyDepth1 : "";
        else if (this.depth === 3 && c === LB) {
          if (this.section === "provider_references") this.startCapture(i, "ref");
          else if (this.section === "in_network") { this.items++; this.keep = false; this.startCapture(i, "header"); }
        } else if (this.depth === 4 && this.mode === "pendingSkip") {
          this.mode = "skip";
          i++;
          continue;
        } else if (this.depth === 5 && c === LB && this.keep && this.section === "in_network" && !this.cap) this.startCapture(i, "rate");
      } else if (c === RB || c === RS) {
        this.depth--;
        if (this.cap) {
          if (this.depth === 2 && this.capKind === "ref") this.h.providerRef(JSON.parse(this.endCapture(buf, i)));
          else if (this.depth === 4 && this.capKind === "rate") this.h.rate(JSON.parse(this.endCapture(buf, i)));
          else if (this.depth === 2 && this.capKind === "whole") {
            const t = this.endCapture(buf, i);
            this.h.whole?.(JSON.parse(t));
          } else if (this.depth === 2 && this.capKind === "header") this.endCapture(buf, i); // item without rates
        }
        if (this.depth === 1) this.section = "";
      }
      i++;
    }
    if (this.cap) {
      const part = buf.subarray(this.capStart);
      this.cap.push(part);
      this.capBytes += part.length;
      if (this.capBytes > WHOLE_CAP) { this.cap = null; this.capKind = null; this.oversize++; }
    }
  }

  /** Index of the closing quote, or -1 if the string continues into the next chunk. */
  private stringEnd(buf: Buffer, j: number): number {
    if (this.esc) { j++; this.esc = false; }
    const start = j;
    for (;;) {
      if (j >= buf.length) return -1;
      const q = buf.indexOf(Q, j);
      if (q === -1) {
        let k = buf.length - 1, n = 0;
        while (k >= start && buf[k] === BS) { n++; k--; }
        this.esc = n % 2 === 1;
        return -1;
      }
      let k = q - 1, n = 0;
      while (k >= start && buf[k] === BS) { n++; k--; }
      if (n % 2 === 0) return q;
      j = q + 1;
    }
  }

  private startCapture(i: number, kind: NonNullable<MrfScanner["capKind"]>) {
    this.cap = [];
    this.capStart = i;
    this.capBytes = 0;
    this.capKind = kind;
  }
  private startCaptureFrom(prefix: Buffer, kind: NonNullable<MrfScanner["capKind"]>) {
    this.cap = [prefix];
    this.capBytes = prefix.length;
    this.capKind = kind;
  }
  /** Finish the capture at byte index `end` (inclusive) of `buf` and return the text. */
  private endCapture(buf: Buffer, end: number): string {
    const parts = this.cap!;
    parts.push(buf.subarray(this.capStart, end + 1));
    this.cap = null;
    this.capKind = null;
    return Buffer.concat(parts).toString("utf8");
  }
}
