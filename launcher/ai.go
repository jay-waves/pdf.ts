package main

import (
	"encoding/json"
	"net/http"
	"strings"

	openai "github.com/sashabaranov/go-openai"
)

type aiRequest struct {
	Text              string `json:"text"`
	TargetLanguage    string `json:"targetLanguage"`
	Lookup            bool   `json:"lookup"`
	APIKey            string `json:"apiKey"`
	BaseURL           string `json:"baseUrl"`
	Model             string `json:"model"`
	TranslationPrompt string `json:"translationPrompt"`
	LookupPrompt      string `json:"lookupPrompt"`
}

type aiResponse struct {
	Text    string `json:"text,omitempty"`
	Message string `json:"message,omitempty"`
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
	if input.Text == "" || input.APIKey == "" || input.BaseURL == "" || input.Model == "" {
		writeJSONError(response, http.StatusBadRequest, "invalid_ai_request", "Text, API key, base URL, and model are required.")
		return
	}
	config := openai.DefaultConfig(input.APIKey)
	config.BaseURL = strings.TrimRight(input.BaseURL, "/")
	client := openai.NewClientWithConfig(config)
	prompt := input.TranslationPrompt + "\nTarget language: " + input.TargetLanguage + ". Text:\n" + input.Text
	if input.Lookup {
		prompt = input.LookupPrompt + "\nTarget language: " + input.TargetLanguage + ". Word: " + input.Text
	}
	completion, err := client.CreateChatCompletion(request.Context(), openai.ChatCompletionRequest{Model: input.Model, Messages: []openai.ChatCompletionMessage{{Role: openai.ChatMessageRoleSystem, Content: aiSystemPrompt}, {Role: openai.ChatMessageRoleUser, Content: prompt}}, Temperature: 0})
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
