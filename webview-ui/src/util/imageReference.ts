import type { ImageReferenceAttachment } from "../../../src/shared/protocol";
import {
    IMAGE_REFERENCE_MIME_TYPES,
    MAX_IMAGE_REFERENCE_BYTES,
    MAX_IMAGE_REFERENCES_PER_TURN,
} from "../../../src/shared/references";

interface ClipboardItemLike {
    kind: string;
    type: string;
    getAsFile(): File | null;
}

interface ClipboardDataLike {
    items?: ArrayLike<ClipboardItemLike>;
    files?: ArrayLike<File>;
}

export async function imageReferencesFromClipboardData(
    clipboardData: ClipboardDataLike | undefined,
    existingImageCount: number,
): Promise<ImageReferenceAttachment[]> {
    if (!clipboardData) return [];
    const fromItems = Array.from(clipboardData.items ?? [])
        .filter((item) => item.kind === "file" && IMAGE_REFERENCE_MIME_TYPES.has(item.type))
        .map((item) => item.getAsFile())
        .filter((file): file is File => !!file);
    const fromFiles = Array.from(clipboardData.files ?? [])
        .filter((file) => IMAGE_REFERENCE_MIME_TYPES.has(file.type));
    const files = fromItems.length > 0 ? fromItems : fromFiles;
    const remaining = Math.max(0, MAX_IMAGE_REFERENCES_PER_TURN - existingImageCount);
    if (files.length === 0 || remaining === 0) return [];

    const refs: ImageReferenceAttachment[] = [];
    for (const file of files.slice(0, remaining)) {
        const ref = await imageReferenceFromFile(file);
        if (ref) refs.push(ref);
    }
    return refs;
}

export function clipboardHasSupportedImage(clipboardData: ClipboardDataLike | undefined): boolean {
    if (!clipboardData) return false;
    const items = Array.from(clipboardData.items ?? []);
    if (items.some((item) => item.kind === "file" && IMAGE_REFERENCE_MIME_TYPES.has(item.type))) {
        return true;
    }
    return Array.from(clipboardData.files ?? []).some((file) => IMAGE_REFERENCE_MIME_TYPES.has(file.type));
}

export async function imageReferenceFromFile(file: File, id = imageReferenceId()): Promise<ImageReferenceAttachment | undefined> {
    if (!IMAGE_REFERENCE_MIME_TYPES.has(file.type)) return undefined;
    if (file.size <= 0 || file.size > MAX_IMAGE_REFERENCE_BYTES) return undefined;
    const bytes = new Uint8Array(await file.arrayBuffer());
    return {
        id,
        kind: "image",
        label: file.name || "Pasted image",
        mimeType: file.type,
        data: bytesToBase64(bytes),
        size: file.size,
    };
}

function imageReferenceId(): string {
    const cryptoObj = globalThis.crypto;
    if (cryptoObj && "randomUUID" in cryptoObj && typeof cryptoObj.randomUUID === "function") {
        return `image:${cryptoObj.randomUUID()}`;
    }
    return `image:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function bytesToBase64(bytes: Uint8Array): string {
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    if (typeof btoa === "function") {
        return btoa(binary);
    }
    const maybeBuffer = (globalThis as unknown as {
        Buffer?: { from(data: Uint8Array): { toString(encoding: "base64"): string } };
    }).Buffer;
    if (maybeBuffer) return maybeBuffer.from(bytes).toString("base64");
    throw new Error("No base64 encoder available");
}
