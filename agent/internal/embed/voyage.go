package embed

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
)

type voyageProvider struct {
	apiKey string
	model  string
	dim    int
	http   *http.Client
}

func newVoyage(apiKey, model string) Provider {
	return &voyageProvider{
		apiKey: apiKey,
		model:  model,
		http:   &http.Client{},
	}
}

type voyageRequest struct {
	Input []string `json:"input"`
	Model string   `json:"model"`
}

type voyageResponse struct {
	Data []struct {
		Embedding []float32 `json:"embedding"`
	} `json:"data"`
}

func (p *voyageProvider) Embed(ctx context.Context, texts []string) ([][]float32, error) {
	body, err := json.Marshal(voyageRequest{Input: texts, Model: p.model})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.voyageai.com/v1/embeddings", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+p.apiKey)
	resp, err := p.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("voyage embed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return nil, fmt.Errorf("voyage returned %s", resp.Status)
	}
	var parsed voyageResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return nil, fmt.Errorf("voyage decode: %w", err)
	}
	if len(parsed.Data) != len(texts) {
		return nil, fmt.Errorf("voyage returned %d vectors for %d inputs", len(parsed.Data), len(texts))
	}
	out := make([][]float32, len(parsed.Data))
	for i := range parsed.Data {
		out[i] = parsed.Data[i].Embedding
		if p.dim == 0 && len(out[i]) > 0 {
			p.dim = len(out[i])
		}
	}
	return out, nil
}

func (p *voyageProvider) Dim() int     { return p.dim }
func (p *voyageProvider) Model() string { return p.model }
