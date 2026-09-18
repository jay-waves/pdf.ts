package main

import (
	"encoding/json"
	"net/http"
	"strings"

	openai "github.com/sashabaranov/go-openai"
)

type aiRequest struct {
	Text   string `json:"text"`
	Lookup bool   `json:"lookup"`
}

type aiResponse struct {
	Text    string `json:"text,omitempty"`
	Message string `json:"message,omitempty"`
}

type aiConfig struct { APIKey string `json:"-"`; APIKeyConfigured bool `json:"apiKeyConfigured"`; BaseURL string `json:"baseUrl"`; Model string `json:"model"`; TranslationPrompt string `json:"translationPrompt"`; LookupPrompt string `json:"lookupPrompt"` }
type aiConfigUpdate struct { APIKey *string `json:"apiKey"`; BaseURL *string `json:"baseUrl"`; Model *string `json:"model"`; TranslationPrompt *string `json:"translationPrompt"`; LookupPrompt *string `json:"lookupPrompt"` }
var desktopAIConfig aiConfig

func (app *App) handleAIConfig(response http.ResponseWriter, request *http.Request) {
	if !app.sameOrigin(request) { writeJSONError(response, http.StatusForbidden, "forbidden_origin", "The AI config request did not come from this pdf.ts instance."); return }
	switch request.Method {
	case http.MethodGet: config := desktopAIConfig; config.APIKeyConfigured = config.APIKey != ""; writeJSON(response, http.StatusOK, config)
	case http.MethodPut: var input aiConfigUpdate; if err := json.NewDecoder(http.MaxBytesReader(response, request.Body, 64<<10)).Decode(&input); err != nil { writeJSONError(response, http.StatusBadRequest, "invalid_ai_config", "Invalid AI config."); return }; config := desktopAIConfig; if input.APIKey != nil && *input.APIKey != "" { config.APIKey = *input.APIKey }; if input.BaseURL != nil { config.BaseURL = *input.BaseURL }; if input.Model != nil { config.Model = *input.Model }; if input.TranslationPrompt != nil { config.TranslationPrompt = *input.TranslationPrompt }; if input.LookupPrompt != nil { config.LookupPrompt = *input.LookupPrompt }; desktopAIConfig = config; response.WriteHeader(http.StatusNoContent)
	default: response.Header().Set("Allow", "GET, PUT"); http.Error(response, "method not allowed", http.StatusMethodNotAllowed)
	}
}

const aiSystemPrompt = `You are a precise reading assistant. Use non-thinking mode and answer only with the requested result.
For translation, translate the supplied text into the target language. Preserve meaning, tone, names, formatting, and paragraph breaks. Do not explain your choices.
For dictionary lookup, give a concise definition in the target language, part of speech, and a short explanation of the word's usage. Keep the answer brief and do not use markdown headings.`

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
	var input aiRequest
	if err := json.NewDecoder(http.MaxBytesReader(response, request.Body, 64<<10)).Decode(&input); err != nil {
		writeJSONError(response, http.StatusBadRequest, "invalid_ai_request", "Invalid AI request.")
		return
	}
	if input.Text == "" || desktopAIConfig.APIKey == "" || desktopAIConfig.BaseURL == "" || desktopAIConfig.Model == "" {
		writeJSONError(response, http.StatusBadRequest, "invalid_ai_request", "Text, API key, base URL, and model are required.")
		return
	}
	config := openai.DefaultConfig(desktopAIConfig.APIKey)
	config.BaseURL = strings.TrimRight(desktopAIConfig.BaseURL, "/")
	client := openai.NewClientWithConfig(config)
	prompt := strings.Replace(desktopAIConfig.TranslationPrompt, "%s", input.Text, 1)
	if input.Lookup {
		prompt = strings.Replace(desktopAIConfig.LookupPrompt, "%s", input.Text, 1)
	}
	completion, err := client.CreateChatCompletion(request.Context(), openai.ChatCompletionRequest{Model: desktopAIConfig.Model, Messages: []openai.ChatCompletionMessage{{Role: openai.ChatMessageRoleSystem, Content: aiSystemPrompt}, {Role: openai.ChatCompletionMessage{Role: openai.ChatMessageRoleUser, Content: prompt}}}, Temperature: 0})
	if err != nil {
		writeJSON(response, http.StatusBadGateway, aiResponse{Message: err.Error()})
		return
	}
	if len(completion.Choices) == 0 || strings.TrimSpace(completion.Choices[0].Message.Content) == "" {
		writeJSON(response, http.StatusBadGateway, aiResponse{Message: "The AI service returned an empty response."})
		return
	}
	writeJSON(response, http.StatusOK, aiResponse{Text: strings.TrimSpace(completion.Choices[0].Message.Content)})
}
