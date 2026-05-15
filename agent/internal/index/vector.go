package index

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/binary"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	_ "modernc.org/sqlite"
)

// VectorStore persists code chunks and their embeddings to a SQLite file
// inside <workspaceRoot>/.loom/index.db. Searches use brute-force cosine
// similarity over all rows. For ~50k rows at 768 dims this is still
// sub-100ms in pure Go; switch to an ANN library if that ceases to hold.
type VectorStore struct {
	db  *sql.DB
	dim int
	mu  sync.Mutex
}

// OpenVectorStore opens (creating if needed) the SQLite database for the
// workspace and ensures the schema exists.
func OpenVectorStore(workspaceRoot string, dim int) (*VectorStore, error) {
	dir := filepath.Join(workspaceRoot, ".loom")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("create .loom dir: %w", err)
	}
	dbPath := filepath.Join(dir, "index.db")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	if _, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS chunks (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			path TEXT NOT NULL,
			start_line INTEGER NOT NULL,
			end_line INTEGER NOT NULL,
			content TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS chunks_path ON chunks(path);
		CREATE TABLE IF NOT EXISTS vectors (
			chunk_id INTEGER PRIMARY KEY REFERENCES chunks(id) ON DELETE CASCADE,
			dim INTEGER NOT NULL,
			data BLOB NOT NULL
		);
	`); err != nil {
		db.Close()
		return nil, fmt.Errorf("create schema: %w", err)
	}
	return &VectorStore{db: db, dim: dim}, nil
}

func (v *VectorStore) Close() error {
	if v == nil || v.db == nil {
		return nil
	}
	return v.db.Close()
}

// ReplaceFileChunks deletes any existing rows for path and inserts the new
// chunks + vectors atomically. Pass nil vectors to skip embedding (e.g. when
// content didn't change).
func (v *VectorStore) ReplaceFileChunks(path string, chunks []Chunk, vectors [][]float32) error {
	if v == nil {
		return nil
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	tx, err := v.db.Begin()
	if err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM vectors WHERE chunk_id IN (SELECT id FROM chunks WHERE path=?)`, path); err != nil {
		tx.Rollback()
		return err
	}
	if _, err := tx.Exec(`DELETE FROM chunks WHERE path=?`, path); err != nil {
		tx.Rollback()
		return err
	}
	insertChunk, err := tx.Prepare(`INSERT INTO chunks(path, start_line, end_line, content) VALUES(?,?,?,?)`)
	if err != nil {
		tx.Rollback()
		return err
	}
	defer insertChunk.Close()
	insertVec, err := tx.Prepare(`INSERT INTO vectors(chunk_id, dim, data) VALUES(?,?,?)`)
	if err != nil {
		tx.Rollback()
		return err
	}
	defer insertVec.Close()
	for i, c := range chunks {
		res, err := insertChunk.Exec(path, c.StartLine, c.EndLine, c.Content)
		if err != nil {
			tx.Rollback()
			return err
		}
		id, _ := res.LastInsertId()
		if i < len(vectors) && vectors[i] != nil {
			blob, err := encodeVector(vectors[i])
			if err != nil {
				tx.Rollback()
				return err
			}
			if _, err := insertVec.Exec(id, len(vectors[i]), blob); err != nil {
				tx.Rollback()
				return err
			}
		}
	}
	return tx.Commit()
}

// Chunk is a slice of file content paired with its line range.
type Chunk struct {
	StartLine int
	EndLine   int
	Content   string
}

// ChunkFile splits content into overlapping line windows.
func ChunkFile(content string, windowLines, overlap int) []Chunk {
	if windowLines <= 0 {
		windowLines = 40
	}
	if overlap < 0 || overlap >= windowLines {
		overlap = 10
	}
	lines := strings.Split(content, "\n")
	if len(lines) == 0 {
		return nil
	}
	step := windowLines - overlap
	out := make([]Chunk, 0, len(lines)/step+1)
	for start := 0; start < len(lines); start += step {
		end := start + windowLines
		if end > len(lines) {
			end = len(lines)
		}
		out = append(out, Chunk{
			StartLine: start + 1,
			EndLine:   end,
			Content:   strings.Join(lines[start:end], "\n"),
		})
		if end == len(lines) {
			break
		}
	}
	return out
}

// SearchHit is one result from Search.
type SearchHit struct {
	Path      string  `json:"path"`
	StartLine int     `json:"startLine"`
	EndLine   int     `json:"endLine"`
	Snippet   string  `json:"snippet"`
	Score     float32 `json:"score"`
}

// Search returns the top-k nearest chunks to query by cosine similarity.
func (v *VectorStore) Search(ctx context.Context, query []float32, k int) ([]SearchHit, error) {
	if v == nil {
		return nil, nil
	}
	if k <= 0 {
		k = 10
	}
	rows, err := v.db.QueryContext(ctx, `
		SELECT c.path, c.start_line, c.end_line, c.content, v.data
		FROM chunks c JOIN vectors v ON v.chunk_id = c.id
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	qn := norm(query)
	hits := make([]SearchHit, 0, k)
	for rows.Next() {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		var (
			path    string
			s, e    int
			content string
			blob    []byte
		)
		if err := rows.Scan(&path, &s, &e, &content, &blob); err != nil {
			return nil, err
		}
		vec, err := decodeVector(blob)
		if err != nil {
			continue
		}
		score := cosine(query, qn, vec)
		hits = append(hits, SearchHit{
			Path: path, StartLine: s, EndLine: e, Snippet: content, Score: score,
		})
	}
	sort.Slice(hits, func(i, j int) bool { return hits[i].Score > hits[j].Score })
	if len(hits) > k {
		hits = hits[:k]
	}
	return hits, nil
}

func encodeVector(v []float32) ([]byte, error) {
	buf := new(bytes.Buffer)
	for _, f := range v {
		if err := binary.Write(buf, binary.LittleEndian, f); err != nil {
			return nil, err
		}
	}
	return buf.Bytes(), nil
}

func decodeVector(b []byte) ([]float32, error) {
	if len(b)%4 != 0 {
		return nil, fmt.Errorf("vector blob length %d is not a multiple of 4", len(b))
	}
	out := make([]float32, len(b)/4)
	if err := binary.Read(bytes.NewReader(b), binary.LittleEndian, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func norm(v []float32) float32 {
	var s float64
	for _, x := range v {
		s += float64(x) * float64(x)
	}
	return float32(math.Sqrt(s))
}

func cosine(a []float32, normA float32, b []float32) float32 {
	if len(a) != len(b) || normA == 0 {
		return 0
	}
	var dot, nb float64
	for i := range a {
		dot += float64(a[i]) * float64(b[i])
		nb += float64(b[i]) * float64(b[i])
	}
	nbf := math.Sqrt(nb)
	if nbf == 0 {
		return 0
	}
	return float32(dot / (float64(normA) * nbf))
}
