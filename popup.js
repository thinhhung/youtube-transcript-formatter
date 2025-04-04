document.addEventListener("DOMContentLoaded", function () {
  const apiKeyInput = document.getElementById("apiKey");
  const formatInstructionsInput = document.getElementById("formatInstructions");
  const extractBtn = document.getElementById("extractBtn");
  const formatBtn = document.getElementById("formatBtn");
  const statusMessage = document.getElementById("statusMessage");
  const transcriptContainer = document.getElementById("transcriptContainer");
  const transcriptDiv = document.getElementById("transcript");
  const copyBtn = document.getElementById("copyBtn");

  let currentTranscript = "";

  // Load saved API key if available
  chrome.storage.local.get(["openaiApiKey"], function (result) {
    if (result.openaiApiKey) {
      apiKeyInput.value = result.openaiApiKey;
    }
  });

  // Load saved format instructions if available
  chrome.storage.local.get(["formatInstructions"], function (result) {
    if (result.formatInstructions) {
      formatInstructionsInput.value = result.formatInstructions;
    }
  });

  // Save API key when changed
  apiKeyInput.addEventListener("change", function () {
    chrome.storage.local.set({ openaiApiKey: apiKeyInput.value });
  });

  // Save format instructions when changed
  formatInstructionsInput.addEventListener("change", function () {
    chrome.storage.local.set({
      formatInstructions: formatInstructionsInput.value,
    });
  });

  // Extract transcript button click handler
  extractBtn.addEventListener("click", function () {
    showStatus("Extracting transcript...", "info");

    // Query the active tab to get the current YouTube video
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      const activeTab = tabs[0];

      // Check if we're on a YouTube video page
      if (!activeTab.url.includes("youtube.com/watch")) {
        showStatus("Please navigate to a YouTube video page", "error");
        return;
      }

      // Send message to content script to extract transcript
      chrome.tabs.sendMessage(
        activeTab.id,
        { action: "extractTranscript" },
        function (response) {
          if (chrome.runtime.lastError) {
            showStatus("Error: " + chrome.runtime.lastError.message, "error");
            return;
          }

          if (response && response.success) {
            currentTranscript = response.transcript;
            transcriptDiv.textContent = currentTranscript;
            transcriptContainer.classList.remove("hidden");
            copyBtn.classList.remove("hidden");
            formatBtn.disabled = false;
            showStatus("Transcript extracted successfully!", "success");
          } else {
            showStatus(
              "Failed to extract transcript: " +
                (response ? response.error : "Unknown error"),
              "error"
            );
          }
        }
      );
    });
  });

  // Format transcript button click handler
  formatBtn.addEventListener("click", function () {
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
      showStatus("Please enter your OpenAI API key", "error");
      return;
    }

    if (!currentTranscript) {
      showStatus("No transcript to format", "error");
      return;
    }

    showStatus("Formatting transcript with ChatGPT...", "info");
    formatBtn.disabled = true;

    const formatInstructions =
      formatInstructionsInput.value.trim() ||
      "Format this YouTube transcript into a well-structured, readable format. Correct any obvious transcription errors.";

    // Send message to background script to format transcript
    chrome.runtime.sendMessage(
      {
        action: "formatTranscript",
        transcript: currentTranscript,
        apiKey: apiKey,
        formatInstructions: formatInstructions,
      },
      function (response) {
        formatBtn.disabled = false;

        if (chrome.runtime.lastError) {
          showStatus("Error: " + chrome.runtime.lastError.message, "error");
          return;
        }

        if (response && response.success) {
          currentTranscript = response.formattedText;
          transcriptDiv.textContent = currentTranscript;
          showStatus("Transcript formatted successfully!", "success");
        } else {
          showStatus(
            "Failed to format transcript: " +
              (response ? response.error : "Unknown error"),
            "error"
          );
        }
      }
    );
  });

  // Copy to clipboard button click handler
  copyBtn.addEventListener("click", function () {
    navigator.clipboard.writeText(currentTranscript).then(
      function () {
        showStatus("Copied to clipboard!", "success");
      },
      function () {
        showStatus("Failed to copy to clipboard", "error");
      }
    );
  });

  // Helper function to show status messages
  function showStatus(message, type) {
    statusMessage.textContent = message;
    statusMessage.className = "status " + type;
    statusMessage.classList.remove("hidden");

    // Hide success messages after 3 seconds
    if (type === "success") {
      setTimeout(function () {
        statusMessage.classList.add("hidden");
      }, 3000);
    }
  }
});
