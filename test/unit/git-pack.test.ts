import { describe, it, expect } from "vitest";
import {
  pktLine,
  pktFlush,
  concatBytes,
  parsePktLines,
  bytesToHex,
  sideBandPacket,
  jsonResponse,
  buildPackfile,
  encoder,
  decoder,
} from "../../src/helpers/git-pack.js";

describe("pktLine", () => {
  it("encodes a string with 4-char hex length prefix", () => {
    const result = pktLine("# service=git-upload-pack\n");
    const text = decoder.decode(result);
    // Length = 4 (hex prefix) + payload length
    const expectedLen = (4 + "# service=git-upload-pack\n".length)
      .toString(16)
      .padStart(4, "0");
    expect(text.slice(0, 4)).toBe(expectedLen);
    expect(text.slice(4)).toBe("# service=git-upload-pack\n");
  });

  it("handles short strings", () => {
    const result = pktLine("a\n");
    const text = decoder.decode(result);
    expect(text).toBe("0006a\n");
  });
});

describe("pktFlush", () => {
  it("returns 0000", () => {
    const result = pktFlush();
    expect(decoder.decode(result)).toBe("0000");
  });
});

describe("concatBytes", () => {
  it("concatenates multiple Uint8Arrays", () => {
    const a = new Uint8Array([1, 2]);
    const b = new Uint8Array([3, 4, 5]);
    const c = new Uint8Array([6]);
    const result = concatBytes(a, b, c);
    expect(result).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6]));
  });

  it("handles empty arrays", () => {
    const result = concatBytes(new Uint8Array([]), new Uint8Array([1]));
    expect(result).toEqual(new Uint8Array([1]));
  });

  it("handles no arguments", () => {
    const result = concatBytes();
    expect(result.length).toBe(0);
  });
});

describe("parsePktLines", () => {
  it("round-trips with pktLine", () => {
    const lines = ["want abc123", "have def456"];
    const encoded = concatBytes(
      ...lines.map((l) => pktLine(l + "\n")),
      pktFlush()
    );
    const parsed = parsePktLines(encoded);
    expect(parsed).toEqual([...lines, "flush"]);
  });

  it("handles flush-only input", () => {
    const encoded = pktFlush();
    const parsed = parsePktLines(encoded);
    expect(parsed).toEqual(["flush"]);
  });

  it("handles empty input", () => {
    const parsed = parsePktLines(new Uint8Array(0));
    expect(parsed).toEqual([]);
  });
});

describe("bytesToHex", () => {
  it("converts bytes to hex string", () => {
    const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    expect(bytesToHex(bytes)).toBe("deadbeef");
  });

  it("pads single-digit hex values", () => {
    const bytes = new Uint8Array([0x00, 0x01, 0x0f]);
    expect(bytesToHex(bytes)).toBe("00010f");
  });
});

describe("sideBandPacket", () => {
  it("creates a packet with correct structure", () => {
    const data = encoder.encode("hello");
    const pkt = sideBandPacket(1, data);
    // Length = 4 hex + 1 band byte + data.length
    const expectedLen = 4 + 1 + data.length;
    expect(pkt.length).toBe(expectedLen);
    // Check hex length
    const hexLen = decoder.decode(pkt.slice(0, 4));
    expect(parseInt(hexLen, 16)).toBe(expectedLen);
    // Check band byte
    expect(pkt[4]).toBe(1);
    // Check data
    expect(decoder.decode(pkt.slice(5))).toBe("hello");
  });

  it("supports band 2 (progress)", () => {
    const data = encoder.encode("progress");
    const pkt = sideBandPacket(2, data);
    expect(pkt[4]).toBe(2);
  });
});

describe("jsonResponse", () => {
  it("returns JSON with correct content-type", async () => {
    const res = jsonResponse({ foo: "bar" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    const body = await res.json();
    expect(body).toEqual({ foo: "bar" });
  });

  it("supports custom status codes", async () => {
    const res = jsonResponse({ error: "not found" }, 404);
    expect(res.status).toBe(404);
  });
});

describe("buildPackfile", () => {
  it("produces a valid PACK header", async () => {
    const objects = [
      { hash: "abc123", type: "blob", content: encoder.encode("hello world") },
    ];
    const pack = await buildPackfile(objects);

    // Check PACK magic
    expect(decoder.decode(pack.slice(0, 4))).toBe("PACK");
    // Version 2
    expect(pack[4]).toBe(0);
    expect(pack[5]).toBe(0);
    expect(pack[6]).toBe(0);
    expect(pack[7]).toBe(2);
    // Object count = 1
    expect(pack[8]).toBe(0);
    expect(pack[9]).toBe(0);
    expect(pack[10]).toBe(0);
    expect(pack[11]).toBe(1);
    // Ends with 20-byte SHA-1 checksum
    expect(pack.length).toBeGreaterThan(12 + 20);
  });

  it("encodes correct object count for multiple objects", async () => {
    const objects = [
      { hash: "a", type: "blob", content: encoder.encode("one") },
      { hash: "b", type: "tree", content: encoder.encode("two") },
      { hash: "c", type: "commit", content: encoder.encode("three") },
    ];
    const pack = await buildPackfile(objects);
    const count =
      (pack[8] << 24) | (pack[9] << 16) | (pack[10] << 8) | pack[11];
    expect(count).toBe(3);
  });
});
