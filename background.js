// Background script for YouTube Transcript Formatter extension

// Listen for messages from the popup
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if (request.action === "formatTranscript") {
    formatWithChatGPT(
      request.transcript,
      request.apiKey,
      request.formatInstructions
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
 * Formats the transcript using OpenAI's ChatGPT API
 * @param {string} transcript - The raw transcript text
 * @param {string} apiKey - The OpenAI API key
 * @param {string} formatInstructions - Instructions for formatting
 * @returns {Promise<string>} The formatted transcript
 */
async function formatWithChatGPT(transcript, apiKey, formatInstructions) {
  try {
    // Prepare the API request
    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "llama3-70b-8192",
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
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(
        errorData.error?.message ||
          `API request failed with status ${response.status}`
      );
    }

    const data = await response.json();
    return data.choices[0].message.content.trim();
  } catch (error) {
    console.error("Error formatting with ChatGPT:", error);
    throw error;
  }
}
