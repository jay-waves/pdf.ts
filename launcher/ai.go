package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"sync"

	openai "github.com/sashabaranov/go-openai"
)

type aiRequest struct {
	Text           string `json:"text"`
	TargetLanguage string `json:"targetLanguage"`
}

type aiResponse struct {
	Text    string `json:"text,omitempty"`
	Message string `json:"message,omitempty"`
}

type aiConfig struct {
	Model            string `json:"model"`
	BaseURL          string `json:"baseUrl"`
	APIKey           string `json:"-"`
	APIKeyConfigured bool   `json:"apiKeyConfigured"`
	Prompt           string `json:"prompt"`
}

type aiConfigUpdate struct {
	Model   *string `json:"model"`
	BaseURL *string `json:"baseUrl"`
	APIKey  *string `json:"apiKey"`
	Prompt  *string `json:"prompt"`
}

const defaultTranslationPrompt = "Translate the following text into {{targetLanguage}}. Preserve meaning, tone, names, formatting, and paragraph breaks. Output only the translation.\n\n%s"

var desktopAIConfig = aiConfig{Model: "deepseek-flash", BaseURL: "https://api.deepseek.com", Prompt: defaultTranslationPrompt}
var desktopAIConfigMutex sync.RWMutex

func currentAIConfig() aiConfig {
	desktopAIConfigMutex.RLock()
	defer desktopAIConfigMutex.RUnlock()
	return desktopAIConfig
}

func applyAIConfigUpdate(previous aiConfig, update aiConfigUpdate) (aiConfig, error) {
	config := previous
	if update.Model != nil {
		config.Model = strings.TrimSpace(*update.Model)
	}
	if update.BaseURL != nil {
		config.BaseURL = strings.TrimRight(strings.TrimSpace(*update.BaseURL), "/")
	}
	if update.APIKey != nil {
		config.APIKey = strings.TrimSpace(*update.APIKey)
	}
	if update.Prompt != nil {
		config.Prompt = *update.Prompt
	}
	if config.BaseURL != "" {
		endpoint, err := url.Parse(config.BaseURL)
		if err != nil || endpoint.Host == "" || (endpoint.Scheme != "https" && endpoint.Scheme != "http") || endpoint.User != nil || endpoint.RawQuery != "" || endpoint.Fragment != "" {
			return previous, errors.New("Base URL must be an HTTP(S) endpoint without credentials, query, or fragment.")
		}
	}
	if strings.TrimSpace(config.Prompt) == "" {
		config.Prompt = defaultTranslationPrompt
	}
	config.APIKeyConfigured = config.APIKey != ""
	return config, nil
}

func (app *App) handleAIConfig(response http.ResponseWriter, request *http.Request) {
	response.Header().Set("Cache-Control", "no-store")
	if !app.sameOrigin(request) {
		writeJSONError(response, http.StatusForbidden, "forbidden_origin", "The AI config request did not come from this pdf.ts instance.")
		return
	}
	switch request.Method {
	case http.MethodGet:
		config := currentAIConfig()
		config.APIKeyConfigured = config.APIKey != ""
		writeJSON(response, http.StatusOK, config)
	case http.MethodPut:
		var input aiConfigUpdate
		if err := json.NewDecoder(http.MaxBytesReader(response, request.Body, 256<<10)).Decode(&input); err != nil {
			writeJSONError(response, http.StatusBadRequest, "invalid_ai_config", "Invalid AI config.")
			return
		}
		desktopAIConfigMutex.Lock()
		config, err := applyAIConfigUpdate(desktopAIConfig, input)
		if err == nil {
			desktopAIConfig = config
		}
		desktopAIConfigMutex.Unlock()
		if err != nil {
			writeJSONError(response, http.StatusBadRequest, "invalid_ai_config", err.Error())
			return
		}
		response.WriteHeader(http.StatusNoContent)
	default:
		response.Header().Set("Allow", "GET, PUT")
		http.Error(response, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func translationPrompt(template, text, target string) string {
	prompt := strings.ReplaceAll(template, "{{targetLanguage}}", target)
	// Insert source text last so placeholders inside the selection remain literal.
	if strings.Contains(prompt, "%s") {
		return strings.Replace(prompt, "%s", text, 1)
	}
	return prompt + "\n\n" + text
}

func (app *App) handleAI(response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		response.Header().Set("Allow", http.MethodPost)
		http.Error(response, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !app.sameOrigin(request) {
		writeJSONError(response, http.StatusForbidden, "forbidden_origin", "The AI request did not come from this pdf.ts instance.")
		return
	}
	config := currentAIConfig()
	if config.Model == "" || config.BaseURL == "" || config.APIKey == "" {
		writeJSONError(response, http.StatusBadRequest, "ai_unconfigured", "Configure Model name, Base URL, and API key in Developer > LLM.")
		return
	}
	var input aiRequest
	if err := json.NewDecoder(http.MaxBytesReader(response, request.Body, 64<<10)).Decode(&input); err != nil || strings.TrimSpace(input.Text) == "" {
		writeJSONError(response, http.StatusBadRequest, "invalid_ai_request", "Translation text is required.")
		return
	}
	clientConfig := openai.DefaultConfig(config.APIKey)
	clientConfig.BaseURL = config.BaseURL
	client := openai.NewClientWithConfig(clientConfig)
	completion, err := client.CreateChatCompletion(request.Context(), openai.ChatCompletionRequest{
		Model: config.Model,
		Messages: []openai.ChatCompletionMessage{
			{Role: openai.ChatMessageRoleSystem, Content: "Follow the user's translation instructions. Return only the translation."},
			{Role: openai.ChatMessageRoleUser, Content: translationPrompt(config.Prompt, input.Text, input.TargetLanguage)},
		},
	})
	if err != nil {
		// Upstream errors can echo request credentials; expose a bounded message.
		writeJSON(response, http.StatusBadGateway, aiResponse{Message: "The LLM provider rejected the request. Check the model name, base URL, and API key."})
		return
	}
	if len(completion.Choices) == 0 || strings.TrimSpace(completion.Choices[0].Message.Content) == "" {
		writeJSON(response, http.StatusBadGateway, aiResponse{Message: "The AI service returned an empty response."})
		return
	}
	writeJSON(response, http.StatusOK, aiResponse{Text: strings.TrimSpace(completion.Choices[0].Message.Content)})
}
