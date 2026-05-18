package llm

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestAnthropicUserMessageIncludesImages(t *testing.T) {
	msgs, err := toAnthropicMessages([]Message{{
		Role:    RoleUser,
		Content: "what is this?",
		Images:  []Image{{MIMEType: "image/png", Data: "aGVsbG8="}},
	}})
	if err != nil {
		t.Fatalf("toAnthropicMessages: %v", err)
	}
	b, err := json.Marshal(msgs)
	if err != nil {
		t.Fatal(err)
	}
	got := string(b)
	for _, want := range []string{`"type":"text"`, `"type":"image"`, `"media_type":"image/png"`, `"data":"aGVsbG8="`} {
		if !strings.Contains(got, want) {
			t.Fatalf("anthropic message missing %s: %s", want, got)
		}
	}
}

func TestOpenAIUserMessageIncludesImages(t *testing.T) {
	msg := openAIUserMessage(Message{
		Role:    RoleUser,
		Content: "what is this?",
		Images:  []Image{{MIMEType: "image/png", Data: "aGVsbG8="}},
	})
	b, err := json.Marshal(msg)
	if err != nil {
		t.Fatal(err)
	}
	got := string(b)
	for _, want := range []string{`"type":"text"`, `"type":"image_url"`, `"url":"data:image/png;base64,aGVsbG8="`} {
		if !strings.Contains(got, want) {
			t.Fatalf("openai message missing %s: %s", want, got)
		}
	}
}
