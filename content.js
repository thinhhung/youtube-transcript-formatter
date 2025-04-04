// This content script runs on YouTube pages and extracts video transcripts

// Constants for transcript extraction
const RE_YOUTUBE =
  /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.83 Safari/537.36,gzip(gfe)";
const RE_XML_TRANSCRIPT =
  /<text start="([^"]*)" dur="([^"]*)">([^<]*)<\/text>/g;

// Listen for messages from the popup
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if (request.action === "extractTranscript") {
    extractYouTubeTranscript()
      .then((transcript) => {
        sendResponse({ success: true, transcript: transcript });
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });
    return true; // Required for async sendResponse
  }
});

// Error classes for transcript extraction
class YoutubeTranscriptError extends Error {
  constructor(message) {
    super(`[YoutubeTranscript] 🚨 ${message}`);
  }
}

class YoutubeTranscriptTooManyRequestError extends YoutubeTranscriptError {
  constructor() {
    super(
      "YouTube is receiving too many requests from this IP and now requires solving a captcha to continue"
    );
  }
}

class YoutubeTranscriptVideoUnavailableError extends YoutubeTranscriptError {
  constructor(videoId) {
    super(`The video is no longer available (${videoId})`);
  }
}

class YoutubeTranscriptDisabledError extends YoutubeTranscriptError {
  constructor(videoId) {
    super(`Transcript is disabled on this video (${videoId})`);
  }
}

class YoutubeTranscriptNotAvailableError extends YoutubeTranscriptError {
  constructor(videoId) {
    super(`No transcripts are available for this video (${videoId})`);
  }
}

class YoutubeTranscriptNotAvailableLanguageError extends YoutubeTranscriptError {
  constructor(lang, availableLangs, videoId) {
    super(
      `No transcripts are available in ${lang} this video (${videoId}). Available languages: ${availableLangs.join(
        ", "
      )}`
    );
  }
}

/**
 * Extracts the transcript from a YouTube video page
 * @param {Object} config - Optional configuration for transcript extraction
 * @param {string} config.lang - Language code for transcript (e.g., 'en', 'es')
 * @returns {Promise<string>} The video transcript as a string
 */
async function extractYouTubeTranscript(config = { lang: "en" }) {
  try {
    // Get the video ID from the URL
    const videoId = retrieveVideoId(window.location.href);
    if (!videoId) {
      throw new YoutubeTranscriptError("Could not find YouTube video ID");
    }

    // Fetch the video page to get caption information
    const videoPageResponse = await fetch(
      `https://www.youtube.com/watch?v=${videoId}`,
      {
        headers: {
          ...(config?.lang && { "Accept-Language": config.lang }),
          "User-Agent": USER_AGENT,
        },
      }
    );
    const videoPageBody = await videoPageResponse.text();

    const splittedHTML = videoPageBody.split('"captions":');

    if (splittedHTML.length <= 1) {
      if (videoPageBody.includes('class="g-recaptcha"')) {
        throw new YoutubeTranscriptTooManyRequestError();
      }
      if (!videoPageBody.includes('"playabilityStatus":')) {
        throw new YoutubeTranscriptVideoUnavailableError(videoId);
      }
      throw new YoutubeTranscriptDisabledError(videoId);
    }

    const captions = (() => {
      try {
        return JSON.parse(
          splittedHTML[1].split(',"videoDetails')[0].replace("\n", "")
        );
      } catch (e) {
        return undefined;
      }
    })()?.["playerCaptionsTracklistRenderer"];

    if (!captions) {
      throw new YoutubeTranscriptDisabledError(videoId);
    }

    if (!("captionTracks" in captions)) {
      throw new YoutubeTranscriptNotAvailableError(videoId);
    }

    if (
      config?.lang &&
      !captions.captionTracks.some(
        (track) => track.languageCode === config?.lang
      )
    ) {
      throw new YoutubeTranscriptNotAvailableLanguageError(
        config?.lang,
        captions.captionTracks.map((track) => track.languageCode),
        videoId
      );
    }

    const transcriptURL = (
      config?.lang
        ? captions.captionTracks.find(
            (track) => track.languageCode === config?.lang
          )
        : captions.captionTracks[0]
    ).baseUrl;

    const transcriptResponse = await fetch(transcriptURL, {
      headers: {
        ...(config?.lang && { "Accept-Language": config.lang }),
        "User-Agent": USER_AGENT,
      },
    });

    if (!transcriptResponse.ok) {
      throw new YoutubeTranscriptNotAvailableError(videoId);
    }

    const transcriptBody = await transcriptResponse.text();
    const results = [...transcriptBody.matchAll(RE_XML_TRANSCRIPT)];

    // Convert the transcript segments to a single string
    let transcriptText = results.map((result) => result[3]).join(" ");
    return transcriptText.trim();
  } catch (error) {
    // If it's already a YoutubeTranscriptError, rethrow it
    if (error instanceof YoutubeTranscriptError) {
      throw error;
    }
    // Otherwise, try the fallback UI-based method
    console.warn(
      "API-based transcript extraction failed, trying UI method:",
      error
    );
    return await extractTranscriptFromPage();
  }
}

/**
 * Retrieve video id from url or string
 * @param {string} videoId video url or video id
 * @returns {string} The YouTube video ID
 */
function retrieveVideoId(videoId) {
  if (videoId.length === 11) {
    return videoId;
  }
  const matchId = videoId.match(RE_YOUTUBE);
  if (matchId && matchId.length) {
    return matchId[1];
  }
  throw new YoutubeTranscriptError("Impossible to retrieve YouTube video ID.");
}

/**
 * Extracts the transcript by interacting with YouTube's UI elements
 * @returns {Promise<string>} The video transcript as a string
 */
async function extractTranscriptFromPage() {
  // Check if transcript button exists
  const transcriptButton = await findTranscriptButton();
  if (!transcriptButton) {
    throw new Error("Transcript not available for this video");
  }

  // Click the transcript button if it's not already open
  if (!isTranscriptPanelOpen()) {
    transcriptButton.click();
    // Wait for transcript panel to load
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  // Extract text from transcript panel
  const transcriptPanel = document.querySelector("ytd-transcript-renderer");
  if (!transcriptPanel) {
    throw new Error("Could not find transcript panel");
  }

  const transcriptItems = transcriptPanel.querySelectorAll(
    "ytd-transcript-segment-renderer"
  );
  if (!transcriptItems || transcriptItems.length === 0) {
    throw new Error("No transcript segments found");
  }

  let transcript = "";
  transcriptItems.forEach((item) => {
    const textElement = item.querySelector(".segment-text");
    if (textElement) {
      transcript += textElement.textContent.trim() + " ";
    }
  });

  return transcript.trim();
}

/**
 * Finds the transcript button in YouTube's UI
 * @returns {Promise<Element|null>} Promise that resolves to the transcript button element or null if not found
 */
async function findTranscriptButton() {
  // Try direct selectors first (most reliable)
  const directSelectors = [
    'button[aria-label="Show transcript"]',
    'button.ytp-button[aria-label*="transcript"]',
    'button[data-tooltip-target-id="transcript"]',
    '.ytp-menuitem[aria-label*="transcript" i]',
    '.ytp-menuitem[aria-label*="Transcript" i]',
    'tp-yt-paper-item[aria-label*="transcript"]',
    'yt-formatted-string[aria-label*="transcript"]',
  ];

  for (const selector of directSelectors) {
    const button = document.querySelector(selector);
    if (button) return button;
  }

  // Try text content matching for various UI elements
  const textMatchSelectors = [
    "ytd-menu-service-item-renderer",
    "tp-yt-paper-item",
    '.ytp-panel-menu [role="menuitem"]',
    "button",
  ];

  for (const selector of textMatchSelectors) {
    const elements = document.querySelectorAll(selector);
    for (const element of elements) {
      if (
        element.textContent &&
        element.textContent.toLowerCase().includes("transcript")
      ) {
        return element;
      }
    }
  }

  // Try the more options button in the video player
  const moreButton = document.querySelector("button.ytp-more-button");
  if (moreButton) {
    moreButton.click();
    await new Promise((resolve) => setTimeout(resolve, 500));

    const menuItems = document.querySelectorAll(
      '.ytp-panel-menu [role="menuitem"]'
    );
    for (const item of menuItems) {
      if (
        item.textContent &&
        item.textContent.toLowerCase().includes("transcript")
      ) {
        return item;
      }
    }
  }

  // Try the three dots menu in the new YouTube UI
  const dotsMenu = document.querySelector(
    "ytd-menu-renderer yt-icon-button, ytd-menu-renderer #button"
  );
  if (dotsMenu) {
    dotsMenu.click();
    await new Promise((resolve) => setTimeout(resolve, 500));

    const menuItems = document.querySelectorAll(
      "ytd-menu-service-item-renderer, tp-yt-paper-listbox ytd-menu-service-item-renderer"
    );
    for (const item of menuItems) {
      if (
        item.textContent &&
        item.textContent.toLowerCase().includes("transcript")
      ) {
        return item;
      }
    }
  }

  // Try the engagement panel (sometimes contains transcript button)
  const engagementPanel = document.querySelector(
    "#engagement-panel-container, ytd-engagement-panel-section-list-renderer"
  );
  if (engagementPanel) {
    const buttons = engagementPanel.querySelectorAll(
      "button, yt-formatted-string"
    );
    for (const button of buttons) {
      if (
        button.textContent &&
        button.textContent.toLowerCase().includes("transcript")
      ) {
        return button;
      }
    }
  }

  // If all attempts fail, return null
  return null;
}

/**
 * Checks if the transcript panel is already open
 * @returns {boolean} True if transcript panel is open
 */
function isTranscriptPanelOpen() {
  return (
    !!document.querySelector("ytd-transcript-renderer") ||
    !!document.querySelector(
      'ytd-engagement-panel-section-list-renderer[data-panel-identifier="transcript"]'
    )
  );
}
