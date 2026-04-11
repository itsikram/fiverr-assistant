// Debugging script for Gemini API issues
// Run this in browser console to test API step by step

function debugGeminiApi() {
  console.log("=== Gemini API Debug Tool ===\n");
  
  // Step 1: Check if we can access extension settings
  console.log("Step 1: Checking extension access...");
  try {
    if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
      console.log("✓ Browser storage available");
    } else {
      console.log("✗ Browser storage not available - run this on Fiverr page");
      return;
    }
  } catch (error) {
    console.error("✗ Extension access error:", error);
    return;
  }
  
  // Step 2: Get current settings
  console.log("\nStep 2: Getting current settings...");
  browser.storage.local.get(['geminiApiKey', 'geminiModel', 'disableImageProcessing'], (result) => {
    console.log("Current settings:", {
      hasApiKey: !!result.geminiApiKey,
      apiKeyLength: result.geminiApiKey ? result.geminiApiKey.length : 0,
      apiKeyPrefix: result.geminiApiKey ? result.geminiApiKey.substring(0, 10) + '...' : 'none',
      model: result.geminiModel || 'default',
      imageProcessingDisabled: result.disableImageProcessing || false
    });
    
    if (!result.geminiApiKey) {
      console.error("✗ No API key found in settings");
      console.log("Please add your API key in extension settings first");
      return;
    }
    
    // Step 3: Test API connectivity with current settings
    console.log("\nStep 3: Testing API connectivity...");
    testApiCall(result.geminiApiKey, result.geminiModel || 'gemini-2.5-flash');
  });
}

function testApiCall(apiKey, model) {
  const testUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const testBody = {
    contents: [{
      role: "user",
      parts: [{ text: "Hello, please respond with 'API test successful'" }]
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 50
    }
  };
  
  console.log("Making test request to:", testUrl.replace(/key=.*/, 'key=***REDACTED***'));
  console.log("Request body:", JSON.stringify(testBody, null, 2));
  
  fetch(`${testUrl}?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(testBody)
  })
  .then(response => {
    console.log("Response status:", response.status);
    console.log("Response headers:", Object.fromEntries(response.headers.entries()));
    
    return response.text();
  })
  .then(responseText => {
    console.log("Raw response:", responseText);
    
    try {
      const data = JSON.parse(responseText);
      console.log("Parsed response:", data);
      
      if (data.candidates && data.candidates[0] && data.candidates[0].content) {
        const generatedText = data.candidates[0].content.parts[0].text;
        console.log("✓ SUCCESS - Generated text:", generatedText);
        console.log("\n=== API is working correctly! ===");
        console.log("If the extension still doesn't work, the issue might be:");
        console.log("1. Extension not properly injected into Fiverr page");
        console.log("2. Content script blocked by browser/security");
        console.log("3. Extension settings not properly saved");
        console.log("4. Try reloading the Fiverr page after updating settings");
      } else {
        console.log("✗ No content in response");
      }
    } catch (parseError) {
      console.error("✗ JSON parse error:", parseError);
    }
  })
  .catch(error => {
    console.error("✗ Network/request error:", error);
    
    if (error.message.includes('Failed to fetch')) {
      console.log("This might be a CORS or network issue");
    }
  });
}

// Function to test if extension is properly injected
function testExtensionInjection() {
  console.log("\n=== Testing Extension Injection ===");
  
  // Check if we're on Fiverr
  if (!window.location.hostname.includes('fiverr.com')) {
    console.log("✗ Not on Fiverr.com - navigate to Fiverr first");
    return;
  }
  
  // Check if main functions exist
  const functions = [
    'geminiGenerateContent',
    'buildUserContentWithImages',
    'buildInboxTranscript',
    'attachToolbarButton'
  ];
  
  functions.forEach(funcName => {
    if (typeof window[funcName] === 'function') {
      console.log(`✓ ${funcName} function available`);
    } else {
      console.log(`✗ ${funcName} function NOT available`);
    }
  });
  
  // Check if UI elements exist
  const elements = [
    '.far-ia-ai-toggle',
    '.far-ia-task-modal',
    '[data-out]'
  ];
  
  elements.forEach(selector => {
    const element = document.querySelector(selector);
    if (element) {
      console.log(`✓ UI element found: ${selector}`);
    } else {
      console.log(`✗ UI element NOT found: ${selector}`);
    }
  });
}

// Instructions
console.log(`
=== Gemini API Debug Instructions ===

1. Open Fiverr.com in your browser
2. Open browser console (F12)
3. Run: debugGeminiApi()
4. Check the detailed logs
5. If API works but extension doesn't, run: testExtensionInjection()

Common issues:
- API key format (should start with "AIza")
- API key permissions (enable Gemini API at aistudio.google.com/app/apikey)
- Network connectivity
- Extension not properly loaded
- Browser security blocking content scripts

Available commands:
- debugGeminiApi() - Test API connectivity
- testExtensionInjection() - Test if extension is properly loaded
`);

// Export functions
if (typeof window !== 'undefined') {
  window.debugGeminiApi = debugGeminiApi;
  window.testExtensionInjection = testExtensionInjection;
}
