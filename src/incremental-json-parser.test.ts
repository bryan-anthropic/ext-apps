import { describe, it, expect, beforeEach } from "bun:test";
import { IncrementalJsonParser } from "./incremental-json-parser";

describe("IncrementalJsonParser", () => {
  let parser: IncrementalJsonParser;

  beforeEach(() => {
    parser = new IncrementalJsonParser();
  });

  // -----------------------------------------------------------------------
  // Basic healing — objects
  // -----------------------------------------------------------------------

  describe("objects", () => {
    it("heals empty input to empty string", () => {
      expect(parser.getHealed()).toBe("");
    });

    it("heals opening brace", () => {
      parser.write("{");
      expect(parser.getHealed()).toBe("{}");
    });

    it("heals partial key", () => {
      parser.write('{"na');
      expect(parser.getHealed()).toBe('{"na": null}');
    });

    it("heals complete key without colon", () => {
      parser.write('{"name"');
      expect(parser.getHealed()).toBe('{"name": null}');
    });

    it("heals after colon", () => {
      parser.write('{"name":');
      expect(parser.getHealed()).toBe('{"name":null}');
    });

    it("heals after colon with space", () => {
      parser.write('{"name": ');
      expect(parser.getHealed()).toBe('{"name": null}');
    });

    it("heals partial string value", () => {
      parser.write('{"name": "Ali');
      expect(parser.getHealed()).toBe('{"name": "Ali"}');
    });

    it("passes through complete object", () => {
      parser.write('{"name": "Alice"}');
      expect(parser.getHealed()).toBe('{"name": "Alice"}');
      expect(parser.isComplete).toBe(true);
    });

    it("heals trailing comma in object", () => {
      parser.write('{"a": 1,');
      expect(parser.getHealed()).toBe('{"a": 1}');
    });

    it("heals trailing comma with space in object", () => {
      parser.write('{"a": 1, ');
      expect(parser.getHealed()).toBe('{"a": 1}');
    });

    it("heals multi-key object mid-value", () => {
      parser.write('{"a": 1, "b": "hel');
      expect(parser.getHealed()).toBe('{"a": 1, "b": "hel"}');
    });

    it("heals object with complete second pair", () => {
      parser.write('{"a": 1, "b": 2');
      expect(parser.getHealed()).toBe('{"a": 1, "b": 2}');
    });
  });

  // -----------------------------------------------------------------------
  // Basic healing — arrays
  // -----------------------------------------------------------------------

  describe("arrays", () => {
    it("heals opening bracket", () => {
      parser.write("[");
      expect(parser.getHealed()).toBe("[]");
    });

    it("heals array with one element", () => {
      parser.write("[1");
      expect(parser.getHealed()).toBe("[1]");
    });

    it("heals array trailing comma", () => {
      parser.write("[1,");
      expect(parser.getHealed()).toBe("[1]");
    });

    it("heals array trailing comma with space", () => {
      parser.write("[1, ");
      expect(parser.getHealed()).toBe("[1]");
    });

    it("heals array with partial string", () => {
      parser.write('["hel');
      expect(parser.getHealed()).toBe('["hel"]');
    });

    it("passes through complete array", () => {
      parser.write("[1, 2, 3]");
      expect(parser.getHealed()).toBe("[1, 2, 3]");
      expect(parser.isComplete).toBe(true);
    });

    it("heals mixed-type array", () => {
      parser.write('[1, "two", tru');
      expect(parser.getHealed()).toBe('[1, "two", true]');
    });
  });

  // -----------------------------------------------------------------------
  // Nesting
  // -----------------------------------------------------------------------

  describe("nesting", () => {
    it("heals nested object", () => {
      parser.write('{"a": {"b": "c');
      expect(parser.getHealed()).toBe('{"a": {"b": "c"}}');
    });

    it("heals nested array in object", () => {
      parser.write('{"items": [1, 2');
      expect(parser.getHealed()).toBe('{"items": [1, 2]}');
    });

    it("heals nested object in array", () => {
      parser.write('[{"a": 1}, {"b":');
      expect(parser.getHealed()).toBe('[{"a": 1}, {"b":null}]');
    });

    it("heals deeply nested structure", () => {
      parser.write('{"a": {"b": {"c": [1, {"d": "e');
      expect(parser.getHealed()).toBe(
        '{"a": {"b": {"c": [1, {"d": "e"}]}}}',
      );
    });

    it("heals nested trailing commas", () => {
      parser.write("[1, [2, ");
      expect(parser.getHealed()).toBe("[1, [2]]");
    });

    it("heals after nested container closes", () => {
      parser.write('{"a": [1, 2], ');
      expect(parser.getHealed()).toBe('{"a": [1, 2]}');
    });
  });

  // -----------------------------------------------------------------------
  // Strings — escapes
  // -----------------------------------------------------------------------

  describe("string escapes", () => {
    it("heals string with complete escape", () => {
      parser.write('{"a": "line1\\nline2');
      expect(parser.getHealed()).toBe('{"a": "line1\\nline2"}');
    });

    it("heals string ending with backslash", () => {
      parser.write('{"a": "test\\');
      expect(parser.getHealed()).toBe('{"a": "test\\n"}');
    });

    it("heals string with partial unicode escape", () => {
      parser.write('{"a": "\\u00');
      expect(parser.getHealed()).toBe('{"a": "\\u0000"}');
    });

    it("heals string with complete unicode escape", () => {
      parser.write('{"a": "\\u0041');
      expect(parser.getHealed()).toBe('{"a": "\\u0041"}');
    });

    it("heals key string ending with backslash", () => {
      parser.write('{"a\\');
      expect(parser.getHealed()).toBe('{"a\\n": null}');
    });

    it("handles escaped quote in string", () => {
      parser.write('{"a": "say \\"hello');
      expect(parser.getHealed()).toBe('{"a": "say \\"hello"}');
    });

    it("handles escaped backslash in string", () => {
      parser.write('{"a": "path\\\\dir');
      expect(parser.getHealed()).toBe('{"a": "path\\\\dir"}');
    });
  });

  // -----------------------------------------------------------------------
  // Numbers
  // -----------------------------------------------------------------------

  describe("numbers", () => {
    it("heals integer", () => {
      parser.write('{"n": 42');
      expect(parser.getHealed()).toBe('{"n": 42}');
    });

    it("heals negative sign only", () => {
      parser.write('{"n": -');
      expect(parser.getHealed()).toBe('{"n": -0}');
    });

    it("heals zero", () => {
      parser.write('{"n": 0');
      expect(parser.getHealed()).toBe('{"n": 0}');
    });

    it("heals decimal point without digits", () => {
      parser.write('{"n": 1.');
      expect(parser.getHealed()).toBe('{"n": 1.0}');
    });

    it("heals decimal with digits", () => {
      parser.write('{"n": 3.14');
      expect(parser.getHealed()).toBe('{"n": 3.14}');
    });

    it("heals exponent without digits", () => {
      parser.write('{"n": 1e');
      expect(parser.getHealed()).toBe('{"n": 1e0}');
    });

    it("heals exponent sign without digits", () => {
      parser.write('{"n": 1e+');
      expect(parser.getHealed()).toBe('{"n": 1e+0}');
    });

    it("heals exponent with negative sign", () => {
      parser.write('{"n": 1e-');
      expect(parser.getHealed()).toBe('{"n": 1e-0}');
    });

    it("heals complete exponent", () => {
      parser.write('{"n": 1e10');
      expect(parser.getHealed()).toBe('{"n": 1e10}');
    });

    it("heals negative decimal with exponent", () => {
      parser.write('{"n": -3.14e');
      expect(parser.getHealed()).toBe('{"n": -3.14e0}');
    });

    it("terminates number at comma", () => {
      parser.write("[1,2");
      expect(parser.getHealed()).toBe("[1,2]");
    });

    it("terminates number at closing brace", () => {
      parser.write('{"a":1}');
      expect(parser.getHealed()).toBe('{"a":1}');
      expect(parser.isComplete).toBe(true);
    });

    it("terminates number at closing bracket", () => {
      parser.write("[1]");
      expect(parser.getHealed()).toBe("[1]");
      expect(parser.isComplete).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Literals (true, false, null)
  // -----------------------------------------------------------------------

  describe("literals", () => {
    it("heals partial true", () => {
      parser.write('{"a": t');
      expect(parser.getHealed()).toBe('{"a": true}');
    });

    it("heals partial true (tr)", () => {
      parser.write('{"a": tr');
      expect(parser.getHealed()).toBe('{"a": true}');
    });

    it("heals complete true", () => {
      parser.write('{"a": true');
      expect(parser.getHealed()).toBe('{"a": true}');
    });

    it("heals partial false", () => {
      parser.write('{"a": fal');
      expect(parser.getHealed()).toBe('{"a": false}');
    });

    it("heals complete false", () => {
      parser.write('{"a": false');
      expect(parser.getHealed()).toBe('{"a": false}');
    });

    it("heals partial null", () => {
      parser.write('{"a": nu');
      expect(parser.getHealed()).toBe('{"a": null}');
    });

    it("heals complete null", () => {
      parser.write('{"a": null');
      expect(parser.getHealed()).toBe('{"a": null}');
    });

    it("literal followed by comma", () => {
      parser.write('{"a": true, "b": 1');
      expect(parser.getHealed()).toBe('{"a": true, "b": 1}');
    });

    it("literal in array", () => {
      parser.write("[true, fal");
      expect(parser.getHealed()).toBe("[true, false]");
    });
  });

  // -----------------------------------------------------------------------
  // Top-level primitives
  // -----------------------------------------------------------------------

  describe("top-level primitives", () => {
    it("heals top-level string", () => {
      parser.write('"hel');
      expect(parser.getHealed()).toBe('"hel"');
    });

    it("completes top-level string", () => {
      parser.write('"hello"');
      expect(parser.getHealed()).toBe('"hello"');
      expect(parser.isComplete).toBe(true);
    });

    it("heals top-level number", () => {
      parser.write("42");
      expect(parser.getHealed()).toBe("42");
      // Numbers can't self-complete; use end() to signal EOF.
      expect(parser.isComplete).toBe(false);
      parser.end();
      expect(parser.isComplete).toBe(true);
    });

    it("heals top-level true", () => {
      parser.write("tru");
      expect(parser.getHealed()).toBe("true");
    });

    it("completes top-level null", () => {
      parser.write("null");
      expect(parser.getHealed()).toBe("null");
      expect(parser.isComplete).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Incremental write (multiple chunks)
  // -----------------------------------------------------------------------

  describe("incremental write", () => {
    it("builds up object character by character", () => {
      const input = '{"name": "Alice"}';
      for (let i = 0; i < input.length; i++) {
        parser.write(input[i]!);
        const healed = parser.getHealed();
        // Every intermediate step should produce valid JSON.
        expect(() => JSON.parse(healed)).not.toThrow();
      }
      expect(parser.isComplete).toBe(true);
      expect(parser.getHealed()).toBe(input);
    });

    it("handles multi-character chunks", () => {
      parser.write('{"na');
      parser.write('me": ');
      parser.write('"Ali');
      parser.write('ce"}');
      expect(parser.getHealed()).toBe('{"name": "Alice"}');
      expect(parser.isComplete).toBe(true);
    });

    it("heals correctly at every intermediate step", () => {
      const steps = [
        ['{"lo', '{"lo": null}'],
        ['cation": "N', '{"location": "N"}'],
        ['ew Yor', '{"location": "New Yor"}'],
        ['k", "units": "met', '{"location": "New York", "units": "met"}'],
        ['ric"}', '{"location": "New York", "units": "metric"}'],
      ] as const;

      for (const [chunk, expected] of steps) {
        parser.write(chunk);
        expect(parser.getHealed()).toBe(expected);
      }
    });

    it("ignores empty writes", () => {
      parser.write('{"a": 1');
      const healed1 = parser.getHealed();
      parser.write("");
      expect(parser.getHealed()).toBe(healed1);
    });

    it("ignores writes after completion", () => {
      parser.write('{"a": 1}');
      expect(parser.isComplete).toBe(true);
      parser.write('{"b": 2}');
      expect(parser.getHealed()).toBe('{"a": 1}');
    });
  });

  // -----------------------------------------------------------------------
  // Events
  // -----------------------------------------------------------------------

  describe("events", () => {
    it("fires onUpdate on each write", () => {
      const updates: string[] = [];
      parser.onUpdate = (healed) => updates.push(healed);

      parser.write("{");
      parser.write('"a');
      parser.write('": 1}');

      expect(updates).toEqual(["{}", '{"a": null}', '{"a": 1}']);
    });

    it("fires onComplete when JSON is finished", () => {
      const results: string[] = [];
      parser.onComplete = (json) => {
        results.push(json);
      };

      parser.write('{"a": ');
      expect(results).toEqual([]);

      parser.write("1}");
      expect(results).toEqual(['{"a": 1}']);
    });

    it("does not fire onUpdate for empty writes", () => {
      const updates: string[] = [];
      parser.onUpdate = (healed) => updates.push(healed);

      parser.write("");
      expect(updates).toEqual([]);
    });

    it("supports constructor callbacks", () => {
      const updates: string[] = [];
      const completions: string[] = [];

      const p = new IncrementalJsonParser({
        onUpdate: (h) => updates.push(h),
        onComplete: (j) => completions.push(j),
      });

      p.write('{"x": 1}');
      expect(updates).toEqual(['{"x": 1}']);
      expect(completions).toEqual(['{"x": 1}']);
    });
  });

  // -----------------------------------------------------------------------
  // Reset
  // -----------------------------------------------------------------------

  describe("reset", () => {
    it("resets parser to initial state", () => {
      parser.write('{"a": 1');
      expect(parser.getHealed()).toBe('{"a": 1}');

      parser.reset();
      expect(parser.getHealed()).toBe("");
      expect(parser.isComplete).toBe(false);
      expect(parser.getRaw()).toBe("");
    });

    it("can parse new input after reset", () => {
      parser.write('{"a": 1}');
      expect(parser.isComplete).toBe(true);

      parser.reset();
      parser.write('{"b": 2}');
      expect(parser.getHealed()).toBe('{"b": 2}');
      expect(parser.isComplete).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Caching
  // -----------------------------------------------------------------------

  describe("caching", () => {
    it("returns cached result for repeated getHealed calls", () => {
      parser.write('{"a": 1');
      const h1 = parser.getHealed();
      const h2 = parser.getHealed();
      expect(h1).toBe(h2);
    });

    it("invalidates cache on write", () => {
      parser.write('{"a": 1');
      const h1 = parser.getHealed();
      parser.write(', "b": 2');
      const h2 = parser.getHealed();
      expect(h1).not.toBe(h2);
      expect(h2).toBe('{"a": 1, "b": 2}');
    });
  });

  // -----------------------------------------------------------------------
  // Properties
  // -----------------------------------------------------------------------

  describe("properties", () => {
    it("tracks depth", () => {
      expect(parser.depth).toBe(0);
      parser.write("{");
      expect(parser.depth).toBe(1);
      parser.write('"a": [');
      expect(parser.depth).toBe(2);
      parser.write("1]");
      expect(parser.depth).toBe(1);
      parser.write("}");
      expect(parser.depth).toBe(0);
    });

    it("tracks raw input", () => {
      parser.write('{"a": ');
      parser.write("1");
      expect(parser.getRaw()).toBe('{"a": 1');
    });
  });

  // -----------------------------------------------------------------------
  // All healed outputs produce valid JSON
  // -----------------------------------------------------------------------

  describe("all healed outputs are valid JSON", () => {
    const testCases: string[] = [
      '{"location": "New York", "units": "metric"}',
      '[1, "two", true, null, {"nested": [3.14, false]}]',
      '{"a": {"b": {"c": {"d": "deep"}}}}',
      '"simple string"',
      "42",
      "true",
      "null",
      '{"escape": "line1\\nline2\\ttab\\u0041"}',
      '{"numbers": [-1, 0, 3.14, 1e10, -2.5e-3]}',
      "[[], {}, [[1, 2], [3, 4]]]",
      '{"empty": {}, "also_empty": []}',
    ];

    for (const input of testCases) {
      it(`valid at every byte for: ${input.substring(0, 50)}…`, () => {
        const p = new IncrementalJsonParser();
        for (let i = 0; i < input.length; i++) {
          p.write(input[i]!);
          const healed = p.getHealed();
          expect(() => JSON.parse(healed)).not.toThrow();
        }
        // Signal end-of-input (needed for top-level numbers that can't
        // self-terminate).
        p.end();
        // Final result should match the original input.
        expect(p.getHealed()).toBe(input);
        expect(p.isComplete).toBe(true);
      });
    }
  });

  // -----------------------------------------------------------------------
  // Healed output matches JSON.parse round-trip
  // -----------------------------------------------------------------------

  describe("healed output round-trips through JSON.parse", () => {
    it("incomplete object heals to parseable JSON", () => {
      parser.write('{"name": "Alice", "age": 3');
      const healed = parser.getHealed();
      const parsed = JSON.parse(healed);
      expect(parsed).toEqual({ name: "Alice", age: 3 });
    });

    it("nested incomplete heals to parseable JSON", () => {
      parser.write('{"items": [1, 2, {"sub": "val');
      const healed = parser.getHealed();
      const parsed = JSON.parse(healed);
      expect(parsed).toEqual({ items: [1, 2, { sub: "val" }] });
    });

    it("incomplete literal heals to correct value", () => {
      parser.write('{"done": fal');
      const parsed = JSON.parse(parser.getHealed());
      expect(parsed).toEqual({ done: false });
    });
  });

  // -----------------------------------------------------------------------
  // Whitespace handling
  // -----------------------------------------------------------------------

  describe("whitespace", () => {
    it("handles leading whitespace", () => {
      parser.write("  {");
      expect(parser.getHealed()).toBe("  {}");
    });

    it("handles whitespace between tokens", () => {
      parser.write('{ "a" : 1 }');
      expect(parser.getHealed()).toBe('{ "a" : 1 }');
      expect(parser.isComplete).toBe(true);
    });

    it("handles newlines and tabs", () => {
      parser.write('{\n\t"a":\n\t1');
      expect(parser.getHealed()).toBe('{\n\t"a":\n\t1}');
    });
  });
});
