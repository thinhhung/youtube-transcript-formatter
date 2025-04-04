document.addEventListener("DOMContentLoaded", function () {
  const apiKeyInput = document.getElementById("apiKey");
  const formatInstructionsInput = document.getElementById("formatInstructions");
  const modelSelect = document.getElementById("modelSelect");
  const extractBtn = document.getElementById("extractBtn");
  const formatBtn = document.getElementById("formatBtn");
  const statusMessage = document.getElementById("statusMessage");
  const transcriptContainer = document.getElementById("transcriptContainer");
  const transcriptDiv = document.getElementById("transcript");
  const copyBtn = document.getElementById("copyBtn");

  let currentTranscript = "";

  // Fetch available models from Groq API when the popup loads
  const fetchModelsBtn = document.getElementById("fetchModelsBtn");

  fetchModelsBtn.addEventListener("click", function () {
    fetchGroqModels().then(() => {
      // Store models in local storage
      const models = Array.from(modelSelect.options).map(
        (option) => option.value
      );
      chrome.storage.local.set({ availableModels: models }, function () {
        console.log("Models stored in local storage:", models);
      });
    });
  });

  // Load saved API key if available
  chrome.storage.local.get(["groqApiKey"], function (result) {
    if (result.groqApiKey) {
      apiKeyInput.value = result.groqApiKey;
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
    chrome.storage.local.set({ groqApiKey: apiKeyInput.value });
  });

  // Save format instructions when changed
  formatInstructionsInput.addEventListener("change", function () {
    chrome.storage.local.set({
      formatInstructions: formatInstructionsInput.value,
    });
  });

  // Load saved settings
  chrome.storage.local.get(
    ["groqApiKey", "selectedModel", "availableModels"],
    function (result) {
      if (result.groqApiKey) {
        apiKeyInput.value = result.groqApiKey;
      }
      if (result.selectedModel) {
        modelSelect.value = result.selectedModel;
      }
      if (result.availableModels && Array.isArray(result.availableModels)) {
        // Clear existing options
        while (modelSelect.firstChild) {
          modelSelect.removeChild(modelSelect.firstChild);
        }

        // Add models from local storage to the dropdown
        result.availableModels.forEach((model) => {
          const option = document.createElement("option");
          option.value = model;
          option.textContent = model;
          modelSelect.appendChild(option);
        });

        // Restore previously selected model if it exists in the available models
        if (
          result.selectedModel &&
          result.availableModels.includes(result.selectedModel)
        ) {
          modelSelect.value = result.selectedModel;
        }
      }
    }
  );

  // Save model selection when changed
  modelSelect.addEventListener("change", function () {
    chrome.storage.local.set({ selectedModel: modelSelect.value });
  });

  // Function to fetch available models from Groq API
  async function fetchGroqModels() {
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
      // If no API key is available, use the default hardcoded models
      return;
    }

    try {
      // Show loading state
      modelSelect.disabled = true;

      // Fetch models from Groq API
      const response = await fetch("https://api.groq.com/openai/v1/models", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.status}`);
      }

      const data = await response.json();

      // Clear existing options
      while (modelSelect.firstChild) {
        modelSelect.removeChild(modelSelect.firstChild);
      }

      // Add models to select dropdown
      if (data.data && data.data.length > 0) {
        // Sort models by id
        data.data.sort((a, b) => a.id.localeCompare(b.id));

        // Add each model as an option
        data.data.forEach((model) => {
          const option = document.createElement("option");
          option.value = model.id;
          option.textContent = model.id;
          modelSelect.appendChild(option);
        });

        // Try to restore previously selected model
        chrome.storage.local.get(["selectedModel"], function (result) {
          if (result.selectedModel) {
            // Check if the previously selected model is still available
            const options = Array.from(modelSelect.options);
            const modelExists = options.some(
              (opt) => opt.value === result.selectedModel
            );

            if (modelExists) {
              modelSelect.value = result.selectedModel;
            }
          }
        });
      }
    } catch (error) {
      console.error("Error fetching Groq models:", error);
      // If there's an error, we'll keep using the default models
    } finally {
      modelSelect.disabled = false;
    }
  }

  // Fetch models when API key changes
  apiKeyInput.addEventListener("change", function () {
    fetchGroqModels();
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
      showStatus("Please enter your API key", "error");
      return;
    }

    if (!currentTranscript) {
      showStatus("No transcript to format", "error");
      return;
    }

    showStatus("Formatting transcript with Groq AI...", "info");
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
        apiProvider: "groq", // Always use Groq as the provider
        model: modelSelect.value, // Keeping parameter name for backward compatibility
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
