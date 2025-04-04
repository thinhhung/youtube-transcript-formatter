document.addEventListener("DOMContentLoaded", function () {
  // Constants and Element References
  const ELEMENTS = {
    apiKey: document.getElementById("apiKey"),
    formatInstructions: document.getElementById("formatInstructions"),
    modelSelect: document.getElementById("modelSelect"),
    extractBtn: document.getElementById("extractBtn"),
    formatBtn: document.getElementById("formatBtn"),
    statusMessage: document.getElementById("statusMessage"),
    transcriptContainer: document.getElementById("transcriptContainer"),
    transcriptDiv: document.getElementById("transcript"),
    copyBtn: document.getElementById("copyBtn"),
    fetchModelsBtn: document.getElementById("fetchModelsBtn"),
  };

  const DEFAULT_MODELS = [
    { id: "gemma2-9b-it", name: "Gemma2 9b IT" },
    { id: "llama-3.3-70b-versatile", name: "LLaMA 3.3 70B Versatile" },
    { id: "llama-3.1-8b-instant", name: "LLaMA 3.1 8B Instant" },
    { id: "llama-guard-3-8b", name: "LLaMA Guard 3 8B" },
    { id: "llama3-70b-8192", name: "LLaMA 3 70B" },
    { id: "llama3-8b-8192", name: "LLaMA 3 8B" },
  ];

  // Add missing styles for status messages
  const statusStyles = {
    info: { backgroundColor: "#cce5ff", color: "#004085" },
    success: { backgroundColor: "#d4edda", color: "#155724" },
    error: { backgroundColor: "#f8d7da", color: "#721c24" },
  };

  let currentTranscript = "";

  // Initialize the extension
  async function initialize() {
    await loadSavedSettings();
    setupEventListeners();
    updateUIState();
  }

  // Settings Management
  async function loadSavedSettings() {
    try {
      const settings = await chrome.storage.local.get([
        "groqApiKey",
        "formatInstructions",
        "selectedModel",
        "availableModels",
      ]);

      if (settings.groqApiKey) ELEMENTS.apiKey.value = settings.groqApiKey;
      if (settings.formatInstructions)
        ELEMENTS.formatInstructions.value = settings.formatInstructions;
      if (
        settings.selectedModel &&
        ELEMENTS.modelSelect.querySelector(
          `option[value="${settings.selectedModel}"]`
        )
      )
        ELEMENTS.modelSelect.value = settings.selectedModel;
      if (settings.availableModels && settings.availableModels.length > 0)
        updateModelsList(settings.availableModels);
    } catch (error) {
      console.error("Error loading settings:", error);
    }
  }

  function saveSettings(key, value) {
    chrome.storage.local.set({ [key]: value });
  }

  // UI State Management
  function updateUIState() {
    const hasApiKey = ELEMENTS.apiKey.value.trim() !== "";
    ELEMENTS.fetchModelsBtn.disabled = !hasApiKey;

    // Only update models list if it's empty
    if (ELEMENTS.modelSelect.options.length === 0) {
      updateModelsList(DEFAULT_MODELS);
    }

    updateFormatButtonText();
  }

  function updateFormatButtonText() {
    if (ELEMENTS.modelSelect.selectedIndex >= 0) {
      const modelName =
        ELEMENTS.modelSelect.options[ELEMENTS.modelSelect.selectedIndex].text;
      const providerName = modelName.split(" ")[0];
      ELEMENTS.formatBtn.textContent = `Format with ${providerName}`;
    } else {
      ELEMENTS.formatBtn.textContent = "Format with AI";
    }
  }

  // Model Management
  function updateModelsList(models) {
    if (!models || !Array.isArray(models) || models.length === 0) {
      console.error("Invalid models data:", models);
      return;
    }

    // Save current selection if possible
    const currentSelection = ELEMENTS.modelSelect.value;

    ELEMENTS.modelSelect.innerHTML = "";
    models.forEach((model) => {
      const option = document.createElement("option");
      option.value = model.id;
      option.textContent = model.name;
      ELEMENTS.modelSelect.appendChild(option);
    });

    // Restore previous selection if it exists in the new list
    if (
      currentSelection &&
      Array.from(ELEMENTS.modelSelect.options).some(
        (opt) => opt.value === currentSelection
      )
    ) {
      ELEMENTS.modelSelect.value = currentSelection;
    }

    // Save the current model selection
    saveSettings("selectedModel", ELEMENTS.modelSelect.value);

    updateFormatButtonText();
  }

  async function fetchGroqModels() {
    const apiKey = ELEMENTS.apiKey.value.trim();
    if (!apiKey) {
      showStatus("Please enter your API key first", "error");
      return;
    }

    try {
      ELEMENTS.modelSelect.disabled = true;
      ELEMENTS.fetchModelsBtn.disabled = true;
      showStatus("Fetching available models...", "info");

      const response = await fetch("https://api.groq.com/openai/v1/models", {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok)
        throw new Error(`HTTP error! status: ${response.status}`);

      const data = await response.json();
      if (!data.data || !Array.isArray(data.data)) {
        throw new Error("Invalid response format from API");
      }

      const models = data.data.map((model) => ({
        id: model.id,
        name: model.id,
      }));

      if (models.length === 0) {
        throw new Error("No models returned from API");
      }

      updateModelsList(models);
      saveSettings("availableModels", models);
      showStatus("Models updated successfully!", "success");
    } catch (error) {
      console.error("Error fetching models:", error);
      showStatus(`Failed to fetch models: ${error.message}`, "error");
      updateModelsList(DEFAULT_MODELS);
    } finally {
      ELEMENTS.modelSelect.disabled = false;
      ELEMENTS.fetchModelsBtn.disabled = false;
    }
  }

  // Transcript Management
  async function extractTranscript() {
    showStatus("Extracting transcript...", "info");

    try {
      const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      const activeTab = tabs[0];

      if (!activeTab.url.includes("youtube.com/watch")) {
        showStatus("Please navigate to a YouTube video page", "error");
        return;
      }

      const response = await chrome.tabs.sendMessage(activeTab.id, {
        action: "extractTranscript",
      });

      if (response && response.success) {
        currentTranscript = response.transcript;
        ELEMENTS.transcriptDiv.textContent = currentTranscript;
        ELEMENTS.transcriptContainer.classList.remove("hidden");
        ELEMENTS.copyBtn.classList.remove("hidden");
        ELEMENTS.formatBtn.disabled = false;
        showStatus("Transcript extracted successfully!", "success");
      } else {
        throw new Error(response ? response.error : "Unknown error");
      }
    } catch (error) {
      showStatus(`Failed to extract transcript: ${error.message}`, "error");
    }
  }

  async function formatTranscript() {
    const apiKey = ELEMENTS.apiKey.value.trim();
    if (!apiKey) {
      showStatus("Please enter your API key", "error");
      return;
    }

    if (!currentTranscript) {
      showStatus("No transcript to format", "error");
      return;
    }

    try {
      ELEMENTS.formatBtn.disabled = true;
      showStatus("Formatting transcript with AI...", "info");

      const formatInstructions =
        ELEMENTS.formatInstructions.value.trim() ||
        "Format this YouTube transcript into a well-structured, readable format. Correct any obvious transcription errors.";

      const response = await chrome.runtime.sendMessage({
        action: "formatTranscript",
        transcript: currentTranscript,
        apiKey: apiKey,
        formatInstructions: formatInstructions,
        model: ELEMENTS.modelSelect.value,
      });

      if (response && response.success) {
        currentTranscript = response.formattedText;
        ELEMENTS.transcriptDiv.textContent = currentTranscript;
        showStatus("Transcript formatted successfully!", "success");
      } else {
        throw new Error(response ? response.error : "Unknown error");
      }
    } catch (error) {
      showStatus(`Failed to format transcript: ${error.message}`, "error");
    } finally {
      ELEMENTS.formatBtn.disabled = false;
    }
  }

  // Event Listeners
  function setupEventListeners() {
    ELEMENTS.apiKey.addEventListener("input", () => {
      const hasApiKey = ELEMENTS.apiKey.value.trim() !== "";
      ELEMENTS.fetchModelsBtn.disabled = !hasApiKey;
    });

    ELEMENTS.apiKey.addEventListener("change", () => {
      saveSettings("groqApiKey", ELEMENTS.apiKey.value);
    });

    ELEMENTS.modelSelect.addEventListener("change", () => {
      saveSettings("selectedModel", ELEMENTS.modelSelect.value);
      updateFormatButtonText();
    });

    ELEMENTS.extractBtn.addEventListener("click", extractTranscript);
    ELEMENTS.formatBtn.addEventListener("click", formatTranscript);
    ELEMENTS.fetchModelsBtn.addEventListener("click", fetchGroqModels);

    ELEMENTS.copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(currentTranscript);
        showStatus("Copied to clipboard!", "success");
      } catch (error) {
        showStatus("Failed to copy to clipboard", "error");
      }
    });
  }

  // Status Management
  function showStatus(message, type) {
    ELEMENTS.statusMessage.textContent = message;
    ELEMENTS.statusMessage.className = `status ${type}`;
    Object.assign(ELEMENTS.statusMessage.style, statusStyles[type]);
    ELEMENTS.statusMessage.classList.remove("hidden");

    if (type === "success") {
      setTimeout(() => {
        ELEMENTS.statusMessage.classList.add("hidden");
        ELEMENTS.statusMessage.style = ""; // Reset inline styles
      }, 3000);
    }
  }

  // Initialize the extension
  initialize();
});
