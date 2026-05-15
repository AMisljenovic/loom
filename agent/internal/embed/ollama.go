package embed

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

type ollamaProvider struct {
	host  string
	model string
	dim   int
	http  *http.Client
}

func newOllama(host, model string) Provider {
	return &ollamaProvider{
		host:  strings.TrimRight(host, "/"),
		model: model,
		http:  &http.Client{},
	}
}

type ollamaEmbedRequest struct {
	Model string `json:"model"`
	Input string `json:"input"`
}

type ollamaEmbedResponse struct {
	Embedding []float32 `json:"embedding"`
}

func (p *ollamaProvider) Embed(ctx context.Context, texts []string) ([][]float32, error) {
	out := make([][]float32, len(texts))
	for i, t := range texts {
		body, err := json.Marshal(ollamaEmbedRequest{Model: p.model, Input: t})
		if err != nil {
			return nil, err
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.host+"/api/embeddings", bytes.NewReader(body))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Content-Type", "application/json")
		resp, err := p.http.Do(req)
		if err != nil {
			return nil, fmt.Errorf("ollama embed: %w", err)
		}
		var parsed ollamaEmbedResponse
		dec := json.NewDecoder(resp.Body)
		err = dec.Decode(&parsed)
		resp.Body.Close()
		if err != nil {
			return nil, fmt.Errorf("ollama decode: %w", err)
		}
		if len(parsed.Embedding) == 0 {
			return nil, fmt.Errorf("ollama returned empty embedding for input %d", i)
		}
		out[i] = parsed.Embedding
		if p.dim == 0 {
			p.dim = len(parsed.Embedding)
		}
	}
	return out, nil
}

func (p *ollamaProvider) Dim() int     { return p.dim }
func (p *ollamaProvider) Model() string { return p.model }
