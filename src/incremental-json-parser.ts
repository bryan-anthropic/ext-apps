/**
 * Incremental JSON Parser with Healing
 *
 * A streaming JSON parser that maintains a finite state automaton (FSA) and can
 * produce valid "healed" JSON at any point during incremental input. Designed
 * for progressive rendering of tool arguments streamed from an LLM.
 *
 * **Key properties:**
 * - Processes input character-by-character via {@link IncrementalJsonParser.write | write()}.
 * - Healed output is computed in O(stack_depth) from the FSA state — the
 *   entire raw input is never re-scanned.
 * - Trailing commas are trimmed rather than padded with dummy values.
 * - Full JSON grammar: objects, arrays, strings (with escapes + `\\uXXXX`),
 *   numbers (including fractions and exponents), `true`, `false`, `null`.
 *
 * @example
 * ```ts
 * const parser = new IncrementalJsonParser({
 *   onUpdate(healed) { console.log(healed); }
 * });
 * parser.write('{"na');   // → '{"na": null}'
 * parser.write('me": "A');// → '{"name": "A"}'
 * parser.write('lice"}'); // → '{"name": "Alice"}'
 * ```
 *
 * @module
 */

// ---------------------------------------------------------------------------
// FSA token types
// ---------------------------------------------------------------------------

/** What atomic token (if any) is currently being parsed. */
const enum TokenType {
  /** Between tokens — processing whitespace or structural characters. */
  NONE = 0,
  /** Inside a quoted string (`"…`). */
  STRING = 1,
  /** After a backslash inside a string (`\`). */
  STRING_ESCAPE = 2,
  /** Inside a `\uXXXX` unicode escape in a string. */
  STRING_UNICODE = 3,
  /** Inside a number literal. */
  NUMBER = 4,
  /** Inside a keyword literal (`true` / `false` / `null`). */
  LITERAL = 5,
}

// ---------------------------------------------------------------------------
// Number sub-states
// ---------------------------------------------------------------------------

const enum NumPhase {
  /** Just saw leading `-`. */
  SIGN = 0,
  /** Saw leading `0` (no further integer digits allowed). */
  INT_ZERO = 1,
  /** In the integer-digit run (`[1-9][0-9]*`). */
  INT_DIGIT = 2,
  /** Just saw the decimal `.`. */
  FRAC_DOT = 3,
  /** In the fractional-digit run. */
  FRAC_DIGIT = 4,
  /** Just saw `e` or `E`. */
  EXP_E = 5,
  /** Just saw the sign after `e`/`E`. */
  EXP_SIGN = 6,
  /** In the exponent-digit run. */
  EXP_DIGIT = 7,
}

// ---------------------------------------------------------------------------
// Container stack
// ---------------------------------------------------------------------------

/**
 * Phase within an open container (object or array).
 *
 * For objects the lifecycle is:
 * ```
 * OBJ_EMPTY ──"──▸ (key string) ──▸ OBJ_AFTER_KEY ──:──▸ OBJ_VALUE
 *   ──(value)──▸ OBJ_AFTER_VALUE ──,──▸ OBJ_AFTER_COMMA ──"──▸ (key) …
 * ```
 *
 * For arrays:
 * ```
 * ARR_EMPTY ──(value)──▸ ARR_AFTER_VALUE ──,──▸ ARR_AFTER_COMMA ──(value)──▸ …
 * ```
 */
const enum FramePhase {
  // ── Object ──
  /** After `{`, expecting first key `"…"` or `}`. */
  OBJ_EMPTY = 0,
  /** After `:`, expecting a value. */
  OBJ_VALUE = 1,
  /** After a closing `"` of an object key, expecting `:`. */
  OBJ_AFTER_KEY = 2,
  /** After a complete value in an object, expecting `,` or `}`. */
  OBJ_AFTER_VALUE = 3,
  /** After `,` in an object, expecting next key. */
  OBJ_AFTER_COMMA = 4,

  // ── Array ──
  /** After `[`, expecting first element or `]`. */
  ARR_EMPTY = 10,
  /** After a complete value in an array, expecting `,` or `]`. */
  ARR_AFTER_VALUE = 11,
  /** After `,` in an array, expecting next element. */
  ARR_AFTER_COMMA = 12,
}

interface StackFrame {
  phase: FramePhase;
}

/** Return `true` when the phase belongs to an object (vs. array). */
function isObjectPhase(phase: FramePhase): boolean {
  return phase < 10;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Options for {@link IncrementalJsonParser}.
 */
export interface IncrementalJsonParserOptions {
  /**
   * Called after every {@link IncrementalJsonParser.write | write()} that
   * changes the healed output.  Receives the current healed JSON string.
   */
  onUpdate?: (healed: string) => void;

  /**
   * Called once when the input forms a complete, valid JSON value (no healing
   * required).
   */
  onComplete?: (json: string) => void;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Incremental (streaming) JSON parser with automatic healing.
 *
 * Feed arbitrary chunks of a JSON document via {@link write} and retrieve the
 * best-effort healed JSON at any time via {@link getHealed}.  The parser never
 * re-scans already-consumed input — healing is derived from the current FSA
 * state in O(stack_depth).
 */
export class IncrementalJsonParser {
  // ── Raw input accumulator ──
  private raw = "";
  private rawLength = 0;

  // ── FSA state ──
  private stack: StackFrame[] = [];
  private tokenType: TokenType = TokenType.NONE;

  /** Whether we're inside a key string (as opposed to a value string). */
  private isKeyString = false;

  // Number sub-state
  private numPhase: NumPhase = NumPhase.SIGN;

  // Literal sub-state
  private literalTarget = "";
  private literalIndex = 0;

  // Unicode escape counter (counts remaining hex digits)
  private unicodeRemaining = 0;

  // Trailing-comma tracking — index in `raw` of the most recent comma that
  // hasn't yet been followed by the start of a new value/key.  Set to -1 when
  // the comma is "consumed" (a value/key begins after it).
  private trailingCommaIndex = -1;

  // Completion flag
  private complete = false;

  // ── Healing cache ──
  private healedCache: string | null = null;

  // ── Callbacks ──
  private onUpdateCb: ((healed: string) => void) | null;
  private onCompleteCb: ((json: string) => void) | null;

  constructor(options?: IncrementalJsonParserOptions) {
    this.onUpdateCb = options?.onUpdate ?? null;
    this.onCompleteCb = options?.onComplete ?? null;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Callback invoked after every {@link write} that changes the healed output.
   */
  get onUpdate(): ((healed: string) => void) | null {
    return this.onUpdateCb;
  }
  set onUpdate(cb: ((healed: string) => void) | null) {
    this.onUpdateCb = cb;
  }

  /**
   * Callback invoked once when the input forms a complete JSON value.
   */
  get onComplete(): ((json: string) => void) | null {
    return this.onCompleteCb;
  }
  set onComplete(cb: ((json: string) => void) | null) {
    this.onCompleteCb = cb;
  }

  /**
   * Feed a chunk of JSON text into the parser.
   *
   * Characters are processed through the FSA one at a time.  After the chunk
   * is consumed the {@link onUpdate} callback fires (if the healed output
   * changed) and, if parsing completed, {@link onComplete} fires.
   */
  write(chunk: string): void {
    if (this.complete || chunk.length === 0) return;

    const startOffset = this.rawLength;

    for (let i = 0; i < chunk.length; i++) {
      if (this.complete) break;
      const ch = chunk[i]!;
      const absPos = startOffset + i;

      switch (this.tokenType) {
        case TokenType.STRING:
          this.processStringChar(ch);
          break;
        case TokenType.STRING_ESCAPE:
          this.processStringEscapeChar(ch);
          break;
        case TokenType.STRING_UNICODE:
          this.processStringUnicodeChar(ch);
          break;
        case TokenType.NUMBER:
          if (!this.processNumberChar(ch)) {
            // Character is not part of the number — end it and re-process.
            this.endNumber();
            i--; // re-process `ch` as structural/whitespace
          }
          break;
        case TokenType.LITERAL:
          if (!this.processLiteralChar(ch)) {
            // Mismatch — force-complete the literal and re-process.
            this.endLiteral();
            i--;
          }
          break;
        case TokenType.NONE:
          this.processStructuralChar(ch, absPos);
          break;
      }
    }

    this.raw += chunk;
    this.rawLength += chunk.length;

    // Invalidate cache & fire callbacks
    const prevHealed = this.healedCache;
    this.healedCache = null;
    const newHealed = this.getHealed();
    if (newHealed !== prevHealed && this.onUpdateCb) {
      this.onUpdateCb(newHealed);
    }
    if (this.complete && this.onCompleteCb) {
      this.onCompleteCb(this.raw);
    }
  }

  /**
   * Return the current healed JSON string.
   *
   * If the input is already complete, this returns the raw input unchanged.
   * Otherwise it appends the minimal suffix that makes the JSON valid
   * (completing open tokens and closing open containers).  Trailing commas
   * are trimmed.
   *
   * Complexity: O(stack_depth) — the raw input is not re-scanned.
   */
  getHealed(): string {
    if (this.healedCache !== null) return this.healedCache;

    if (this.complete) {
      this.healedCache = this.raw;
      return this.raw;
    }

    if (this.rawLength === 0) {
      this.healedCache = "";
      return "";
    }

    // Determine the base raw string (trimming trailing comma if needed).
    let rawBase: string;
    if (
      this.trailingCommaIndex >= 0 &&
      this.tokenType === TokenType.NONE
    ) {
      rawBase = this.raw.substring(0, this.trailingCommaIndex);
    } else {
      rawBase = this.raw;
    }

    let suffix = "";
    const topFrame =
      this.stack.length > 0
        ? this.stack[this.stack.length - 1]!
        : null;

    // Step 1 — close the current token (if any).
    switch (this.tokenType) {
      case TokenType.STRING:
        suffix += '"';
        if (
          topFrame &&
          (topFrame.phase === FramePhase.OBJ_EMPTY ||
            topFrame.phase === FramePhase.OBJ_AFTER_COMMA)
        ) {
          suffix += ": null";
        }
        break;

      case TokenType.STRING_ESCAPE:
        // Complete the escape with a benign character, then close string.
        suffix += 'n"';
        if (
          topFrame &&
          (topFrame.phase === FramePhase.OBJ_EMPTY ||
            topFrame.phase === FramePhase.OBJ_AFTER_COMMA)
        ) {
          suffix += ": null";
        }
        break;

      case TokenType.STRING_UNICODE:
        suffix += "0".repeat(this.unicodeRemaining) + '"';
        if (
          topFrame &&
          (topFrame.phase === FramePhase.OBJ_EMPTY ||
            topFrame.phase === FramePhase.OBJ_AFTER_COMMA)
        ) {
          suffix += ": null";
        }
        break;

      case TokenType.NUMBER:
        suffix += this.healNumberSuffix();
        break;

      case TokenType.LITERAL:
        suffix += this.literalTarget.substring(this.literalIndex);
        break;

      case TokenType.NONE:
        // No token in progress — check if the top frame expects something.
        if (topFrame) {
          switch (topFrame.phase) {
            case FramePhase.OBJ_AFTER_KEY:
              suffix += ": null";
              break;
            case FramePhase.OBJ_VALUE:
              suffix += "null";
              break;
            // OBJ_EMPTY, OBJ_AFTER_VALUE, OBJ_AFTER_COMMA: nothing extra
            // ARR_EMPTY, ARR_AFTER_VALUE, ARR_AFTER_COMMA: nothing extra
          }
        }
        break;
    }

    // Step 2 — close every open container.
    for (let i = this.stack.length - 1; i >= 0; i--) {
      suffix += isObjectPhase(this.stack[i]!.phase) ? "}" : "]";
    }

    this.healedCache = rawBase + suffix;
    return this.healedCache;
  }

  /** The raw (unhealed) input accumulated so far. */
  getRaw(): string {
    return this.raw;
  }

  /** `true` once a complete, valid JSON value has been received. */
  get isComplete(): boolean {
    return this.complete;
  }

  /** Current nesting depth (number of open containers). */
  get depth(): number {
    return this.stack.length;
  }

  /**
   * Signal that no more input will arrive.
   *
   * This terminates any in-progress number or literal token at the top level
   * and marks the parse as complete (if the result is a valid top-level
   * value).  Has no effect if parsing is already complete or if containers
   * are still open.
   */
  end(): void {
    if (this.complete) return;

    // Terminate an in-progress number or literal at the top level.
    if (this.stack.length === 0) {
      if (this.tokenType === TokenType.NUMBER) {
        this.endNumber();
      } else if (
        this.tokenType === TokenType.LITERAL &&
        this.literalIndex === this.literalTarget.length
      ) {
        this.endLiteral();
      }
    }
  }

  /** Reset the parser to its initial state (empty input). */
  reset(): void {
    this.raw = "";
    this.rawLength = 0;
    this.stack.length = 0;
    this.tokenType = TokenType.NONE;
    this.isKeyString = false;
    this.numPhase = NumPhase.SIGN;
    this.literalTarget = "";
    this.literalIndex = 0;
    this.unicodeRemaining = 0;
    this.trailingCommaIndex = -1;
    this.complete = false;
    this.healedCache = null;
  }

  // -----------------------------------------------------------------------
  // FSA internals — string
  // -----------------------------------------------------------------------

  private processStringChar(ch: string): void {
    if (ch === '"') {
      this.tokenType = TokenType.NONE;
      this.stringCompleted();
    } else if (ch === "\\") {
      this.tokenType = TokenType.STRING_ESCAPE;
    }
    // Any other character: stay in STRING.
  }

  private processStringEscapeChar(ch: string): void {
    if (ch === "u") {
      this.tokenType = TokenType.STRING_UNICODE;
      this.unicodeRemaining = 4;
    } else {
      // Single-char escape (\", \\, \/, \b, \f, \n, \r, \t) or lenient.
      this.tokenType = TokenType.STRING;
    }
  }

  private processStringUnicodeChar(_ch: string): void {
    this.unicodeRemaining--;
    if (this.unicodeRemaining === 0) {
      this.tokenType = TokenType.STRING;
    }
  }

  /**
   * A string has been fully consumed (closing `"` seen).
   * Advance the parent container's phase.
   */
  private stringCompleted(): void {
    if (this.stack.length === 0) {
      // Top-level string value — parsing is done.
      this.complete = true;
      return;
    }

    const frame = this.stack[this.stack.length - 1]!;
    switch (frame.phase) {
      case FramePhase.OBJ_EMPTY:
      case FramePhase.OBJ_AFTER_COMMA:
        // The string was an object key.
        frame.phase = FramePhase.OBJ_AFTER_KEY;
        break;
      case FramePhase.OBJ_VALUE:
        // The string was an object value.
        frame.phase = FramePhase.OBJ_AFTER_VALUE;
        break;
      case FramePhase.ARR_EMPTY:
      case FramePhase.ARR_AFTER_COMMA:
        // The string was an array element.
        frame.phase = FramePhase.ARR_AFTER_VALUE;
        break;
    }
  }

  // -----------------------------------------------------------------------
  // FSA internals — number
  // -----------------------------------------------------------------------

  /**
   * Try to consume `ch` as part of a number.
   * @returns `true` if consumed, `false` if `ch` is not part of the number.
   */
  private processNumberChar(ch: string): boolean {
    switch (this.numPhase) {
      case NumPhase.SIGN:
        if (ch === "0") {
          this.numPhase = NumPhase.INT_ZERO;
          return true;
        }
        if (ch >= "1" && ch <= "9") {
          this.numPhase = NumPhase.INT_DIGIT;
          return true;
        }
        return false;

      case NumPhase.INT_ZERO:
        if (ch === ".") {
          this.numPhase = NumPhase.FRAC_DOT;
          return true;
        }
        if (ch === "e" || ch === "E") {
          this.numPhase = NumPhase.EXP_E;
          return true;
        }
        return false;

      case NumPhase.INT_DIGIT:
        if (ch >= "0" && ch <= "9") return true;
        if (ch === ".") {
          this.numPhase = NumPhase.FRAC_DOT;
          return true;
        }
        if (ch === "e" || ch === "E") {
          this.numPhase = NumPhase.EXP_E;
          return true;
        }
        return false;

      case NumPhase.FRAC_DOT:
        if (ch >= "0" && ch <= "9") {
          this.numPhase = NumPhase.FRAC_DIGIT;
          return true;
        }
        return false;

      case NumPhase.FRAC_DIGIT:
        if (ch >= "0" && ch <= "9") return true;
        if (ch === "e" || ch === "E") {
          this.numPhase = NumPhase.EXP_E;
          return true;
        }
        return false;

      case NumPhase.EXP_E:
        if (ch === "+" || ch === "-") {
          this.numPhase = NumPhase.EXP_SIGN;
          return true;
        }
        if (ch >= "0" && ch <= "9") {
          this.numPhase = NumPhase.EXP_DIGIT;
          return true;
        }
        return false;

      case NumPhase.EXP_SIGN:
        if (ch >= "0" && ch <= "9") {
          this.numPhase = NumPhase.EXP_DIGIT;
          return true;
        }
        return false;

      case NumPhase.EXP_DIGIT:
        if (ch >= "0" && ch <= "9") return true;
        return false;
    }
  }

  /** End a number token and advance the parent container. */
  private endNumber(): void {
    this.tokenType = TokenType.NONE;
    this.valueCompleted();
  }

  /**
   * Return the suffix needed to make the current (incomplete) number valid.
   */
  private healNumberSuffix(): string {
    switch (this.numPhase) {
      case NumPhase.SIGN: // `-` → `-0`
        return "0";
      case NumPhase.FRAC_DOT: // `1.` → `1.0`
        return "0";
      case NumPhase.EXP_E: // `1e` → `1e0`
      case NumPhase.EXP_SIGN: // `1e+` → `1e+0`
        return "0";
      default:
        // INT_ZERO, INT_DIGIT, FRAC_DIGIT, EXP_DIGIT — already valid.
        return "";
    }
  }

  // -----------------------------------------------------------------------
  // FSA internals — literal (true / false / null)
  // -----------------------------------------------------------------------

  /**
   * Try to consume `ch` as the next expected character of a literal.
   * @returns `true` if it matched, `false` otherwise.
   */
  private processLiteralChar(ch: string): boolean {
    if (ch === this.literalTarget[this.literalIndex]) {
      this.literalIndex++;
      if (this.literalIndex === this.literalTarget.length) {
        this.endLiteral();
      }
      return true;
    }
    return false;
  }

  /** End a literal token and advance the parent container. */
  private endLiteral(): void {
    this.tokenType = TokenType.NONE;
    this.valueCompleted();
  }

  // -----------------------------------------------------------------------
  // FSA internals — structural characters
  // -----------------------------------------------------------------------

  /**
   * Process a character when no token is active (`tokenType === NONE`).
   * Handles whitespace, structural characters, and starts new tokens.
   */
  private processStructuralChar(ch: string, absPos: number): void {
    // Skip whitespace.
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") return;

    switch (ch) {
      // ── Container open ──
      case "{":
        this.clearTrailingComma();
        this.stack.push({ phase: FramePhase.OBJ_EMPTY });
        break;
      case "[":
        this.clearTrailingComma();
        this.stack.push({ phase: FramePhase.ARR_EMPTY });
        break;

      // ── Container close ──
      case "}": {
        const frame = this.topFrame();
        if (
          frame &&
          (frame.phase === FramePhase.OBJ_EMPTY ||
            frame.phase === FramePhase.OBJ_AFTER_VALUE)
        ) {
          this.stack.pop();
          this.valueCompleted();
        }
        break;
      }
      case "]": {
        const frame = this.topFrame();
        if (
          frame &&
          (frame.phase === FramePhase.ARR_EMPTY ||
            frame.phase === FramePhase.ARR_AFTER_VALUE)
        ) {
          this.stack.pop();
          this.valueCompleted();
        }
        break;
      }

      // ── Colon (object key→value separator) ──
      case ":": {
        const frame = this.topFrame();
        if (frame && frame.phase === FramePhase.OBJ_AFTER_KEY) {
          frame.phase = FramePhase.OBJ_VALUE;
        }
        break;
      }

      // ── Comma ──
      case ",": {
        const frame = this.topFrame();
        if (frame) {
          if (frame.phase === FramePhase.OBJ_AFTER_VALUE) {
            frame.phase = FramePhase.OBJ_AFTER_COMMA;
          } else if (frame.phase === FramePhase.ARR_AFTER_VALUE) {
            frame.phase = FramePhase.ARR_AFTER_COMMA;
          }
          this.trailingCommaIndex = absPos;
        }
        break;
      }

      // ── String ──
      case '"': {
        this.clearTrailingComma();
        this.tokenType = TokenType.STRING;
        const frame = this.topFrame();
        this.isKeyString =
          frame !== null &&
          (frame.phase === FramePhase.OBJ_EMPTY ||
            frame.phase === FramePhase.OBJ_AFTER_COMMA);
        break;
      }

      // ── Number ──
      default:
        if (ch === "-" || (ch >= "0" && ch <= "9")) {
          this.clearTrailingComma();
          this.tokenType = TokenType.NUMBER;
          if (ch === "-") {
            this.numPhase = NumPhase.SIGN;
          } else if (ch === "0") {
            this.numPhase = NumPhase.INT_ZERO;
          } else {
            this.numPhase = NumPhase.INT_DIGIT;
          }
          break;
        }

        // ── Literal ──
        if (ch === "t") {
          this.clearTrailingComma();
          this.tokenType = TokenType.LITERAL;
          this.literalTarget = "true";
          this.literalIndex = 1;
        } else if (ch === "f") {
          this.clearTrailingComma();
          this.tokenType = TokenType.LITERAL;
          this.literalTarget = "false";
          this.literalIndex = 1;
        } else if (ch === "n") {
          this.clearTrailingComma();
          this.tokenType = TokenType.LITERAL;
          this.literalTarget = "null";
          this.literalIndex = 1;
        }
        // Unrecognised characters are silently skipped (lenient).
        break;
    }
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  /** Top stack frame, or `null` if the stack is empty. */
  private topFrame(): StackFrame | null {
    return this.stack.length > 0
      ? this.stack[this.stack.length - 1]!
      : null;
  }

  /** Mark the trailing comma as consumed (a new key/value has started). */
  private clearTrailingComma(): void {
    if (this.trailingCommaIndex >= 0) {
      this.trailingCommaIndex = -1;
    }
  }

  /**
   * Called when a non-string, non-container value completes
   * (number, literal) *or* when a container closes.
   * Advances the parent container's phase.
   */
  private valueCompleted(): void {
    if (this.stack.length === 0) {
      this.complete = true;
      return;
    }

    const frame = this.stack[this.stack.length - 1]!;
    switch (frame.phase) {
      case FramePhase.OBJ_VALUE:
        frame.phase = FramePhase.OBJ_AFTER_VALUE;
        break;
      case FramePhase.ARR_EMPTY:
      case FramePhase.ARR_AFTER_COMMA:
        frame.phase = FramePhase.ARR_AFTER_VALUE;
        break;
    }
  }
}
