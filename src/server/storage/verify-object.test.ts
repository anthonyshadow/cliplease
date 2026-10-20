import { afterEach, describe, expect, it, vi } from "vitest";
import { localDriver, storage } from "./index";
import {
  checkPartList,
  hasJpegSignature,
  hasVideoSignature,
  verifyUploadedObject,
} from "./verify-object";

const MIB = 1024 ** 2;

/** 12 bytes: a 4-byte box size, then the box name, then 4 more bytes. */
function box(name: string): Uint8Array {
  return new Uint8Array([
    0x00,
    0x00,
    0x00,
    0x20,
    ...Buffer.from(name, "latin1"),
    0x69,
    0x73,
    0x6f,
    0x6d,
  ]);
}

describe("hasVideoSignature", () => {
  it.each(["ftyp", "moov", "mdat", "wide", "free", "skip"])(
    "accepts a %s box",
    (name) => {
      expect(hasVideoSignature(box(name))).toBe(true);
    },
  );

  it("accepts a real MP4 header (ftyp isom)", () => {
    const header = Buffer.from("0000001c6674797069736f6d00000200", "hex");
    expect(hasVideoSignature(header)).toBe(true);
  });

  it("refuses an unknown box, an upper-case name and zero bytes", () => {
    expect(hasVideoSignature(box("abcd"))).toBe(false);
    expect(hasVideoSignature(box("FTYP"))).toBe(false);
    expect(hasVideoSignature(new Uint8Array(12))).toBe(false);
  });

  it("refuses a PNG and a JPEG", () => {
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
    const jpeg = Buffer.from("ffd8ffe000104a4649460001", "hex");
    expect(hasVideoSignature(png)).toBe(false);
    expect(hasVideoSignature(jpeg)).toBe(false);
  });

  it("needs at least 12 bytes", () => {
    const full = box("ftyp");
    expect(hasVideoSignature(full.subarray(0, 11))).toBe(false);
    expect(hasVideoSignature(full.subarray(0, 8))).toBe(false);
    expect(hasVideoSignature(new Uint8Array())).toBe(false);
    expect(hasVideoSignature(full.subarray(0, 12))).toBe(true);
  });

  it("looks at bytes 4..7 only, not at the start", () => {
    const shifted = new Uint8Array([
      ...Buffer.from("ftyp"),
      ...new Uint8Array(8),
    ]);
    expect(hasVideoSignature(shifted)).toBe(false);
  });
});

describe("hasJpegSignature", () => {
  it("accepts FF D8 FF", () => {
    expect(hasJpegSignature(new Uint8Array([0xff, 0xd8, 0xff]))).toBe(true);
    expect(
      hasJpegSignature(Buffer.from("ffd8ffe000104a4649460001", "hex")),
    ).toBe(true);
  });

  it("refuses a PNG, an MP4, a near miss and a short buffer", () => {
    expect(
      hasJpegSignature(Buffer.from("89504e470d0a1a0a0000000d", "hex")),
    ).toBe(false);
    expect(hasJpegSignature(box("ftyp"))).toBe(false);
    expect(hasJpegSignature(new Uint8Array([0xff, 0xd8, 0xfe]))).toBe(false);
    expect(hasJpegSignature(new Uint8Array([0xff, 0xd8]))).toBe(false);
    expect(hasJpegSignature(new Uint8Array())).toBe(false);
  });
});

describe("checkPartList (R2's rules, 07 D80)", () => {
  const partSize = 16 * MIB;
  const size = 40 * MIB; // 16 + 16 + 8
  const parts = (...sizes: number[]) =>
    sizes.map((s, i) => ({ partNumber: i + 1, size: s }));

  it("accepts the exact parts", () => {
    expect(
      checkPartList(parts(16 * MIB, 16 * MIB, 8 * MIB), { size, partSize }),
    ).toBe("ok");
  });

  it("accepts a size that is an exact multiple (the last part full)", () => {
    expect(
      checkPartList(parts(16 * MIB, 16 * MIB), { size: 32 * MIB, partSize }),
    ).toBe("ok");
  });

  it("accepts a single last part smaller than partSize", () => {
    expect(checkPartList(parts(1000), { size: 1000, partSize })).toBe("ok");
  });

  it("refuses a missing part", () => {
    expect(
      checkPartList(
        [
          { partNumber: 1, size: 16 * MIB },
          { partNumber: 3, size: 8 * MIB },
        ],
        { size, partSize },
      ),
    ).toBe("parts_incomplete");
    expect(checkPartList(parts(16 * MIB, 16 * MIB), { size, partSize })).toBe(
      "parts_incomplete",
    );
  });

  it("refuses a short middle part", () => {
    expect(
      checkPartList(parts(16 * MIB, 16 * MIB - 1, 8 * MIB + 1), {
        size,
        partSize,
      }),
    ).toBe("parts_incomplete");
  });

  it("refuses a wrong sum (a short or long last part)", () => {
    expect(
      checkPartList(parts(16 * MIB, 16 * MIB, 8 * MIB - 1), { size, partSize }),
    ).toBe("parts_incomplete");
    expect(
      checkPartList(parts(16 * MIB, 16 * MIB, 8 * MIB + 1), { size, partSize }),
    ).toBe("parts_incomplete");
  });

  it("refuses an extra part", () => {
    expect(
      checkPartList(parts(16 * MIB, 16 * MIB, 8 * MIB, 1), { size, partSize }),
    ).toBe("parts_incomplete");
  });

  it("refuses parts out of order and a duplicate part number", () => {
    expect(
      checkPartList(
        [
          { partNumber: 2, size: 16 * MIB },
          { partNumber: 1, size: 16 * MIB },
          { partNumber: 3, size: 8 * MIB },
        ],
        { size, partSize },
      ),
    ).toBe("parts_incomplete");
    expect(
      checkPartList(
        [
          { partNumber: 1, size: 16 * MIB },
          { partNumber: 1, size: 16 * MIB },
          { partNumber: 3, size: 8 * MIB },
        ],
        { size, partSize },
      ),
    ).toBe("parts_incomplete");
  });

  it("refuses an empty list", () => {
    expect(checkPartList([], { size, partSize })).toBe("parts_incomplete");
  });
});

describe("verifyUploadedObject (storage() spied, nothing on disk)", () => {
  const KEY =
    "originals/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.mp4";
  const original = {
    kind: "original",
    declaredSize: 4096,
    maxBytes: 2 * 1024 ** 3,
  } as const;
  const enoent = () =>
    Object.assign(new Error("ENOENT: no such file or directory, open"), {
      code: "ENOENT",
    });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** The test env runs the local driver, so spying on its singleton spies on storage(). */
  function driver() {
    const local = localDriver();
    expect(storage()).toBe(local);
    return local;
  }

  it("is not_found when the object vanishes between HEAD and the read", async () => {
    const local = driver();
    const head = vi
      .spyOn(local, "head")
      .mockResolvedValueOnce({ size: 4096, contentType: null })
      .mockResolvedValueOnce(null);
    const readRange = vi.spyOn(local, "readRange").mockRejectedValue(enoent());
    expect(await verifyUploadedObject(KEY, original)).toBe("not_found");
    expect(head).toHaveBeenCalledTimes(2);
    expect(readRange).toHaveBeenCalledWith(KEY, 0, 11);
  });

  it("rethrows a read error when the object is still there", async () => {
    const local = driver();
    vi.spyOn(local, "head").mockResolvedValue({
      size: 4096,
      contentType: null,
    });
    const failure = Object.assign(new Error("EIO: i/o error, read"), {
      code: "EIO",
    });
    vi.spyOn(local, "readRange").mockRejectedValue(failure);
    await expect(verifyUploadedObject(KEY, original)).rejects.toBe(failure);
  });

  it("is not_found when HEAD finds nothing, without reading", async () => {
    const local = driver();
    vi.spyOn(local, "head").mockResolvedValue(null);
    const readRange = vi.spyOn(local, "readRange");
    expect(await verifyUploadedObject(KEY, original)).toBe("not_found");
    expect(readRange).not.toHaveBeenCalled();
  });

  it("is size_mismatch for another size or one over maxBytes, without reading", async () => {
    const local = driver();
    const head = vi.spyOn(local, "head");
    const readRange = vi.spyOn(local, "readRange");
    head.mockResolvedValue({ size: 4095, contentType: null });
    expect(await verifyUploadedObject(KEY, original)).toBe("size_mismatch");
    head.mockResolvedValue({ size: 4096, contentType: null });
    expect(
      await verifyUploadedObject(KEY, { ...original, maxBytes: 4095 }),
    ).toBe("size_mismatch");
    expect(readRange).not.toHaveBeenCalled();
  });

  it("checks the first bytes against the kind", async () => {
    const local = driver();
    vi.spyOn(local, "head").mockResolvedValue({
      size: 4096,
      contentType: null,
    });
    const readRange = vi.spyOn(local, "readRange");
    readRange.mockResolvedValue(box("ftyp"));
    expect(await verifyUploadedObject(KEY, original)).toBe("ok");
    readRange.mockResolvedValue(new Uint8Array(12));
    expect(await verifyUploadedObject(KEY, original)).toBe(
      "bad_signature_bytes",
    );
    readRange.mockResolvedValue(Buffer.from("ffd8ffe000104a4649460001", "hex"));
    expect(
      await verifyUploadedObject(KEY, { ...original, kind: "poster" }),
    ).toBe("ok");
    readRange.mockResolvedValue(box("ftyp"));
    expect(
      await verifyUploadedObject(KEY, { ...original, kind: "poster" }),
    ).toBe("bad_signature_bytes");
  });
});
