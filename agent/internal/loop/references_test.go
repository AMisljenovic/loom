package loop

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRenderReferencesFilePreview(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "src", "a.ts"), "export const a = 1;\n")

	out, images, err := RenderReferences(root, []Reference{{Kind: "file", Path: "src/a.ts"}})
	if err != nil {
		t.Fatalf("RenderReferences: %v", err)
	}
	if len(images) != 0 {
		t.Fatalf("expected no images, got %#v", images)
	}
	if !strings.Contains(out, `<reference kind="file" path="src/a.ts">`) {
		t.Fatalf("missing file reference: %s", out)
	}
	if !strings.Contains(out, "export const a = 1;") {
		t.Fatalf("missing file content: %s", out)
	}
}

func TestRenderReferencesFolderListing(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "src", "a.ts"), "a")
	mustWrite(t, filepath.Join(root, "src", "nested", "b.ts"), "b")

	out, _, err := RenderReferences(root, []Reference{{Kind: "folder", Path: "src"}})
	if err != nil {
		t.Fatalf("RenderReferences: %v", err)
	}
	if !strings.Contains(out, "src/a.ts") || !strings.Contains(out, "src/nested/") || !strings.Contains(out, "src/nested/b.ts") {
		t.Fatalf("missing folder entries: %s", out)
	}
}

func TestRenderReferencesRejectsEscapingPath(t *testing.T) {
	root := t.TempDir()
	_, _, err := RenderReferences(root, []Reference{{Kind: "file", Path: "../secret.txt"}})
	if err == nil || !strings.Contains(err.Error(), "escapes workspace") {
		t.Fatalf("expected escaping path error, got %v", err)
	}
}

func TestRenderReferencesBinaryAndTruncated(t *testing.T) {
	root := t.TempDir()
	mustWriteBytes(t, filepath.Join(root, "bin.dat"), []byte{0, 1, 2})
	mustWrite(t, filepath.Join(root, "large.txt"), strings.Repeat("x", maxReferenceFileBytes+10))

	out, _, err := RenderReferences(root, []Reference{
		{Kind: "file", Path: "bin.dat"},
		{Kind: "file", Path: "large.txt"},
	})
	if err != nil {
		t.Fatalf("RenderReferences: %v", err)
	}
	if !strings.Contains(out, "<binary") {
		t.Fatalf("missing binary marker: %s", out)
	}
	if !strings.Contains(out, `truncated="true"`) {
		t.Fatalf("missing truncation marker: %s", out)
	}
}

func TestRenderReferencesImage(t *testing.T) {
	out, images, err := RenderReferences("", []Reference{
		{ID: "image:1", Kind: "image", Label: "shot.png", MIMEType: "image/png", Data: "aGVsbG8=", Size: 5},
	})
	if err != nil {
		t.Fatalf("RenderReferences: %v", err)
	}
	if !strings.Contains(out, `<reference kind="image" label="shot.png" mime="image/png" size="5" />`) {
		t.Fatalf("missing image metadata: %s", out)
	}
	if len(images) != 1 || images[0].MIMEType != "image/png" || images[0].Data != "aGVsbG8=" {
		t.Fatalf("unexpected images: %#v", images)
	}
}

func TestRenderReferencesMixedKeepsImagesAfterTextCap(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "large1.txt"), strings.Repeat("x", maxReferenceFileBytes+100))
	mustWrite(t, filepath.Join(root, "large2.txt"), strings.Repeat("x", maxReferenceFileBytes+100))
	mustWrite(t, filepath.Join(root, "large3.txt"), strings.Repeat("x", maxReferenceFileBytes+100))

	out, images, err := RenderReferences(root, []Reference{
		{Kind: "file", Path: "large1.txt"},
		{Kind: "file", Path: "large2.txt"},
		{Kind: "file", Path: "large3.txt"},
		{ID: "image:1", Kind: "image", Label: "shot.png", MIMEType: "image/png", Data: "aGVsbG8=", Size: 5},
	})
	if err != nil {
		t.Fatalf("RenderReferences: %v", err)
	}
	if !strings.Contains(out, `reference total byte cap reached`) || !strings.Contains(out, `kind="image"`) {
		t.Fatalf("expected truncation marker and image metadata: %s", out)
	}
	if len(images) != 1 {
		t.Fatalf("expected image payload after text cap, got %#v", images)
	}
}

func mustWrite(t *testing.T, path string, body string) {
	t.Helper()
	mustWriteBytes(t, path, []byte(body))
}

func mustWriteBytes(t *testing.T, path string, body []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, body, 0o644); err != nil {
		t.Fatal(err)
	}
}
