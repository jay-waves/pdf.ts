package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func testAIConfig(endpoint string) aiConfig {
	return aiConfig{Model: "test-model", BaseURL: endpoint, APIKey: "test-only-token", Prompt: "Translate into {{targetLanguage}}: %s"}
}

func installTestAIConfig(t *testing.T, config aiConfig) {
	t.Helper()
	previous := currentAIConfig()
	desktopAIConfigMutex.Lock()
	desktopAIConfig = config
	desktopAIConfigMutex.Unlock()
	t.Cleanup(func() {
		desktopAIConfigMutex.Lock()
		desktopAIConfig = previous
		desktopAIConfigMutex.Unlock()
	})
}

func TestAIConfigUpdates(t *testing.T) {
	previous := testAIConfig("https://example.test/v1")
	var update aiConfigUpdate
	if err := json.Unmarshal([]byte(`{"model":"new-model","baseUrl":"https://example.test/v1/","prompt":"Translate: %s"}`), &update); err != nil {
		t.Fatal(err)
	}
	config, err := applyAIConfigUpdate(previous, update)
	if err != nil {
		t.Fatal(err)
	}
	if config.APIKey != previous.APIKey || config.Model != "new-model" || config.BaseURL != "https://example.test/v1" {
		t.Fatal("configuration update or retained key is incorrect")
	}
	if previous.Model != "test-model" {
		t.Fatal("update mutated the original snapshot")
	}
	encoded, err := json.Marshal(config)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "test-only-token") {
		t.Fatal("API key leaked in JSON")
	}
	empty := ""
	cleared, err := applyAIConfigUpdate(config, aiConfigUpdate{APIKey: &empty, Prompt: &empty})
	if err != nil {
		t.Fatal(err)
	}
	if cleared.APIKey != "" || cleared.APIKeyConfigured || cleared.Prompt != defaultTranslationPrompt {
		t.Fatal("key clearing or default prompt restoration failed")
	}
	badURL := "https://user:password@example.test/v1"
	if _, err := applyAIConfigUpdate(config, aiConfigUpdate{BaseURL: &badURL}); err == nil {
		t.Fatal("URL containing credentials was accepted")
	}
}

func TestAITranslationUsesConfiguration(t *testing.T) {
	var received struct {
		Model           string `json:"model"`
		ReasoningEffort string `json:"reasoning_effort"`
		Messages        []struct {
			Content string `json:"content"`
		} `json:"messages"`
	}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/chat/completions" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer test-only-token" {
			t.Error("missing model credentials")
		}
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Error(err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"Bonjour"}}]}`))
	}))
	defer upstream.Close()
	config := testAIConfig(upstream.URL)
	installTestAIConfig(t, config)
	request := httptest.NewRequest(http.MethodPost, "/api/control/ai", strings.NewReader(`{"text":"Hello %s {{targetLanguage}}","targetLanguage":"fr"}`))
	response := httptest.NewRecorder()
	(&App{}).handleAI(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("request failed: %s", response.Body.String())
	}
	if received.Model != "test-model" || received.ReasoningEffort != "" {
		t.Fatal("configured model or provider-default reasoning was not applied")
	}
	if len(received.Messages) != 2 || received.Messages[1].Content != "Translate into fr: Hello %s {{targetLanguage}}" {
		t.Fatalf("unexpected prompt: %+v", received.Messages)
	}
	if !strings.Contains(response.Body.String(), "Bonjour") {
		t.Fatal("missing translation")
	}
}

func TestAIUnconfiguredBlocksRequestsAndRejectsCrossOrigin(t *testing.T) {
	config := testAIConfig("https://example.test/v1")
	config.APIKey = ""
	installTestAIConfig(t, config)
	response := httptest.NewRecorder()
	(&App{}).handleAI(response, httptest.NewRequest(http.MethodPost, "/api/control/ai", strings.NewReader(`{"text":"Hello"}`)))
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "ai_unconfigured") {
		t.Fatal("unconfigured LLM accepted a request")
	}
	request := httptest.NewRequest(http.MethodPut, "/api/control/ai-config", strings.NewReader(`{"model":"other"}`))
	request.Header.Set("Origin", "https://untrusted.example")
	response = httptest.NewRecorder()
	(&App{origin: "https://pdf.ts.localhost"}).handleAIConfig(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatal("cross-origin settings write accepted")
	}
}

func TestTranslationPromptWithoutPlaceholder(t *testing.T) {
	if got := translationPrompt("Translate into {{targetLanguage}}", "Hello", "fr"); got != "Translate into fr\n\nHello" {
		t.Fatalf("unexpected prompt: %q", got)
	}
}
