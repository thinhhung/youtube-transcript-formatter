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
    fetchModelsBtn: document.getElementById("fetchModelsBtn")
  };

  const DEFAULT_MODELS = [
    { id: "gemma2-9b-it", name: "Gemma2 9b IT 70B (8K)" },
    { id: "llama-3.3-70b-versatile", name: "LLaMA 3.3 70B Versatile (128K)" },
    { id: "llama-3.1-8b-instant", name: "LLaMA 3.1 8B Instant (128K)" },
    { id: "llama-guard-3-8b", name: "LLaMA Guard 3 (8K)" },
    { id: "llama3-70b-8192", name: "LLaMA 3 70B (8K)" },
    { id: "llama3-8b-8192", name: "LLaMA 3 8B (8K)" }
  ];

  const DEFAULT_INSTRUCTIONS = "Format this YouTube transcript into a well-structured, readable format. Correct any obvious transcription errors.";

  let currentTranscript = "";

  // Initialize the extension
  async function initialize() {
    await loadSavedSettings();
    setupEventListeners();
    updateModelsList(DEFAULT_MODELS);
  }

  // Settings Management
  async function loadSavedSettings() {
    const settings = await chrome.storage.local.get([
      'groqApiKey',
      'formatInstructions',
      'selectedModel',
      'availableModels'
    ]);

    if (settings.groqApiKey) ELEMENTS.apiKey.value = settings.groqApiKey;
    if (settings.formatInstructions) ELEMENTS.formatInstructions.value = settings.formatInstructions;
    if (settings.selectedModel) ELEMENTS.modelSelect.value = settings.selectedModel;
    if (settings.availableModels) updateModelsList(settings.availableModels);
  }

  function saveSettings(key, value) {
    chrome.storage.local.set({ [key]: value });
  }

  // Model Management
  async function fetchGroqModels() {
    const apiKey = ELEMENTS.apiKey.value.trim();
    if (!apiKey) return updateModelsList(DEFAULT_MODELS);

    try {
      ELEMENTS.modelSelect.disabled = true;
      showStatus("Fetching available models...", "info");

      const response = await fetch("https://api.groq.com/openai/v1/models", {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        }
      });

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      
      const data = await response.json();
      const models = data.data.map(model => ({ id: model.id, name: model.id }));
      updateModelsList(models);
      saveSettings('availableModels', models);
      showStatus("Models updated successfully!", "success");
    } catch (error) {
      console.error("Error fetching models:", error);
      showStatus("Failed to fetch models. Using default list.", "error");
      updateModelsList(DEFAULT_MODELS);
    } finally {
      ELEMENTS.modelSelect.disabled = false;
    }
  }

  function updateModelsList(models) {
    ELEMENTS.modelSelect.innerHTML = models
      .map(model => `<option value="${model.id}">${model.name}</option>`)
      .join('');
  }

  // Transcript Management
  async function extractTranscript() {
    showStatus("Extracting transcript...", "info");
    
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs[0];

    if (!activeTab.url.includes("youtube.com/watch")) {
      showStatus("Please navigate to a YouTube video page", "error");
      return;
    }

    try {
      const response = await chrome.tabs.sendMessage(activeTab.id, { action: "extractTranscript" });
      
      if (response.success) {
        currentTranscript = response.transcript;
        ELEMENTS.transcriptDiv.textContent = currentTranscript;
        ELEMENTS.transcriptContainer.classList.remove("hidden");
        ELEMENTS.copyBtn.classList.remove("hidden");
        ELEMENTS.formatBtn.disabled = false;
        showStatus("Transcript extracted successfully!", "success");
      } else {
        throw new Error(response.error || "Unknown error");
      }
    } catch (error) {
      showStatus(`Failed to extract transcript: ${error.message}`, "error");
    }
  }

  async function formatTranscript() {
    const apiKey = ELEMENTS.apiKey.value.trim();
    if (!apiKey) return showStatus("Please enter your API key", "error");
    if (!currentTranscript) return showStatus("No transcript to format", "error");

    try {
      ELEMENTS.formatBtn.disabled = true;
      showStatus("Formatting transcript with Groq AI...", "info");

      const response = await chrome.runtime.sendMessage({
        action: "formatTranscript",
        transcript: currentTranscript,
        apiKey: apiKey,
        formatInstructions: ELEMENTS.formatInstructions.value.trim() || DEFAULT_INSTRUCTIONS,
        apiProvider: "groq",
        model: ELEMENTS.modelSelect.value
      });

      if (response.success) {
        currentTranscript = response.formattedText;
        ELEMENTS.transcriptDiv.textContent = currentTranscript;
        showStatus("Transcript formatted successfully!", "success");
      } else {
        throw new Error(response.error || "Unknown error");
      }
    } catch (error) {
      showStatus(`Failed to format transcript: ${error.message}`, "error");
    } finally {
      ELEMENTS.formatBtn.disabled = false;
    }
  }

  // Event Listeners
  function setupEventListeners() {
    ELEMENTS.apiKey.addEventListener("change", () => {
      saveSettings('groqApiKey', ELEMENTS.apiKey.value);
      fetchGroqModels();
    });

    ELEMENTS.formatInstructions.addEventListener("change", () => 
      saveSettings('formatInstructions', ELEMENTS.formatInstructions.value));

    ELEMENTS.modelSelect.addEventListener("change", () => 
      saveSettings('selectedModel', ELEMENTS.modelSelect.value));

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
    ELEMENTS.statusMessage.classList.remove("hidden");

    if (type === "success") {
      setTimeout(() => ELEMENTS.statusMessage.classList.add("hidden"), 3000);
    }
  }

  // Initialize the extension
  initialize();
});
