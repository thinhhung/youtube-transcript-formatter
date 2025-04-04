// Background script for YouTube Transcript Formatter extension

// Listen for messages from the popup
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if (request.action === "formatTranscript") {
    formatWithChatGPT(
      request.transcript,
      request.apiKey,
      request.formatInstructions,
      request.apiProvider,
      request.model // Using model for backward compatibility
    )
      .then((formattedText) => {
        sendResponse({ success: true, formattedText: formattedText });
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });
    return true; // Required for async sendResponse
  }
});

/**
 * Formats the transcript using AI API (supports both chat and text-only models)
 * @param {string} transcript - The raw transcript text
 * @param {string} apiKey - The API key
 * @param {string} formatInstructions - Instructions for formatting
 * @param {string} apiProvider - The API provider (groq, openai, etc.)
 * @param {string} model - The model to use
 * @returns {Promise<string>} The formatted transcript
 */
async function formatWithChatGPT(
  transcript,
  apiKey,
  formatInstructions,
  apiProvider, // Kept for backward compatibility
  model = "llama3-70b-8192"
) {
  try {
    // Groq API endpoint and request format
    const apiEndpoint = "https://api.groq.com/openai/v1/chat/completions";

    // Default headers for all requests
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    };

    // Configure request for Groq API
    const requestBody = {
      model: model,
      messages: [
        {
          role: "system",
          content:
            "You are a helpful assistant that formats YouTube video transcripts.",
        },
        {
          role: "user",
          content: `${formatInstructions}\n\nHere is the transcript:\n${transcript}`,
        },
      ],
      temperature: 0.7,
      max_tokens: 4000,
    };

    // Make the API request
    const response = await fetch(apiEndpoint, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(
        errorData.error?.message ||
          `API request failed with status ${response.status}`
      );
    }

    const data = await response.json();

    // Handle response format from Groq API
    return data.choices[0].message.content.trim();
  } catch (error) {
    console.error("Error formatting with ChatGPT:", error);
    throw error;
  }
}
