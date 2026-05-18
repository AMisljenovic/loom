import { describe, expect, it } from "vitest";
import {
    clipboardHasSupportedImage,
    imageReferenceFromFile,
    imageReferencesFromClipboardData,
} from "./imageReference";

describe("imageReferenceFromFile", () => {
    it("converts supported image files to base64 references", async () => {
        const file = new File([new Uint8Array([104, 101, 108, 108, 111])], "shot.png", { type: "image/png" });

        await expect(imageReferenceFromFile(file, "image:test")).resolves.toEqual({
            id: "image:test",
            kind: "image",
            label: "shot.png",
            mimeType: "image/png",
            data: "aGVsbG8=",
            size: 5,
        });
    });

    it("rejects unsupported image types and oversized files", async () => {
        const bmp = new File([new Uint8Array([1])], "shot.bmp", { type: "image/bmp" });
        const huge = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "huge.png", { type: "image/png" });

        await expect(imageReferenceFromFile(bmp, "image:bmp")).resolves.toBeUndefined();
        await expect(imageReferenceFromFile(huge, "image:huge")).resolves.toBeUndefined();
    });
});

describe("imageReferencesFromClipboardData", () => {
    it("collects supported image clipboard items and caps total images", async () => {
        const png = new File([new Uint8Array([1])], "one.png", { type: "image/png" });
        const jpeg = new File([new Uint8Array([2])], "two.jpg", { type: "image/jpeg" });
        const clipboard = {
            items: [
                { kind: "file", type: "image/png", getAsFile: () => png },
                { kind: "file", type: "image/jpeg", getAsFile: () => jpeg },
            ],
        };

        expect(clipboardHasSupportedImage(clipboard)).toBe(true);
        const refs = await imageReferencesFromClipboardData(clipboard, 3);

        expect(refs).toHaveLength(1);
        expect(refs[0].label).toBe("one.png");
    });

    it("falls back to clipboard files when item files are absent", async () => {
        const webp = new File([new Uint8Array([3])], "shot.webp", { type: "image/webp" });
        const clipboard = { files: [webp] };

        const refs = await imageReferencesFromClipboardData(clipboard, 0);

        expect(refs).toHaveLength(1);
        expect(refs[0].mimeType).toBe("image/webp");
    });
});
